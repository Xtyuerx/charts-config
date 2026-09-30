import { expect, test } from '@playwright/test'
import * as THREE from 'three'
import { enableMeshBvh, enableNearestHit } from '../src/page/toothSegmentationTest/utils/bvhRaycastUtils'
import {
  bindBoundarySurfaceAnchors,
  projectLocalSurfaceAnchor,
  surfaceAnchorFromIntersection,
} from '../src/page/toothSegmentationTest/utils/surfaceAnchorUtils'
import { createToothBoundary, updateBoundaryControlPoint } from '../src/page/toothSegmentationTest/utils/toothBoundaryEditorUtils'

function createSurface(indexed = false) {
  const geometry = new THREE.BufferGeometry()
  // 两个分离的三角面，第二面可用于检查原始 faceIndex。
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
    3, 0, 0, 4, 0, 0, 3, 1, 0,
  ], 3))
  if (indexed) geometry.setIndex([3, 4, 5, 0, 1, 2])
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
}

test('BVH is built once without adding or reordering the STL index', () => {
  for (const indexed of [false, true]) {
    const mesh = createSurface(indexed)
    const position = mesh.geometry.getAttribute('position')
    const originalPositions = Array.from(position.array)
    const index = mesh.geometry.getIndex()
    const originalIndices = index ? Array.from(index.array) : null
    const tree = enableMeshBvh(mesh)
    expect(enableMeshBvh(mesh)).toBe(tree)
    expect(mesh.geometry.getIndex()).toBe(index)
    expect(mesh.geometry.getAttribute('position')).toBe(position)
    expect(Array.from(position.array)).toEqual(originalPositions)
    expect(index ? Array.from(index.array) : null).toEqual(originalIndices)
    const anchor = projectLocalSurfaceAnchor(mesh, new THREE.Vector3(3.25, 0.25, 0.5))
    expect(anchor.faceIndex).toBe(indexed ? 0 : 1)
    expect(anchor.position).toEqual([3.25, 0.25, 0])
    expect(anchor.barycentric).toEqual([0.5, 0.25, 0.25])
  }
})

test('raycast anchor converts world to STL local coordinates without changing the hit', () => {
  const mesh = createSurface()
  enableMeshBvh(mesh)
  mesh.position.set(10, 20, 30)
  mesh.rotation.set(0.2, 0.4, 0.1)
  mesh.scale.set(2, 3, 4)
  mesh.updateWorldMatrix(true, false)
  const localPoint = new THREE.Vector3(3.25, 0.25, 0)
  const worldPoint = mesh.localToWorld(localPoint.clone())
  const direction = new THREE.Vector3(0, 0, -1).transformDirection(mesh.matrixWorld)
  const raycaster = enableNearestHit(new THREE.Raycaster(
    worldPoint.clone().addScaledVector(direction, -10), direction,
  ))
  const hit = raycaster.intersectObject(mesh, false)[0]!
  const originalHit = hit.point.clone()
  const anchor = surfaceAnchorFromIntersection(mesh, hit)!
  expect(anchor.faceIndex).toBe(1)
  expect(anchor.point.distanceTo(localPoint)).toBeLessThan(1e-10)
  expect(anchor.barycentric[0]).toBeCloseTo(0.5)
  expect(hit.point.equals(originalHit)).toBe(true)
})

test('legacy boundary receives anchors and a dragged control stores the new face only on itself', () => {
  const mesh = createSurface()
  enableMeshBvh(mesh)
  const boundary = createToothBoundary(11, [
    new THREE.Vector3(0.1, 0.1, 0),
    new THREE.Vector3(0.7, 0.1, 0),
    new THREE.Vector3(0.1, 0.7, 0),
  ])
  bindBoundarySurfaceAnchors(mesh, boundary)
  const unchanged = JSON.stringify(boundary.boundary.slice(1))
  const anchor = projectLocalSurfaceAnchor(mesh, new THREE.Vector3(3.25, 0.25, 0))
  updateBoundaryControlPoint(new Map([[11, boundary]]), 11, 0, anchor.point, anchor)
  expect(boundary.boundary[0]).toEqual({
    type: 'control', position: [3.25, 0.25, 0], faceIndex: 1, barycentric: [0.5, 0.25, 0.25],
  })
  expect(JSON.stringify(boundary.boundary.slice(1))).toBe(unchanged)
})
