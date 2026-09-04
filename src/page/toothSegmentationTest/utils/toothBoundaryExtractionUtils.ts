import * as THREE from 'three'

import { createToothBoundary, type ToothBoundary } from './toothBoundaryEditorUtils'
import type { ToothGraphCutRoi, ToothGraphTopology } from './toothGraphCutUtils'

const EDGE_PRECISION = 100_000
const MIN_CONTROL_COUNT = 24
const MAX_CONTROL_COUNT = 64

type BoundaryEdge = {
  from: string
  to: string
  foregroundFaces: number[]
}

type BoundaryLoop = {
  points: THREE.Vector3[]
  length: number
  foregroundArea: number
  stableKey: string
}

export type ExtractedToothBoundary = {
  triangleIndices: number[]
  loop: THREE.Vector3[]
  boundary: ToothBoundary
}

function pointKey(point: THREE.Vector3) {
  return `${Math.round(point.x * EDGE_PRECISION)}:${Math.round(point.y * EDGE_PRECISION)}:${Math.round(point.z * EDGE_PRECISION)}`
}

function geometryFaces(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!position) throw new Error('STL geometry 缺少 position 属性')
  const index = geometry.getIndex()
  const count = Math.floor((index ? index.count : position.count) / 3)
  const result: THREE.Vector3[][] = []
  for (let face = 0; face < count; face += 1) {
    result.push(
      [0, 1, 2].map((corner) => {
        const vertex = index ? index.getX(face * 3 + corner) : face * 3 + corner
        return new THREE.Vector3(
          position.getX(vertex),
          position.getY(vertex),
          position.getZ(vertex),
        )
      }),
    )
  }
  return result
}

function topologyFaceCount(topology: ToothGraphTopology) {
  return Math.floor(topology.faceCenters.length / 3)
}

function assertInput(
  topology: ToothGraphTopology,
  roi: ToothGraphCutRoi,
  foregroundMask: Uint8Array,
) {
  if (
    roi.faceIndices.length !== roi.foregroundMask.length ||
    roi.faceIndices.length !== roi.backgroundMask.length
  ) {
    throw new Error('Graph Cut ROI 掩码长度与面索引不一致')
  }
  if (foregroundMask.length !== roi.faceIndices.length) {
    throw new Error('Graph Cut 前景结果长度与 ROI 不一致')
  }
  const count = topologyFaceCount(topology)
  let previous = -1
  roi.faceIndices.forEach((face) => {
    if (!Number.isInteger(face) || face < 0 || face >= count || face <= previous) {
      throw new Error('Graph Cut ROI 面索引必须为有效升序唯一值')
    }
    previous = face
  })
}

function foregroundComponents(
  topology: ToothGraphTopology,
  roi: ToothGraphCutRoi,
  foregroundMask: Uint8Array,
) {
  const localByFace = new Map<number, number>()
  roi.faceIndices.forEach((face, local) => localByFace.set(face, local))
  const visited = new Uint8Array(foregroundMask.length)
  const components: Array<{ localFaces: number[]; seedCount: number; area: number }> = []

  foregroundMask.forEach((selected, start) => {
    if (!selected || visited[start]) return
    const queue = [start]
    const localFaces: number[] = []
    let seedCount = 0
    let area = 0
    visited[start] = 1
    while (queue.length) {
      const local = queue.pop()!
      const face = roi.faceIndices[local]!
      localFaces.push(local)
      if (roi.foregroundMask[local]) seedCount += 1
      area += topology.faceAreas[face] ?? 0
      const startOffset = topology.neighborOffsets[face] ?? 0
      const endOffset = topology.neighborOffsets[face + 1] ?? startOffset
      for (let offset = startOffset; offset < endOffset; offset += 1) {
        const neighborLocal = localByFace.get(topology.neighborFaces[offset]!)
        if (neighborLocal === undefined || !foregroundMask[neighborLocal] || visited[neighborLocal])
          continue
        visited[neighborLocal] = 1
        queue.push(neighborLocal)
      }
    }
    components.push({ localFaces, seedCount, area })
  })
  return components
}

