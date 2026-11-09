import { Matrix4, Mesh, Plane, Vector3 } from 'three'
import { treeFor } from './collision'

export function adjacentPairs(ids: number[], jaw: 'lower' | 'upper'): [number, number][] {
  const order =
    jaw === 'lower'
      ? [38, 37, 36, 35, 34, 33, 32, 31, 41, 42, 43, 44, 45, 46, 47, 48]
      : [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]
  const present = new Set(ids),
    pairs: [number, number][] = []
  for (let i = 0; i < order.length - 1; i++)
    if (present.has(order[i]!) && present.has(order[i + 1]!)) pairs.push([order[i]!, order[i + 1]!])
  return pairs
}

export function surfaceGap(first: Mesh, second: Mesh) {
  first.updateWorldMatrix(true, false)
  second.updateWorldMatrix(true, false)
  const tree = treeFor(first.geometry)
  treeFor(second.geometry)
  const scale = new Vector3().setFromMatrixScale(first.matrixWorld)
  if (Math.abs(scale.x - scale.y) > 1e-6 || Math.abs(scale.x - scale.z) > 1e-6 || scale.x <= 0)
    throw new Error('间隙检测不支持非均匀缩放')
  const relative = new Matrix4().copy(first.matrixWorld).invert().multiply(second.matrixWorld)
  const a = { point: new Vector3(), distance: Infinity, faceIndex: -1 }
  const b = { point: new Vector3(), distance: Infinity, faceIndex: -1 }
  const hit = tree.closestPointToGeometry(second.geometry, relative, a, b)
  if (!hit) throw new Error('牙齿网格没有可测量的三角面')
  a.point.applyMatrix4(first.matrixWorld)
  b.point.applyMatrix4(second.matrixWorld)
  return { distance: a.point.distanceTo(b.point), a: a.point, b: b.point }
}

export const pointDistance = (a: Vector3, b: Vector3) => a.distanceTo(b)

/** Intersect the original crown triangles with a world-space plane. No cap surfaces are measured. */
export function sectionSegments(mesh: Mesh, worldPlane: Plane): Vector3[] {
  mesh.updateWorldMatrix(true, false)
  const localPlane = worldPlane.clone().applyMatrix4(mesh.matrixWorld.clone().invert())
  const output: Vector3[] = [],
    seen = new Set<string>(),
    epsilon = 1e-6
  treeFor(mesh.geometry).shapecast({
    intersectsBounds: (box) => localPlane.intersectsBox(box),
    intersectsTriangle: (triangle) => {
      const vertices = [triangle.a, triangle.b, triangle.c]
      const distances = vertices.map((p) => localPlane.distanceToPoint(p))
      if (distances.every((d) => Math.abs(d) < epsilon)) return false
      const hits: Vector3[] = []
      const add = (p: Vector3) => {
        if (!hits.some((h) => h.distanceToSquared(p) < epsilon ** 2)) hits.push(p.clone())
      }
      for (let i = 0; i < 3; i++) {
        const a = vertices[i]!,
          b = vertices[(i + 1) % 3]!,
          da = distances[i]!,
          db = distances[(i + 1) % 3]!
        if (Math.abs(da) < epsilon) add(a)
        if (da * db < 0 && Math.abs(da) >= epsilon && Math.abs(db) >= epsilon)
          add(a.clone().lerp(b, da / (da - db)))
      }
      if (hits.length === 2) {
        const points = hits.map((p) => p.applyMatrix4(mesh.matrixWorld))
        const key = points
          .map((p) =>
            p
              .toArray()
              .map((n) => Math.round(n / epsilon))
              .join(','),
          )
          .sort()
          .join('|')
        if (!seen.has(key)) {
          seen.add(key)
          output.push(points[0]!, points[1]!)
        }
      }
      return false
    },
  })
  return output
}
