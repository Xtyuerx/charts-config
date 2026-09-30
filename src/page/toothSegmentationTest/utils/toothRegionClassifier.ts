import * as THREE from 'three'

import type { ToothBoundary } from './toothBoundaryEditorUtils'
import { boundaryControlVectors } from './toothBoundaryEditorUtils'
import {
  buildSurfaceGraph,
  createClosedSurfacePath,
  type ClosedSurfacePath,
  type SurfaceGraph,
} from './surfaceBoundaryUtils'

type FaceNeighbor = {
  edgeKey: string
  neighbor: number
}

export type ToothRegionTopology = {
  graph: SurfaceGraph
  faceNeighbors: FaceNeighbor[][]
}

export type ClassifiedToothRegion = {
  toothId: number
  triangleIndices: number[]
  blockedEdgeCount: number
}

export function quantizedPositionKey(position: THREE.BufferAttribute, index: number, precision: number) {
  return `${Math.round(position.getX(index) * precision)}:${Math.round(
    position.getY(index) * precision,
  )}:${Math.round(position.getZ(index) * precision)}`
}

export function canonicalQuantizedEdgeKey(from: string, to: string) {
  return from < to ? `${from}|${to}` : `${to}|${from}`
}

export function buildToothRegionTopology(geometry: THREE.BufferGeometry) {
  const graph = buildSurfaceGraph(geometry)
  // 与编辑路径共享精确面邻接；不在确认时另行焊接近邻表面。
  const faceNeighbors = graph.surface.faces.map((face, index) =>
    face.portals.map((portal) => ({ edgeKey: facePairKey(index, portal.face), neighbor: portal.face })),
  )
  return { graph, faceNeighbors } satisfies ToothRegionTopology
}

