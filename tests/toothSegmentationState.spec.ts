import { expect, test } from '@playwright/test'
import {
  createSeededState,
  markBoundaryReady,
  markBoundaryEdited,
  markConfirmed,
  segmentationKey,
} from '../src/page/toothSegmentationTest/utils/toothSegmentationState'

const boundary = {
  toothId: 11,
  boundary: [{ position: [0, 0, 0], type: 'control' as const }],
}

test('creates a seeded state with unique sorted seed faces', () => {
  expect(createSeededState(11, 'upper', [7, 3, 7])).toMatchObject({
    toothId: 11, jaw: 'upper', seedFaceIndices: [3, 7], boundary: null,
    triangleIndices: [], status: 'seeded',
  })
})

test('boundary transitions preserve boundary and confirm sorted triangles', () => {
  const ready = markBoundaryReady(createSeededState(11, 'upper', [7, 3, 7]), boundary)
  expect(ready.status).toBe('boundary-ready')
  expect(markConfirmed(ready, [9, 2, 4, 2]).triangleIndices).toEqual([2, 4, 9])
})

test('editing a confirmed boundary invalidates only its confirmed triangles', () => {
  const seeded = createSeededState(11, 'upper', [7, 3, 7])
  const ready = markBoundaryReady(seeded, boundary)
  const confirmed = markConfirmed(ready, [9, 2, 4])
  expect(markBoundaryEdited(confirmed, boundary)).toMatchObject({
    status: 'boundary-ready', triangleIndices: [],
  })
  expect(segmentationKey('upper', 11)).toBe('upper:11')
})

test('rejects confirmation without a boundary or triangles', () => {
  const seeded = createSeededState(11, 'upper', [7, 3, 7])
  expect(() => markConfirmed(seeded, [1])).toThrow()
  const ready = markBoundaryReady(seeded, boundary)
  expect(() => markConfirmed(ready, [])).toThrow()
})

test('state transitions do not mutate their input', () => {
  const seeded = createSeededState(11, 'upper', [7, 3, 7])
  const snapshot = JSON.stringify(seeded)
  const ready = markBoundaryReady(seeded, boundary)
  expect(seeded).toEqual(JSON.parse(snapshot))
  expect(ready).not.toBe(seeded)
  const confirmed = markConfirmed(ready, [2, 1])
  expect(ready.triangleIndices).toEqual([])
  expect(confirmed).not.toBe(ready)
})
