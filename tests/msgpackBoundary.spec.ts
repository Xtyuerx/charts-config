import { expect, test } from '@playwright/test'
import {
  BufferGeometry,
  Float32BufferAttribute,
  Vector3,
  PerspectiveCamera,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
} from 'three'
import {
  BoundaryEditor,
  ToothBoundary,
  boundaryPoints,
} from '../src/page/msgpackTeeth/boundaryEditor'
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js'

test('model occlusion prevents picking a rear control point but permits a front one', () => {
  class Canvas extends EventTarget {
    style = { cursor: '' }
    capture = false
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 100, height: 100 }
    }
    setPointerCapture() {
      this.capture = true
    }
    releasePointerCapture() {
      this.capture = false
    }
    hasPointerCapture() {
      return this.capture
    }
  }
  const canvas = new Canvas()
  const camera = new PerspectiveCamera(40, 1, 0.1, 100)
  camera.position.z = 5
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  const controls = { enabled: true, target: new Vector3() } as OrbitControls
  const model = new Mesh(new PlaneGeometry(3, 3), new MeshBasicMaterial())
  model.position.z = 1
  model.updateMatrixWorld()
  let selected: number | null = null
  const editor = new BoundaryEditor(
    canvas as unknown as HTMLCanvasElement,
    camera,
    controls,
    new Map([[11, model]]),
    (label) => {
      selected = label
    },
  )
  const boundary = new ToothBoundary(
    11,
    [new Vector3(), new Vector3(1, 0, 0), new Vector3(0, 1, 0)],
    0.05,
  )
  boundary.group.updateMatrixWorld(true)
  editor.boundaries.set(11, boundary)
  const pointer = (type: string) => {
    const event = new Event(type, { cancelable: true })
    Object.assign(event, { clientX: 50, clientY: 50, button: 0, pointerId: 1, isPrimary: true })
    canvas.dispatchEvent(event)
  }
  pointer('pointerdown')
  expect(selected).toBeNull()
  expect(controls.enabled).toBe(true)
  boundary.group.position.z = 2
  boundary.group.updateMatrixWorld(true)
  pointer('pointerdown')
  expect(selected).toBe(11)
  expect(controls.enabled).toBe(false)
  pointer('pointercancel')
  editor.dispose()
})

test('selection turns the line and every handle white, and restores default colors', () => {
  const boundary = new ToothBoundary(
    11,
    [new Vector3(), new Vector3(1, 0, 0), new Vector3(0, 1, 0)],
    0.02,
  )
  boundary.select(true)
  expect(boundary.line.material.color.getHex()).toBe(0xffffff)
  expect(boundary.handles.every((h) => h.material.color.getHex() === 0xffffff)).toBe(true)
  boundary.select(false)
  expect(boundary.line.material.color.getHex()).toBe(0x52c41a)
  expect(boundary.handles[0]!.material.color.getHex()).toBe(0x28b8ef)
  boundary.dispose()
})

test('dragging one handle moves its line vertex and reset restores the original loop', () => {
  const boundary = new ToothBoundary(
    11,
    [new Vector3(), new Vector3(1, 0, 0), new Vector3(0, 1, 0)],
    0.02,
  )
  boundary.move(0, new Vector3(0, 0, 2))
  expect(boundary.handles[0]!.position.z).toBe(2)
  expect(boundary.line.geometry.getAttribute('position').getZ(0)).toBe(2)
  expect(boundary.line.geometry.getAttribute('position').getX(1)).toBe(1)
  boundary.reset()
  expect(boundary.line.geometry.getAttribute('position').getZ(0)).toBe(0)
  boundary.dispose()
})

test('uses the provided boundary and removes a duplicated closing point', () => {
  const data = {
    lower_gum: {
      tooth_boundary_dict: {
        31: [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 0],
        ],
      },
    },
  }
  expect(boundaryPoints(data, 'lower', 31, new BufferGeometry()).length).toBe(3)
})

