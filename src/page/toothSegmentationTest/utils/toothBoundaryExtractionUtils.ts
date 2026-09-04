import * as THREE from 'three'

import { createToothBoundary, type ToothBoundary } from './toothBoundaryEditorUtils'
import type { ToothGraphCutRoi, ToothGraphTopology } from './toothGraphCutUtils'

const EDGE_PRECISION = 100_000
const MIN_CONTROL_COUNT = 24
const MAX_CONTROL_COUNT = 64
const DISTANCE_TIE_EPSILON = 1e-6

type BoundaryEdge = {
  from: string
  to: string
  foregroundFaces: number[]
}

type BoundaryLoop = {
  points: THREE.Vector3[]
  length: number
  foregroundArea: number
  foregroundFaces: number[]
  seedCount: number
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
  seedFaces: Set<number>,
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
    loops.push({
      points: loopPoints,
      length,
      foregroundArea,
      foregroundFaces: Array.from(foreground),
      seedCount: 0,
      stableKey: [...keys].sort()[0]!,
    })
  })
  loops.forEach((loop) => {
    loop.seedCount = seedCountInsideLoop(loop, topology, seedFaces)
  })
  return loops
}

function newellNormal(points: readonly THREE.Vector3[]) {
  const normal = new THREE.Vector3()
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length]!
    normal.x += (point.y - next.y) * (point.z + next.z)
    normal.y += (point.z - next.z) * (point.x + next.x)
    normal.z += (point.x - next.x) * (point.y + next.y)
  })
  return normal
}

function loopProjection(loop: BoundaryLoop, topology: ToothGraphTopology) {
  const normal = newellNormal(loop.points)
  if (normal.lengthSq() <= 1e-12) {
    loop.foregroundFaces.forEach((face) => {
      normal.add(
        new THREE.Vector3(
          topology.faceNormals[face * 3] ?? 0,
          topology.faceNormals[face * 3 + 1] ?? 0,
          topology.faceNormals[face * 3 + 2] ?? 0,
        ),
      )
    })
  }
  if (normal.lengthSq() <= 1e-12) return null
  normal.normalize()
  let longest = new THREE.Vector3()
  for (let index = 0; index < loop.points.length; index += 1) {
    const segment = loop.points[(index + 1) % loop.points.length]!.clone().sub(loop.points[index]!)
    segment.addScaledVector(normal, -segment.dot(normal))
    if (segment.lengthSq() > longest.lengthSq()) longest = segment
  }
  if (longest.lengthSq() <= 1e-12) return null
  longest.normalize()
  const vertical = normal.clone().cross(longest)
  const origin = loop.points[0]!
  const project = (point: THREE.Vector3): [number, number] => {
    const offset = point.clone().sub(origin)
    return [offset.dot(longest), offset.dot(vertical)]
  }
  const polygon = loop.points.map(project)
  const doubledArea = polygon.reduce((sum, point, index) => {
    const next = polygon[(index + 1) % polygon.length]!
    return sum + point[0] * next[1] - next[0] * point[1]
  }, 0)
  return Math.abs(doubledArea) > 1e-10 ? { polygon, project } : null
}

function pointInPolygon(point: [number, number], polygon: Array<[number, number]>) {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const current = polygon[index]!
    const prior = polygon[previous]!
    if (current[1] > point[1] === prior[1] > point[1]) continue
    const intersection =
      ((prior[0] - current[0]) * (point[1] - current[1])) / (prior[1] - current[1]) + current[0]
    if (point[0] < intersection) inside = !inside
  }
  return inside
}

function seedCountInsideLoop(
  loop: BoundaryLoop,
  topology: ToothGraphTopology,
  seedFaces: Set<number>,
) {
  const projection = loopProjection(loop, topology)
  if (!projection) {
    return loop.foregroundFaces.filter((face) => seedFaces.has(face)).length
  }
  let count = 0
  seedFaces.forEach((face) => {
    const offset = face * 3
    const center = new THREE.Vector3(
      topology.faceCenters[offset] ?? 0,
      topology.faceCenters[offset + 1] ?? 0,
      topology.faceCenters[offset + 2] ?? 0,
    )
    if (pointInPolygon(projection.project(center), projection.polygon)) count += 1
  })
  return count
}

