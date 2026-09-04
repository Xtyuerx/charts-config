import * as THREE from 'three'

export type SurfaceGraph = {
  vertices: Map<string, THREE.Vector3>
  neighbors: Map<string, Map<string, number>>
  precision: number
}

export type ClosedSurfacePath = {
  anchorPoints: THREE.Vector3[]
  curvePoints: THREE.Vector3[]
  segmentPoints: THREE.Vector3[][]
}

export type LabelBoundary = {
  linePoints: THREE.Vector3[]
  pointPositions: THREE.Vector3[]
  pointLineIndices: number[][]
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

  for (let index = 0; index + 2 < position.count; index += 3) {
    const a = keys[index]!
    const b = keys[index + 1]!
    const c = keys[index + 2]!
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
) {
  const fromKey = findNearestSurfaceVertexKey(graph, fromPoint)
  const toKey = findNearestSurfaceVertexKey(graph, toPoint)
  if (!fromKey || !toKey) throw new Error('边界点无法吸附到 STL 表面')
  if (fromKey === toKey) return [fromPoint.clone(), toPoint.clone()]
  const points = findShortestSurfacePathKeys(graph, fromKey, toKey).map((key) =>
    graph.vertices.get(key)!.clone(),
  )
  points[0] = fromPoint.clone()
  points[points.length - 1] = toPoint.clone()
  return points
}

export function createClosedSurfaceSegments(graph: SurfaceGraph, anchorPoints: THREE.Vector3[]) {
  if (anchorPoints.length < 3) throw new Error('至少需要 3 个不同的 Boundary Points')
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
    const key = findNearestSurfaceVertexKey(graph, point)
    if (!key || seen.has(key)) return
    seen.add(key)
    anchorKeys.push(key)
    anchorPoints.push(point.clone())
  })

  if (anchorKeys.length < 3) throw new Error('至少需要 3 个不同的 Boundary Points')

  const segmentPoints = createClosedSurfaceSegments(graph, anchorPoints)

  return {
    anchorPoints,
    curvePoints: segmentPoints.flatMap((segment, index) => (index ? segment.slice(1) : segment)),
    segmentPoints,
  }
}

export function moveClosedSurfacePathAnchor(
  graph: SurfaceGraph,
  pathOrAnchorPoints: ClosedSurfacePath | THREE.Vector3[],
  anchorIndex: number,
  nextPoint: THREE.Vector3,
) {
  const currentPath = Array.isArray(pathOrAnchorPoints)
    ? createClosedSurfacePath(graph, pathOrAnchorPoints)
    : pathOrAnchorPoints
  const anchorPoints = currentPath.anchorPoints.map((point) => point.clone())
  if (!anchorPoints[anchorIndex]) throw new Error('Boundary Point 索引无效')
  const anchorKeys = anchorPoints.map((point) => findNearestSurfaceVertexKey(graph, point))
  const nextKey = findNearestSurfaceVertexKey(graph, nextPoint)
  if (anchorKeys.some((key, index) => index !== anchorIndex && key === nextKey)) {
    throw new Error('Boundary Point 不能与其他控制点重合')
  }

  anchorKeys[anchorIndex] = nextKey
  anchorPoints[anchorIndex] = nextPoint.clone()
  const previousIndex = (anchorIndex - 1 + anchorKeys.length) % anchorKeys.length
  const segmentPoints = currentPath.segmentPoints.map((segment) =>
    segment.map((point) => point.clone()),
  )
  segmentPoints[previousIndex] = createSurfaceSegmentPoints(
    graph,
    anchorPoints[previousIndex]!,
    anchorPoints[anchorIndex]!,
  )
  segmentPoints[anchorIndex] = createSurfaceSegmentPoints(
    graph,
    anchorPoints[anchorIndex]!,
    anchorPoints[(anchorIndex + 1) % anchorPoints.length]!,
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
