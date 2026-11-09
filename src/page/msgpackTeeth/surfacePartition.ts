import { Line3, Triangle, Vector3 } from 'three'
import type { ClosedSurfacePath } from '../toothSegmentationTest/utils/surfaceBoundaryUtils'
import type { PreviewSurface } from './previewSurface'

type Cut = [Vector3, Vector3]
export type SurfaceCell = { id: number; face: number; vertices: Vector3[]; area: number }

function area(vertices: Vector3[]) {
  let total = 0
  for (let i = 1; i + 1 < vertices.length; i++)
    total += new Triangle(vertices[0]!, vertices[i]!, vertices[i + 1]!).getArea()
  return total
}

function split(vertices: Vector3[], cut: Cut, normal: Vector3, epsilon: number) {
  const sideNormal = cut[1].clone().sub(cut[0]).cross(normal).normalize()
  const sides = vertices.map((p) => p.clone().sub(cut[0]).dot(sideNormal))
  if (!sides.some((s) => s > epsilon) || !sides.some((s) => s < -epsilon)) return [vertices]
  const positive: Vector3[] = [],
    negative: Vector3[] = []
  vertices.forEach((point, i) => {
    const j = (i + 1) % vertices.length,
      a = sides[i]!,
      b = sides[j]!
    if (a >= -epsilon) positive.push(point)
    if (a <= epsilon) negative.push(point)
    if ((a > epsilon && b < -epsilon) || (a < -epsilon && b > epsilon)) {
      const crossing = point.clone().lerp(vertices[j]!, a / (a - b))
      positive.push(crossing)
      negative.push(crossing)
    }
  })
  return [positive, negative].filter((p) => p.length >= 3 && area(p) > epsilon * epsilon)
}

/** Overlapping edges also connect T junctions where only one triangle was split. */
function sharedMidpoint(a: Vector3[], b: Vector3[], epsilon: number) {
  for (let i = 0; i < a.length; i++) {
    const from = a[i]!,
      direction = a[(i + 1) % a.length]!.clone().sub(from),
      length = direction.length()
    if (length <= epsilon) continue
    direction.divideScalar(length)
    for (let j = 0; j < b.length; j++) {
      const c = b[j]!.clone().sub(from),
        d = b[(j + 1) % b.length]!.clone().sub(from)
      if (
        c.clone().cross(direction).length() > epsilon ||
        d.clone().cross(direction).length() > epsilon
      )
        continue
      const low = Math.max(0, Math.min(c.dot(direction), d.dot(direction)))
      const high = Math.min(length, Math.max(c.dot(direction), d.dot(direction)))
      if (high - low > epsilon) return from.clone().addScaledVector(direction, (low + high) / 2)
    }
  }
}

