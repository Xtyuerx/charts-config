import { expect, test } from '@playwright/test'
import * as THREE from 'three'

import {
  buildGeometryPayloadFromMesh,
  createGeometryFromPayload,
  filterMeshGeometryFaces,
  getFacesInsideScreenPolygon,
} from '../src/page/allStl/utils/geometryPayloadUtils'

test('exports only remaining triangles after geometry faces are deleted', () => {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 9, 9, 9, 10, 9, 9, 9, 10, 9], 3),
  )
  const labels = [11, 11, 11, 0, 0, 0]

  const filtered = filterMeshGeometryFaces(geometry, labels, new Set([1]))
  const payload = buildGeometryPayloadFromMesh(filtered.geometry, filtered.labels, {
    removedFaceCount: 1,
    sourceFaceCount: 2,
  })

  expect(payload.positions).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0])
  expect(payload.labels).toEqual([11, 11, 11])
  expect(payload.removedFaceCount).toBe(1)
  expect(payload.sourceFaceCount).toBe(2)

  const restored = createGeometryFromPayload(payload)
  expect(restored.geometry.getAttribute('position').count).toBe(3)
  expect(restored.labels).toEqual([11, 11, 11])
})

test('finds triangles whose projected vertices fall inside a drawn screen loop', () => {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [10, 10, 0, 20, 10, 0, 10, 20, 0, 80, 80, 0, 90, 80, 0, 80, 90, 0],
      3,
    ),
  )
  const polygon = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 40 },
    { x: 0, y: 40 },
  ]

  expect(
    getFacesInsideScreenPolygon(geometry, polygon, (point) => ({ x: point.x, y: point.y })),
  ).toEqual(new Set([0]))
})

test('selects a triangle when only its projected center falls inside the drawn loop', () => {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-20, 10, 0, 60, 10, 0, 20, 60, 0], 3),
  )
  const polygon = [
    { x: 15, y: 20 },
    { x: 35, y: 20 },
    { x: 35, y: 35 },
    { x: 15, y: 35 },
  ]

  expect(
    getFacesInsideScreenPolygon(geometry, polygon, (point) => ({ x: point.x, y: point.y })),
  ).toEqual(new Set([0]))
})
