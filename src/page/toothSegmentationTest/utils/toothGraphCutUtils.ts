import * as THREE from 'three'

import { canonicalQuantizedEdgeKey, quantizedPositionKey } from './toothRegionClassifier'

const DEFAULT_MAX_FACES = 40_000
const TOPOLOGY_PRECISION = 100_000
const CURVATURE_EPSILON = 1e-8
// Values remain finite after Float32 conversion; the lower ordinary cap leaves room for hard seeds.
const MAX_ORDINARY_CAPACITY = 1e20
const MAX_HARD_CAPACITY = 1e30
const topologyCache = new WeakMap<THREE.BufferGeometry, ToothGraphTopology>()

export const graphCutWeights = {
  normalAngle: 2.5,
  concavity: 3.0,
  curvature: 1.5,
  geodesic: 2.0,
  foregroundNormal: 1.0,
  relativeHeight: 0.75,
} as const

export type ToothGraphTopology = {
  faceCenters: Float32Array
  faceNormals: Float32Array
  faceAreas: Float32Array
  neighborOffsets: Uint32Array
  neighborFaces: Uint32Array
  sharedEdgeLengths: Float32Array
  signedDihedrals: Float32Array
  curvatureDiffs: Float32Array
}

export type ToothGraphCutRoi = {
  faceIndices: Uint32Array
  foregroundMask: Uint8Array
  backgroundMask: Uint8Array
  seedDiameter: number
}

export type GraphCutProblem = {
  roiFaceIndices: Uint32Array
  edgeFrom: Uint32Array
  edgeTo: Uint32Array
  edgeCapacity: Float32Array
  sourceCapacity: Float32Array
  sinkCapacity: Float32Array
  foregroundMask: Uint8Array
  backgroundMask: Uint8Array
}

type NeighborMetric = {
  neighbor: number
  sharedEdgeLength: number
  signedDihedral: number
}

type QueueItem = { face: number; distance: number }

class MinQueue {
  private readonly items: QueueItem[] = []

  push(item: QueueItem) {
    this.items.push(item)
    let index = this.items.length - 1
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (this.items[parent]!.distance <= item.distance) break
      this.items[index] = this.items[parent]!
      index = parent
    }
    this.items[index] = item
  }

  pop() {
    const first = this.items[0]
    const last = this.items.pop()
    if (!first || !last || this.items.length === 0) return first
    let index = 0
    while (true) {
      const left = index * 2 + 1
      const right = left + 1
      if (left >= this.items.length) break
      const child = right < this.items.length && this.items[right]!.distance < this.items[left]!.distance
        ? right
        : left
      if (this.items[child]!.distance >= last.distance) break
      this.items[index] = this.items[child]!
      index = child
    }
    this.items[index] = last
    return first
  }

  get size() {
    return this.items.length
  }
}

function finite(value: number, fallback = 0) {
  return Number.isFinite(value) ? value : fallback
}

function storedCapacity(value: number) {
  return Math.min(Math.max(finite(value), 0), MAX_ORDINARY_CAPACITY)
}

function storedHardCapacity(value: number) {
  return Math.min(Math.max(finite(value), 0), MAX_HARD_CAPACITY)
}

function faceCount(topology: ToothGraphTopology) {
  return Math.floor(topology.faceCenters.length / 3)
}

function centerAt(topology: ToothGraphTopology, face: number) {
  const offset = face * 3
  return new THREE.Vector3(
    topology.faceCenters[offset] ?? 0,
    topology.faceCenters[offset + 1] ?? 0,
    topology.faceCenters[offset + 2] ?? 0,
  )
}

function normalAt(topology: ToothGraphTopology, face: number) {
  const offset = face * 3
  return new THREE.Vector3(
    topology.faceNormals[offset] ?? 0,
    topology.faceNormals[offset + 1] ?? 0,
    topology.faceNormals[offset + 2] ?? 0,
  )
}