function selectedForegroundFaces(
  topology: ToothGraphTopology,
  roi: ToothGraphCutRoi,
  foregroundMask: Uint8Array,
) {
  const seedCount = Array.from(roi.foregroundMask).filter(Boolean).length
  if (!seedCount) throw new Error('Graph Cut ROI 缺少前景种子')
  const components = foregroundComponents(topology, roi, foregroundMask)
  if (!components.length) throw new Error('Graph Cut 前景结果为空')
  components.sort(
    (first, second) =>
      second.seedCount - first.seedCount ||
      second.area - first.area ||
      first.localFaces[0]! - second.localFaces[0]!,
  )
  const selected = components[0]!
  if (selected.localFaces.length < seedCount) throw new Error('前景面数少于种子面数')
  if (selected.localFaces.length > roi.faceIndices.length * 0.9)
    throw new Error('前景结果超过 ROI 的 90%')
  return selected.localFaces
    .map((local) => roi.faceIndices[local]!)
    .sort((first, second) => first - second)
}

function boundaryEdges(
  geometry: THREE.BufferGeometry,
  roi: ToothGraphCutRoi,
  selectedFaces: readonly number[],
) {
  const faces = geometryFaces(geometry)
  const roiFaces = new Set<number>(roi.faceIndices)
  const foregroundFaces = new Set(selectedFaces)
  const edges = new Map<string, { from: string; to: string; faces: number[] }>()
  const points = new Map<string, THREE.Vector3>()

  faces.forEach((vertices, face) => {
    for (let corner = 0; corner < 3; corner += 1) {
      const fromPoint = vertices[corner]!
      const toPoint = vertices[(corner + 1) % 3]!
      const from = pointKey(fromPoint)
      const to = pointKey(toPoint)
      points.set(from, fromPoint.clone())
      points.set(to, toPoint.clone())
      const key = from < to ? `${from}|${to}` : `${to}|${from}`
      const existing = edges.get(key)
      if (existing) existing.faces.push(face)
      else edges.set(key, { from, to, faces: [face] })
    }
  })

  const result: BoundaryEdge[] = []
  edges.forEach((edge) => {
    const foreground = edge.faces.filter((face) => foregroundFaces.has(face))
    const background = edge.faces.filter((face) => roiFaces.has(face) && !foregroundFaces.has(face))
    if (foreground.length && background.length)
      result.push({ from: edge.from, to: edge.to, foregroundFaces: foreground })
  })
  return { edges: result, points }
}

function loopLength(points: readonly THREE.Vector3[]) {
  return points.reduce(
    (total, point, index) => total + point.distanceTo(points[(index + 1) % points.length]!),
    0,
  )
}

function extractLoops(
  edges: BoundaryEdge[],
  points: Map<string, THREE.Vector3>,
  topology: ToothGraphTopology,
): BoundaryLoop[] {
  const edgeIndicesByVertex = new Map<string, number[]>()
  edges.forEach((edge, index) => {
    for (const vertex of [edge.from, edge.to]) {
      const indexes = edgeIndicesByVertex.get(vertex) ?? []
      indexes.push(index)
      edgeIndicesByVertex.set(vertex, indexes)
    }
  })
  edgeIndicesByVertex.forEach((indexes) => {
    if (indexes.length !== 2) throw new Error('边界不是闭合环')
  })

  const consumed = new Uint8Array(edges.length)
  const loops: BoundaryLoop[] = []
  edges.forEach((edge, initial) => {
    if (consumed[initial]) return
    const keys = [edge.from]
    const foreground = new Set<number>()
    let currentEdge = initial
    let currentVertex = edge.from
    while (true) {
      if (consumed[currentEdge]) throw new Error('边界不是闭合环')
      consumed[currentEdge] = 1
      const active = edges[currentEdge]!
      active.foregroundFaces.forEach((face) => foreground.add(face))
      const nextVertex = active.from === currentVertex ? active.to : active.from
      if (nextVertex === keys[0]) break
      keys.push(nextVertex)
      const choices = edgeIndicesByVertex.get(nextVertex) ?? []
      const nextEdge = choices.find((index) => index !== currentEdge)
      if (nextEdge === undefined) throw new Error('边界不是闭合环')
      currentVertex = nextVertex
      currentEdge = nextEdge
    }
    const loopPoints = keys.map((key) => points.get(key)!.clone())
    const length = loopLength(loopPoints)
    const foregroundArea = Array.from(foreground).reduce(
      (total, face) => total + (topology.faceAreas[face] ?? 0),
      0,
    )
    loops.push({ points: loopPoints, length, foregroundArea, stableKey: [...keys].sort()[0]! })
  })
  return loops
}

