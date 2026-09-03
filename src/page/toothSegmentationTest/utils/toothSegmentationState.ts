import type { ToothBoundary } from './toothBoundaryEditorUtils'

export type JawType = 'upper' | 'lower'
export type ToothSegmentationStatus = 'seeded' | 'boundary-ready' | 'confirmed'

type StateBase = {
  toothId: number
  jaw: JawType
  seedFaceIndices: number[]
}
export type SeededState = StateBase & { status: 'seeded'; boundary: null; triangleIndices: [] }
export type BoundaryReadyState = StateBase & { status: 'boundary-ready'; boundary: ToothBoundary; triangleIndices: [] }
export type ConfirmedState = StateBase & { status: 'confirmed'; boundary: ToothBoundary; triangleIndices: [number, ...number[]] }
export type ToothSegmentationState = SeededState | BoundaryReadyState | ConfirmedState

const sortedUnique = (indices: number[]) => [...new Set(indices)].sort((a, b) => a - b)

export function createSeededState(
  toothId: number,
  jaw: JawType,
  seedFaceIndices: number[],
): ToothSegmentationState {
  return { toothId, jaw, seedFaceIndices: sortedUnique(seedFaceIndices), boundary: null, triangleIndices: [], status: 'seeded' }
}

export function markBoundaryReady(
  state: ToothSegmentationState,
  boundary: ToothBoundary,
): ToothSegmentationState {
  if (boundary.toothId !== state.toothId) throw new Error('边界牙号不匹配')
  return { ...state, boundary, triangleIndices: [], status: 'boundary-ready' }
}

export function markConfirmed(
  state: ToothSegmentationState,
  triangleIndices: number[],
): ToothSegmentationState {
  if (!state.boundary) throw new Error('确认状态必须有边界')
  const triangles = sortedUnique(triangleIndices)
  if (triangles.length === 0) throw new Error('确认状态必须有三角面')
  return { ...state, triangleIndices: triangles as [number, ...number[]], status: 'confirmed' }
}

export function markBoundaryEdited(
  state: ToothSegmentationState,
  boundary: ToothBoundary,
): ToothSegmentationState {
  return markBoundaryReady(state, boundary)
}

export function segmentationKey(jaw: JawType, toothId: number): string {
  return `${jaw}:${toothId}`
}
