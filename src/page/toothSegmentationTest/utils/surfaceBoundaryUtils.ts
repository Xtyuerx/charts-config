import * as THREE from 'three'
import type { SurfaceAnchor, SurfaceIntersection } from './surfaceAnchorUtils'
import { bindFacePathPoint, buildSurfaceFaceTopology, createFaceConstrainedSegment, type SurfaceFaceTopology } from './surfaceFacePathUtils'

export type SurfaceGraph = {
  vertices: Map<string, THREE.Vector3>
  neighbors: Map<string, Map<string, number>>
  precision: number
  surface: SurfaceFaceTopology
}

export type ClosedSurfacePath = {
  anchorPoints: THREE.Vector3[]
  curvePoints: THREE.Vector3[]
  segmentPoints: THREE.Vector3[][]
}

export type SurfaceBoundaryDragFrame = {
  sourceMesh: THREE.Mesh
  graph: SurfaceGraph
  currentPath: ClosedSurfacePath
  controlIndex: number
  raycastSurface: (mesh: THREE.Mesh) => SurfaceIntersection | null
  updateControlPoint: (point: THREE.Vector3) => void
  updateOverlay: (segmentPoints: THREE.Vector3[][]) => void
}

export type LabelBoundary = {
  linePoints: THREE.Vector3[]
  pointPositions: THREE.Vector3[]
  pointLineIndices: number[][]
}

function surfaceSegmentsToLinePoints(segmentPoints: THREE.Vector3[][]) {
  return segmentPoints.flatMap((segment) => {
    const linePoints: THREE.Vector3[] = []
    for (let index = 0; index + 1 < segment.length; index += 1) {
      linePoints.push(segment[index]!, segment[index + 1]!)
    }
    return linePoints
  })
}

/**
 * Creates a line geometry whose position attribute can be reused while a boundary is dragged.
 * `minimumPointCapacity` can reserve room for a long surface route. Pointer moves only change
 * this overlay attribute and never the source STL geometry.
 */
export function createSurfaceLineGeometry(
  segmentPoints: THREE.Vector3[][],
  minimumPointCapacity = 0,
) {
  const linePoints = surfaceSegmentsToLinePoints(segmentPoints)
  const geometry = new THREE.BufferGeometry()
  const position = new THREE.Float32BufferAttribute(
    new Float32Array(Math.max(linePoints.length, minimumPointCapacity) * 3),
    3,
  )
  position.setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('position', position)
  updateSurfaceLineGeometry(geometry, segmentPoints)
  return geometry
}

/** Updates only the existing boundary overlay position attribute. */
export function updateSurfaceLineGeometry(
  geometry: THREE.BufferGeometry,
  segmentPoints: THREE.Vector3[][],
) {
  let position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!position) throw new Error('边界线缺少 position 属性')
  const linePoints = surfaceSegmentsToLinePoints(segmentPoints)
  if (position.count < linePoints.length) {
    position = new THREE.BufferAttribute(new Float32Array(linePoints.length * 3), 3)
    position.setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute('position', position)
  }
  linePoints.forEach((point, index) => position.setXYZ(index, point.x, point.y, point.z))
  geometry.setDrawRange(0, linePoints.length)
  position.needsUpdate = true
  geometry.computeBoundingSphere()
}

/**
 * Performs exactly one drawn-boundary drag frame. All geometry writes are delegated to the
 * boundary overlay callbacks; the original STL mesh is used only as the raycast target.
 */
export function applySurfaceBoundaryDragFrame({
  sourceMesh,
  graph,
  currentPath,
  controlIndex,
  raycastSurface,
  updateControlPoint,
  updateOverlay,
}: SurfaceBoundaryDragFrame) {
  const intersection = raycastSurface(sourceMesh)
  if (!intersection) return null
  const point = intersection.point.clone()
  const path = moveClosedSurfacePathAnchor(graph, currentPath, controlIndex, point, intersection)
  updateControlPoint(point)
  updateOverlay(path.segmentPoints)
  return { point, path, anchor: intersection }
}

type QueueItem = {
  key: string
  distance: number
}

class MinPriorityQueue {
  private readonly items: QueueItem[] = []

