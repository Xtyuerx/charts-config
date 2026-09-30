import { expect, test } from '@playwright/test'
import * as THREE from 'three'

import {
  buildSliceContours,
  calculateOrthographicViewHeight,
  createOrthographicViewPose,
  createSliceFrame,
  sliceGeometry,
  type ToothAxisPose,
} from '../src/page/toothAxisSlice/utils/toothSliceUtils'

const identityPose: ToothAxisPose = {
  origin: new THREE.Vector3(0, 0, 0),
  quaternion: new THREE.Quaternion(),
}

test('creates front side and top frames from the tooth local coordinate system', () => {
  const front = createSliceFrame(identityPose, 'front')
  const side = createSliceFrame(identityPose, 'side')
  const top = createSliceFrame(identityPose, 'top')

  expect(front.normal.toArray()).toEqual([0, 1, 0])
  expect(front.horizontal.toArray()).toEqual([1, 0, 0])
  expect(front.vertical.toArray()).toEqual([0, 0, 1])

  expect(side.normal.toArray()).toEqual([1, 0, 0])
  expect(side.horizontal.toArray()).toEqual([0, 1, 0])
  expect(side.vertical.toArray()).toEqual([0, 0, 1])

  expect(top.normal.toArray()).toEqual([0, 0, 1])
  expect(top.horizontal.toArray()).toEqual([1, 0, 0])
  expect(top.vertical.toArray()).toEqual([0, 1, 0])
})

test('rotates slice frames with the edited tooth axis', () => {
  const pose: ToothAxisPose = {
    origin: new THREE.Vector3(3, 4, 5),
    quaternion: new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      Math.PI / 2,
    ),
  }

  const front = createSliceFrame(pose, 'front')

  expect(front.origin.toArray()).toEqual([3, 4, 5])
  expect(front.normal.x).toBeCloseTo(-1, 6)
  expect(front.normal.y).toBeCloseTo(0, 6)
  expect(front.horizontal.x).toBeCloseTo(0, 6)
  expect(front.horizontal.y).toBeCloseTo(1, 6)
})

test('places orthographic cameras on the three negative tooth axes', () => {
  const front = createOrthographicViewPose(identityPose, 'front', 10)
  const side = createOrthographicViewPose(identityPose, 'side', 10)
  const top = createOrthographicViewPose(identityPose, 'top', 10)

  expect(front.position.toArray()).toEqual([0, -10, 0])
  expect(front.target.toArray()).toEqual([0, 0, 0])
  expect(front.up.toArray()).toEqual([0, 0, 1])

  expect(side.position.toArray()).toEqual([-10, 0, 0])
  expect(side.up.toArray()).toEqual([0, 0, 1])

  expect(top.position.toArray()).toEqual([0, 0, -10])
  expect(top.up.toArray()).toEqual([0, 1, 0])
})

test('expands a narrow orthographic view to keep a wide tooth visible', () => {
  const box = new THREE.Box3(
    new THREE.Vector3(-2, -1, -1),
    new THREE.Vector3(2, 1, 1),
  )

  expect(calculateOrthographicViewHeight(box, identityPose, 'front', 0.5, 1)).toBeCloseTo(
    8,
    6,
  )
})

test('cuts a box into line segments expressed in slice-local coordinates', () => {
  const geometry = new THREE.BoxGeometry(2, 2, 2).toNonIndexed()
  const frame = createSliceFrame(identityPose, 'front')

  const segments = sliceGeometry(geometry, frame)
  const coordinates = segments.flatMap((segment) => [segment.start, segment.end])

  expect(segments).toHaveLength(8)
  expect(Math.min(...coordinates.map((point) => point.x))).toBeCloseTo(-1, 6)
  expect(Math.max(...coordinates.map((point) => point.x))).toBeCloseTo(1, 6)
  expect(Math.min(...coordinates.map((point) => point.y))).toBeCloseTo(-1, 6)
  expect(Math.max(...coordinates.map((point) => point.y))).toBeCloseTo(1, 6)
})

test('returns no segments when the slice plane misses the tooth', () => {
  const geometry = new THREE.BoxGeometry(2, 2, 2).toNonIndexed()
  const frame = createSliceFrame(
    {
      origin: new THREE.Vector3(0, 3, 0),
      quaternion: new THREE.Quaternion(),
    },
    'front',
  )

  expect(sliceGeometry(geometry, frame)).toEqual([])
})

test('joins unordered triangle intersections into a closed slice contour', () => {
  const geometry = new THREE.BoxGeometry(2, 2, 2).toNonIndexed()
  const frame = createSliceFrame(identityPose, 'front')

  const segments = sliceGeometry(geometry, frame)
  const contours = buildSliceContours(segments)

  expect(contours).toHaveLength(1)
  expect(contours[0].length).toBeGreaterThanOrEqual(5)
  expect(contours[0][0].x).toBeCloseTo(contours[0].at(-1)!.x, 6)
  expect(contours[0][0].y).toBeCloseTo(contours[0].at(-1)!.y, 6)
})
