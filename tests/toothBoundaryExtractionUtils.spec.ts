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

function annulusGeometryWithLargeInnerBoundaryFaces() {
  const outer = [
    [0, 0, 0],
    [10, 0, 0],
    [10, 10, 0],
    [0, 10, 0],
  ]
  const middle = [
    [0.1, 0.1, 0],
    [9.9, 0.1, 0],
    [9.9, 9.9, 0],
    [0.1, 9.9, 0],
  ]
  const inner = [
    [4, 4, 0],
    [6, 4, 0],
    [6, 6, 0],
    [4, 6, 0],
  ]
  const face = (...points: number[][]) => points.flat()
  const faces: number[][] = []
  for (let index = 0; index < 4; index += 1) {
    const next = (index + 1) % 4
    faces.push(face(outer[index]!, outer[next]!, middle[next]!))
    faces.push(face(outer[index]!, middle[next]!, middle[index]!))
    faces.push(face(middle[index]!, middle[next]!, inner[next]!))
    faces.push(face(middle[index]!, inner[next]!, inner[index]!))
  }
  faces.push(face(inner[0]!, inner[1]!, inner[2]!))
  faces.push(face(inner[0]!, inner[2]!, inner[3]!))
  faces.push(face(outer[1]!, outer[0]!, [5, -5, 0]))
  faces.push(face(outer[2]!, outer[1]!, [15, 5, 0]))
  faces.push(face(outer[3]!, outer[2]!, [5, 15, 0]))
  faces.push(face(outer[0]!, outer[3]!, [-5, 5, 0]))
  return geometryFromFaces(faces)
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

test('rejects a branching foreground/background boundary chain', () => {
  const geometry = geometryFromFaces([
    [0, 0, 0, 1, 0, 0, 0, 1, 0],
    [0, 0, 0, 0, 1, 0, -1, 0, 0],
    [0, 0, 0, -1, 0, 0, 1, 0, 0],
    [1, 0, 0, 0, 0, 0, 1, -1, 0],
    [0, 1, 0, 0, 0, 0, -1, 1, 0],
    [-1, 0, 0, 0, 0, 0, -1, -1, 0],
  ])
  const topology = buildToothGraphTopology(geometry)
  const roi = roiFor(6, [0, 1, 2])

  expect(() =>
    extractToothBoundary(geometry, topology, roi, Uint8Array.from([1, 1, 1, 0, 0, 0]), 11),
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
  expect(controls).toHaveLength(41)
  expect(controls[0]?.position).not.toEqual(controls.at(-1)?.position)
  expect(controls.map((control) => control.position)).toEqual(
    extracted.loop.map((point) => point.toArray()),
  )
})

test('uses the maximum simplification tolerance to remove a sub-tolerance boundary notch', () => {
  const geometry = geometryFromFaces([
    [2, 2, 0, 0, 0, 0, 4, 0, 0],
    [2, 2, 0, 4, 0, 0, 4.05, 0.05, 0],
    [2, 2, 0, 4.05, 0.05, 0, 4, 0.1, 0],
    [2, 2, 0, 4, 0.1, 0, 4, 4, 0],
    [2, 2, 0, 4, 4, 0, 0, 4, 0],
    [2, 2, 0, 0, 4, 0, 0, 0, 0],
    [4, 0, 0, 0, 0, 0, 4, -4, 0],
    [4.05, 0.05, 0, 4, 0, 0, 8, 0, 0],
    [4, 0.1, 0, 4.05, 0.05, 0, 8, 1, 0],
    [4, 4, 0, 4, 0.1, 0, 8, 4, 0],
    [0, 4, 0, 4, 4, 0, 0, 8, 0],
    [0, 0, 0, 0, 4, 0, -4, 4, 0],
  ])
  const topology = buildToothGraphTopology(geometry)
  const roi = roiFor(12, [0, 1, 2], 20)

  const extracted = extractToothBoundary(
    geometry,
    topology,
    roi,
    Uint8Array.from([1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0]),
    11,
  )

  expect(Math.max(...extracted.loop.map((point) => point.x))).toBeLessThanOrEqual(4.001)
})

test('selects the seed-containing outer loop even when its directly adjacent triangles are smaller', () => {
  const geometry = annulusGeometryWithLargeInnerBoundaryFaces()
  const topology = buildToothGraphTopology(geometry)
  const roi = roiFor(22, [0, 1, 2], 10)

  const extracted = extractToothBoundary(
    geometry,
    topology,
    roi,
    Uint8Array.from({ length: 22 }, (_, face) => (face < 16 ? 1 : 0)),
    11,
  )

  expect(Math.min(...extracted.loop.map((point) => point.x))).toBeLessThan(1)
  expect(Math.max(...extracted.loop.map((point) => point.x))).toBeGreaterThan(9)
})