/** Split only derived display triangles, then flood cells without crossing the drawn path. */
export function partitionSurface(surface: PreviewSurface, path: ClosedSurfacePath) {
  const { faces, tree } = surface.graph.surface
  const epsilon = Math.max(surface.graph.surface.epsilon * 32, 2e-7)
  const cuts = new Map<number, Cut[]>()
  for (const segment of path.segmentPoints)
    for (let i = 1; i < segment.length; i++) {
      const a = segment[i - 1]!,
        b = segment[i]!
      if (a.distanceToSquared(b) <= epsilon * epsilon) continue
      const hit = tree.closestPointToPoint(a.clone().lerp(b, 0.5))
      if (!hit || hit.distance > epsilon) throw new Error('颜色边界未贴合模型表面')
      let bound = false
      for (const face of [hit.faceIndex, ...faces[hit.faceIndex]!.portals.map((p) => p.face)]) {
        const triangle = faces[face]!.triangle
        if (
          [a, b].some((p) => triangle.closestPointToPoint(p, new Vector3()).distanceTo(p) > epsilon)
        )
          continue
        const list = cuts.get(face) ?? []
        list.push([a, b])
        cuts.set(face, list)
        bound = true
      }
      if (!bound) throw new Error('显示边界跨越了不连续的三角面')
    }
  const cells: SurfaceCell[] = []
  const byFace = faces.map((face, index) => {
    if (!cuts.has(index)) {
      if (surface.areas[index]! <= epsilon * epsilon) return []
      const cell = {
        id: cells.length,
        face: index,
        vertices: [face.triangle.a, face.triangle.b, face.triangle.c],
        area: surface.areas[index]!,
      }
      cells.push(cell)
      return [cell]
    }
    let polygons = [[face.triangle.a, face.triangle.b, face.triangle.c]]
    for (const cut of cuts.get(index) ?? [])
      polygons = polygons.flatMap((p) => split(p, cut, face.normal, epsilon))
    return polygons
      .filter((p) => area(p) > epsilon * epsilon)
      .map((vertices) => {
        const cell = { id: cells.length, face: index, vertices, area: area(vertices) }
        cells.push(cell)
        return cell
      })
  })
  const neighbors = cells.map(() => [] as number[])
  const connect = (a: SurfaceCell, b: SurfaceCell) => {
    const midpoint = sharedMidpoint(a.vertices, b.vertices, epsilon)
    if (!midpoint) return
    for (const cut of [...(cuts.get(a.face) ?? []), ...(cuts.get(b.face) ?? [])]) {
      if (
        new Line3(...cut).closestPointToPoint(midpoint, true, new Vector3()).distanceTo(midpoint) <=
        epsilon
      )
        return
    }
    neighbors[a.id]!.push(b.id)
    neighbors[b.id]!.push(a.id)
  }
  byFace.forEach((local, face) => {
    local.forEach((cell, i) => local.slice(i + 1).forEach((other) => connect(cell, other)))
    for (const portal of faces[face]!.portals) {
      if (portal.face <= face) continue
      if (!cuts.has(face) && !cuts.has(portal.face) && local[0] && byFace[portal.face]![0]) {
        const a = local[0].id,
          b = byFace[portal.face]![0]!.id
        neighbors[a]!.push(b)
        neighbors[b]!.push(a)
        continue
      }
      local.forEach((cell) => byFace[portal.face]!.forEach((other) => connect(cell, other)))
    }
  })
  const components = new Int32Array(cells.length).fill(-1)
  let count = 0
  for (const cell of cells) {
    if (components[cell.id] !== -1) continue
    const queue = [cell.id]
    components[cell.id] = count
    for (let q = 0; q < queue.length; q++)
      for (const next of neighbors[queue[q]!]!) {
        if (components[next] !== -1) continue
        components[next] = count
        queue.push(next)
      }
    count++
  }
  const componentAt = (point: Vector3) => {
    const hit = tree.closestPointToPoint(point)
    if (!hit || hit.distance > epsilon) throw new Error('牙齿内部种子不在参考表面上')
    for (const cell of byFace[hit.faceIndex]!)
      for (let i = 1; i + 1 < cell.vertices.length; i++) {
        const triangle = new Triangle(cell.vertices[0]!, cell.vertices[i]!, cell.vertices[i + 1]!)
        if (triangle.closestPointToPoint(point, new Vector3()).distanceTo(point) <= epsilon)
          return components[cell.id]!
      }
    throw new Error('牙齿内部种子无法确定边界内侧')
  }
  // Preserve which side of the oriented surface contour each component occupies.
  // This allows a valid boundary to shrink past an old interior sample without inverting.
  const left = new Map<number, number>(),
    right = new Map<number, number>()
  for (const [faceIndex, segments] of cuts)
    for (const cut of segments)
      for (const cell of byFace[faceIndex]!) {
        if (!sharedMidpoint(cut, cell.vertices, epsilon)) continue
        const c = cell.vertices
          .reduce((sum, p) => sum.add(p), new Vector3())
          .divideScalar(cell.vertices.length)
        const side = cut[1]
          .clone()
          .sub(cut[0])
          .cross(c.clone().sub(cut[0]))
          .dot(faces[faceIndex]!.normal)
        if (Math.abs(side) <= epsilon * epsilon) continue
        const votes = side > 0 ? left : right,
          component = components[cell.id]!
        votes.set(component, (votes.get(component) ?? 0) + cut[0].distanceTo(cut[1]))
      }
  return { cells, components, componentAt, left, right }
}
