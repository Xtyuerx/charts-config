import { Box3, BufferGeometry, Float32BufferAttribute, Matrix4, Mesh, Vector3 } from 'three'
import { MeshBVH, type HitPointInfo } from 'three-mesh-bvh'

export interface CollisionTooth {
  id: number
  jaw: 'upper' | 'lower'
  mesh: Mesh
}
export interface ToothContact {
  key: string
  upperId: number
  lowerId: number
  kind: 'intersection' | 'near'
  /** Unsigned surface gap, never penetration depth. */
  distance: number
  upperFaces: number[]
  lowerFaces: number[]
  upperPoint: Vector3
  lowerPoint: Vector3
}
const trees = new WeakMap<BufferGeometry, MeshBVH>()

export function treeFor(geometry: BufferGeometry) {
  let tree = trees.get(geometry)
  if (!tree) {
    tree = new MeshBVH(geometry, { indirect: true })
    trees.set(geometry, tree)
    // closestPointToGeometry uses the second tree when available.
    ;(geometry as BufferGeometry & { boundsTree: MeshBVH }).boundsTree = tree
  }
  return tree
}

/** Surface intersection, not solid-volume overlap. Geometry is never repositioned or reindexed. */
export function detectToothPair(
  upper: CollisionTooth,
  lower: CollisionTooth,
  threshold: number,
): ToothContact | null {
  if (!Number.isFinite(threshold) || threshold < 0) throw new Error('接触阈值必须为非负数')
  if (upper.jaw !== 'upper' || lower.jaw !== 'lower') throw new Error('需要一颗上颌牙和一颗下颌牙')
  for (const tooth of [upper, lower]) tooth.mesh.updateWorldMatrix(true, false)
  const upperBox = new Box3().setFromObject(upper.mesh)
  const lowerBox = new Box3().setFromObject(lower.mesh)
  if (!upperBox.clone().expandByScalar(threshold).intersectsBox(lowerBox)) return null
  const a = treeFor(upper.mesh.geometry),
    b = treeFor(lower.mesh.geometry)
  const relative = new Matrix4()
    .copy(upper.mesh.matrixWorld)
    .invert()
    .multiply(lower.mesh.matrixWorld)
  const scale = new Vector3().setFromMatrixScale(upper.mesh.matrixWorld)
  if (Math.abs(scale.x - scale.y) > 1e-6 || Math.abs(scale.x - scale.z) > 1e-6 || scale.x <= 0)
    throw new Error('碰撞距离检测不支持非均匀缩放，请先将缩放应用到网格')
  const upperFaces = new Set<number>(),
    lowerFaces = new Set<number>()
  const upperPoint = new Vector3(),
    lowerPoint = new Vector3()
  a.bvhcast(b, relative, {
    intersectsTriangles: (ta, tb, ia, ib) => {
      if (ta.intersectsTriangle(tb)) {
        upperFaces.add(a.resolveTriangleIndex(ia))
        lowerFaces.add(b.resolveTriangleIndex(ib))
        ta.getMidpoint(upperPoint).applyMatrix4(upper.mesh.matrixWorld)
      }
      return false // Collect all intersecting faces, not only the first pair.
    },
  })
  const base = { key: `${upper.id}-${lower.id}`, upperId: upper.id, lowerId: lower.id }
  if (upperFaces.size)
    return {
      ...base,
      kind: 'intersection',
      distance: 0,
      upperFaces: [...upperFaces],
      lowerFaces: [...lowerFaces],
      upperPoint,
      lowerPoint: upperPoint.clone(),
    }
  const first: HitPointInfo = { point: new Vector3(), distance: Infinity, faceIndex: -1 }
  const second: HitPointInfo = { point: new Vector3(), distance: Infinity, faceIndex: -1 }
  const hit = a.closestPointToGeometry(
    lower.mesh.geometry,
    relative,
    first,
    second,
    0,
    threshold / scale.x + 1e-8,
  )
  if (!hit) return null
  upperPoint.copy(first.point).applyMatrix4(upper.mesh.matrixWorld)
  lowerPoint.copy(second.point).applyMatrix4(lower.mesh.matrixWorld)
  const distance = upperPoint.distanceTo(lowerPoint)
  if (distance > threshold + 1e-7) return null
  return { ...base, kind: 'near', distance, upperFaces: [], lowerFaces: [], upperPoint, lowerPoint }
}

export function collisionOverlay(geometry: BufferGeometry, faces: number[]) {
  const positions = geometry.getAttribute('position'),
    index = geometry.getIndex()
  const result: number[] = []
  for (const face of faces)
    for (let k = 0; k < 3; k++) {
      const vertex = index ? index.getX(face * 3 + k) : face * 3 + k
      result.push(positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex))
    }
  const overlay = new BufferGeometry().setAttribute(
    'position',
    new Float32BufferAttribute(result, 3),
  )
  overlay.computeVertexNormals()
  return overlay
}