function edgeDistance(topology: ToothGraphTopology, from: number, to: number) {
  return centerAt(topology, from).distanceTo(centerAt(topology, to))
}

function topologyNeighbors(topology: ToothGraphTopology, face: number) {
  const start = topology.neighborOffsets[face] ?? 0
  const end = topology.neighborOffsets[face + 1] ?? start
  const neighbors: NeighborMetric[] = []
  for (let index = start; index < end; index += 1) {
    neighbors.push({
      neighbor: topology.neighborFaces[index]!,
      sharedEdgeLength: finite(topology.sharedEdgeLengths[index] ?? 0),
      signedDihedral: finite(topology.signedDihedrals[index] ?? 0),
    })
  }
  return neighbors
}

function dijkstra(topology: ToothGraphTopology, sourceFaces: readonly number[], allowed?: Set<number>) {
  const count = faceCount(topology)
  const distances = new Float64Array(count)
  distances.fill(Number.POSITIVE_INFINITY)
  const queue = new MinQueue()
  sourceFaces.forEach((face) => {
    if (face < 0 || face >= count || (allowed && !allowed.has(face))) return
    if (distances[face] === 0) return
    distances[face] = 0
    queue.push({ face, distance: 0 })
  })
  while (queue.size) {
    const current = queue.pop()
    if (!current || current.distance !== distances[current.face]) continue
    topologyNeighbors(topology, current.face).forEach(({ neighbor }) => {
      if (allowed && !allowed.has(neighbor)) return
      const next = current.distance + edgeDistance(topology, current.face, neighbor)
      if (next >= distances[neighbor]!) return
      distances[neighbor] = next
      queue.push({ face: neighbor, distance: next })
    })
  }
  return distances
}

