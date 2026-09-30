import * as THREE from 'three'
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js'

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
  private readonly sphere: THREE.SphereGeometry
  private readonly pointMaterial = new THREE.MeshBasicMaterial({
    color: 0x28b8ef,
    depthTest: false,
    depthWrite: false,
  })

  constructor(
    readonly label: number,
    points: THREE.Vector3[],
    radius: number,
    private readonly edited?: (points: THREE.Vector3[]) => void,
  ) {
    this.original = points.map((p) => p.clone())
    this.anchors = Array.from({ length: Math.min(points.length, 20) }, (_, i) =>
      Math.floor((i * points.length) / Math.min(points.length, 20)),
    )
    this.line = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0x52c41a, depthTest: false, depthWrite: false }),
    )
    this.line.userData.boundaryLabel = label
    this.group.add(this.line)
    this.sphere = new THREE.SphereGeometry(radius, 10, 8)
    this.anchors.forEach((anchor, i) => {
      const handle = new THREE.Mesh(this.sphere, this.pointMaterial)
      handle.position.copy(points[anchor]!)
      handle.userData.boundaryLabel = label
      handle.userData.handleIndex = i
      this.handles.push(handle)
      this.group.add(handle)
    })
  }

  select(selected: boolean) {
    this.line.material.color.setHex(selected ? 0xffffff : 0x52c41a)
    this.pointMaterial.color.setHex(selected ? 0xffffff : 0x28b8ef)
    this.line.material.depthTest = false
    this.line.material.depthWrite = false
    this.pointMaterial.depthTest = false
    this.pointMaterial.depthWrite = false
    this.group.renderOrder = selected ? 100 : 0
    this.line.renderOrder = selected ? 100 : 0
    this.handles.forEach((handle) => {
      handle.renderOrder = selected ? 101 : 0
    })
  }

  move(index: number, point: THREE.Vector3) {
    this.handles[index]!.position.copy(point)
    const attr = this.line.geometry.getAttribute('position')
    // Preserve the original dense contour; interpolate control-point displacement
    // only between adjacent anchors, including the closing segment.
    this.anchors.forEach((start, i) => {
      const next = (i + 1) % this.anchors.length
      const end = next === 0 ? this.original.length : this.anchors[next]!
      const a = this.handles[i]!.position.clone().sub(this.original[start]!)
      const b = this.handles[next]!.position.clone().sub(this.original[end % this.original.length]!)
      for (let j = start; j < end; j++) {
        const p = this.original[j]!.clone().add(a.clone().lerp(b, (j - start) / (end - start)))
        attr.setXYZ(j, p.x, p.y, p.z)
      }
    })
    attr.needsUpdate = true
    this.line.geometry.computeBoundingSphere()
    this.edited?.(this.points())
  }

  points() {
    const attr = this.line.geometry.getAttribute('position')
    return Array.from({ length: attr.count }, (_, i) =>
      new THREE.Vector3().fromBufferAttribute(attr, i),
    )
  }

  reset() {
    this.anchors.forEach((anchor, i) => this.handles[i]!.position.copy(this.original[anchor]!))
    this.move(0, this.original[0]!)
  }

  dispose() {
    this.group.removeFromParent()
    this.line.geometry.dispose()
    this.line.material.dispose()
    this.sphere.dispose()
    this.pointMaterial.dispose()
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
      }
    | undefined
  private ray = new THREE.Raycaster()
  private enabled = true

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: THREE.PerspectiveCamera,
    private controls: OrbitControls,
    private models: Map<number, THREE.Mesh>,
    private changed: (label: number | null) => void,
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
    this.selected?.reset()
  }
  private setRay(event: PointerEvent) {
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
    const visible = [...this.boundaries.values()].filter((b) => b.group.visible)
    const hit =
      this.ray.intersectObjects(
        visible.flatMap((b) => b.handles),
        false,
      )[0] ??
      this.ray.intersectObjects(
        visible.map((b) => b.line),
        false,
      )[0]
    if (!hit) {
      this.select(null)
      return
    }
    // Contours are rendered in an overlay, so their visible handles remain pickable.
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
    }
    this.controls.enabled = false
    this.canvas.setPointerCapture(event.pointerId)
    this.canvas.style.cursor = 'grabbing'
  }
  private move = (event: PointerEvent) => {
    if (!this.drag || this.drag.pointer !== event.pointerId) return
    event.stopImmediatePropagation()
    event.preventDefault()
    this.setRay(event)
    const surfaces = [this.models.get(this.drag.boundary.label), this.models.get(0)].filter(
      (m): m is THREE.Mesh => !!m && m.visible,
    )
    const hit = this.ray.intersectObjects(surfaces, false)[0]
    const point = hit?.point ?? this.ray.ray.intersectPlane(this.drag.plane, new THREE.Vector3())
    if (point) this.drag.boundary.move(this.drag.index, point)
  }
  private up = (event: PointerEvent) => {
    if (!this.drag || this.drag.pointer !== event.pointerId) return
    event.stopImmediatePropagation()
    this.finishDrag()
  }
  private finishDrag() {
    if (!this.drag) return
    const { pointer, controlsEnabled } = this.drag
    this.drag = undefined
    this.controls.enabled = controlsEnabled
    this.canvas.style.cursor = ''
    if (this.canvas.hasPointerCapture(pointer)) this.canvas.releasePointerCapture(pointer)
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