  get size() {
    return this.items.length
  }

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
      const child =
        right < this.items.length && this.items[right]!.distance < this.items[left]!.distance
          ? right
          : left
      if (this.items[child]!.distance >= last.distance) break
      this.items[index] = this.items[child]!
      index = child
    }
    this.items[index] = last
    return first
  }
}

function vertexKey(position: THREE.BufferAttribute, index: number, precision: number) {
  return `${Math.round(position.getX(index) * precision)}:${Math.round(
    position.getY(index) * precision,
  )}:${Math.round(position.getZ(index) * precision)}`
}

function resolvedFaceLabel(labels: number[], faceIndex: number) {
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

export function extractLabelBoundary(
  geometry: THREE.BufferGeometry,
  labels: number[],
  pointSampleSize = 0,
): LabelBoundary {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!position) throw new Error('STL geometry 缺少 position 属性')

  const precision = 100_000
  const edges = new Map<
    string,
    { from: THREE.Vector3; to: THREE.Vector3; label: number; boundary: boolean }
  >()

  for (let faceIndex = 0; faceIndex * 3 + 2 < position.count; faceIndex += 1) {
    const offset = faceIndex * 3
    const label = resolvedFaceLabel(labels, faceIndex)
    const vertexIndices = [offset, offset + 1, offset + 2]
    const faceEdges: Array<[number, number]> = [
      [vertexIndices[0]!, vertexIndices[1]!],
      [vertexIndices[1]!, vertexIndices[2]!],
      [vertexIndices[2]!, vertexIndices[0]!],
    ]

    faceEdges.forEach(([fromIndex, toIndex]) => {
      const fromKey = vertexKey(position, fromIndex, precision)
      const toKey = vertexKey(position, toIndex, precision)
      const edgeKey = fromKey < toKey ? `${fromKey}|${toKey}` : `${toKey}|${fromKey}`
      const existing = edges.get(edgeKey)
      if (existing) {
        if (existing.label !== label) existing.boundary = true
        return
      }
      edges.set(edgeKey, {
        from: new THREE.Vector3(
          position.getX(fromIndex),
          position.getY(fromIndex),
          position.getZ(fromIndex),
        ),
        to: new THREE.Vector3(
          position.getX(toIndex),
          position.getY(toIndex),
          position.getZ(toIndex),
        ),
        label,
        boundary: false,
      })
    })
  }

  const linePoints: THREE.Vector3[] = []
  const sampledPoints = new Map<string, { point: THREE.Vector3; lineIndices: number[] }>()
  edges.forEach((edge) => {
    if (!edge.boundary) return
    const lineOffset = linePoints.length
    linePoints.push(edge.from, edge.to)
    ;[edge.from, edge.to].forEach((point, endpointIndex) => {
      const sampleKey =
        pointSampleSize > 0
          ? `${Math.round(point.x / pointSampleSize)}:${Math.round(
              point.y / pointSampleSize,
            )}:${Math.round(point.z / pointSampleSize)}`
          : `${Math.round(point.x * precision)}:${Math.round(
              point.y * precision,
            )}:${Math.round(point.z * precision)}`
      const sample = sampledPoints.get(sampleKey)
      if (sample) sample.lineIndices.push(lineOffset + endpointIndex)
      else sampledPoints.set(sampleKey, { point, lineIndices: [lineOffset + endpointIndex] })
    })
  })

  const samples = Array.from(sampledPoints.values())
  return {
    linePoints,
    pointPositions: samples.map((sample) => sample.point),
    pointLineIndices: samples.map((sample) => sample.lineIndices),
  }
}

function addEdge(graph: SurfaceGraph, from: string, to: string) {
  if (from === to) return
  const fromPoint = graph.vertices.get(from)
  const toPoint = graph.vertices.get(to)
  if (!fromPoint || !toPoint) return
  const weight = fromPoint.distanceTo(toPoint)
  graph.neighbors.get(from)?.set(to, weight)
  graph.neighbors.get(to)?.set(from, weight)
}

