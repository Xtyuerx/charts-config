import * as THREE from 'three'
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { PreviewFit, SurfacePreview } from './previewSurface'

type CurveOptions = {
  controls: THREE.Vector3[]
  fit: (controls: THREE.Vector3[]) => THREE.Vector3[]
}

export function boundaryPoints(
  data: unknown,
  jaw: 'lower' | 'upper',
  label: number,
  geometry: THREE.BufferGeometry,
): THREE.Vector3[] {
  const root = data as Record<string, { tooth_boundary_dict?: Record<string, unknown> }> | null
  const raw = root?.[`${jaw}_gum`]?.tooth_boundary_dict?.[label]
  if (
    Array.isArray(raw) &&
    raw.length >= 3 &&
    raw.every((p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite))
  ) {
    const points = raw.map((p) => new THREE.Vector3(...(p as [number, number, number])))
    if (points[0]!.distanceToSquared(points[points.length - 1]!) < 1e-12) points.pop()
    if (points.length >= 3) return points
  }
  // Weld coincident vertices so this also works with split non-indexed geometry.
  const position = geometry.getAttribute('position')
  if (!position) return []
  const index = geometry.getIndex()
  const vertices = new Map<string, THREE.Vector3>()
  const edges = new Map<string, { a: string; b: string; count: number }>()
  const key = (i: number) => {
    const p = new THREE.Vector3().fromBufferAttribute(position, i)
    const id = [p.x, p.y, p.z].map((x) => Math.round(x * 100000)).join(',')
    vertices.set(id, p)
    return id
  }
  const count = index?.count ?? position.count
  for (let i = 0; i < count; i += 3) {
    const ids = [0, 1, 2].map((j) => key(index ? index.getX(i + j) : i + j))
    for (let j = 0; j < 3; j++) {
      const a = ids[j]!,
        b = ids[(j + 1) % 3]!
      if (a === b) continue
      const id = [a, b].sort().join('|')
      const edge = edges.get(id)
      if (edge) edge.count++
      else edges.set(id, { a, b, count: 1 })
    }
  }
  const neighbors = new Map<string, string[]>()
  for (const edge of edges.values())
    if (edge.count === 1) {
      for (const [a, b] of [
        [edge.a, edge.b],
        [edge.b, edge.a],
      ]) {
        neighbors.set(a!, [...(neighbors.get(a!) ?? []), b!])
      }
    }
  const visited = new Set<string>()
  let best: THREE.Vector3[] = [],
    bestLength = 0
  for (const start of neighbors.keys()) {
    if (visited.has(start)) continue
    const loop: THREE.Vector3[] = []
    let current = start,
      previous = ''
    while (!visited.has(current) && neighbors.get(current)?.length === 2) {
      visited.add(current)
      loop.push(vertices.get(current)!.clone())
      const next = neighbors.get(current)!.find((n) => n !== previous)!
      previous = current
      current = next
    }
    if (current !== start || loop.length < 3) continue
    const length = loop.reduce((sum, p, i) => sum + p.distanceTo(loop[(i + 1) % loop.length]!), 0)
    if (length > bestLength) {
      best = loop
      bestLength = length
    }
  }
  return best
}

export class ToothBoundary {
  readonly group = new THREE.Group()
  readonly line: THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial>
  readonly handles: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[] = []
  private readonly anchors: number[]
  private readonly original: THREE.Vector3[]
  private previewPoints: THREE.Vector3[] | undefined
  private previewPath: SurfacePreview['path'] | undefined
  private readonly sphere: THREE.SphereGeometry
  private readonly pointMaterial = new THREE.MeshBasicMaterial({
    color: 0x28b8ef,
    depthTest: true,
    depthWrite: false,
  })

