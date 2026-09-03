import { expect, test } from '@playwright/test'
import * as THREE from 'three'
import { acceleratedRaycast, type MeshBVH } from 'three-mesh-bvh'

import {
  disposeMeshBvh,
  enableMeshBvh,
} from '../src/page/toothSegmentationTest/utils/bvhRaycastUtils'

type GeometryWithBvh = THREE.BufferGeometry & {
  boundsTree?: MeshBVH | null
}

test('builds a BVH and uses accelerated raycasting for the nearest STL hit', () => {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
        0, 0, -2,
        1, 0, -2,
        0, 1, -2,
      ],
      3,
    ),
  )
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))

  enableMeshBvh(mesh)

  expect((geometry as GeometryWithBvh).boundsTree).toBeTruthy()
  expect(mesh.raycast).toBe(acceleratedRaycast)
  const raycaster = new THREE.Raycaster(
    new THREE.Vector3(0.2, 0.2, 1),
    new THREE.Vector3(0, 0, -1),
  ) as THREE.Raycaster & { firstHitOnly: boolean }
  raycaster.firstHitOnly = true
  const hits = raycaster.intersectObject(mesh, false)
  expect(hits).toHaveLength(1)
  expect(hits[0]?.point.z).toBeCloseTo(0)

  disposeMeshBvh(mesh)
  expect((geometry as GeometryWithBvh).boundsTree).toBeNull()
})
