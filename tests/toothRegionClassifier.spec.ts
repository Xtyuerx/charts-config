import { expect, test } from '@playwright/test'
import * as THREE from 'three'

import { createToothBoundary } from '../src/page/toothSegmentationTest/utils/toothBoundaryEditorUtils'
import {
  buildConfirmedToothGeometry,
  buildSegmentationExportPayload,
  buildToothRegionTopology,
  classifyToothRegion,
  prepareConfirmedToothRegion,
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

test('classifies the closed surface-boundary interior without original tooth labels', () => {
  const geometry = createTwoFaceGeometry()
  const topology = buildToothRegionTopology(geometry)
  const boundary = createToothBoundary(11, [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(1, 1, 0),
  ])

  const region = classifyToothRegion(topology, boundary)

  expect(region.toothId).toBe(11)
  expect(region.triangleIndices).toEqual([0])
  expect(region.blockedEdgeCount).toBe(3)
})

test('replaces the previous region for the same tooth', () => {
  expect(prepareConfirmedToothRegion([11, 11, 0], 11, [2])).toEqual([0, 0, 11])
})

test('rejects a region that overlaps another confirmed tooth', () => {
  const labels = [0, 12]

  expect(() => prepareConfirmedToothRegion(labels, 11, [0, 1])).toThrow(
    '牙号 12（1 个三角形）',
  )
  expect(labels).toEqual([0, 12])
})

test('builds an independent non-indexed confirmed geometry without mutating the STL geometry', () => {
  const source = new THREE.BufferGeometry()
  const positions = new THREE.Float32BufferAttribute(
    [
      0, 0, 0,
      1, 0, 0,
      1, 1, 0,
      0, 1, 0,
    ],
    3,
  )
  const index = new THREE.Uint16BufferAttribute([0, 1, 2, 0, 2, 3], 1)
  source.setAttribute('position', positions)
  source.setIndex(index)
  const sourcePositionArray = positions.array
  const sourceIndexArray = index.array
  const sourcePositionVersion = positions.version
  const sourceIndexVersion = index.version

  const geometry = buildConfirmedToothGeometry(source, [1])

  expect(geometry.index).toBeNull()
  expect(geometry.getAttribute('position').count).toBe(3)
  expect(Array.from(geometry.getAttribute('position').array)).toEqual([
    0, 0, 0,
    1, 1, 0,
    0, 1, 0,
  ])
  expect(geometry.getAttribute('normal').count).toBe(3)
  expect(source.getAttribute('position')).toBe(positions)
  expect(source.index).toBe(index)
  expect(positions.array).toBe(sourcePositionArray)
  expect(index.array).toBe(sourceIndexArray)
  expect(positions.version).toBe(sourcePositionVersion)
  expect(index.version).toBe(sourceIndexVersion)
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
