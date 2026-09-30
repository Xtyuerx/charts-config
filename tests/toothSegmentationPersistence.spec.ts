import { expect, test } from '@playwright/test'

import {
  findJawForToothId,
  parseSegmentationImportPayload,
} from '../src/page/toothSegmentationTest/utils/toothSegmentationPersistence'

const faceCounts = { upper: 3, lower: 2 }

test('keeps saved surface samples, anchors, and seeds without re-routing them', () => {
  const boundary = {
    toothId: 11,
    boundary: [
      { type: 'control', position: [0, 0, 0], faceIndex: 0, barycentric: [1, 0, 0] },
      { type: 'control', position: [1, 0, 0], faceIndex: 0, barycentric: [0, 1, 0] },
      { type: 'control', position: [0, 1, 0], faceIndex: 0, barycentric: [0, 0, 1] },
    ],
    seedFaceIndices: [0],
    surfaceSegments: [
      [[0, 0, 0], [0.5, 0, 0], [1, 0, 0]],
      [[1, 0, 0], [0, 1, 0]],
      [[0, 1, 0], [0, 0, 0]],
    ],
  }
  expect(parseSegmentationImportPayload(JSON.stringify([boundary]), faceCounts).boundaries.get(11)).toEqual(boundary)
  boundary.boundary[0]!.barycentric = [1, 1, 1]
  expect(() => parseSegmentationImportPayload([boundary], faceCounts)).toThrow('表面锚点无效')
})

test('locates the jaw from the STL original tooth labels', () => {
  const labels = { upper: [11, 11, 0], lower: [0, 31, 31] }

  expect(findJawForToothId(labels, 11)).toBe('upper')
  expect(findJawForToothId(labels, 31)).toBe('lower')
  expect(findJawForToothId(labels, 48)).toBeNull()
})

test('restores tooth ids, 3D boundary controls, and confirmed triangle labels', () => {
  const imported = parseSegmentationImportPayload(
    {
      boundaries: [
        {
          toothId: 11,
          boundary: [
            { position: [1, 2, 3], type: 'control' },
            { position: [4, 5, 6], type: 'control' },
            { position: [7, 8, 9], type: 'control' },
          ],
        },
      ],
      jaws: {
        upper: { triangleLabels: [11, 0, 11], teeth: [] },
        lower: { triangleLabels: [0, 0], teeth: [] },
      },
    },
    faceCounts,
  )

  expect(Array.from(imported.boundaries.entries())).toEqual([
    [
      11,
      {
        toothId: 11,
        boundary: [
          { position: [1, 2, 3], type: 'control' },
          { position: [4, 5, 6], type: 'control' },
          { position: [7, 8, 9], type: 'control' },
        ],
      },
    ],
  ])
  expect(imported.jaws).toEqual({ upper: [11, 0, 11], lower: [0, 0] })
})

test('accepts a boundaries-only JSON object and initializes empty classifications', () => {
  const imported = parseSegmentationImportPayload(
    {
      boundaries: [
        {
          toothId: 31,
          boundary: [
            { position: [0, 0, 0], type: 'control' },
            { position: [1, 0, 0], type: 'control' },
            { position: [0, 1, 0], type: 'control' },
          ],
        },
      ],
    },
    faceCounts,
  )

  expect(imported.boundaries.get(31)?.boundary).toHaveLength(3)
  expect(imported.jaws).toEqual({ upper: [0, 0, 0], lower: [0, 0] })
})

test('rejects invalid coordinates and mismatched triangle label counts', () => {
  expect(() =>
    parseSegmentationImportPayload(
      {
        boundaries: [
          {
            toothId: 11,
            boundary: [
              { position: [0, 0, 0], type: 'control' },
              { position: [1, 'bad', 0], type: 'control' },
              { position: [0, 1, 0], type: 'control' },
            ],
          },
        ],
      },
      faceCounts,
    ),
  ).toThrow('三维坐标')

  expect(() =>
    parseSegmentationImportPayload(
      {
        boundaries: [],
        jaws: {
          upper: { triangleLabels: [11], teeth: [] },
          lower: { triangleLabels: [0, 0], teeth: [] },
        },
      },
      faceCounts,
    ),
  ).toThrow('上颌 triangleLabels 数量')
})
