import { test, expect } from '@playwright/test'
import { BoxGeometry, Mesh, MeshBasicMaterial, Plane, Vector3 } from 'three'
import { toothSectionFrame, projectSection } from '../src/page/toothRoots/sectionView'
import {
  adjacentPairs,
  surfaceGap,
  sectionSegments,
  pointDistance,
} from '../src/page/toothRoots/measurements'

function box(x = 0) {
  const mesh = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial())
  mesh.position.x = x
  return mesh
}
test('adjacent pairs follow FDI order across the midline and do not bridge missing teeth', () => {
  expect(adjacentPairs([31, 32, 34, 41, 42], 'lower')).toEqual([
    [32, 31],
    [31, 41],
    [41, 42],
  ])
  expect(adjacentPairs([11, 12, 21], 'upper')).toEqual([
    [12, 11],
    [11, 21],
  ])
})
test('surface gaps use triangle surfaces and current world transforms', () => {
  const a = box(),
    b = box(3)
  const gap = surfaceGap(a, b)
  expect(gap.distance).toBeCloseTo(1)
  expect(gap.a.distanceTo(gap.b)).toBeCloseTo(1)
  b.position.x = 1.5
  expect(surfaceGap(a, b).distance).toBeCloseTo(0)
  b.position.x = 4
  expect(surfaceGap(a, b).distance).toBeCloseTo(2)
})
test('sections intersect transformed triangles and omit surfaces away from the plane', () => {
  const mesh = box(3)
  const points = sectionSegments(mesh, new Plane(new Vector3(0, 0, 1), 0))
  expect(points.length).toBeGreaterThan(0)
  for (const p of points) {
    expect(p.z).toBeCloseTo(0)
    expect(p.x).toBeGreaterThanOrEqual(2)
  }
  expect(sectionSegments(mesh, new Plane(new Vector3(0, 0, 1), -5))).toEqual([])
})
test('point distance reports the actual 3D gap', () => {
  expect(pointDistance(new Vector3(0, 0, 0), new Vector3(3, 4, 12))).toBe(13)
})

test('tooth slices follow the selected crown center and local frame without modifying it', () => {
  const first = box(3),
    second = box(-4)
  first.rotation.z = Math.PI / 2
  const frame = toothSectionFrame(first)
  expect(frame.plane.distanceToPoint(new Vector3(3, 0, 0))).toBeCloseTo(0)
  expect(frame.normal.y).toBeCloseTo(1)
  expect(frame.normal.dot(frame.u)).toBeCloseTo(0)
  expect(frame.normal.dot(frame.v)).toBeCloseTo(0)
  const next = toothSectionFrame(second)
  expect(next.origin.x).toBeCloseTo(-4)
  expect(first.position.x).toBe(3)
  expect(first.material.clippingPlanes).toBeNull()
  const projected = projectSection(
    [frame.origin.clone().add(frame.u), frame.origin.clone().add(frame.v)],
    frame,
  )
  expect(projected[0]!.x).toBeCloseTo(1)
  expect(projected[1]!.y).toBeCloseTo(-1)
  expect(toothSectionFrame(second, 0.5).origin.x).toBeCloseTo(-3.5)
})
