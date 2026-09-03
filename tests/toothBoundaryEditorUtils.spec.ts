import { expect, test } from '@playwright/test'
import * as THREE from 'three'

import {
  createBoundaryCurvePoints,
  createToothBoundary,
  inferDominantToothId,
  moveBoundaryToothId,
  serializeToothBoundaries,
  updateBoundaryControlPoint,
  upsertToothBoundary,
} from '../src/page/toothSegmentationTest/utils/toothBoundaryEditorUtils'

test('infers the dominant positive tooth label from sampled STL faces', () => {
  expect(inferDominantToothId([0, 11, 11, 12, 11, 0])).toBe(11)
  expect(inferDominantToothId([0, 0])).toBeNull()
})

test('stores one boundary per tooth and replaces an existing tooth entry', () => {
  const boundaries = new Map()
  upsertToothBoundary(
    boundaries,
    createToothBoundary(11, [new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0)]),
  )
  upsertToothBoundary(
    boundaries,
    createToothBoundary(11, [new THREE.Vector3(2, 0, 0), new THREE.Vector3(3, 0, 0)]),
  )

  expect(boundaries.size).toBe(1)
  expect(boundaries.get(11)?.boundary[0]?.position).toEqual([2, 0, 0])
})

test('renames a tooth entry and writes a dragged control point back to the map', () => {
  const boundaries = new Map([
    [
      11,
      createToothBoundary(11, [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(0, 1, 0),
      ]),
    ],
  ])

  moveBoundaryToothId(boundaries, 11, 12)
  updateBoundaryControlPoint(boundaries, 12, 1, new THREE.Vector3(2, 0, 0))

  expect(boundaries.has(11)).toBe(false)
  expect(boundaries.get(12)?.toothId).toBe(12)
  expect(boundaries.get(12)?.boundary[1]?.position).toEqual([2, 0, 0])
})

test('builds a closed Catmull-Rom curve and exports boundaries in tooth order', () => {
  const tooth12 = createToothBoundary(12, [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0),
  ])
  const curvePoints = createBoundaryCurvePoints(tooth12, 2)
  expect(curvePoints[0]?.equals(curvePoints.at(-1)!)).toBe(true)

  const tooth11 = createToothBoundary(11, [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0),
  ])
  const exported = JSON.parse(
    serializeToothBoundaries(
      new Map([
        [12, tooth12],
        [11, tooth11],
      ]),
    ),
  ) as Array<{ toothId: number }>
  expect(exported.map((item) => item.toothId)).toEqual([11, 12])
})
