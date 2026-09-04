import { expect, test } from '@playwright/test'
import * as THREE from 'three'

import { extractToothBoundary } from '../src/page/toothSegmentationTest/utils/toothBoundaryExtractionUtils'
import {
  buildToothGraphTopology,
  type ToothGraphCutRoi,
} from '../src/page/toothSegmentationTest/utils/toothGraphCutUtils'

function geometryFromFaces(faces: number[][]) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(faces.flat(), 3))
  return geometry
}

function enclosedSeedGeometry() {
  return geometryFromFaces([
    [1, 1, 0, 0, 0, 0, 4, 0, 0],
    [1, 1, 0, 4, 0, 0, 0, 4, 0],
    [1, 1, 0, 0, 4, 0, 0, 0, 0],
    [4, 0, 0, 0, 0, 0, 4, -4, 0],
    [0, 4, 0, 4, 0, 0, 6, 6, 0],
    [0, 0, 0, 0, 4, 0, -4, 4, 0],
  ])
}

function roiFor(faceCount: number, seeds: number[], seedDiameter = 4): ToothGraphCutRoi {
  return {
    faceIndices: Uint32Array.from({ length: faceCount }, (_, face) => face),
    foregroundMask: Uint8Array.from({ length: faceCount }, (_, face) =>
      seeds.includes(face) ? 1 : 0,
    ),
    backgroundMask: Uint8Array.from({ length: faceCount }, (_, face) =>
      seeds.includes(face) ? 0 : 1,
    ),
    seedDiameter,
  }
}

test('keeps the foreground component containing the most seed faces', () => {
  const geometry = enclosedSeedGeometry()
  const topology = buildToothGraphTopology(geometry)
  const roi = roiFor(6, [0, 1, 2])

  const extracted = extractToothBoundary(
    geometry,
    topology,
    roi,
    Uint8Array.from([1, 1, 1, 0, 0, 0]),
    11,
  )

  expect(extracted.triangleIndices).toEqual([0, 1, 2])
  expect(extracted.boundary.toothId).toBe(11)
})

test('rejects a foreground result smaller than its seed set', () => {
  const geometry = enclosedSeedGeometry()
  const topology = buildToothGraphTopology(geometry)
  const roi = roiFor(6, [0, 1, 2])

  expect(() =>
    extractToothBoundary(geometry, topology, roi, Uint8Array.from([1, 1, 0, 0, 0, 0]), 11),
  ).toThrow('前景面数少于种子面数')
})

test('rejects a foreground result that consumes more than ninety percent of the ROI', () => {
  const geometry = enclosedSeedGeometry()
  const topology = buildToothGraphTopology(geometry)
  const roi = roiFor(6, [0, 1, 2])

  expect(() =>
    extractToothBoundary(geometry, topology, roi, Uint8Array.from([1, 1, 1, 1, 1, 1]), 11),
  ).toThrow('前景结果超过 ROI 的 90%')
})

test('rejects an open foreground/background boundary chain', () => {
  const geometry = geometryFromFaces([
    [0, 0, 0, 1, 0, 0, 0, 1, 0],
    [1, 0, 0, 1, 1, 0, 0, 1, 0],
    [1, 0, 0, 2, 0, 0, 1, 1, 0],
    [2, 0, 0, 2, 1, 0, 1, 1, 0],
  ])
  const topology = buildToothGraphTopology(geometry)
  const roi = roiFor(4, [0, 1, 2])

  expect(() =>
    extractToothBoundary(geometry, topology, roi, Uint8Array.from([1, 1, 1, 0]), 11),
  ).toThrow('边界不是闭合环')
})

test('drops a closed loop shorter than fifteen percent of the seed diameter', () => {
  const geometry = enclosedSeedGeometry()
  const topology = buildToothGraphTopology(geometry)
  const roi = roiFor(6, [0, 1, 2], 100)

  expect(() =>
    extractToothBoundary(geometry, topology, roi, Uint8Array.from([1, 1, 1, 0, 0, 0]), 11),
  ).toThrow('没有足够长的闭合边界环')
})

test('resamples a simplified loop to editable non-repeated controls at the seed-derived spacing', () => {
  const geometry = enclosedSeedGeometry()
  const topology = buildToothGraphTopology(geometry)
  const roi = roiFor(6, [0, 1, 2], 4)

  const extracted = extractToothBoundary(
    geometry,
    topology,
    roi,
    Uint8Array.from([1, 1, 1, 0, 0, 0]),
    11,
  )

  const controls = extracted.boundary.boundary
  expect(controls.length).toBeGreaterThanOrEqual(24)
  expect(controls.length).toBeLessThanOrEqual(64)
  expect(controls[0]?.position).not.toEqual(controls.at(-1)?.position)
  expect(controls.map((control) => control.position)).toEqual(
    extracted.loop.map((point) => point.toArray()),
  )
})
