import * as THREE from 'three'
import { createClosedSurfacePath } from '../toothSegmentationTest/utils/surfaceBoundaryUtils'
import { createPreviewSurfaceFit, type PreviewFit, type SurfacePreview } from './previewSurface'
import { partitionSurface, type SurfaceCell } from './surfacePartition'

type Model = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
type Region = {
  mesh: Model
  originalGeometry: THREE.BufferGeometry
  originalMaterial: THREE.MeshStandardMaterial
  material: THREE.MeshStandardMaterial
  overlay: Model
  fit?: PreviewFit
  state: SurfacePreview
  seed: THREE.Vector3
  side: 'left' | 'right'
  targetSource: number
  gumSource: number
  baselineForeign: Map<number, THREE.Vector3[][]>
}

const center = (cell: SurfaceCell) =>
  cell.vertices
    .reduce((sum, p) => sum.add(p), new THREE.Vector3())
    .divideScalar(cell.vertices.length)

function polygonArea(vertices: THREE.Vector3[]) {
  let area = 0
  for (let i = 1; i + 1 < vertices.length; i++)
    area += new THREE.Triangle(vertices[0]!, vertices[i]!, vertices[i + 1]!).getArea()
  return area
}

/** Convex display cells lie in the same original triangle; sum their exact overlap areas. */
function intersectionArea(subject: THREE.Vector3[], clip: THREE.Vector3[], normal: THREE.Vector3) {
  let polygon = subject
  for (let i = 0; i < clip.length && polygon.length; i++) {
    const a = clip[i]!,
      direction = clip[(i + 1) % clip.length]!.clone().sub(a)
    const side = (point: THREE.Vector3) => direction.clone().cross(point.clone().sub(a)).dot(normal)
    const next: THREE.Vector3[] = []
    polygon.forEach((point, j) => {
      const end = polygon[(j + 1) % polygon.length]!,
        fromSide = side(point),
        toSide = side(end)
      if (fromSide >= 0) next.push(point)
      if ((fromSide < 0 && toSide > 0) || (fromSide > 0 && toSide < 0))
        next.push(point.clone().lerp(end, fromSide / (fromSide - toSide)))
    })
    polygon = next
  }
  return polygonArea(polygon)
}

/** Color geometry is derived from the same surface path as the visible contour. */
export class BoundaryRegionColors {
  private readonly regions = new Map<number, Region>()
  private readonly gumColor: THREE.Color
  private readonly ownedFits: PreviewFit[] = []

  constructor(
    models: Map<number, Model>,
    boundaries: Map<number, THREE.Vector3[]>,
    states?: Map<number, SurfacePreview>,
  ) {
    this.gumColor = models.get(0)?.material.color.clone() ?? new THREE.Color('#d391a0')
    try {
      for (const [label, points] of boundaries) {
        const mesh = models.get(label)
        if (!mesh || points.length < 3) continue
        const gum = models.get(0)
        const fit = states?.has(label)
          ? undefined
          : createPreviewSurfaceFit([mesh.geometry, ...(gum ? [gum.geometry] : [])])
        if (fit) this.ownedFits.push(fit)
        const state = states?.get(label) ?? { surface: fit!.surface, path: fit!(points).path }
        // Saved points are the trustworthy original contour, even after controls were restored.
        const baseline = fit
          ? fit(points).path
          : createClosedSurfacePath(state.surface.graph, points)
        const partition = partitionSurface(state.surface, baseline)
        const targetSource = state.surface.geometries.indexOf(mesh.geometry)
        const gumSource = gum ? state.surface.geometries.indexOf(gum.geometry) : -1
        const weights = new Map<number, number>()
        partition.cells.forEach((cell) => {
          if (state.surface.sources[cell.face]!.source !== targetSource) return
          const component = partition.components[cell.id]!
          weights.set(component, (weights.get(component) ?? 0) + cell.area)
        })
        const selected = [...weights].sort((a, b) => b[1] - a[1])[0]?.[0]
        if (selected === undefined) throw new Error(`牙号 ${label} 缺少可确定的内部表面`)
        const candidates = partition.cells.filter(
          (cell) =>
            partition.components[cell.id] === selected &&
            state.surface.sources[cell.face]!.source === targetSource,
        )
        const seedCell = candidates.reduce((a, b) => (a.area > b.area ? a : b))
        // Imports may already contain overlapping teeth/shared surfaces. Preserve those
        // original foreign regions, while still rejecting any newly acquired foreign area.
        const baselineForeign = new Map<number, THREE.Vector3[][]>()
        partition.cells.forEach((cell) => {
          const source = state.surface.sources[cell.face]!.source
          if (
            partition.components[cell.id] !== selected ||
            source === targetSource ||
            source === gumSource
          )
            return
          const polygons = baselineForeign.get(cell.face) ?? []
          polygons.push(cell.vertices)
          baselineForeign.set(cell.face, polygons)
        })
        const material = mesh.material.clone()
        material.color.set(0xffffff)
        material.vertexColors = true
        const overlayMaterial = mesh.material.clone()
        overlayMaterial.vertexColors = false
        const overlay = new THREE.Mesh(new THREE.BufferGeometry(), overlayMaterial)
        overlay.name = `tooth-${label}-surface-preview`
        overlay.userData.segLabel = label
        const region: Region = {
          mesh,
          originalGeometry: mesh.geometry,
          originalMaterial: mesh.material,
          material,
          overlay,
          fit,
          state,
          seed: center(seedCell),
          side:
            (partition.left.get(selected) ?? 0) >= (partition.right.get(selected) ?? 0)
              ? 'left'
              : 'right',
          targetSource,
          gumSource,
          baselineForeign,
        }
        this.regions.set(label, region)
        mesh.add(overlay)
        const samePath =
          baseline.curvePoints.length === state.path.curvePoints.length &&
          baseline.curvePoints.every((p, i) => p.equals(state.path.curvePoints[i]!))
        this.apply(
          region,
          state,
          samePath ? partition : partitionSurface(state.surface, state.path),
        )
      }
    } catch (error) {
      this.dispose()
      throw error
    }
  }

