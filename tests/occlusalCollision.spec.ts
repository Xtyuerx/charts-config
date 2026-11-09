import { test, expect } from '@playwright/test'
import { BoxGeometry, Mesh, MeshBasicMaterial, Group, Matrix4 } from 'three'
import { detectToothPair, collisionOverlay } from '../src/page/toothRoots/collision'

function tooth(id: number, jaw: 'upper' | 'lower', x = 0) {
  const mesh = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial())
  mesh.position.x = x
  mesh.updateMatrixWorld(true)
  return { id, jaw, mesh }
}

test('separated boxes are omitted while near contacts retain unsigned distance', () => {
  const a = tooth(11, 'upper'),
    b = tooth(31, 'lower', 2.15)
  expect(detectToothPair(a, b, 0.1)).toBeNull()
  const hit = detectToothPair(a, b, 0.2)!
  expect(hit.kind).toBe('near')
  expect(hit.distance).toBeCloseTo(0.15)
  expect(hit.upperFaces).toEqual([])
  expect(hit.upperPoint.distanceTo(hit.lowerPoint)).toBeCloseTo(0.15)
})

test('intersecting surfaces return original face indices and local red overlay geometry', () => {
  const a = tooth(11, 'upper'),
    b = tooth(31, 'lower', 1.5)
  const hit = detectToothPair(a, b, 0)!
  expect(hit.kind).toBe('intersection')
  expect(hit.upperFaces.length).toBeGreaterThan(0)
  expect(hit.lowerFaces.length).toBeGreaterThan(0)
  const overlay = collisionOverlay(a.mesh.geometry, hit.upperFaces)
  expect(overlay.getAttribute('position').count).toBe(hit.upperFaces.length * 3)
  const p = overlay.getAttribute('position')
  for (let i = 0; i < p.count; i++) expect(Math.abs(p.getX(i))).toBeLessThanOrEqual(1)
  expect([...hit.upperFaces].every((f) => f >= 0 && f < 12)).toBe(true)
})

test('uses world transforms including parent transforms, and recomputes after moving', () => {
  const a = tooth(11, 'upper'),
    b = tooth(31, 'lower')
  const parent = new Group()
  parent.position.x = 5
  parent.add(b.mesh)
  expect(detectToothPair(a, b, 0.2)).toBeNull()
  parent.position.x = 1.5
  expect(detectToothPair(a, b, 0.2)?.kind).toBe('intersection')
  parent.position.x = 20
  expect(detectToothPair(a, b, 0.2)).toBeNull()
  expect(a.mesh.matrixWorld.equals(new Matrix4())).toBe(true)
})

test('validates threshold and does not change source triangle indices', () => {
  const a = tooth(11, 'upper'),
    b = tooth(31, 'lower', 1.5)
  const before = Array.from(a.mesh.geometry.index!.array)
  expect(() => detectToothPair(a, b, -1)).toThrow()
  detectToothPair(a, b, 0.2)
  expect(Array.from(a.mesh.geometry.index!.array)).toEqual(before)
})
