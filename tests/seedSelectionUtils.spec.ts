import { expect, test } from '@playwright/test'

import {
  collectSeedFaces,
  sampleClosedScreenPolygon,
} from '../src/page/toothSegmentationTest/utils/seedSelectionUtils'

test('samples a concave closed stroke and includes its stroke and interior grid points', () => {
  const stroke = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 20 },
    { x: 12, y: 20 },
    { x: 12, y: 8 },
    { x: 8, y: 8 },
    { x: 8, y: 20 },
    { x: 0, y: 20 },
  ]

  const samples = sampleClosedScreenPolygon(stroke, 6)
  const keys = new Set(samples.map(({ x, y }) => `${x},${y}`))

  expect(stroke.every(({ x, y }) => keys.has(`${x},${y}`))).toBe(true)
  expect(['6,6', '18,6', '6,12', '18,12', '6,18', '18,18']
    .every(point => keys.has(point))).toBe(true)
  expect(keys.has('10,14')).toBe(false)
})

test('keeps the largest connected face component and breaks ties by smallest face index', () => {
  const hits = [
    { jaw: 'upper' as const, faceIndex: 4 },
    { jaw: 'upper' as const, faceIndex: 1 },
    { jaw: 'upper' as const, faceIndex: 2 },
    { jaw: 'upper' as const, faceIndex: 8 },
    { jaw: 'upper' as const, faceIndex: 9 },
  ]
  const faceNeighbors = [
    [], [2], [1], [], [5], [4], [], [], [9], [8],
  ]

  expect(collectSeedFaces(
    hits.map((_, index) => ({ x: index, y: 0 })),
    point => hits[point.x] ?? null,
    faceNeighbors,
  )).toEqual({ jaw: 'upper', faceIndices: [1, 2] })

  expect(collectSeedFaces(
    [{ x: 0, y: 0 }, { x: 1, y: 0 }],
    point => point.x === 0 ? { jaw: 'upper', faceIndex: 4 } : { jaw: 'upper', faceIndex: 8 },
    faceNeighbors,
  )).toEqual({ jaw: 'upper', faceIndices: [4] })
})

test('uses the jaw from the first valid hit and ignores hits from the other jaw', () => {
  const result = collectSeedFaces(
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
    point => point.x === 0
      ? null
      : point.x === 1
        ? { jaw: 'lower', faceIndex: 7 }
        : { jaw: 'upper', faceIndex: 2 },
    [[], [], [], [], [], [], [], [],],
  )

  expect(result).toEqual({ jaw: 'lower', faceIndices: [7] })
})

test('returns null when no sampled point hits either jaw', () => {
  expect(collectSeedFaces(
    [{ x: 0, y: 0 }],
    () => null,
    [],
  )).toBeNull()
})
