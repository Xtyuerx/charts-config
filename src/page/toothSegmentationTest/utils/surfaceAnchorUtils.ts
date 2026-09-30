import * as THREE from 'three'
import type { BvhBufferGeometry } from './bvhRaycastUtils'
import type { ToothBoundary } from './toothBoundaryEditorUtils'

export type SurfaceAnchor = {
  /** STL Mesh 局部坐标。 */
  position: [number, number, number]
  /** 原始 geometry 的三角面编号，不是 BVH 内部编号。 */
  faceIndex: number
  /** 对应该面三个顶点的权重。 */
  barycentric: [number, number, number]
}

export type SurfaceIntersection = SurfaceAnchor & { point: THREE.Vector3 }

function anchorOnFace(mesh: THREE.Mesh, point: THREE.Vector3, faceIndex: number): SurfaceIntersection {
  const geometry = mesh.geometry
  const positions = geometry.getAttribute('position')
  const index = geometry.getIndex()
  const count = index ? index.count : positions.count
  if (!Number.isInteger(faceIndex) || faceIndex < 0 || faceIndex * 3 + 2 >= count) {
    throw new Error('STL 表面交点的三角面编号无效')
  }
  const vertices = [0, 1, 2].map((offset) => {
    const vertexIndex = faceIndex * 3 + offset
    return new THREE.Vector3().fromBufferAttribute(
      positions, index ? index.getX(vertexIndex) : vertexIndex,
    )
  })
  const weights = THREE.Triangle.getBarycoord(point, vertices[0]!, vertices[1]!, vertices[2]!, new THREE.Vector3())
  if (!weights || ![point.x, point.y, point.z, weights.x, weights.y, weights.z].every(Number.isFinite)) {
    throw new Error('STL 表面交点无法绑定到有效三角面')
  }
  return {
    point: point.clone(),
    position: [point.x, point.y, point.z],
    faceIndex,
    barycentric: [weights.x, weights.y, weights.z],
  }
}

/** Raycaster 的世界坐标只在入口转换一次；不修改传入的 intersection。 */
export function surfaceAnchorFromIntersection(mesh: THREE.Mesh, hit: THREE.Intersection) {
  if (hit.object !== mesh || hit.faceIndex == null) return null
  mesh.updateWorldMatrix(true, false)
  return anchorOnFace(mesh, mesh.worldToLocal(hit.point.clone()), hit.faceIndex)
}

/** 仅用于初始化/恢复控制点，复用模型加载时创建的 BVH。 */
export function projectLocalSurfaceAnchor(mesh: THREE.Mesh, point: THREE.Vector3) {
  if (![point.x, point.y, point.z].every(Number.isFinite)) throw new Error('控制点坐标无效')
  const tree = (mesh.geometry as BvhBufferGeometry).boundsTree
  if (!tree) throw new Error('STL BVH 尚未建立')
  const hit = tree.closestPointToPoint(point)
  if (!hit) throw new Error('控制点附近没有有效 STL 表面')
  return anchorOnFace(mesh, hit.point, hit.faceIndex)
}

/** 旧 JSON 只有 position；恢复时以当前 STL 为准重建锚点，不信任外部面编号。 */
export function bindBoundarySurfaceAnchors(mesh: THREE.Mesh, boundary: ToothBoundary) {
  const anchored = boundary.boundary.map((control) => {
    const { position, faceIndex, barycentric } = projectLocalSurfaceAnchor(
      mesh, new THREE.Vector3(...control.position),
    )
    return { type: 'control' as const, position, faceIndex, barycentric }
  })
  boundary.boundary = anchored
  return boundary
}
