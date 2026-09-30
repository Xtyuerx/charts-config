import type { ClosedSurfacePath, LabelBoundary } from './surfaceBoundaryUtils'
import type { ToothBoundary } from './toothBoundaryEditorUtils'
import type * as THREE from 'three'

function closedIndices(count: number) {
  const target = Math.min(count, Math.max(3, Math.ceil(count / 3)))
  return Array.from({ length: target }, (_, i) => Math.floor((i * count) / target))
}

/** 只减少控制点，合并原有密集采样段，不重新求路或拉直边界。 */
export function reduceToothBoundaryControls(
  boundary: ToothBoundary,
  path: ClosedSurfacePath,
): ClosedSurfacePath {
  if (boundary.controlReduction === 3) return path
  const count = boundary.boundary.length
  const indices = closedIndices(count)
  const segmentPoints = indices.map((from, i) => {
    const end = indices[i + 1] ?? count
    return path.segmentPoints
      .slice(from, end)
      .flatMap((segment, offset) => (offset ? segment.slice(1) : segment))
  })
  const anchorPoints = indices.map((index) => path.anchorPoints[index]!.clone())
  boundary.boundary = indices.map((index) => boundary.boundary[index]!)
  boundary.controlReduction = 3
  // 若来自 JSON，同步缓存，后续重绘不再使用减点前的分段。
  boundary.surfaceSegments = segmentPoints.map((segment) =>
    segment.map((point) => [point.x, point.y, point.z]),
  )
  return {
    anchorPoints,
    segmentPoints,
    curvePoints: segmentPoints.flatMap((segment, i) => (i ? segment.slice(1) : segment)),
  }
}

/** 自动边界是共享边网络，沿 degree=2 的链减点，保留分叉和开放端点。 */
export function reduceAutomaticBoundaryControls(
  source: LabelBoundary,
): LabelBoundary & { segmentPoints: THREE.Vector3[][] } {
  const endpointNodes = new Map<number, number>()
  source.pointLineIndices.forEach((indices, node) =>
    indices.forEach((index) => endpointNodes.set(index, node)),
  )
  const edges: Array<[number, number]> = []
  const adjacency = source.pointPositions.map(() => [] as number[])
  for (let i = 0; i < source.linePoints.length; i += 2) {
    const a = endpointNodes.get(i)!,
      b = endpointNodes.get(i + 1)!
    if (a === undefined || b === undefined) throw new Error('自动边界端点映射不完整')
    const edge = edges.length
    edges.push([a, b])
    adjacency[a]!.push(edge)
    adjacency[b]!.push(edge)
  }
  const visited = new Set<number>()
  const chains: number[][] = []
  const walk = (start: number, firstEdge: number) => {
    const chain = [start]
    let node = start,
      edge = firstEdge
    while (!visited.has(edge)) {
      visited.add(edge)
      const [a, b] = edges[edge]!
      node = a === node ? b : a
      chain.push(node)
      if (node === start || adjacency[node]!.length !== 2) break
      const next = adjacency[node]!.find((candidate) => !visited.has(candidate))
      if (next === undefined) break
      edge = next
    }
    chains.push(chain)
  }
  adjacency.forEach((neighbors, node) => {
    if (neighbors.length === 2) return
    neighbors.forEach((edge) => {
      if (!visited.has(edge)) walk(node, edge)
    })
  })
  edges.forEach(([node], edge) => {
    if (!visited.has(edge)) walk(node, edge)
  })

  const linePoints: THREE.Vector3[] = [],
    pointPositions: THREE.Vector3[] = []
  const pointLineIndices: number[][] = [],
    segmentPoints: THREE.Vector3[][] = []
  const controls = new Map<number, number>()
  const addEndpoint = (node: number) => {
    let control = controls.get(node)
    if (control === undefined) {
      control = pointPositions.length
      controls.set(node, control)
      pointPositions.push(source.pointPositions[node]!.clone())
      pointLineIndices.push([])
    }
    pointLineIndices[control]!.push(linePoints.length)
    linePoints.push(source.pointPositions[node]!.clone())
  }
  chains.forEach((chain) => {
    const closed = chain[0] === chain[chain.length - 1]
    const count = chain.length - 1
    const intervals = Math.max(1, Math.ceil(count / 3))
    const indices = closed
      ? [...closedIndices(count), count]
      : Array.from({ length: intervals + 1 }, (_, i) => Math.floor((i * count) / intervals))
    for (let i = 1; i < indices.length; i++) {
      const from = indices[i - 1]!,
        to = indices[i]!
      addEndpoint(chain[from]!)
      addEndpoint(chain[to]!)
      segmentPoints.push(
        chain.slice(from, to + 1).map((node) => source.pointPositions[node]!.clone()),
      )
    }
  })
  return { linePoints, pointPositions, pointLineIndices, segmentPoints }
}
