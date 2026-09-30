import { expect, test } from '@playwright/test'
import * as THREE from 'three'
import {
  reduceAutomaticBoundaryControls,
  reduceToothBoundaryControls,
} from '../src/page/toothSegmentationTest/utils/boundaryControlReductionUtils'
import { createToothBoundary } from '../src/page/toothSegmentationTest/utils/toothBoundaryEditorUtils'

function ring(count = 12) {
  return Array.from(
    { length: count },
    (_, i) =>
      new THREE.Vector3(
        Math.cos((i * Math.PI * 2) / count),
        Math.sin((i * Math.PI * 2) / count),
        0,
      ),
  )
}

test('reduces closed controls to one third while retaining the original curve and preventing repeated reduction', () => {
  const anchors = ring()
  const segments = anchors.map((point, i) => [
    point,
    point.clone().lerp(anchors[(i + 1) % anchors.length]!, 0.5),
    anchors[(i + 1) % anchors.length]!,
  ])
  const curvePoints = segments.flatMap((segment, i) => (i ? segment.slice(1) : segment))
  const boundary = createToothBoundary(11, anchors)
  const path = reduceToothBoundaryControls(boundary, {
    anchorPoints: anchors,
    segmentPoints: segments,
    curvePoints,
  })
  expect(boundary.boundary).toHaveLength(4)
  expect(path.segmentPoints).toHaveLength(4)
  expect(path.curvePoints.map((point) => point.toArray())).toEqual(
    curvePoints.map((point) => point.toArray()),
  )
  expect(reduceToothBoundaryControls(boundary, path)).toBe(path)
  expect(boundary.controlReduction).toBe(3)
})

test('automatic ring retains all surface edges with fewer linked controls', () => {
  const points = ring()
  const linePoints = points.flatMap((point, i) => [point, points[(i + 1) % points.length]!])
  const reduced = reduceAutomaticBoundaryControls({
    pointPositions: points,
    linePoints,
    pointLineIndices: points.map((_, i) => [
      2 * i,
      2 * ((i + points.length - 1) % points.length) + 1,
    ]),
  })
  expect(reduced.pointPositions).toHaveLength(4)
  expect(reduced.segmentPoints.reduce((sum, segment) => sum + segment.length - 1, 0)).toBe(12)
  reduced.pointLineIndices.forEach((indices, control) => {
    expect(indices).toHaveLength(2)
    indices.forEach((index) =>
      expect(reduced.linePoints[index]!.equals(reduced.pointPositions[control]!)).toBe(true),
    )
  })
})

test('a triangle keeps the minimum three controls', () => {
  const anchors = ring(3)
  const segments = anchors.map((point, i) => [point, anchors[(i + 1) % 3]!])
  const boundary = createToothBoundary(11, anchors)
  expect(
    reduceToothBoundaryControls(boundary, {
      anchorPoints: anchors,
      segmentPoints: segments,
      curvePoints: [],
    }).anchorPoints,
  ).toHaveLength(3)
})