function simplifyOpen(points: THREE.Vector3[], tolerance: number): THREE.Vector3[] {
  if (points.length < 3) return points.map((point) => point.clone())
  const first = points[0]!
  const last = points.at(-1)!
  const line = last.clone().sub(first)
  const lineLengthSquared = line.lengthSq()
  let furthestDistance = -1
  let furthestIndex = -1
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index]!
    const ratio = lineLengthSquared
      ? THREE.MathUtils.clamp(point.clone().sub(first).dot(line) / lineLengthSquared, 0, 1)
      : 0
    const distance = point.distanceTo(first.clone().addScaledVector(line, ratio))
    if (distance > furthestDistance) {
      furthestDistance = distance
      furthestIndex = index
    }
  }
  if (furthestDistance <= tolerance || furthestIndex < 0) return [first.clone(), last.clone()]
  return [
    ...simplifyOpen(points.slice(0, furthestIndex + 1), tolerance).slice(0, -1),
    ...simplifyOpen(points.slice(furthestIndex), tolerance),
  ]
}

function simplifyClosedLoop(points: THREE.Vector3[], tolerance: number) {
  let firstIndex = 0
  let secondIndex = 1
  let maximumDistance = -1
  for (let first = 0; first < points.length; first += 1) {
    for (let second = first + 1; second < points.length; second += 1) {
      const distance = points[first]!.distanceToSquared(points[second]!)
      if (distance > maximumDistance) {
        maximumDistance = distance
        firstIndex = first
        secondIndex = second
      }
    }
  }
  const forward = Array.from(
    { length: secondIndex - firstIndex + 1 },
    (_, offset) => points[firstIndex + offset]!,
  )
  const backward = Array.from(
    { length: points.length - forward.length + 2 },
    (_, offset) => points[(secondIndex + offset) % points.length]!,
  )
  const simplified = [
    ...simplifyOpen(forward, tolerance).slice(0, -1),
    ...simplifyOpen(backward, tolerance).slice(0, -1),
  ]
  return simplified.length >= 3 ? simplified : points.map((point) => point.clone())
}

function resampleClosedLoop(points: THREE.Vector3[], seedDiameter: number) {
  const perimeter = loopLength(points)
  const targetSpacing =
    seedDiameter > 0 && Number.isFinite(seedDiameter)
      ? seedDiameter / 12
      : perimeter / MIN_CONTROL_COUNT
  const count = THREE.MathUtils.clamp(
    Math.round(perimeter / Math.max(targetSpacing, Number.EPSILON)),
    MIN_CONTROL_COUNT,
    MAX_CONTROL_COUNT,
  )
  const result: THREE.Vector3[] = []
  let edge = 0
  let edgeStart = 0
  for (let index = 0; index < count; index += 1) {
    const target = (perimeter * index) / count
    while (
      edgeStart + points[edge]!.distanceTo(points[(edge + 1) % points.length]!) < target &&
      edge < points.length - 1
    ) {
      edgeStart += points[edge]!.distanceTo(points[(edge + 1) % points.length]!)
      edge += 1
    }
    const from = points[edge]!
    const to = points[(edge + 1) % points.length]!
    const edgeLength = from.distanceTo(to)
    result.push(from.clone().lerp(to, edgeLength ? (target - edgeStart) / edgeLength : 0))
  }
  return result
}

export function extractToothBoundary(
  geometry: THREE.BufferGeometry,
  topology: ToothGraphTopology,
  roi: ToothGraphCutRoi,
  foregroundMask: Uint8Array,
  toothId: number,
): ExtractedToothBoundary {
  assertInput(topology, roi, foregroundMask)
  const triangleIndices = selectedForegroundFaces(topology, roi, foregroundMask)
  const raw = boundaryEdges(geometry, roi, triangleIndices)
  const minimumLoopLength = 0.15 * roi.seedDiameter
  const loops = extractLoops(raw.edges, raw.points, topology).filter(
    (loop) => loop.length >= minimumLoopLength,
  )
  if (!loops.length) throw new Error('没有足够长的闭合边界环')
  loops.sort(
    (first, second) =>
      second.foregroundArea - first.foregroundArea ||
      second.length - first.length ||
      first.stableKey.localeCompare(second.stableKey),
  )
  const tolerance = Math.max(0.15, roi.seedDiameter * 0.01)
  const loop = resampleClosedLoop(simplifyClosedLoop(loops[0]!.points, tolerance), roi.seedDiameter)
  return { triangleIndices, loop, boundary: createToothBoundary(toothId, loop) }
}