function simplifyOpen(points: THREE.Vector3[], tolerance: number): THREE.Vector3[] {
  if (points.length < 3) return points.map((point) => point.clone())
  const first = points[0]!
  const last = points[points.length - 1]!
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
    if (distance > furthestDistance + DISTANCE_TIE_EPSILON) {
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

function pointToClosedPolylineDistance(point: THREE.Vector3, loop: THREE.Vector3[]) {
  return Math.min(
    ...loop.map((from, index) => {
      const to = loop[(index + 1) % loop.length]!
      const segment = to.clone().sub(from)
      const denominator = segment.lengthSq()
      const ratio = denominator
        ? THREE.MathUtils.clamp(point.clone().sub(from).dot(segment) / denominator, 0, 1)
        : 0
      return point.distanceTo(from.clone().addScaledVector(segment, ratio))
    }),
  )
}

function removeGloballyRedundantClosedPoints(
  simplified: THREE.Vector3[],
  original: THREE.Vector3[],
  tolerance: number,
) {
  const result = simplified.map((point) => point.clone())
  let changed = true
  while (changed && result.length > 3) {
    changed = false
    for (let index = 0; index < result.length && result.length > 3; index += 1) {
      const candidate = result.filter((_, candidateIndex) => candidateIndex !== index)
      if (original.some((point) => pointToClosedPolylineDistance(point, candidate) > tolerance))
        continue
      result.splice(index, 1)
      changed = true
      index -= 1
    }
  }
  return result
}

function simplifyClosedLoop(points: THREE.Vector3[], tolerance: number) {
  if (points.length < 4) return points.map((point) => point.clone())
  const firstIndex = points.reduce((best, point, index) => {
    const current = points[best]!
    if (point.x !== current.x) return point.x < current.x ? index : best
    if (point.y !== current.y) return point.y < current.y ? index : best
    return point.z < current.z ? index : best
  }, 0)
  const secondIndex = points.reduce(
    (best, point, index) => {
      return point.distanceToSquared(points[firstIndex]!) >
        points[best]!.distanceToSquared(points[firstIndex]!)
        ? index
        : best
    },
    firstIndex === 0 ? 1 : 0,
  )
  const orderedChain = (from: number, to: number) => {
    const chain = [points[from]!]
    for (
      let index = (from + 1) % points.length;
      index !== to;
      index = (index + 1) % points.length
    ) {
      chain.push(points[index]!)
    }
    chain.push(points[to]!)
    return chain
  }
  const forward = orderedChain(firstIndex, secondIndex)
  const backward = orderedChain(secondIndex, firstIndex)
  const simplified = [
    ...simplifyOpen(forward, tolerance).slice(0, -1),
    ...simplifyOpen(backward, tolerance).slice(0, -1),
  ]
  if (simplified.length < 3) return points.map((point) => point.clone())
  return removeGloballyRedundantClosedPoints(simplified, points, tolerance)
}

export function simplifyToothBoundaryLoop(points: THREE.Vector3[], seedDiameter: number) {
  return simplifyClosedLoop(points, Math.max(0.15, seedDiameter * 0.01))
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
  const seedFaces = new Set<number>(
    Array.from(roi.faceIndices, (face, local) => (roi.foregroundMask[local] ? face : -1)).filter(
      (face) => face >= 0,
    ),
  )
  const loops = extractLoops(raw.edges, raw.points, topology, seedFaces).filter(
    (loop) => loop.length >= minimumLoopLength,
  )
  if (!loops.length) throw new Error('没有足够长的闭合边界环')
  loops.sort(
    (first, second) =>
      second.seedCount - first.seedCount ||
      second.foregroundArea - first.foregroundArea ||
      second.length - first.length ||
      first.stableKey.localeCompare(second.stableKey),
  )
  const loop = resampleClosedLoop(
    simplifyToothBoundaryLoop(loops[0]!.points, roi.seedDiameter),
    roi.seedDiameter,
  )
  return { triangleIndices, loop, boundary: createToothBoundary(toothId, loop) }
}