  constructor(
    readonly label: number,
    points: THREE.Vector3[],
    radius: number,
    private readonly edited?: (points: THREE.Vector3[], preview?: SurfacePreview) => void,
    private readonly curve?: CurveOptions,
    private readonly previewFit?: PreviewFit,
  ) {
    this.original = (curve?.controls ?? points).map((p) => p.clone())
    this.anchors = curve
      ? curve.controls.map((_, i) => i)
      : Array.from({ length: Math.min(points.length, 20) }, (_, i) =>
          Math.floor((i * points.length) / Math.min(points.length, 20)),
        )
    const preview = !curve ? previewFit?.(points) : undefined
    if (preview) this.original = preview.points.map((p) => p.clone())
    this.previewPoints = preview?.points
    this.previewPath = preview?.path
    this.line = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(
        curve ? curve.fit(this.original) : (preview?.line ?? points),
      ),
      new THREE.LineBasicMaterial({ color: 0x52c41a, depthTest: true, depthWrite: false }),
    )
    this.line.userData.boundaryLabel = label
    this.group.add(this.line)
    this.sphere = new THREE.SphereGeometry(radius, 10, 8)
    this.anchors.forEach((anchor, i) => {
      const handle = new THREE.Mesh(this.sphere, this.pointMaterial)
      handle.position.copy(this.previewPoints?.[anchor] ?? this.original[anchor]!)
      handle.userData.boundaryLabel = label
      handle.userData.handleIndex = i
      handle.renderOrder = 1
      this.handles.push(handle)
      this.group.add(handle)
    })
  }

  select(selected: boolean) {
    this.line.material.color.setHex(selected && !this.curve ? 0xffffff : 0x52c41a)
    this.pointMaterial.color.setHex(selected ? 0xffffff : 0x28b8ef)
    this.line.material.depthTest = true
    this.line.material.depthWrite = false
    this.pointMaterial.depthTest = true
    this.pointMaterial.depthWrite = false
    this.group.renderOrder = selected ? 100 : 0
    this.line.renderOrder = selected ? 100 : 0
    this.handles.forEach((handle) => {
      handle.renderOrder = selected ? 101 : 1
    })
  }

  move(index: number, point: THREE.Vector3) {
    if (this.curve) {
      const controls = this.handles.map((h) => h.position.clone())
      controls[index] = point.clone()
      this.restoreControls(controls)
      return
    }
    const controls = this.handles.map((h) => h.position.clone())
    controls[index] = point.clone()
    this.moveControls(controls)
  }

  private moveControls(controls: THREE.Vector3[]) {
    const updated: THREE.Vector3[] = []
    // Preserve the original dense contour; interpolate control-point displacement
    // only between adjacent anchors, including the closing segment.
    this.anchors.forEach((start, i) => {
      const next = (i + 1) % this.anchors.length
      const end = next === 0 ? this.original.length : this.anchors[next]!
      const a = controls[i]!.clone().sub(this.original[start]!)
      const b = controls[next]!.clone().sub(this.original[end % this.original.length]!)
      for (let j = start; j < end; j++) {
        const p = this.original[j]!.clone().add(a.clone().lerp(b, (j - start) / (end - start)))
        updated.push(p)
      }
    })
    const fitted = this.previewFit?.(updated)
    if (fitted) {
      // Validate and prepare colors before publishing either handles or the visible line.
      this.edited?.(fitted.points, { surface: this.previewFit!.surface, path: fitted.path })
      this.updateLine(fitted.line)
      this.previewPoints = fitted.points
      this.previewPath = fitted.path
      this.handles.forEach((handle, i) => handle.position.copy(fitted.points[this.anchors[i]!]!))
    } else {
      this.handles.forEach((handle, i) => handle.position.copy(controls[i]!))
      const attr = this.line.geometry.getAttribute('position')
      updated.forEach((p, i) => attr.setXYZ(i, p.x, p.y, p.z))
      attr.needsUpdate = true
    }
    this.line.geometry.computeBoundingSphere()
    if (!fitted) this.edited?.(this.points())
  }

  restoreControls(points: THREE.Vector3[]) {
    if (this.curve) {
      // Compute first: a failed surface fit never leaves partially moved handles.
      const fitted = this.curve.fit(points)
      this.handles.forEach((h, i) => h.position.copy(points[i]!))
      this.updateLine(fitted)
      this.edited?.(this.points())
    } else {
      this.moveControls(points)
    }
  }

  private updateLine(points: THREE.Vector3[]) {
    const geometry = this.line.geometry
    const position = geometry.getAttribute('position')
    if (position.count === points.length) {
      points.forEach((point, i) => position.setXYZ(i, point.x, point.y, point.z))
      position.needsUpdate = true
      // Raycasting also uses the bounding sphere after a point moves.
      geometry.computeBoundingSphere()
    } else {
      this.line.geometry = new THREE.BufferGeometry().setFromPoints(points)
      this.line.geometry.computeBoundingSphere()
      geometry.dispose()
    }
  }

  points() {
    if (this.previewPoints) return this.previewPoints.map((p) => p.clone())
    const attr = this.line.geometry.getAttribute('position')
    return Array.from({ length: attr.count }, (_, i) =>
      new THREE.Vector3().fromBufferAttribute(attr, i),
    )
  }

  surfacePreview(): SurfacePreview | undefined {
    return this.previewPath && this.previewFit
      ? { surface: this.previewFit.surface, path: this.previewPath }
      : undefined
  }

  reset() {
    if (this.curve) {
      this.restoreControls(this.original)
      return
    }
    this.moveControls(this.anchors.map((anchor) => this.original[anchor]!.clone()))
  }

  dispose() {
    this.group.removeFromParent()
    this.line.geometry.dispose()
    this.line.material.dispose()
    this.sphere.dispose()
    this.pointMaterial.dispose()
    this.previewFit?.dispose?.()
  }
}

