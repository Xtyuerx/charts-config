import { expect, test } from '@playwright/test'
import * as THREE from 'three'

import { createToothBoundary } from '../src/page/toothSegmentationTest/utils/toothBoundaryEditorUtils'
import {
  applyConfirmedToothRegion,
  buildSegmentationExportPayload,
  buildToothRegionTopology,
  classifyToothRegion,
} from '../src/page/toothSegmentationTest/utils/toothRegionClassifier'

function createTwoFaceGeometry() {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        0, 0, 0,
        1, 0, 0,
        1, 1, 0,
        0, 0, 0,
        1, 1, 0,
        0, 1, 0,
      ],
      3,
    ),
  )
  return geometry
}

test('classifies triangles reachable from the tooth seed without crossing Boundary edges', () => {
  const geometry = createTwoFaceGeometry()
  const topology = buildToothRegionTopology(geometry)
  const boundary = createToothBoundary(11, [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(1, 1, 0),
  ])

  const region = classifyToothRegion(topology, [11, 11, 11, 0, 0, 0], boundary)

  expect(region.toothId).toBe(11)
  expect(region.triangleIndices).toEqual([0])
  expect(region.blockedEdgeCount).toBe(3)
})

test('replaces the previous region for the same tooth', () => {
  expect(applyConfirmedToothRegion([11, 11, 0], 11, [2])).toEqual([0, 0, 11])
})

test('rejects a region that overlaps another confirmed tooth', () => {
  expect(() => applyConfirmedToothRegion([0, 12], 11, [0, 1])).toThrow(
    '牙号 12（1 个三角形）',
  )
})

test('exports boundaries together with per-jaw triangle labels and tooth indices', () => {
  const boundary = createToothBoundary(11, [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0),
  ])

  expect(
    buildSegmentationExportPayload(new Map([[11, boundary]]), {
      upper: [11, 0, 11],
      lower: [0, 31],
    }),
  ).toEqual({
    boundaries: [boundary],
    jaws: {
      upper: {
        triangleLabels: [11, 0, 11],
        teeth: [{ toothId: 11, triangleIndices: [0, 2] }],
      },
      lower: {
        triangleLabels: [0, 31],
        teeth: [{ toothId: 31, triangleIndices: [1] }],
      },
    },
  })
})
