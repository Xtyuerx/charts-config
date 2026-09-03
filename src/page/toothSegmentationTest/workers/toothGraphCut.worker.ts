import type { GraphCutProblem } from '../utils/toothGraphCutUtils'

export type GraphCutWorkerRequest = GraphCutProblem & { jobId: number }

export type GraphCutWorkerResponse = {
  jobId: number
  foregroundMask: Uint8Array
}

export type GraphCutWorkerErrorResponse = {
  jobId: number
  error: string
}

type ResidualEdge = {
  to: number
  reverse: number
  capacity: number
}

type CapacityArc = {
  from: number
  to: number
  capacity: number
  order: number
}

function addResidualEdge(graph: ResidualEdge[][], from: number, to: number, capacity: number) {
  const forward: ResidualEdge = { to, reverse: graph[to]!.length, capacity }
  const backward: ResidualEdge = { to: from, reverse: graph[from]!.length, capacity: 0 }
  graph[from]!.push(forward)
  graph[to]!.push(backward)
}

function buildLevelGraph(graph: ResidualEdge[][], source: number, sink: number) {
  const levels = new Int32Array(graph.length)
  levels.fill(-1)
  const queue = new Uint32Array(graph.length)
  let head = 0
  let tail = 0
  levels[source] = 0
  queue[tail++] = source
  while (head < tail) {
    const from = queue[head++]!
    for (const edge of graph[from]!) {
      if (edge.capacity <= 0 || levels[edge.to] !== -1) continue
      levels[edge.to] = levels[from]! + 1
      if (edge.to === sink) return levels
      queue[tail++] = edge.to
    }
  }
  return levels
}

function sendLevelFlow(graph: ResidualEdge[][], levels: Int32Array, next: Uint32Array, source: number, sink: number) {
  const pathNodes = [source]
  const pathEdges: Array<{ from: number; edgeIndex: number }> = []
  while (pathNodes.length) {
    const from = pathNodes[pathNodes.length - 1]!
    if (from === sink) {
      let flow = Number.POSITIVE_INFINITY
      pathEdges.forEach(({ from: pathFrom, edgeIndex }) => {
        flow = Math.min(flow, graph[pathFrom]![edgeIndex]!.capacity)
      })
      pathEdges.forEach(({ from: pathFrom, edgeIndex }) => {
        const edge = graph[pathFrom]![edgeIndex]!
        edge.capacity -= flow
        graph[edge.to]![edge.reverse]!.capacity += flow
      })
      return flow
    }

    const edges = graph[from]!
    while (next[from]! < edges.length) {
      const edge = edges[next[from]!]!
      if (edge.capacity > 0 && levels[edge.to] === levels[from]! + 1) break
      next[from] = next[from]! + 1
    }
    if (next[from]! < edges.length) {
      const edgeIndex = next[from]!
      const edge = edges[edgeIndex]!
      pathEdges.push({ from, edgeIndex })
      pathNodes.push(edge.to)
      continue
    }

    levels[from] = -1
    pathNodes.pop()
    const previous = pathEdges.pop()
    if (previous) next[previous.from] = next[previous.from]! + 1
  }
  return 0
}

function sourceReachableMask(graph: ResidualEdge[][], source: number, faceCount: number) {
  const reachable = new Uint8Array(graph.length)
  const queue = new Uint32Array(graph.length)
  let head = 0
  let tail = 0
  reachable[source] = 1
  queue[tail++] = source
  while (head < tail) {
    const from = queue[head++]!
    for (const edge of graph[from]!) {
      if (edge.capacity <= 0 || reachable[edge.to]) continue
      reachable[edge.to] = 1
      queue[tail++] = edge.to
    }
  }
  return Uint8Array.from({ length: faceCount }, (_, face) => reachable[face] ? 1 : 0)
}

export function solveBinaryMinCut(problem: GraphCutProblem): Uint8Array {
  const faceCount = problem.roiFaceIndices.length
  const source = faceCount
  const sink = source + 1
  const graph = Array.from({ length: faceCount + 2 }, () => [] as ResidualEdge[])
  const arcs: CapacityArc[] = []
  let order = 0
  const addArc = (from: number, to: number, capacity: number) => arcs.push({ from, to, capacity, order: order++ })

  for (let face = 0; face < faceCount; face += 1) {
    addArc(source, face, problem.sourceCapacity[face] ?? 0)
    addArc(face, sink, problem.sinkCapacity[face] ?? 0)
  }
  for (let edge = 0; edge < problem.edgeCapacity.length; edge += 1) {
    const from = problem.edgeFrom[edge]
    const to = problem.edgeTo[edge]
    const capacity = problem.edgeCapacity[edge]
    if (from === undefined || to === undefined || capacity === undefined) continue
    addArc(from, to, capacity)
    addArc(to, from, capacity)
  }
  arcs
    .sort((first, second) => first.from - second.from || first.to - second.to || first.order - second.order)
    .forEach(({ from, to, capacity }) => addResidualEdge(graph, from, to, capacity))

  while (true) {
    const levels = buildLevelGraph(graph, source, sink)
    if (levels[sink]! < 0) break
    const next = new Uint32Array(graph.length)
    while (sendLevelFlow(graph, levels, next, source, sink) > 0) {
      // The next blocking-flow path is found by the following iteration.
    }
  }
  return sourceReachableMask(graph, source, faceCount)
}

function workerErrorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : '未知错误'
}

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<GraphCutWorkerRequest>) => void) | null
  postMessage: (message: GraphCutWorkerResponse | GraphCutWorkerErrorResponse, transfer?: Transferable[]) => void
  importScripts?: unknown
}

if (typeof workerScope.postMessage === 'function' && typeof workerScope.importScripts === 'function') {
  workerScope.onmessage = (event) => {
    const { jobId, ...problem } = event.data
    try {
      const foregroundMask = solveBinaryMinCut(problem)
      workerScope.postMessage({ jobId, foregroundMask }, [foregroundMask.buffer])
    } catch (error) {
      workerScope.postMessage({ jobId, error: workerErrorMessage(error) })
    }
  }
}
