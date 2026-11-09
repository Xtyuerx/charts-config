import { BufferGeometry, Float32BufferAttribute, Triangle, Vector3 } from 'three'
import {
  buildSurfaceGraph,
  type ClosedSurfacePath,
} from '../toothSegmentationTest/utils/surfaceBoundaryUtils'
import { createCachedSurfacePath } from './cachedSurfacePath'
import { MeshBVH } from 'three-mesh-bvh'

export type PreviewSurface = {
  geometry: BufferGeometry
  geometries: BufferGeometry[]
  graph: ReturnType<typeof buildSurfaceGraph>
  sources: { source: number; normals: Vector3[] }[]
  areas: number[]
}
export type SurfacePreview = { surface: PreviewSurface; path: ClosedSurfacePath }
export type PreviewFit = ((points: Vector3[]) => {
  points: Vector3[]
  line: Vector3[]
  path: ClosedSurfacePath
}) & { surface: PreviewSurface; dispose: () => void }

/** An immutable display reference. Only exactly duplicated triangles are removed. */
const trees = new WeakMap<BufferGeometry, MeshBVH | null>()

export function createPreviewSurfaceFit(
  geometries: BufferGeometry[],
  reference?: PreviewSurface,
): PreviewFit {
  const positions: number[] = []
  const sources: PreviewSurface['sources'] = []
  const triangles = new Set<string>()
  if (!reference)
    geometries.forEach((geometry, source) => {
      const copy = geometry.getAttribute('normal') ? undefined : geometry.clone()
      copy?.computeVertexNormals()
      const position = geometry.getAttribute('position')
      const normal = (copy ?? geometry).getAttribute('normal')
      const index = geometry.getIndex()
      const count = index?.count ?? position.count
      for (let i = 0; i < count; i += 3) {
        const ids = [0, 1, 2].map((j) => (index ? index.getX(i + j) : i + j))
        const points = ids.map((id) => new Vector3().fromBufferAttribute(position, id))
        // Draco can retain collapsed faces. They have no surface to bind a path to.
        // Filter only the derived reference; leave the imported geometry untouched.
        if (new Triangle(points[0]!, points[1]!, points[2]!).getArea() === 0) continue
        const key = points
          .map((p) => `${p.x},${p.y},${p.z}`)
          .sort()
          .join('|')
        if (triangles.has(key)) continue
        triangles.add(key)
        points.forEach((p) => positions.push(p.x, p.y, p.z))
        sources.push({
          source,
          normals: ids.map((id) => new Vector3().fromBufferAttribute(normal, id)),
        })
      }
      copy?.dispose()
    })
  const geometry =
    reference?.geometry ??
    new BufferGeometry().setAttribute('position', new Float32BufferAttribute(positions, 3))
  const graph = reference?.graph ?? buildSurfaceGraph(geometry)
  const surface: PreviewSurface = reference ?? {
    geometry,
    geometries,
    graph,
    sources,
    areas: graph.surface.faces.map((face) => face.triangle.getArea()),
  }
  const projectionTrees = geometries.flatMap((geometry) => {
    let tree = trees.get(geometry)
    if (tree === undefined) {
      const position = geometry.getAttribute('position'),
        index = geometry.getIndex()
      const count = index?.count ?? position.count,
        valid: number[] = []
      const triangle = new Triangle()
      for (let i = 0; i < count; i += 3) {
        const a = index ? index.getX(i) : i,
          b = index ? index.getX(i + 1) : i + 1,
          c = index ? index.getX(i + 2) : i + 2
        triangle.a.fromBufferAttribute(position, a)
        triangle.b.fromBufferAttribute(position, b)
        triangle.c.fromBufferAttribute(position, c)
        if (triangle.getArea() > 0) valid.push(a, b, c)
      }
      // Projection and path fitting must both ignore the same collapsed faces.
      const projection =
        valid.length === count
          ? geometry
          : new BufferGeometry().setAttribute('position', position).setIndex(valid)
      tree = valid.length ? new MeshBVH(projection, { indirect: true }) : null
      trees.set(geometry, tree)
    }
    return tree ? [tree] : []
  })
  const fitPath = createCachedSurfacePath(surface.graph)
  const fit = ((input: Vector3[]) => {
    // Snap to display-buffer precision before fitting, so save/reload uses identical paths.
    const points = input.map((point) => {
      if (![point.x, point.y, point.z].every(Number.isFinite)) throw new Error('边界控制点坐标无效')
      const hit = projectionTrees
        .map((tree) => tree.closestPointToPoint(point))
        .filter((hit) => !!hit)
        .sort((a, b) => a.distance - b.distance)[0]
      if (!hit) throw new Error('边界线无法贴合模型表面')
      return new Vector3(
        Math.fround(hit.point.x),
        Math.fround(hit.point.y),
        Math.fround(hit.point.z),
      )
    })
    const path = fitPath(points)
    return { points, line: path.curvePoints.slice(0, -1), path }
  }) as PreviewFit
  fit.surface = surface
  fit.dispose = () => {
    if (!reference) geometry.dispose()
  }
  return fit
}