export function robustMedian(values: readonly number[]) {
  const sorted = values.filter(Number.isFinite).sort((first, second) => first - second)
  if (!sorted.length) return 0
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

export function robustMad(values: readonly number[], median = robustMedian(values)) {
  return robustMedian(values.filter(Number.isFinite).map((value) => Math.abs(value - median)))
}

export function robustNormalize(values: readonly number[]) {
  const median = robustMedian(values)
  const divisor = robustMad(values, median) || 1
  return values.map((value) => Math.abs(finite(value) - median) / divisor)
}

function monotonicNormalize(values: readonly number[]) {
  const positives = values.filter((value) => Number.isFinite(value) && value > 0)
  const divisor = robustMad(positives) || robustMedian(positives) || 1
  return values.map((value) => Math.max(0, finite(value)) / divisor)
}

function positiveRobustScale(values: readonly number[]) {
  const median = robustMedian(values)
  const divisor = robustMad(values, median) || Math.max(Math.abs(median), 1)
  return values.map((value) => Math.max(0, (finite(value) - median) / divisor))
}

function boundedLengthScale(values: readonly number[]) {
  const finiteLengths = values.filter((value) => Number.isFinite(value) && value > 0)
  const median = robustMedian(finiteLengths)
  const divisor = median + robustMad(finiteLengths, median) || 1
  return values.map((value) => Math.min(Math.max(finite(value) / divisor, 0), MAX_ORDINARY_CAPACITY))
}

function uniqueValidFaces(indices: readonly number[], count: number) {
  return Array.from(new Set(indices.filter((index) => Number.isInteger(index) && index >= 0 && index < count)))
    .sort((first, second) => first - second)
}

export function buildToothGraphTopology(geometry: THREE.BufferGeometry): ToothGraphTopology {
  const cached = topologyCache.get(geometry)
  if (cached) return cached
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!position) throw new Error('STL geometry 缺少 position 属性')
  const index = geometry.getIndex()
  const vertexCount = index ? index.count : position.count
  const count = Math.floor(vertexCount / 3)
  const centers = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  const areas = new Float32Array(count)
  const edgeFaces = new Map<string, Array<{ face: number; length: number; direction: THREE.Vector3 }>>()

  const vertexIndex = (face: number, corner: number) => index ? index.getX(face * 3 + corner) : face * 3 + corner
  for (let face = 0; face < count; face += 1) {
    const vertices = [vertexIndex(face, 0), vertexIndex(face, 1), vertexIndex(face, 2)]
    const points = vertices.map((vertex) => new THREE.Vector3(position.getX(vertex), position.getY(vertex), position.getZ(vertex)))
    const center = points[0]!.clone().add(points[1]!).add(points[2]!).multiplyScalar(1 / 3)
    centers.set([finite(center.x), finite(center.y), finite(center.z)], face * 3)
    const cross = points[1]!.clone().sub(points[0]!).cross(points[2]!.clone().sub(points[0]!))
    const doubleArea = cross.length()
    areas[face] = finite(doubleArea / 2)
    if (Number.isFinite(doubleArea) && doubleArea > 0) cross.multiplyScalar(1 / doubleArea)
    else cross.set(0, 0, 0)
    normals.set([finite(cross.x), finite(cross.y), finite(cross.z)], face * 3)
    const keys = vertices.map((vertex) => quantizedPositionKey(position, vertex, TOPOLOGY_PRECISION))
    const edges = [0, 1, 2].map((corner) => {
      const next = (corner + 1) % 3
      const from = points[corner]!
      const to = points[next]!
      const toKey = keys[next]!
      const direction = to.clone().sub(from).normalize()
      return {
        key: canonicalQuantizedEdgeKey(keys[corner]!, toKey),
        length: finite(from.distanceTo(to)),
        direction,
      }
    })
    edges.forEach((edge) => {
      const faces = edgeFaces.get(edge.key) ?? []
      faces.push({ face, length: edge.length, direction: edge.direction })
      edgeFaces.set(edge.key, faces)
    })
  }

  const neighbors = Array.from({ length: count }, () => [] as NeighborMetric[])
  edgeFaces.forEach((faces) => {
    for (let first = 0; first < faces.length; first += 1) {
      for (let second = first + 1; second < faces.length; second += 1) {
        const left = faces[first]!
        const right = faces[second]!
        const leftNormal = new THREE.Vector3(
          normals[left.face * 3] ?? 0,
          normals[left.face * 3 + 1] ?? 0,
          normals[left.face * 3 + 2] ?? 0,
        )
        const rightNormal = new THREE.Vector3(
          normals[right.face * 3] ?? 0,
          normals[right.face * 3 + 1] ?? 0,
          normals[right.face * 3 + 2] ?? 0,
        )
        const dot = THREE.MathUtils.clamp(leftNormal.dot(rightNormal), -1, 1)
        // Adjacent consistently wound faces traverse their shared edge in opposite directions.
        // Swapping face insertion order reverses both terms and therefore preserves this sign.
        const signed = Math.atan2(leftNormal.clone().cross(rightNormal).dot(left.direction), dot)
        const sharedLength = finite((left.length + right.length) / 2)
        neighbors[left.face]!.push({ neighbor: right.face, sharedEdgeLength: sharedLength, signedDihedral: finite(signed) })
        neighbors[right.face]!.push({ neighbor: left.face, sharedEdgeLength: sharedLength, signedDihedral: finite(signed) })
      }
    }
  })

  const meanCurvature = neighbors.map((items, face) =>
    items.reduce((sum, item) => sum + item.sharedEdgeLength * Math.abs(item.signedDihedral), 0) /
      Math.max(areas[face] ?? 0, CURVATURE_EPSILON),
  )
  const offsets = new Uint32Array(count + 1)
  neighbors.forEach((items, face) => {
    items.sort((first, second) => first.neighbor - second.neighbor)
    offsets[face + 1] = offsets[face]! + items.length
  })
  const totalNeighbors = offsets[count]!
  const neighborFaces = new Uint32Array(totalNeighbors)
  const lengths = new Float32Array(totalNeighbors)
  const dihedrals = new Float32Array(totalNeighbors)
  const curvatureDiffs = new Float32Array(totalNeighbors)
  neighbors.forEach((items, face) => items.forEach((item, index) => {
    const target = offsets[face]! + index
    neighborFaces[target] = item.neighbor
    lengths[target] = item.sharedEdgeLength
    dihedrals[target] = item.signedDihedral
    curvatureDiffs[target] = finite(
      Math.abs(meanCurvature[face]! - meanCurvature[item.neighbor]!) /
        Math.max(Math.abs(meanCurvature[face]!), Math.abs(meanCurvature[item.neighbor]!), CURVATURE_EPSILON),
    )
  }))
  const topology = { faceCenters: centers, faceNormals: normals, faceAreas: areas, neighborOffsets: offsets, neighborFaces, sharedEdgeLengths: lengths, signedDihedrals: dihedrals, curvatureDiffs }
  topologyCache.set(geometry, topology)
  return topology
}