function facePairKey(a: number, b: number) {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

/** 同一三角面内的线段相交，使用该面的法向，避免世界 XY 投影。 */
function segmentsCross(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, normal: THREE.Vector3, epsilon: number) {
  const side = (p: THREE.Vector3, q: THREE.Vector3, r: THREE.Vector3) =>
    new THREE.Vector3().subVectors(q, p).cross(new THREE.Vector3().subVectors(r, p)).dot(normal)
  const tolerance = epsilon * Math.max(a.distanceTo(b), c.distanceTo(d), epsilon)
  const s1 = side(a, b, c), s2 = side(a, b, d), s3 = side(c, d, a), s4 = side(c, d, b)
  const opposite = (x: number, y: number) => (x > tolerance && y < -tolerance) || (x < -tolerance && y > tolerance)
  if (opposite(s1, s2) && opposite(s3, s4)) return true
  const on = (p: THREE.Vector3, q: THREE.Vector3, r: THREE.Vector3, s: number) =>
    Math.abs(s) <= tolerance && new THREE.Line3(p, q).closestPointToPoint(r, true, new THREE.Vector3()).distanceTo(r) <= epsilon
  return on(a, b, c, s1) || on(a, b, d, s2) || on(c, d, a, s3) || on(c, d, b, s4)
}

function boundaryBlockedEdges(topology: ToothRegionTopology, boundary: ToothBoundary, displayedPath?: ClosedSurfacePath) {
  const path = displayedPath ?? createClosedSurfacePath(topology.graph, boundaryControlVectors(boundary))
  const { faces, tree, epsilon } = topology.graph.surface
  if (path.anchorPoints.length !== boundary.boundary.length || path.segmentPoints.length !== boundary.boundary.length) {
    throw new Error('显示边界与控制点数量不一致，请重新生成边界')
  }
  const blockedEdges = new Set<string>()
  path.segmentPoints.forEach((segment, index) => {
    const from = new THREE.Vector3(...boundary.boundary[index]!.position)
    const to = new THREE.Vector3(...boundary.boundary[(index + 1) % boundary.boundary.length]!.position)
    if (segment.length < 2 || segment[0]!.distanceTo(from) > epsilon || segment[segment.length - 1]!.distanceTo(to) > epsilon) {
      throw new Error('显示边界已过期，请重新生成边界后确认')
    }
    for (let i = 1; i < segment.length; i++) {
      const a = segment[i - 1]!, b = segment[i]!
      if (a.distanceTo(b) <= epsilon) continue
      const midpoint = a.clone().lerp(b, 0.5)
      const hit = tree.closestPointToPoint(midpoint)
      if (!hit || hit.distance > epsilon) throw new Error('Boundary 采样线段未贴合 STL 表面')
      const candidates = [hit.faceIndex, ...faces[hit.faceIndex]!.portals.map((p) => p.face)]
      for (const faceIndex of candidates) {
        const face = faces[faceIndex]!
        const onFace = (point: THREE.Vector3) => face.triangle.closestPointToPoint(point, new THREE.Vector3()).distanceTo(point) <= epsilon
        if (!onFace(a) || !onFace(b)) continue
        for (const portal of face.portals) {
          // 面中心 -> 公共边中点 -> 邻面中心是区域生长的对偶连接。
          // 只要当前显示路径截断任一半段，就阻止跨过该邻接关系。
          const edgeMidpoint = portal.a.clone().lerp(portal.b, 0.5)
          if (segmentsCross(a, b, face.center, edgeMidpoint, face.normal, epsilon)) {
            blockedEdges.add(facePairKey(faceIndex, portal.face))
          }
        }
      }
    }
  })
  return blockedEdges
}

type FaceComponents = {
  faceComponentIndices: number[]
  components: number[][]
}

function buildFaceComponents(
  topology: ToothRegionTopology,
  blockedEdges: ReadonlySet<string> = new Set(),
): FaceComponents {
  const faceComponentIndices = new Array<number>(topology.faceNeighbors.length).fill(-1)
  const components: number[][] = []

  for (let firstFace = 0; firstFace < topology.faceNeighbors.length; firstFace += 1) {
    if (faceComponentIndices[firstFace] !== -1) continue
    const componentIndex = components.length
    const component = [firstFace]
    faceComponentIndices[firstFace] = componentIndex
    for (let cursor = 0; cursor < component.length; cursor += 1) {
      const faceIndex = component[cursor]!
      for (const edge of topology.faceNeighbors[faceIndex] ?? []) {
        if (blockedEdges.has(edge.edgeKey) || faceComponentIndices[edge.neighbor] !== -1) continue
        faceComponentIndices[edge.neighbor] = componentIndex
        component.push(edge.neighbor)
      }
    }
    components.push(component.sort((first, second) => first - second))
  }
  return { faceComponentIndices, components }
}

export function classifyToothRegion(
  topology: ToothRegionTopology,
  boundary: ToothBoundary,
  options: { surfacePath?: ClosedSurfacePath; seedFaceIndices?: readonly number[] } = {},
): ClassifiedToothRegion {
  const blockedEdges = boundaryBlockedEdges(topology, boundary, options.surfacePath)
  const boundaryAdjacentFaces = new Set<number>()
  topology.faceNeighbors.forEach((neighbors, faceIndex) => {
    neighbors.forEach((edge) => {
      if (!blockedEdges.has(edge.edgeKey)) return
      boundaryAdjacentFaces.add(faceIndex)
      boundaryAdjacentFaces.add(edge.neighbor)
    })
  })
  if (!boundaryAdjacentFaces.size) {
    throw new Error('Boundary 未分割任何 STL 表面连通分量')
  }

  const originalComponents = buildFaceComponents(topology)
  const sourceComponentIndices = new Set(
    Array.from(boundaryAdjacentFaces, (faceIndex) =>
      originalComponents.faceComponentIndices[faceIndex]!,
    ),
  )
  if (sourceComponentIndices.size !== 1) {
    throw new Error('Boundary 未分割同一原始 STL 表面连通分量')
  }

  const splitComponents = buildFaceComponents(topology, blockedEdges)
  const boundaryAdjacentComponentIndices = new Set(
    Array.from(boundaryAdjacentFaces, (faceIndex) =>
      splitComponents.faceComponentIndices[faceIndex]!,
    ),
  )
  if (boundaryAdjacentComponentIndices.size < 2) {
    throw new Error('Boundary 未分割其原始 STL 表面连通分量')
  }

  const sourceComponentIndex = Array.from(sourceComponentIndices)[0]!
  const seededComponents = new Set((options.seedFaceIndices ?? []).map((face) => {
    if (!Number.isInteger(face) || face < 0 || face >= topology.faceNeighbors.length) throw new Error('种子三角面编号无效')
    return splitComponents.faceComponentIndices[face]!
  }))
  if (seededComponents.size > 1) throw new Error('种子区域跨越当前 Boundary，请调整边界或重新圈选种子')
  const seededComponent = seededComponents.values().next().value
  if (seededComponent !== undefined && !boundaryAdjacentComponentIndices.has(seededComponent)) throw new Error('种子不在当前 Boundary 相邻区域内')
  if (seededComponent === undefined && boundaryAdjacentComponentIndices.size > 2) throw new Error('Boundary 产生多个候选区域，请重新圈选内部种子后确认')
  const candidateComponents = seededComponent === undefined ? boundaryAdjacentComponentIndices : new Set([seededComponent])
  const triangleIndices = Array.from(candidateComponents, (componentIndex) =>
    splitComponents.components[componentIndex]!,
  ).sort(
    (first, second) => first.length - second.length || first[0]! - second[0]!,
  )[0]!
  if (originalComponents.faceComponentIndices[triangleIndices[0]!] !== sourceComponentIndex) {
    throw new Error('Boundary 未分割其原始 STL 表面连通分量')
  }
  return {
    toothId: boundary.toothId,
    triangleIndices,
    blockedEdgeCount: blockedEdges.size,
  }
}

export function prepareConfirmedToothRegion(
  currentLabels: readonly number[],
  toothId: number,
  triangleIndices: readonly number[],
) {
  const nextLabels = currentLabels.map((label) => (label === toothId ? 0 : label))
  const conflicts = new Map<number, number>()
  triangleIndices.forEach((triangleIndex) => {
    const label = Number(nextLabels[triangleIndex] ?? 0)
    if (label && label !== toothId) conflicts.set(label, (conflicts.get(label) ?? 0) + 1)
  })
  if (conflicts.size) {
    const details = Array.from(conflicts.entries())
      .sort(([a], [b]) => a - b)
      .map(([label, count]) => `牙号 ${label}（${count} 个三角形）`)
      .join('、')
    throw new Error(`当前区域与已确认区域重叠：${details}`)
  }
  triangleIndices.forEach((triangleIndex) => {
    if (triangleIndex >= 0 && triangleIndex < nextLabels.length) {
      nextLabels[triangleIndex] = toothId
    }
  })
  return nextLabels
}

export function applyConfirmedToothRegion(
  triangleLabels: number[],
  toothId: number,
  triangleIndices: number[],
) {
  return prepareConfirmedToothRegion(triangleLabels, toothId, triangleIndices)
}

export function buildConfirmedToothGeometry(
  source: THREE.BufferGeometry,
  triangleIndices: readonly number[],
): THREE.BufferGeometry {
  const position = source.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!position) throw new Error('STL geometry 缺少 position 属性')
  const sourceIndex = source.getIndex()
  const triangleCount = Math.floor((sourceIndex?.count ?? position.count) / 3)
  const positions = new Float32Array(triangleIndices.length * 9)

  triangleIndices.forEach((triangleIndex, outputTriangleIndex) => {
    if (!Number.isInteger(triangleIndex) || triangleIndex < 0 || triangleIndex >= triangleCount) {
      throw new Error(`三角面索引 ${triangleIndex} 超出 STL 范围`)
    }
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const sourceVertexIndex = sourceIndex
        ? sourceIndex.getX(triangleIndex * 3 + vertex)
        : triangleIndex * 3 + vertex
      const outputOffset = outputTriangleIndex * 9 + vertex * 3
      positions[outputOffset] = position.getX(sourceVertexIndex)
      positions[outputOffset + 1] = position.getY(sourceVertexIndex)
      positions[outputOffset + 2] = position.getZ(sourceVertexIndex)
    }
  })

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return geometry
}

