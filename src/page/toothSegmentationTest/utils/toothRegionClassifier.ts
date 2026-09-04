import * as THREE from 'three'

import type { ToothBoundary } from './toothBoundaryEditorUtils'
import { boundaryControlVectors } from './toothBoundaryEditorUtils'
import {
  buildSurfaceGraph,
  findNearestSurfaceVertexKey,
  findShortestSurfacePathKeys,
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
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!position) throw new Error('STL geometry 缺少 position 属性')
  const graph = buildSurfaceGraph(geometry)
  const faceCount = Math.floor(position.count / 3)
  const faceEdgeKeys: string[][] = []
  const edgeFaces = new Map<string, number[]>()

  for (let faceIndex = 0; faceIndex < faceCount; faceIndex += 1) {
    const offset = faceIndex * 3
    const keys = [
      quantizedPositionKey(position, offset, graph.precision),
      quantizedPositionKey(position, offset + 1, graph.precision),
      quantizedPositionKey(position, offset + 2, graph.precision),
    ]
    const edges = [
      canonicalQuantizedEdgeKey(keys[0]!, keys[1]!),
      canonicalQuantizedEdgeKey(keys[1]!, keys[2]!),
      canonicalQuantizedEdgeKey(keys[2]!, keys[0]!),
    ]
    faceEdgeKeys.push(edges)
    edges.forEach((key) => {
      const faces = edgeFaces.get(key) ?? []
      faces.push(faceIndex)
      edgeFaces.set(key, faces)
    })
  }

  const faceNeighbors = faceEdgeKeys.map((edges, faceIndex) =>
    edges.flatMap((key) =>
      (edgeFaces.get(key) ?? [])
        .filter((neighbor) => neighbor !== faceIndex)
        .map((neighbor) => ({ edgeKey: key, neighbor })),
    ),
  )
  return { graph, faceNeighbors } satisfies ToothRegionTopology
}

function boundaryBlockedEdges(topology: ToothRegionTopology, boundary: ToothBoundary) {
  const controls = boundaryControlVectors(boundary)
  const anchorKeys = controls.map((point) =>
    findNearestSurfaceVertexKey(topology.graph, point),
  )
  if (new Set(anchorKeys).size < 3) throw new Error('Boundary 至少需要 3 个不同的网格控制点')

  const blockedEdges = new Set<string>()
  for (let index = 0; index < anchorKeys.length; index += 1) {
    const path = findShortestSurfacePathKeys(
      topology.graph,
      anchorKeys[index]!,
      anchorKeys[(index + 1) % anchorKeys.length]!,
    )
    for (let pathIndex = 0; pathIndex + 1 < path.length; pathIndex += 1) {
      blockedEdges.add(canonicalQuantizedEdgeKey(path[pathIndex]!, path[pathIndex + 1]!))
    }
  }
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
): ClassifiedToothRegion {
  const blockedEdges = boundaryBlockedEdges(topology, boundary)
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
  const triangleIndices = Array.from(boundaryAdjacentComponentIndices, (componentIndex) =>
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
