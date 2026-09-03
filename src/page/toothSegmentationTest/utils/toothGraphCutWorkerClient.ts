import type { GraphCutProblem } from './toothGraphCutUtils'
import type {
  GraphCutWorkerErrorResponse,
  GraphCutWorkerRequest,
  GraphCutWorkerResponse,
} from '../workers/toothGraphCut.worker'

export type GraphCutRunResult =
  | { stale: false; jobId: number; foregroundMask: Uint8Array }
  | { stale: true; jobId: number }

export type WorkerLike = {
  onmessage: ((event: MessageEvent<unknown>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage: (message: GraphCutWorkerRequest, transfer: Transferable[]) => void
  terminate: () => void
}

export type ToothGraphCutWorkerFactory = () => WorkerLike

type PendingJob = {
  resolve: (result: GraphCutRunResult) => void
  reject: (reason: Error) => void
}

function createBrowserWorker(): WorkerLike {
  return new Worker(new URL('../workers/toothGraphCut.worker.ts', import.meta.url), { type: 'module' })
}

function cloneRequest(problem: GraphCutProblem, jobId: number): GraphCutWorkerRequest {
  return {
    jobId,
    roiFaceIndices: Uint32Array.from(problem.roiFaceIndices),
    edgeFrom: Uint32Array.from(problem.edgeFrom),
    edgeTo: Uint32Array.from(problem.edgeTo),
    edgeCapacity: Float32Array.from(problem.edgeCapacity),
    sourceCapacity: Float32Array.from(problem.sourceCapacity),
    sinkCapacity: Float32Array.from(problem.sinkCapacity),
    foregroundMask: Uint8Array.from(problem.foregroundMask),
    backgroundMask: Uint8Array.from(problem.backgroundMask),
  }
}

function requestTransferList(request: GraphCutWorkerRequest): Transferable[] {
  return [
    request.roiFaceIndices.buffer,
    request.edgeFrom.buffer,
    request.edgeTo.buffer,
    request.edgeCapacity.buffer,
    request.sourceCapacity.buffer,
    request.sinkCapacity.buffer,
    request.foregroundMask.buffer,
    request.backgroundMask.buffer,
  ] as Transferable[]
}

function displayableWorkerError(message: string) {
  return new Error(`Graph Cut Worker 执行失败：${message || '未知错误'}`)
}

function isWorkerErrorResponse(response: unknown): response is GraphCutWorkerErrorResponse {
  return Boolean(response) && typeof response === 'object' && typeof (response as { error?: unknown }).error === 'string'
}

function isWorkerResponse(response: unknown): response is GraphCutWorkerResponse {
  return Boolean(response) && typeof response === 'object' && (response as { foregroundMask?: unknown }).foregroundMask instanceof Uint8Array
}

export class ToothGraphCutWorkerClient {
  private readonly worker: WorkerLike
  private readonly pending = new Map<number, PendingJob>()
  private latestJobId = 0
  private destroyed = false

  constructor(workerFactory: ToothGraphCutWorkerFactory = createBrowserWorker) {
    try {
      this.worker = workerFactory()
    } catch (error) {
      throw displayableWorkerError(error instanceof Error ? error.message : '未知错误')
    }
    this.worker.onmessage = (event) => this.handleMessage(event.data)
    this.worker.onerror = (event) => this.handleError(event.message)
  }

  run(problem: GraphCutProblem): Promise<GraphCutRunResult> {
    if (this.destroyed) return Promise.reject(new Error('Graph Cut Worker 已销毁'))
    const jobId = ++this.latestJobId
    this.pending.forEach((pending, pendingJobId) => {
      if (pendingJobId >= jobId) return
      this.pending.delete(pendingJobId)
      pending.resolve({ stale: true, jobId: pendingJobId })
    })
    const request = cloneRequest(problem, jobId)
    return new Promise<GraphCutRunResult>((resolve, reject) => {
      this.pending.set(jobId, { resolve, reject })
      try {
        this.worker.postMessage(request, requestTransferList(request))
      } catch (error) {
        this.pending.delete(jobId)
        reject(displayableWorkerError(error instanceof Error ? error.message : '未知错误'))
      }
    })
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    this.pending.forEach(({ reject }) => reject(new Error('Graph Cut Worker 已销毁')))
    this.pending.clear()
    this.worker.terminate()
  }

  private handleMessage(response: unknown) {
    const jobId = isWorkerErrorResponse(response) || isWorkerResponse(response)
      ? response.jobId
      : undefined
    if (typeof jobId !== 'number') return
    const pending = this.pending.get(jobId)
    if (!pending) return
    this.pending.delete(jobId)
    if (jobId !== this.latestJobId) {
      pending.resolve({ stale: true, jobId })
      return
    }
    if (isWorkerErrorResponse(response)) {
      pending.reject(displayableWorkerError(response.error))
      return
    }
    if (isWorkerResponse(response)) {
      pending.resolve({ stale: false, jobId, foregroundMask: response.foregroundMask })
    }
  }

  private handleError(message: string) {
    const error = displayableWorkerError(message)
    this.pending.forEach(({ reject }) => reject(error))
    this.pending.clear()
  }
}