export function commitConfirmedToothTransaction<T>(
  apply: () => T,
  rollback: () => void,
  cleanupPrevious: () => void,
) {
  let result: T
  try {
    result = apply()
  } catch (error) {
    rollback()
    throw error
  }
  try {
    cleanupPrevious()
  } catch {
    // Derived-Mesh cleanup must not roll back an already committed region.
  }
  return result
}

export function groupConfirmedTriangles(triangleLabels: number[]) {
  const grouped = new Map<number, number[]>()
  triangleLabels.forEach((toothId, triangleIndex) => {
    if (!toothId) return
    const indices = grouped.get(toothId) ?? []
    indices.push(triangleIndex)
    grouped.set(toothId, indices)
  })
  return grouped
}

export function buildSegmentationExportPayload(
  boundaries: Map<number, ToothBoundary>,
  jaws: { upper: number[]; lower: number[] },
) {
  const buildJawPayload = (triangleLabels: number[]) => ({
    triangleLabels: [...triangleLabels],
    teeth: Array.from(groupConfirmedTriangles(triangleLabels).entries())
      .sort(([first], [second]) => first - second)
      .map(([toothId, triangleIndices]) => ({ toothId, triangleIndices })),
  })

  return {
    boundaries: Array.from(boundaries.values()).sort((first, second) =>
      first.toothId - second.toothId,
    ),
    jaws: {
      upper: buildJawPayload(jaws.upper),
      lower: buildJawPayload(jaws.lower),
    },
  }
}
