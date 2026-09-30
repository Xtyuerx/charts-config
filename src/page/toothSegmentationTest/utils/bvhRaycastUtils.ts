import * as THREE from 'three'
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
  type MeshBVH,
} from 'three-mesh-bvh'

export type BvhBufferGeometry = THREE.BufferGeometry & {
  boundsTree?: MeshBVH | null
  computeBoundsTree?: typeof computeBoundsTree
  disposeBoundsTree?: typeof disposeBoundsTree
}

export type FirstHitRaycaster = THREE.Raycaster & {
  firstHitOnly?: boolean
}

export function enableMeshBvh(mesh: THREE.Mesh) {
  const geometry = mesh.geometry as BvhBufferGeometry
  geometry.computeBoundsTree ??= computeBoundsTree
  geometry.disposeBoundsTree ??= disposeBoundsTree
  // 保留原始 STL 三角面编号，不能让 BVH 重排标签/拓扑所依赖的索引。
  if (!geometry.boundsTree) geometry.computeBoundsTree({ indirect: true })
  mesh.raycast = acceleratedRaycast
  return geometry.boundsTree
}

export function disposeMeshBvh(mesh: THREE.Mesh) {
  const geometry = mesh.geometry as BvhBufferGeometry
  geometry.disposeBoundsTree?.call(geometry)
}

export function enableNearestHit(raycaster: THREE.Raycaster) {
  ;(raycaster as FirstHitRaycaster).firstHitOnly = true
  return raycaster as FirstHitRaycaster
}