export function buildToothGraphCutRoi(
  topology: ToothGraphTopology,
  seedFaceIndices: readonly number[],
  backgroundFaceIndices: readonly number[],
  options: { radiusScale?: number; maxFaces?: number } = {},
): ToothGraphCutRoi {
  const count = faceCount(topology)
  const requestedMaxFaces = options.maxFaces ?? DEFAULT_MAX_FACES
  if (!Number.isSafeInteger(requestedMaxFaces) || requestedMaxFaces <= 0) {
    throw new Error('Graph Cut maxFaces 必须是正整数')
  }
  const maxFaces = Math.min(requestedMaxFaces, DEFAULT_MAX_FACES)
  const foreground = uniqueValidFaces(seedFaceIndices, count)
  const background = uniqueValidFaces(backgroundFaceIndices, count)
  if (foreground.length < 3) throw new Error('Graph Cut 前景种子至少需要 3 个有效面')
  if (background.length < 3) throw new Error('Graph Cut 背景种子至少需要 3 个有效面')
  if (foreground.some((face) => background.includes(face))) throw new Error('Graph Cut 前景和背景种子不能重叠')
  const radiusScale = options.radiusScale ?? 3
  if (!Number.isFinite(radiusScale) || radiusScale < 0) throw new Error('Graph Cut ROI 半径倍率必须为非负有限数')
  let seedDiameter = 0
  for (let first = 0; first < foreground.length; first += 1) {
    for (let second = first + 1; second < foreground.length; second += 1) {
      seedDiameter = Math.max(seedDiameter, edgeDistance(topology, foreground[first]!, foreground[second]!))
    }
  }
  const radius = seedDiameter * radiusScale
  const distances = dijkstra(topology, foreground)
  const selected = new Set<number>()
  distances.forEach((distance, face) => {
    if (distance <= radius + Number.EPSILON) selected.add(face)
  })
  if (selected.size > maxFaces) throw new Error(`Graph Cut 面数超过 ${maxFaces}，ROI 无法构建`)
  const faceIndices = Uint32Array.from(Array.from(selected).sort((first, second) => first - second))
  const foregroundSet = new Set(foreground)
  const backgroundSet = new Set(background)
  return {
    faceIndices,
    foregroundMask: Uint8Array.from(faceIndices, (face) => foregroundSet.has(face) ? 1 : 0),
    backgroundMask: Uint8Array.from(faceIndices, (face) => backgroundSet.has(face) ? 1 : 0),
    seedDiameter,
  }
}

function normalDifference(first: THREE.Vector3, second: THREE.Vector3) {
  const firstLength = first.length()
  const secondLength = second.length()
  if (!firstLength || !secondLength) return 0
  return Math.acos(THREE.MathUtils.clamp(first.dot(second) / (firstLength * secondLength), -1, 1))
}