test('extracts the outer loop of an indexed mesh without including its interior diagonal', () => {
  const geometry = new BufferGeometry()
    .setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3))
    .setIndex([0, 1, 2, 0, 2, 3])
  expect(boundaryPoints({}, 'lower', 31, geometry).length).toBe(4)
})

test('pointer selection and dragging update the line and release OrbitControls on cancellation', () => {
  // Minimal canvas event surface; picking and dragging use real Three.js rays.
  class Canvas extends EventTarget {
    style = { cursor: '' }
    capture = false
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 100, height: 100 }
    }
    setPointerCapture() {
      this.capture = true
    }
    releasePointerCapture() {
      this.capture = false
    }
    hasPointerCapture() {
      return this.capture
    }
  }
  const canvas = new Canvas()
  const camera = new PerspectiveCamera(40, 1, 0.1, 100)
  camera.position.set(0, 0, 5)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  const controls = { enabled: true, target: new Vector3() } as OrbitControls
  let selected: number | null = null
  const editor = new BoundaryEditor(
    canvas as unknown as HTMLCanvasElement,
    camera,
    controls,
    new Map(),
    (label) => {
      selected = label
    },
  )
  const boundary = new ToothBoundary(
    11,
    [new Vector3(), new Vector3(1, 0, 0), new Vector3(0, 1, 0)],
    0.05,
  )
  boundary.group.updateMatrixWorld(true)
  editor.boundaries.set(11, boundary)
  function pointer(type: string, x: number, y: number) {
    const event = new Event(type, { cancelable: true })
    Object.assign(event, { clientX: x, clientY: y, button: 0, pointerId: 1, isPrimary: true })
    canvas.dispatchEvent(event)
  }
  pointer('pointerdown', 50, 50)
  expect(selected).toBe(11)
  expect(controls.enabled).toBe(false)
  pointer('pointermove', 60, 50)
  editor.update()
  expect(boundary.line.geometry.getAttribute('position').getX(0)).toBeGreaterThan(0.3)
  expect(boundary.handles[0]!.position.x).toBeCloseTo(
    boundary.line.geometry.getAttribute('position').getX(0),
  )
  pointer('pointercancel', 60, 50)
  expect(controls.enabled).toBe(true)
  editor.dispose()
})

test('Ctrl tooth selection toggles and release commits once while cancellation restores controls', () => {
  class Canvas extends EventTarget {
    style = { cursor: '' }
    capture = false
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 100, height: 100 }
    }
    setPointerCapture() {
      this.capture = true
    }
    releasePointerCapture() {
      this.capture = false
    }
    hasPointerCapture() {
      return this.capture
    }
  }
  const canvas = new Canvas(),
    camera = new PerspectiveCamera(40, 1, 0.1, 100)
  camera.position.set(0, 0, 5)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  const mesh = new Mesh(new PlaneGeometry(4, 4), new MeshBasicMaterial())
  mesh.userData.segLabel = 44
  mesh.updateMatrixWorld()
  const controls = { enabled: true, target: new Vector3() } as OrbitControls
  let selected: number | null = null,
    commits = 0
  const editor = new BoundaryEditor(
    canvas as unknown as HTMLCanvasElement,
    camera,
    controls,
    new Map([[44, mesh]]),
    (l) => {
      selected = l
    },
    () => {
      commits++
    },
  )
  const boundary = new ToothBoundary(
    44,
    [new Vector3(), new Vector3(1, 0), new Vector3(0, 1)],
    0.05,
  )
  boundary.group.updateMatrixWorld(true)
  editor.boundaries.set(44, boundary)
  function pointer(type: string, x: number, ctrlKey = false) {
    const event = new Event(type, { cancelable: true })
    Object.assign(event, {
      clientX: x,
      clientY: 50,
      button: 0,
      pointerId: 1,
      isPrimary: true,
      ctrlKey,
    })
    canvas.dispatchEvent(event)
  }
  pointer('pointerdown', 70, true)
  expect(selected).toBe(44)
  pointer('pointerdown', 70, true)
  expect(selected).toBeNull()
  pointer('pointerdown', 50)
  pointer('pointermove', 60)
  expect(commits).toBe(0)
  editor.update()
  pointer('pointercancel', 60)
  expect(boundary.handles[0]!.position.x).toBe(0)
  expect(controls.enabled).toBe(true)
  pointer('pointerdown', 50)
  pointer('pointermove', 60)
  pointer('pointerup', 60)
  expect(commits).toBe(1)
  expect(boundary.handles[0]!.position.x).toBeGreaterThan(0)
  editor.dispose()
  mesh.geometry.dispose()
  mesh.material.dispose()
})