export class BoundaryEditor {
  readonly boundaries = new Map<number, ToothBoundary>()
  private selected: ToothBoundary | undefined
  private drag:
    | {
        boundary: ToothBoundary
        index: number
        pointer: number
        plane: THREE.Plane
        controlsEnabled: boolean
        originalControls: THREE.Vector3[]
        moved: boolean
        lastX: number
        lastY: number
      }
    | undefined
  private ray = new THREE.Raycaster()
  private enabled = true
  private pendingMove: Pick<PointerEvent, 'clientX' | 'clientY'> | undefined

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: THREE.PerspectiveCamera,
    private controls: OrbitControls,
    private models: Map<number, THREE.Mesh>,
    private changed: (label: number | null) => void,
    private committed?: (boundary: ToothBoundary, reset: boolean) => void,
    private failed?: (error: unknown) => void,
  ) {
    canvas.addEventListener('pointerdown', this.down, true)
    canvas.addEventListener('pointermove', this.move, true)
    canvas.addEventListener('pointerup', this.up, true)
    canvas.addEventListener('pointercancel', this.up, true)
    canvas.addEventListener('lostpointercapture', this.up, true)
  }

  setEnabled(enabled: boolean) {
    this.finishDrag()
    this.enabled = enabled
    for (const [label, b] of this.boundaries)
      b.group.visible = enabled && !!this.models.get(label)?.visible
    if (!enabled) this.select(null)
  }
  syncVisibility(label: number) {
    const b = this.boundaries.get(label)
    if (b) b.group.visible = this.enabled && !!this.models.get(label)?.visible
    if (this.selected === b && !b?.group.visible) {
      this.finishDrag()
      this.select(null)
    }
  }
  select(label: number | null) {
    this.selected?.select(false)
    this.selected = label === null ? undefined : this.boundaries.get(label)
    this.selected?.select(true)
    this.changed(this.selected?.label ?? null)
  }
  resetSelected() {
    if (!this.selected) return
    const before = this.selected.handles.map((h) => h.position.clone())
    try {
      this.selected.reset()
      this.committed?.(this.selected, true)
    } catch (error) {
      this.selected.restoreControls(before)
      this.failed?.(error)
    }
  }
  private setRay(event: Pick<PointerEvent, 'clientX' | 'clientY'>) {
    const rect = this.canvas.getBoundingClientRect()
    this.ray.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.camera,
    )
    const distance = this.camera.position.distanceTo(this.controls.target)
    this.ray.params.Line!.threshold =
      (7 * 2 * distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / rect.height
  }
  private down = (event: PointerEvent) => {
    if (!this.enabled || event.button !== 0 || !event.isPrimary) return
    this.setRay(event)
    if (event.ctrlKey) {
      const hit = this.ray.intersectObjects(
        [...this.models.values()].filter((m) => m.visible),
        false,
      )[0]
      const label = hit?.object.userData.segLabel as number | undefined
      if (label !== undefined && this.boundaries.has(label)) {
        event.stopImmediatePropagation()
        event.preventDefault()
        this.select(this.selected?.label === label ? null : label)
      }
      return
    }
    const visible = [...this.boundaries.values()].filter((b) => b.group.visible)
    const surface = this.ray.intersectObjects(
      [...this.models.values()].filter((m) => m.visible),
      false,
    )[0]
    const unoccluded = (hit: THREE.Intersection) =>
      !surface || hit.distance <= surface.distance + Math.max(1e-6, surface.distance * 1e-6)
    const hit =
      this.ray
        .intersectObjects(
          visible.flatMap((b) => b.handles),
          false,
        )
        .find(unoccluded) ??
      this.ray
        .intersectObjects(
          visible.map((b) => b.line),
          false,
        )
        .find(unoccluded)
    if (!hit) {
      this.select(null)
      return
    }
    // Only pick contours that pass the same model occlusion used for rendering.
    event.stopImmediatePropagation()
    event.preventDefault()
    const label = hit.object.userData.boundaryLabel as number
    this.select(label)
    const index = hit.object.userData.handleIndex as number | undefined
    if (index === undefined || !this.selected) return
    const normal = this.camera.getWorldDirection(new THREE.Vector3())
    const point = this.selected.handles[index]!.position
    this.drag = {
      boundary: this.selected,
      index,
      pointer: event.pointerId,
      plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point),
      controlsEnabled: this.controls.enabled,
      originalControls: this.selected.handles.map((h) => h.position.clone()),
      moved: false,
      lastX: event.clientX,
      lastY: event.clientY,
    }
    this.controls.enabled = false
    this.canvas.setPointerCapture(event.pointerId)
    this.canvas.style.cursor = 'grabbing'
  }
  private move = (event: PointerEvent) => {
    if (!this.drag || this.drag.pointer !== event.pointerId) return
    event.stopImmediatePropagation()
    event.preventDefault()
    this.pendingMove = { clientX: event.clientX, clientY: event.clientY }
  }
  /** Called once by the page's render loop, before rendering and color updates. */
  update() {
    const event = this.pendingMove
    this.pendingMove = undefined
    if (!this.drag || !event) return
    if (event.clientX === this.drag.lastX && event.clientY === this.drag.lastY) return
    this.setRay(event)
    const surfaces = [...this.models.values()].filter((m): m is THREE.Mesh => !!m && m.visible)
    const hit = this.ray.intersectObjects(surfaces, false)[0]
    const point = hit?.point ?? this.ray.ray.intersectPlane(this.drag.plane, new THREE.Vector3())
    if (point) {
      try {
        this.drag.boundary.move(this.drag.index, point)
        this.drag.moved = true
        this.drag.lastX = event.clientX
        this.drag.lastY = event.clientY
      } catch (error) {
        this.failed?.(error)
      }
    }
  }
  private up = (event: PointerEvent) => {
    if (!this.drag || this.drag.pointer !== event.pointerId) return
    event.stopImmediatePropagation()
    if (event.type === 'pointerup' && (this.pendingMove || this.drag.moved)) {
      this.pendingMove = { clientX: event.clientX, clientY: event.clientY }
      this.update()
    }
    this.finishDrag(event.type === 'pointerup')
  }
  private finishDrag(commit = false) {
    this.pendingMove = undefined
    if (!this.drag) return
    const { pointer, controlsEnabled, boundary, originalControls, moved } = this.drag
    this.drag = undefined
    this.controls.enabled = controlsEnabled
    this.canvas.style.cursor = ''
    if (this.canvas.hasPointerCapture(pointer)) this.canvas.releasePointerCapture(pointer)
    if (this.committed && moved) {
      try {
        if (commit) this.committed(boundary, false)
        else boundary.restoreControls(originalControls)
      } catch (error) {
        boundary.restoreControls(originalControls)
        this.failed?.(error)
      }
    }
  }
  clear() {
    this.finishDrag()
    this.select(null)
    this.boundaries.forEach((b) => b.dispose())
    this.boundaries.clear()
  }
  dispose() {
    this.clear()
    this.canvas.removeEventListener('pointerdown', this.down, true)
    this.canvas.removeEventListener('pointermove', this.move, true)
    this.canvas.removeEventListener('pointerup', this.up, true)
    this.canvas.removeEventListener('pointercancel', this.up, true)
    this.canvas.removeEventListener('lostpointercapture', this.up, true)
  }
}
