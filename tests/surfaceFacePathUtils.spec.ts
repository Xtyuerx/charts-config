import { expect, test } from '@playwright/test'
import * as THREE from 'three'
import {
  buildSurfaceFaceTopology,
  createFaceConstrainedSegment,
} from '../src/page/toothSegmentationTest/utils/surfaceFacePathUtils'

function foldedGeometry() {
  return new THREE.BufferGeometry().setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 1, 0, 1, 0], 3),
  )
}

test('samples and every rendered chord stay on a triangle of the folded surface', () => {
  const geometry = foldedGeometry()
  const position = geometry.getAttribute('position')
  const before = Array.from(position.array)
  const topology = buildSurfaceFaceTopology(geometry)
  const tree = topology.tree
  const points = createFaceConstrainedSegment(
    topology,
    new THREE.Vector3(0.2, 0.2, 0),
    new THREE.Vector3(0.8, 0.8, 0.6),
  )
  expect(points.length).toBeGreaterThan(3)
  const onFace = (point: THREE.Vector3) =>
    topology.faces.some(
      ({ triangle }) =>
        triangle.closestPointToPoint(point, new THREE.Vector3()).distanceTo(point) < 1e-9,
    )
  points.forEach((point, i) => {
    expect(onFace(point)).toBe(true)
    if (i) expect(onFace(point.clone().lerp(points[i - 1]!, 0.5))).toBe(true)
  })
  expect(onFace(points[0]!.clone().lerp(points.at(-1)!, 0.5))).toBe(false)
  expect(buildSurfaceFaceTopology(geometry)).toBe(topology)
  expect(topology.tree).toBe(tree)
  expect(geometry.getIndex()).toBeNull()
  expect(geometry.getAttribute('position')).toBe(position)
  expect(Array.from(position.array)).toEqual(before)
})

test('moving inside the same triangle recomputes the shared-edge crossing', () => {
  const topology = buildSurfaceFaceTopology(foldedGeometry())
  const end = new THREE.Vector3(0.8, 0.8, 0.6)
  const a = createFaceConstrainedSegment(topology, new THREE.Vector3(0.2, 0.2, 0), end)
  const b = createFaceConstrainedSegment(topology, new THREE.Vector3(0.3, 0.2, 0), end)
  const crossing = (points: THREE.Vector3[]) =>
    points.find((point) => Math.abs(point.x + point.y - 1) < 1e-9 && Math.abs(point.z) < 1e-9)!
  expect(crossing(a).distanceTo(crossing(b))).toBeGreaterThan(0.001)
  expect(b.at(-1)?.equals(end)).toBe(true)
})

test('does not bridge nearby disconnected triangles', () => {
  const geometry = new THREE.BufferGeometry().setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0.01, 1, 0, 0.01, 0, 1, 0.01],
      3,
    ),
  )
  const topology = buildSurfaceFaceTopology(geometry)
  expect(() =>
    createFaceConstrainedSegment(
      topology,
      new THREE.Vector3(0.2, 0.2, 0),
      new THREE.Vector3(0.2, 0.2, 0.01),
    ),
  ).toThrow('没有连续')
})