export function buildSurfaceGraph(geometry: THREE.BufferGeometry, precision = 100_000) {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!position) throw new Error('STL geometry 缺少 position 属性')

  const graph: SurfaceGraph = {
    vertices: new Map(),
    neighbors: new Map(),
    precision,
    surface: buildSurfaceFaceTopology(geometry),
  }
  const keys = new Array<string>(position.count)

  for (let index = 0; index < position.count; index += 1) {
    const key = vertexKey(position, index, precision)
    keys[index] = key
    if (graph.vertices.has(key)) continue
    graph.vertices.set(
      key,
      new THREE.Vector3(position.getX(index), position.getY(index), position.getZ(index)),
    )
    graph.neighbors.set(key, new Map())
  }

  const indices = geometry.getIndex()
  const count = indices ? indices.count : position.count
  for (let index = 0; index + 2 < count; index += 3) {
    const a = keys[indices ? indices.getX(index) : index]!
    const b = keys[indices ? indices.getX(index + 1) : index + 1]!
    const c = keys[indices ? indices.getX(index + 2) : index + 2]!
    addEdge(graph, a, b)
    addEdge(graph, b, c)
    addEdge(graph, c, a)
  }

  return graph
}

export function findNearestSurfaceVertexKey(graph: SurfaceGraph, point: THREE.Vector3) {
  const directKey = `${Math.round(point.x * graph.precision)}:${Math.round(
    point.y * graph.precision,
  )}:${Math.round(point.z * graph.precision)}`
  if (graph.vertices.has(directKey)) return directKey

  let nearestKey = ''
  let nearestDistance = Number.POSITIVE_INFINITY
  graph.vertices.forEach((vertex, key) => {
    const distance = vertex.distanceToSquared(point)
    if (distance >= nearestDistance) return
    nearestDistance = distance
    nearestKey = key
  })
  return nearestKey
}

export function findShortestSurfacePathKeys(graph: SurfaceGraph, start: string, end: string) {
  if (start === end) return [start]

  const distances = new Map<string, number>([[start, 0]])
  const previous = new Map<string, string>()
  const queue = new MinPriorityQueue()
  queue.push({ key: start, distance: 0 })

  while (queue.size) {
    const current = queue.pop()
    if (!current || current.distance !== distances.get(current.key)) continue
    if (current.key === end) break

    graph.neighbors.get(current.key)?.forEach((weight, neighbor) => {
      const nextDistance = current.distance + weight
      if (nextDistance >= (distances.get(neighbor) ?? Number.POSITIVE_INFINITY)) return
      distances.set(neighbor, nextDistance)
      previous.set(neighbor, current.key)
      queue.push({ key: neighbor, distance: nextDistance })
    })
  }

  if (!distances.has(end)) throw new Error('边界点之间不存在连续的模型表面路径')
  const path = [end]
  while (path[0] !== start) path.unshift(previous.get(path[0]!)!)
  return path
}

export function createSurfaceSegmentPoints(
  graph: SurfaceGraph,
  fromPoint: THREE.Vector3,
  toPoint: THREE.Vector3,
  fromAnchor?: SurfaceAnchor,
  toAnchor?: SurfaceAnchor,
) {
  return createFaceConstrainedSegment(graph.surface, fromPoint, toPoint, fromAnchor, toAnchor)
}

function controlPositionKey(graph: SurfaceGraph, point: THREE.Vector3) {
  const epsilon = graph.surface.epsilon
  return `${Math.round(point.x / epsilon)}:${Math.round(point.y / epsilon)}:${Math.round(point.z / epsilon)}`
}

export function createClosedSurfaceSegments(graph: SurfaceGraph, anchorPoints: THREE.Vector3[]) {
  const anchorKeys = anchorPoints.map((point) => controlPositionKey(graph, point))
  if (new Set(anchorKeys).size < 3) throw new Error('至少需要 3 个不同的 Boundary Points')
  return anchorPoints.map((point, index) =>
    createSurfaceSegmentPoints(graph, point, anchorPoints[(index + 1) % anchorPoints.length]!),
  )
}

export function createClosedSurfacePath(
  graph: SurfaceGraph,
  sampledPoints: THREE.Vector3[],
): ClosedSurfacePath {
  const seen = new Set<string>()
  const anchorKeys: string[] = []
  const anchorPoints: THREE.Vector3[] = []
  sampledPoints.forEach((point) => {
    const surfacePoint = bindFacePathPoint(graph.surface, point).point
    const key = controlPositionKey(graph, surfacePoint)
    if (!key || seen.has(key)) return
    seen.add(key)
    anchorKeys.push(key)
    anchorPoints.push(surfacePoint)
  })

  if (anchorKeys.length < 3) throw new Error('至少需要 3 个不同的 Boundary Points')

  const segmentPoints = createClosedSurfaceSegments(graph, anchorPoints)

  return {
    anchorPoints,
    curvePoints: segmentPoints.flatMap((segment, index) => (index ? segment.slice(1) : segment)),
    segmentPoints,
  }
}