test('coalesces drag events per frame, flushes the release position and discards cancelled work', () => {
  class Canvas extends EventTarget {
    style = { cursor: '' }
    capture = false
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 100, height: 100 }
    }
    setPointerCapture() {
      this.capture = true
    }
    releasePointerCapture() {
      this.capture = false
    }
    hasPointerCapture() {
      return this.capture
    }
  }
  const canvas = new Canvas()
  const camera = new PerspectiveCamera(40, 1, 0.1, 100)
  camera.position.z = 5
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  const controls = { enabled: true, target: new Vector3() } as OrbitControls
  let edits = 0,
    commits = 0
  const boundary = new ToothBoundary(
    11,
    [new Vector3(), new Vector3(1, 0), new Vector3(0, 1)],
    0.05,
    () => {
      edits++
    },
  )
  boundary.group.updateMatrixWorld(true)
  const editor = new BoundaryEditor(
    canvas as unknown as HTMLCanvasElement,
    camera,
    controls,
    new Map(),
    () => {},
    () => {
      commits++
    },
  )
  editor.boundaries.set(11, boundary)
  const pointer = (type: string, x: number) => {
    const event = new Event(type, { cancelable: true })
    Object.assign(event, { clientX: x, clientY: 50, button: 0, pointerId: 1, isPrimary: true })
    canvas.dispatchEvent(event)
  }
  const geometry = boundary.line.geometry
  const attribute = geometry.getAttribute('position')
  pointer('pointerdown', 50)
  for (let x = 51; x <= 60; x++) pointer('pointermove', x)
  expect(edits).toBe(0)
  editor.update()
  expect(edits).toBe(1)
  const first = boundary.handles[0]!.position.x
  expect(first).toBeGreaterThan(0.3)
  editor.update()
  expect(edits).toBe(1)
  pointer('pointermove', 60)
  editor.update()
  expect(edits).toBe(1)
  pointer('pointermove', 65)
  pointer('pointerup', 70)
  expect(edits).toBe(2)
  expect(commits).toBe(1)
  expect(boundary.handles[0]!.position.x).toBeCloseTo(first * 2)
  expect(boundary.line.geometry).toBe(geometry)
  expect(geometry.getAttribute('position')).toBe(attribute)
  boundary.group.updateMatrixWorld(true)
  pointer('pointerdown', 70)
  pointer('pointermove', 75)
  pointer('pointercancel', 75)
  editor.update()
  expect(edits).toBe(2)
  expect(commits).toBe(1)
  expect(controls.enabled).toBe(true)
  boundary.group.updateMatrixWorld(true)
  pointer('pointerdown', 70)
  pointer('pointermove', 80)
  editor.dispose()
  editor.update()
  expect(edits).toBe(2)
  expect(canvas.capture).toBe(false)
})

test('reuses a fitted line buffer when its sample count is unchanged', () => {
  const points = [new Vector3(), new Vector3(1, 0), new Vector3(0, 1)]
  const boundary = new ToothBoundary(11, points, 0.05, undefined, {
    controls: points,
    fit: (controls) => controls.map((p) => p.clone()),
  })
  const geometry = boundary.line.geometry
  const attribute = geometry.getAttribute('position')
  boundary.move(0, new Vector3(0.2, 0, 0))
  expect(boundary.line.geometry).toBe(geometry)
  expect(geometry.getAttribute('position')).toBe(attribute)
  expect(attribute.getX(0)).toBeCloseTo(0.2)
  boundary.dispose()
})