function finiteDistances(distances: Float64Array, faces: Uint32Array) {
  const values = Array.from(faces, (face) => distances[face]!).filter(Number.isFinite)
  const farthest = values.length ? Math.max(...values) : 0
  const fallback = Number.isFinite(farthest + 1) ? farthest + 1 : farthest
  return Array.from(faces, (face) => finite(distances[face]!, fallback))
}

function validateGraphCutRoi(topology: ToothGraphTopology, roi: ToothGraphCutRoi) {
  const count = faceCount(topology)
  if (roi.faceIndices.length !== roi.foregroundMask.length || roi.faceIndices.length !== roi.backgroundMask.length) {
    throw new Error('Graph Cut ROI 掩码长度与面索引不一致')
  }
  let foregroundCount = 0
  let backgroundCount = 0
  let previous = -1
  roi.faceIndices.forEach((face, local) => {
    if (!Number.isInteger(face) || face < 0 || face >= count || face <= previous) {
      throw new Error('Graph Cut ROI 面索引必须为有效升序唯一值')
    }
    previous = face
    const foreground = roi.foregroundMask[local] !== 0
    const background = roi.backgroundMask[local] !== 0
    if (foreground && background) throw new Error('Graph Cut ROI 前景和背景种子不能重叠')
    if (foreground) foregroundCount += 1
    if (background) backgroundCount += 1
  })
  if (foregroundCount < 3) throw new Error('Graph Cut ROI 前景种子至少需要 3 个有效面')
  if (backgroundCount < 3) throw new Error('Graph Cut ROI 背景种子至少需要 3 个有效面')
}

function foregroundMedianNormal(topology: ToothGraphTopology, foregroundFaces: readonly number[]) {
  const normal = new THREE.Vector3(
    robustMedian(foregroundFaces.map((face) => normalAt(topology, face).x)),
    robustMedian(foregroundFaces.map((face) => normalAt(topology, face).y)),
    robustMedian(foregroundFaces.map((face) => normalAt(topology, face).z)),
  )
  if (normal.length()) return normal.normalize()
  const fallback = normalAt(topology, foregroundFaces[0] ?? 0)
  return fallback.length() ? fallback.normalize() : new THREE.Vector3(0, 0, 1)
}

function saturatedCapacitySum(values: readonly Float32Array[]) {
  let total = 0
  values.forEach((capacities) => {
    capacities.forEach((capacity) => {
      total = Math.min(MAX_HARD_CAPACITY, total + storedCapacity(capacity))
    })
  })
  return total >= MAX_HARD_CAPACITY - 1 ? MAX_HARD_CAPACITY : storedHardCapacity(total + 1)
}