  update(label: number, value: THREE.Vector3[] | SurfacePreview) {
    const region = this.regions.get(label)
    if (!region) return
    const state = Array.isArray(value)
      ? {
          surface: region.state.surface,
          path: region.fit
            ? region.fit(value).path
            : createClosedSurfacePath(region.state.surface.graph, value),
        }
      : value
    if (state.surface !== region.state.surface)
      throw new Error('颜色预览与显示边界不属于同一参考表面')
    const partition = partitionSurface(state.surface, state.path)
    this.apply(region, state, partition)
  }

  private apply(
    region: Region,
    state: SurfacePreview,
    partition: ReturnType<typeof partitionSurface>,
  ) {
    const sides = partition[region.side]
    const selected =
      [...sides].sort((a, b) => b[1] - a[1])[0]?.[0] ?? partition.componentAt(region.seed)
    if (
      [...sides].some(
        ([component, weight]) =>
          component !== selected && weight > (sides.get(selected) ?? 0) * 0.01,
      )
    ) {
      throw new Error('边界自交或产生了多个内部区域，已拒绝修改')
    }
    const opposite = partition[region.side === 'left' ? 'right' : 'left']
    if (
      (sides.get(selected) ?? 0) > 0 &&
      (opposite.get(selected) ?? 0) > (sides.get(selected) ?? 0) * 0.01
    ) {
      throw new Error('新边界未可靠分隔牙齿内外表面，已拒绝修改')
    }
    const target = { positions: [] as number[], normals: [] as number[], colors: [] as number[] }
    const overlay = { positions: [] as number[], normals: [] as number[], colors: [] as number[] }
    for (const cell of partition.cells) {
      const source = state.surface.sources[cell.face]!
      const inside = partition.components[cell.id] === selected
      if (inside && source.source !== region.targetSource && source.source !== region.gumSource) {
        const baseline = region.baselineForeign.get(cell.face) ?? []
        if (!baseline.includes(cell.vertices)) {
          const normal = state.surface.graph.surface.faces[cell.face]!.normal
          const covered = baseline.reduce(
            (sum, polygon) => sum + intersectionArea(cell.vertices, polygon, normal),
            0,
          )
          const epsilon = Math.max(state.surface.graph.surface.epsilon * 32, 2e-7)
          if (cell.area - covered > Math.max(cell.area * 1e-6, epsilon * epsilon * 16))
            throw new Error('边界跨入了其他牙齿区域，已拒绝修改')
        }
      }
      if (source.source !== region.targetSource && (!inside || source.source !== region.gumSource))
        continue
      const output = source.source === region.targetSource ? target : overlay
      const color = inside ? region.originalMaterial.color : this.gumColor
      const triangle = state.surface.graph.surface.faces[cell.face]!.triangle
      for (let i = 1; i + 1 < cell.vertices.length; i++)
        for (const point of [cell.vertices[0]!, cell.vertices[i]!, cell.vertices[i + 1]!]) {
          const bary = triangle.getBarycoord(point, new THREE.Vector3())
          if (!bary) throw new Error('颜色边界遇到退化三角面')
          const normal = source.normals[0]!.clone()
            .multiplyScalar(bary.x)
            .addScaledVector(source.normals[1]!, bary.y)
            .addScaledVector(source.normals[2]!, bary.z)
            .normalize()
          output.positions.push(point.x, point.y, point.z)
          output.normals.push(normal.x, normal.y, normal.z)
          output.colors.push(color.r, color.g, color.b)
        }
    }
    const build = (data: typeof target) =>
      new THREE.BufferGeometry()
        .setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3))
        .setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3))
        .setAttribute('color', new THREE.Float32BufferAttribute(data.colors, 3))
    // Publish only after fitting, classification and both display buffers succeeded.
    const geometry = build(target),
      overlayGeometry = build(overlay)
    const previous = region.mesh.geometry
    region.mesh.geometry = geometry
    region.mesh.material = region.material
    if (previous !== region.originalGeometry) previous.dispose()
    region.overlay.geometry.dispose()
    region.overlay.geometry = overlayGeometry
    region.overlay.visible = !!overlay.positions.length
    region.state = state
  }

  dispose() {
    for (const region of this.regions.values()) {
      if (region.mesh.geometry !== region.originalGeometry) region.mesh.geometry.dispose()
      region.mesh.geometry = region.originalGeometry
      region.mesh.material = region.originalMaterial
      region.material.dispose()
      region.overlay.removeFromParent()
      region.overlay.geometry.dispose()
      region.overlay.material.dispose()
    }
    this.regions.clear()
    this.ownedFits.forEach((fit) => fit.dispose())
    this.ownedFits.length = 0
  }
}

/** Render boundaries against the model's depth so rear curves and points stay occluded. */
export function renderBoundaryOverlay(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  overlay: THREE.Scene,
  camera: THREE.Camera,
) {
  const autoClear = renderer.autoClear
  renderer.autoClear = true
  renderer.render(scene, camera)
  renderer.autoClear = false
  renderer.render(overlay, camera)
  renderer.autoClear = autoClear
}
