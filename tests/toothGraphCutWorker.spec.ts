import { expect, test } from '@playwright/test'

import {
  solveBinaryMinCut,
  type GraphCutWorkerRequest,
} from '../src/page/toothSegmentationTest/workers/toothGraphCut.worker'
import {
  ToothGraphCutWorkerClient,
  type WorkerLike,
} from '../src/page/toothSegmentationTest/utils/toothGraphCutWorkerClient'
import type { GraphCutProblem } from '../src/page/toothSegmentationTest/utils/toothGraphCutUtils'

function problem(input: Partial<GraphCutProblem> & { faceCount: number }): GraphCutProblem {
  const { faceCount, ...overrides } = input
  return {
    roiFaceIndices: Uint32Array.from({ length: faceCount }, (_, index) => index),
    edgeFrom: new Uint32Array(),
    edgeTo: new Uint32Array(),
    edgeCapacity: new Float32Array(),
    sourceCapacity: new Float32Array(faceCount),
    sinkCapacity: new Float32Array(faceCount),
    foregroundMask: new Uint8Array(faceCount),
    backgroundMask: new Uint8Array(faceCount),
    ...overrides,
  }
}

test('solves a single path min-cut with the middle local face on the lower-cost foreground side', () => {
  const result = solveBinaryMinCut(problem({
    faceCount: 3,
    edgeFrom: Uint32Array.from([0, 1]),
    edgeTo: Uint32Array.from([1, 2]),
    edgeCapacity: Float32Array.from([10, 10]),
    sourceCapacity: Float32Array.from([100, 4, 0]),
    sinkCapacity: Float32Array.from([0, 3, 100]),
    foregroundMask: Uint8Array.from([1, 0, 0]),
    backgroundMask: Uint8Array.from([0, 0, 1]),
  }))

  expect(Array.from(result)).toEqual([1, 1, 0])
})

test('cuts both branches of a two-path graph at their minimum capacity', () => {
  const result = solveBinaryMinCut(problem({
    faceCount: 4,
    edgeFrom: Uint32Array.from([0, 1, 0, 2]),
    edgeTo: Uint32Array.from([1, 3, 2, 3]),
    edgeCapacity: Float32Array.from([1, 10, 10, 10]),
    sourceCapacity: Float32Array.from([100, 0, 0, 0]),
    sinkCapacity: Float32Array.from([0, 0, 0, 100]),
    foregroundMask: Uint8Array.from([1, 0, 0, 0]),
    backgroundMask: Uint8Array.from([0, 0, 0, 1]),
  }))

  expect(Array.from(result)).toEqual([1, 0, 0, 0])
})

test('keeps hard foreground and background seeds on their required sides', () => {
  const result = solveBinaryMinCut(problem({
    faceCount: 2,
    edgeFrom: Uint32Array.from([0]),
    edgeTo: Uint32Array.from([1]),
    edgeCapacity: Float32Array.from([0.01]),
    sourceCapacity: Float32Array.from([100, 0]),
    sinkCapacity: Float32Array.from([0, 100]),
    foregroundMask: Uint8Array.from([1, 0]),
    backgroundMask: Uint8Array.from([0, 1]),
  }))

  expect(Array.from(result)).toEqual([1, 0])
})

test('breaks equal-capacity cuts by cutting the lower local face index first', () => {
  const graph = problem({
    faceCount: 3,
    edgeFrom: Uint32Array.from([1, 0]),
    edgeTo: Uint32Array.from([2, 1]),
    edgeCapacity: Float32Array.from([1, 1]),
    sourceCapacity: Float32Array.from([100, 1, 0]),
    sinkCapacity: Float32Array.from([0, 1, 100]),
    foregroundMask: Uint8Array.from([1, 0, 0]),
    backgroundMask: Uint8Array.from([0, 0, 1]),
  })

  expect(Array.from(solveBinaryMinCut(graph))).toEqual([1, 0, 0])
  expect(Array.from(solveBinaryMinCut(graph))).toEqual([1, 0, 0])
})

class FakeWorker implements WorkerLike {
  readonly posts: Array<{ request: GraphCutWorkerRequest; transfer: Transferable[] }> = []
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  terminated = false

  postMessage(request: GraphCutWorkerRequest, transfer: Transferable[]) {
    this.posts.push({ request, transfer })
  }

  terminate() {
    this.terminated = true
  }

  respond(jobId: number, foregroundMask: Uint8Array) {
    this.onmessage?.({ data: { jobId, foregroundMask } } as MessageEvent)
  }

  fail(message: string) {
    this.onerror?.({ message } as ErrorEvent)
  }
}

test('copies every typed array before transferring all buffers to its worker', async () => {
  const worker = new FakeWorker()
  const client = new ToothGraphCutWorkerClient(() => worker)
  const graph = problem({
    faceCount: 2,
    edgeFrom: Uint32Array.from([0]),
    edgeTo: Uint32Array.from([1]),
    edgeCapacity: Float32Array.from([2]),
    sourceCapacity: Float32Array.from([3, 0]),
    sinkCapacity: Float32Array.from([0, 3]),
    foregroundMask: Uint8Array.from([1, 0]),
    backgroundMask: Uint8Array.from([0, 1]),
  })

  const pending = client.run(graph)
  const post = worker.posts[0]!
  const originalBuffers = [
    graph.roiFaceIndices.buffer,
    graph.edgeFrom.buffer,
    graph.edgeTo.buffer,
    graph.edgeCapacity.buffer,
    graph.sourceCapacity.buffer,
    graph.sinkCapacity.buffer,
    graph.foregroundMask.buffer,
    graph.backgroundMask.buffer,
  ]

  expect(post.transfer).toHaveLength(8)
  originalBuffers.forEach((buffer) => expect(post.transfer).not.toContain(buffer))
  ;[
    post.request.roiFaceIndices.buffer,
    post.request.edgeFrom.buffer,
    post.request.edgeTo.buffer,
    post.request.edgeCapacity.buffer,
    post.request.sourceCapacity.buffer,
    post.request.sinkCapacity.buffer,
    post.request.foregroundMask.buffer,
    post.request.backgroundMask.buffer,
  ].forEach((buffer) => expect(post.transfer).toContain(buffer))

  worker.respond(post.request.jobId, Uint8Array.from([1, 0]))
  await expect(pending).resolves.toEqual({ stale: false, jobId: 1, foregroundMask: Uint8Array.from([1, 0]) })
})

test('marks an older worker response stale after a newer job starts', async () => {
  const worker = new FakeWorker()
  const client = new ToothGraphCutWorkerClient(() => worker)
  const first = client.run(problem({ faceCount: 1 }))
  const second = client.run(problem({ faceCount: 1 }))

  worker.respond(1, Uint8Array.from([1]))
  worker.respond(2, Uint8Array.from([0]))

  await expect(first).resolves.toEqual({ stale: true, jobId: 1 })
  await expect(second).resolves.toEqual({ stale: false, jobId: 2, foregroundMask: Uint8Array.from([0]) })
})

test('turns worker failures into a displayable Chinese error', async () => {
  const worker = new FakeWorker()
  const client = new ToothGraphCutWorkerClient(() => worker)
  const pending = client.run(problem({ faceCount: 1 }))

  worker.fail('boom')

  await expect(pending).rejects.toThrow('Graph Cut Worker 执行失败：boom')
})
