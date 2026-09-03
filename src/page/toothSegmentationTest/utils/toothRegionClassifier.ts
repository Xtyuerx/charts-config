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
  faceCenters: THREE.Vector3[]
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

function faceLabel(labels: number[], faceIndex: number) {
  const offset = faceIndex * 3
  const values = [
    Number(labels[offset] ?? 0),
    Number(labels[offset + 1] ?? 0),
    Number(labels[offset + 2] ?? 0),
  ]
  const counts = new Map<number, number>()
  values.forEach((label) => counts.set(label, (counts.get(label) ?? 0) + 1))
  return values.reduce((best, label) =>
    (counts.get(label) ?? 0) > (counts.get(best) ?? 0) ? label : best,
  )
}

export function buildToothRegionTopology(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!position) throw new Error('STL geometry 缺少 position 属性')
  const graph = buildSurfaceGraph(geometry)
  const faceCount = Math.floor(position.count / 3)
  const faceCenters: THREE.Vector3[] = []
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
    faceCenters.push(
      new THREE.Vector3(
        (position.getX(offset) + position.getX(offset + 1) + position.getX(offset + 2)) / 3,
        (position.getY(offset) + position.getY(offset + 1) + position.getY(offset + 2)) / 3,
        (position.getZ(offset) + position.getZ(offset + 1) + position.getZ(offset + 2)) / 3,
      ),
    )
  }

  const faceNeighbors = faceEdgeKeys.map((edges, faceIndex) =>
    edges.flatMap((key) =>
      (edgeFaces.get(key) ?? [])
        .filter((neighbor) => neighbor !== faceIndex)
        .map((neighbor) => ({ edgeKey: key, neighbor })),
    ),
  )
  return { graph, faceCenters, faceNeighbors } satisfies ToothRegionTopology
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

function findSeedFace(
  topology: ToothRegionTopology,
  originalLabels: number[],
  boundary: ToothBoundary,
) {
  const controls = boundaryControlVectors(boundary)
  const center = controls
    .reduce((sum, point) => sum.add(point), new THREE.Vector3())
    .multiplyScalar(1 / Math.max(controls.length, 1))
  let seed = -1
  let bestDistance = Number.POSITIVE_INFINITY
  topology.faceCenters.forEach((faceCenter, faceIndex) => {
    if (faceLabel(originalLabels, faceIndex) !== boundary.toothId) return
    const distance = faceCenter.distanceToSquared(center)
    if (distance >= bestDistance) return
    seed = faceIndex
    bestDistance = distance
  })
  if (seed < 0) throw new Error(`原始 STL 标签中找不到牙号 ${boundary.toothId} 的种子三角形`)
  return seed
}

export function classifyToothRegion(
  topology: ToothRegionTopology,
  originalLabels: number[],
  boundary: ToothBoundary,
): ClassifiedToothRegion {
  const blockedEdges = boundaryBlockedEdges(topology, boundary)
  const seed = findSeedFace(topology, originalLabels, boundary)
  const visited = new Set<number>([seed])
  const queue = [seed]

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const faceIndex = queue[cursor]!
    for (const edge of topology.faceNeighbors[faceIndex] ?? []) {
      if (blockedEdges.has(edge.edgeKey) || visited.has(edge.neighbor)) continue
      visited.add(edge.neighbor)
      queue.push(edge.neighbor)
    }
  }
  if (visited.size === topology.faceNeighbors.length) {
    throw new Error('Boundary 未形成有效闭合区域，分类结果会覆盖整个 STL')
  }
  return {
    toothId: boundary.toothId,
    triangleIndices: Array.from(visited).sort((a, b) => a - b),
    blockedEdgeCount: blockedEdges.size,
  }
}

export function applyConfirmedToothRegion(
  triangleLabels: number[],
  toothId: number,
  triangleIndices: number[],
) {
  const nextLabels = triangleLabels.map((label) => (label === toothId ? 0 : label))
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
