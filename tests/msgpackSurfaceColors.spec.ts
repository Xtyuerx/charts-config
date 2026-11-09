import { expect, test } from '@playwright/test'
import { Color, Mesh, PlaneGeometry, Vector3 } from 'three'
import { BoundaryRegionColors } from '../src/page/msgpackTeeth/boundaryRegionColors'
import { modelMaterial } from '../src/page/msgpackTeeth/modelMaterial'
import { createPreviewSurfaceFit } from '../src/page/msgpackTeeth/previewSurface'

const loop = (right: number) => [
  new Vector3(-0.8, -0.8),
  new Vector3(right, -0.8),
  new Vector3(right, 0.8),
  new Vector3(-0.8, 0.8),
]

test('rebuilds the whole display region and restores resources without changing source buffers', () => {
  const source = new PlaneGeometry(2, 2, 4, 4)
  const originalPositions = Array.from(source.getAttribute('position').array)
  const material = modelMaterial(new Color('#6699dd'), 11)
  const mesh = new Mesh(source, material)
  const colors = new BoundaryRegionColors(new Map([[11, mesh]]), new Map([[11, loop(0.8)]]))
  try {
    colors.update(11, loop(0.2))
    expect(mesh.geometry).not.toBe(source)
    const position = mesh.geometry.getAttribute('position'),
      color = mesh.geometry.getAttribute('color')
    const gum = new Color('#d391a0')
    let toothVertices = 0,
      gumVertices = 0
    for (let i = 0; i < position.count; i++) {
      const isGum = Math.abs(color.getX(i) - gum.r) < 1e-5
      if (isGum) gumVertices++
      else {
        toothVertices++
        expect(position.getX(i)).toBeLessThan(0.21)
        expect(position.getX(i)).toBeGreaterThan(-0.81)
      }
    }
    expect(toothVertices).toBeGreaterThan(0)
    expect(gumVertices).toBeGreaterThan(0)
    const validGeometry = mesh.geometry
    const invalid = loop(0.2)
    invalid[0]!.x = NaN
    expect(() => colors.update(11, invalid)).toThrow()
    expect(mesh.geometry).toBe(validGeometry)
    expect(Array.from(source.getAttribute('position').array)).toEqual(originalPositions)
  } finally {
    colors.dispose()
  }
  expect(mesh.geometry).toBe(source)
  expect(mesh.material).toBe(material)
  source.dispose()
  material.dispose()
})

test('extends color only onto the connected gum surface inside the same displayed path', () => {
  const tooth = new Mesh(
    new PlaneGeometry(1, 2, 2, 4).translate(-0.5, 0, 0),
    modelMaterial(new Color('#6699dd'), 11),
  )
  const gum = new Mesh(
    new PlaneGeometry(1, 2, 2, 4).translate(0.5, 0, 0),
    modelMaterial(new Color('#d391a0'), 0),
  )
  const colors = new BoundaryRegionColors(
    new Map([
      [11, tooth],
      [0, gum],
    ]),
    new Map([[11, loop(-0.1)]]),
  )
  try {
    colors.update(11, loop(0.4))
    expect(tooth.children.length).toBe(1)
    const overlay = tooth.children[0] as Mesh
    tooth.visible = false
    expect(overlay.parent).toBe(tooth)
    expect(overlay.parent!.visible).toBe(false)
    tooth.visible = true
    gum.visible = false
    expect(overlay.parent!.visible).toBe(true)
    const positions = overlay.geometry.getAttribute('position')
    expect(positions.count).toBeGreaterThan(0)
    for (let i = 0; i < positions.count; i++) {
      expect(positions.getX(i)).toBeLessThan(0.41)
      expect(positions.getX(i)).toBeGreaterThanOrEqual(0)
      expect(Math.abs(positions.getY(i))).toBeLessThan(0.81)
    }
  } finally {
    colors.dispose()
    for (const mesh of [tooth, gum]) {
      mesh.geometry.dispose()
      mesh.material.dispose()
    }
  }
  expect(tooth.children).toHaveLength(0)
})

test('restores a shrunken region using the original contour and shares one immutable reference', () => {
  const geometry = new PlaneGeometry(2, 2, 4, 4)
  const mesh = new Mesh(geometry, modelMaterial(new Color('#6699dd'), 11))
  const reference = createPreviewSurfaceFit([geometry])
  const firstFit = createPreviewSurfaceFit([geometry], reference.surface)
  const secondFit = createPreviewSurfaceFit([geometry], reference.surface)
  expect(firstFit.surface).toBe(secondFit.surface)
  const original = loop(0.8)
  const originalState = { surface: reference.surface, path: firstFit(original).path }
  let colors = new BoundaryRegionColors(
    new Map([[11, mesh]]),
    new Map([[11, original]]),
    new Map([[11, originalState]]),
  )
  const movedState = { surface: reference.surface, path: firstFit(loop(-0.2)).path }
  colors.update(11, movedState)
  const beforePositions = Array.from(mesh.geometry.getAttribute('position').array)
  const beforeColors = Array.from(mesh.geometry.getAttribute('color').array)
  colors.dispose()
  colors = new BoundaryRegionColors(
    new Map([[11, mesh]]),
    new Map([[11, original]]),
    new Map([[11, movedState]]),
  )
  expect(Array.from(mesh.geometry.getAttribute('position').array)).toEqual(beforePositions)
  expect(Array.from(mesh.geometry.getAttribute('color').array)).toEqual(beforeColors)
  colors.dispose()
  firstFit.dispose()
  secondFit.dispose()
  reference.dispose()
  geometry.dispose()
  mesh.material.dispose()
})

test('loads an existing shared-surface overlap but rejects new overlap within the same neighbor face', () => {
  const toothGeometry = new PlaneGeometry(1, 2).translate(-0.5, 0, 0)
  const neighborGeometry = new PlaneGeometry(1, 2).translate(0.5, 0, 0)
  const tooth = new Mesh(toothGeometry, modelMaterial(new Color('#6699dd'), 11))
  const neighbor = new Mesh(neighborGeometry, modelMaterial(new Color('#aadd66'), 12))
  const neighborMaterial = neighbor.material
  const reference = createPreviewSurfaceFit([toothGeometry, neighborGeometry])
  const original = loop(0.4)
  const initialState = { surface: reference.surface, path: reference(original).path }
  const colors = new BoundaryRegionColors(
    new Map([
      [11, tooth],
      [12, neighbor],
    ]),
    new Map([[11, original]]),
    new Map([[11, initialState]]),
  )
  try {
    expect(neighbor.geometry).toBe(neighborGeometry)
    expect(neighbor.material).toBe(neighborMaterial)
    const initialGeometry = tooth.geometry
    const expanded = { surface: reference.surface, path: reference(loop(0.7)).path }
    expect(() => colors.update(11, expanded)).toThrow('边界跨入了其他牙齿区域')
    expect(tooth.geometry).toBe(initialGeometry)
    // Reapplying the imported contour remains valid; neighboring geometry is untouched.
    colors.update(11, initialState)
    expect(neighbor.geometry).toBe(neighborGeometry)
  } finally {
    colors.dispose()
    reference.dispose()
    for (const mesh of [tooth, neighbor]) {
      mesh.geometry.dispose()
      mesh.material.dispose()
    }
  }
})