/** 恢复实际保存的显示路径，不用控制点重新求路而改变用户已编辑的曲线。 */
export function restoreClosedSurfacePath(graph: SurfaceGraph, anchors: THREE.Vector3[], saved: [number, number, number][][]): ClosedSurfacePath {
  const { tree, faces, epsilon } = graph.surface
  if (saved.length !== anchors.length) throw new Error('保存路径与控制点数量不一致')
  const segments = saved.map((segment, index) => {
    const points = segment.map((point) => new THREE.Vector3(...point))
    if (points.length < 2 || points[0]!.distanceTo(anchors[index]!) > epsilon || points[points.length - 1]!.distanceTo(anchors[(index + 1) % anchors.length]!) > epsilon) throw new Error('保存路径端点与 Boundary 不一致')
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!, b = points[i]!
      const hit = tree.closestPointToPoint(a.clone().lerp(b, 0.5))
      if (!hit || hit.distance > epsilon) throw new Error('保存的路径不在当前 STL 表面上')
      const face = faces[hit.faceIndex]!
      if ([a, b].some((point) => face.triangle.closestPointToPoint(point, new THREE.Vector3()).distanceTo(point) > epsilon)) throw new Error('保存路径跨越三角面，不能直接恢复')
    }
    return points
  })
  return { anchorPoints: anchors.map((point) => point.clone()), segmentPoints: segments, curvePoints: segments.flatMap((segment, index) => index ? segment.slice(1) : segment) }
}

export function moveClosedSurfacePathAnchor(
  graph: SurfaceGraph,
  currentPath: ClosedSurfacePath,
  anchorIndex: number,
  nextPoint: THREE.Vector3,
  nextAnchor?: SurfaceAnchor,
) {
  const anchorPoints = currentPath.anchorPoints.map((point) => point.clone())
  if (!anchorPoints[anchorIndex]) throw new Error('Boundary Point 索引无效')
  const anchorKeys = anchorPoints.map((point) => controlPositionKey(graph, point))
  const surfacePoint = bindFacePathPoint(graph.surface, nextPoint, nextAnchor).point
  const nextKey = controlPositionKey(graph, surfacePoint)
  if (anchorKeys.some((key, index) => index !== anchorIndex && key === nextKey)) {
    throw new Error('Boundary Point 不能与其他控制点重合')
  }

  anchorKeys[anchorIndex] = nextKey
  anchorPoints[anchorIndex] = surfacePoint
  const previousIndex = (anchorIndex - 1 + anchorKeys.length) % anchorKeys.length
  const segmentPoints = currentPath.segmentPoints.slice()
  segmentPoints[previousIndex] = createSurfaceSegmentPoints(
    graph,
    anchorPoints[previousIndex]!,
    anchorPoints[anchorIndex]!,
    undefined,
    nextAnchor,
  )
  segmentPoints[anchorIndex] = createSurfaceSegmentPoints(
    graph,
    anchorPoints[anchorIndex]!,
    anchorPoints[(anchorIndex + 1) % anchorPoints.length]!,
    nextAnchor,
  )

  return {
    anchorPoints,
    curvePoints: segmentPoints.flatMap((segment, index) => (index ? segment.slice(1) : segment)),
    segmentPoints,
  }
}

export function moveLabelBoundaryControl(
  linePoints: THREE.Vector3[],
  controlPoints: THREE.Vector3[],
  pointLineIndices: number[][],
  controlIndex: number,
  nextPoint: THREE.Vector3,
) {
  const currentPoint = controlPoints[controlIndex]
  if (!currentPoint) throw new Error('白色边界控制点索引无效')
  const changedIndices = pointLineIndices[controlIndex] ?? []
  changedIndices.forEach((lineIndex) => linePoints[lineIndex]?.copy(nextPoint))
  currentPoint.copy(nextPoint)
  return changedIndices
}
