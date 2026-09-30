import { expect, test } from '@playwright/test'
import { BufferGeometry, Float32BufferAttribute, Vector3, PerspectiveCamera } from 'three'
import {
  BoundaryEditor,
  ToothBoundary,
  boundaryPoints,
} from '../src/page/msgpackTeeth/boundaryEditor'
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js'

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
  expect(boundary.line.geometry.getAttribute('position').getX(0)).toBeGreaterThan(0.3)
  expect(boundary.handles[0]!.position.x).toBeCloseTo(
    boundary.line.geometry.getAttribute('position').getX(0),
  )
  pointer('pointercancel', 60, 50)
  expect(controls.enabled).toBe(true)
  editor.dispose()
})
