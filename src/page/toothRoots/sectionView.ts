import { Mesh, Plane, Vector2, Vector3 } from 'three'

export interface SectionFrame {
  origin: Vector3
  normal: Vector3
  u: Vector3
  v: Vector3
  plane: Plane
}

/** A slice through a tooth's actual crown center, with the local X axis as its normal. */
export function toothSectionFrame(mesh: Mesh, offset = 0): SectionFrame {
  mesh.updateWorldMatrix(true, false)
  mesh.geometry.computeBoundingBox()
  const origin = mesh.geometry.boundingBox!.getCenter(new Vector3()).applyMatrix4(mesh.matrixWorld)
  const normal = new Vector3(1, 0, 0).transformDirection(mesh.matrixWorld)
  const v = new Vector3(0, 0, 1).transformDirection(mesh.matrixWorld)
  const u = new Vector3().crossVectors(v, normal).normalize()
  v.crossVectors(normal, u).normalize()
  origin.addScaledVector(normal, offset)
  return { origin, normal, u, v, plane: new Plane().setFromNormalAndCoplanarPoint(normal, origin) }
}

/** SVG coordinates use a downward Y axis. */
export function projectSection(points: Vector3[], frame: SectionFrame): Vector2[] {
  return points.map((point) => {
    const delta = point.clone().sub(frame.origin)
    return new Vector2(delta.dot(frame.u), -delta.dot(frame.v))
  })
}