export function buildGraphCutProblem(topology: ToothGraphTopology, roi: ToothGraphCutRoi): GraphCutProblem {
  validateGraphCutRoi(topology, roi)
  const roiFaces = Uint32Array.from(roi.faceIndices)
  const localByFace = new Map<number, number>()
  roiFaces.forEach((face, local) => localByFace.set(face, local))
  const edgeFrom: number[] = []
  const edgeTo: number[] = []
  const normalAngles: number[] = []
  const concavities: number[] = []
  const curvatureDiffs: number[] = []
  const sharedLengths: number[] = []
  roiFaces.forEach((face, local) => {
    const normal = normalAt(topology, face)
    topologyNeighbors(topology, face).forEach((neighbor, edgeIndex) => {
      const target = localByFace.get(neighbor.neighbor)
      if (target === undefined || local >= target) return
      const globalOffset = (topology.neighborOffsets[face] ?? 0) + edgeIndex
      edgeFrom.push(local)
      edgeTo.push(target)
      normalAngles.push(normalDifference(normal, normalAt(topology, neighbor.neighbor)))
      concavities.push(Math.max(0, -neighbor.signedDihedral))
      curvatureDiffs.push(finite(topology.curvatureDiffs[globalOffset] ?? 0))
      sharedLengths.push(neighbor.sharedEdgeLength)
    })
  })
  const normalizedAngles = positiveRobustScale(normalAngles)
  const normalizedConcavity = positiveRobustScale(concavities)
  const normalizedCurvature = positiveRobustScale(curvatureDiffs)
  const edgeLengthScale = boundedLengthScale(sharedLengths)
  const edgeCapacity = Float32Array.from(edgeFrom, (_, index) => {
    const discontinuity =
      graphCutWeights.normalAngle * normalizedAngles[index]! +
      graphCutWeights.concavity * normalizedConcavity[index]! +
      graphCutWeights.curvature * normalizedCurvature[index]!
    return storedCapacity(edgeLengthScale[index]! * Math.exp(-Math.min(discontinuity, 80)))
  })

  const allowed = new Set<number>(roiFaces)
  const foregroundFaces = Array.from(roiFaces, (_, local) => roi.foregroundMask[local] ? roiFaces[local]! : -1).filter((face) => face >= 0)
  const backgroundFaces = Array.from(roiFaces, (_, local) => roi.backgroundMask[local] ? roiFaces[local]! : -1).filter((face) => face >= 0)
  const foregroundDistances = finiteDistances(dijkstra(topology, foregroundFaces, allowed), roiFaces)
  const backgroundDistances = finiteDistances(dijkstra(topology, backgroundFaces, allowed), roiFaces)
  const foregroundNormal = foregroundMedianNormal(topology, foregroundFaces)
  const minHeight = Math.min(...Array.from(roiFaces, (face) => centerAt(topology, face).y))
  const maxHeight = Math.max(...Array.from(roiFaces, (face) => centerAt(topology, face).y))
  const foregroundHeight = robustMedian(foregroundFaces.map((face) => centerAt(topology, face).y))
  const normalDifferences = Array.from(roiFaces, (face) => normalDifference(normalAt(topology, face), foregroundNormal))
  const relativeHeights = Array.from(roiFaces, (face) =>
    Math.abs((centerAt(topology, face).y - foregroundHeight) / (maxHeight - minHeight || 1)),
  )
  const normalizedForegroundDistance = monotonicNormalize(foregroundDistances)
  const normalizedBackgroundDistance = monotonicNormalize(backgroundDistances)
  const normalizedNormalDifference = monotonicNormalize(normalDifferences)
  const normalizedHeight = monotonicNormalize(relativeHeights)
  const sourceCapacity = Float32Array.from(roiFaces, (_, local) => storedCapacity(
    graphCutWeights.geodesic * normalizedBackgroundDistance[local]!,
  ))
  const sinkCapacity = Float32Array.from(roiFaces, (_, local) => storedCapacity(
    graphCutWeights.geodesic * normalizedForegroundDistance[local]! +
      graphCutWeights.foregroundNormal * normalizedNormalDifference[local]! +
      graphCutWeights.relativeHeight * normalizedHeight[local]!,
  ))
  const hardSeedCapacity = saturatedCapacitySum([edgeCapacity, sourceCapacity, sinkCapacity])
  roiFaces.forEach((_, local) => {
    if (roi.foregroundMask[local]) {
      sourceCapacity[local] = hardSeedCapacity
      sinkCapacity[local] = 0
    }
    if (roi.backgroundMask[local]) {
      sourceCapacity[local] = 0
      sinkCapacity[local] = hardSeedCapacity
    }
  })
  return {
    roiFaceIndices: roiFaces,
    edgeFrom: Uint32Array.from(edgeFrom),
    edgeTo: Uint32Array.from(edgeTo),
    edgeCapacity,
    sourceCapacity,
    sinkCapacity,
    foregroundMask: Uint8Array.from(roi.foregroundMask),
    backgroundMask: Uint8Array.from(roi.backgroundMask),
  }
}

export const buildToothGraphCutProblem = buildGraphCutProblem
