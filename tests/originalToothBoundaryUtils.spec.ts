import { expect, test } from '@playwright/test'
import * as THREE from 'three'
import { buildSurfaceGraph } from '../src/page/toothSegmentationTest/utils/surfaceBoundaryUtils'
import { extractOriginalToothBoundaries } from '../src/page/toothSegmentationTest/utils/originalToothBoundaryUtils'
import {
  createSeededState,
  markBoundaryEdited,
  markBoundaryReady,
  markConfirmed,
} from '../src/page/toothSegmentationTest/utils/toothSegmentationState'
import { prepareConfirmedToothRegion } from '../src/page/toothSegmentationTest/utils/toothRegionClassifier'

test('assigns a separate closed boundary and interior seed to each original tooth', () => {
  const geometry = new THREE.BufferGeometry().setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0], 3),
  )
  const labels = [11, 12]
  const { teeth, warnings } = extractOriginalToothBoundaries(buildSurfaceGraph(geometry), labels)
  expect(warnings).toEqual([])
  expect(teeth.map((tooth) => tooth.boundary.toothId)).toEqual([11, 12])
  teeth.forEach((tooth, face) => {
    expect(tooth.boundary.boundary).toHaveLength(3)
    expect(tooth.boundary.source).toBe('original')
    expect(tooth.triangleIndices).toEqual([face])
    expect(tooth.seedFaceIndices).toEqual([face])
    const original = markConfirmed(
      markBoundaryReady(
        createSeededState(tooth.boundary.toothId, 'upper', tooth.seedFaceIndices),
        tooth.boundary,
      ),
      tooth.triangleIndices,
    )
    expect(original.status).toBe('confirmed')
    expect(markBoundaryEdited(original, tooth.boundary).status).toBe('boundary-ready')
    expect(original.status).toBe('confirmed')
  })
  expect(labels).toEqual([11, 12])
})

test('does not guess a boundary for disconnected loops carrying the same tooth id', () => {
  const geometry = new THREE.BufferGeometry().setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 3, 0, 0, 4, 0, 0, 3, 1, 0], 3),
  )
  const result = extractOriginalToothBoundaries(buildSurfaceGraph(geometry), [11, 11])
  expect(result.teeth).toEqual([])
  expect(result.warnings[0]).toContain('多个边界环')
})

test('confirming an edited tooth preserves untouched original labels and refuses neighbor overlap', () => {
  const labels = [11, 11, 12, 12, 0]
  expect(prepareConfirmedToothRegion(labels, 11, [0, 4])).toEqual([11, 0, 12, 12, 11])
  expect(() => prepareConfirmedToothRegion(labels, 11, [0, 2])).toThrow('牙号 12')
  expect(labels).toEqual([11, 11, 12, 12, 0])
})
