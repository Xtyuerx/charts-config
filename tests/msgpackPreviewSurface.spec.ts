import { expect, test } from '@playwright/test'
import {
  BufferGeometry,
  Float32BufferAttribute,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
} from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import { createPreviewSurfaceFit } from '../src/page/msgpackTeeth/previewSurface'
import { ToothBoundary } from '../src/page/msgpackTeeth/boundaryEditor'

test('preview boundary uses the fitted display path after dragging and resetting', () => {
  const geometry = new SphereGeometry(1, 24, 16)
  const fit = createPreviewSurfaceFit([geometry])
  const points = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]
  const boundary = new ToothBoundary(11, points, 0.01, undefined, undefined, fit)
  expect(boundary.line.geometry.getAttribute('position').count).toBeGreaterThan(3)
  boundary.move(0, new Vector3(0.9, 0.3, 0))
  expect(boundary.points()).toHaveLength(3)
  const tree = new MeshBVH(geometry, { indirect: true })
  const positions = boundary.line.geometry.getAttribute('position')
  for (let i = 0; i < positions.count; i++) {
    const midpoint = new Vector3()
      .fromBufferAttribute(positions, i)
      .lerp(new Vector3().fromBufferAttribute(positions, (i + 1) % positions.count), 0.5)
    expect(tree.closestPointToPoint(midpoint)!.distance).toBeLessThan(4e-5)
  }
  boundary.reset()
  boundary.points().forEach((p, i) => expect(p.distanceTo(points[i]!)).toBeLessThan(1e-5))
  boundary.dispose()
})

test('subdivides curved preview segments so the drawn chord does not cut through the mesh', () => {
  const geometry = new SphereGeometry(1, 24, 16)
  const fit = createPreviewSurfaceFit([geometry])
  const result = fit([new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)])
  const tree = new MeshBVH(geometry, { indirect: true })
  expect(result.points).toHaveLength(3)
  expect(result.line.length).toBeGreaterThan(3)
  result.line.forEach((a, i) => {
    const midpoint = a.clone().lerp(result.line[(i + 1) % result.line.length]!, 0.5)
    expect(tree.closestPointToPoint(midpoint)!.distance).toBeLessThan(4e-5)
  })
})

test('projects all preview samples without changing source positions or indices', () => {
  const geometry = new PlaneGeometry(2, 2)
  const positions = Array.from(geometry.getAttribute('position').array)
  const indices = Array.from(geometry.getIndex()!.array)
  const result = createPreviewSurfaceFit([geometry])([
    new Vector3(-0.5, -0.5, -0.2),
    new Vector3(0.5, -0.5, 0.2),
    new Vector3(0, 0.5, 0),
  ])
  expect(result.points.every((p) => Math.abs(p.z) < 1e-8)).toBe(true)
  expect(Array.from(geometry.getAttribute('position').array)).toEqual(positions)
  expect(Array.from(geometry.getIndex()!.array)).toEqual(indices)
})

test('a rejected color partition leaves handles, line and preview path unchanged', () => {
  const geometry = new PlaneGeometry(2, 2, 4, 4)
  const fit = createPreviewSurfaceFit([geometry])
  let reject = false
  const boundary = new ToothBoundary(
    11,
    [new Vector3(-0.5, -0.5), new Vector3(0.5, -0.5), new Vector3(0, 0.5)],
    0.01,
    () => {
      if (reject) throw new Error('ambiguous surface partition')
    },
    undefined,
    fit,
  )
  const before = boundary.handles.map((h) => h.position.clone())
  const line = Array.from(boundary.line.geometry.getAttribute('position').array)
  const path = boundary.surfacePreview()!.path
  const moved = before.map((p) => p.clone().add(new Vector3(0.1, 0, 0)))
  reject = true
  expect(() => boundary.restoreControls(moved)).toThrow('ambiguous')
  expect(boundary.handles.map((h) => h.position)).toEqual(before)
  expect(Array.from(boundary.line.geometry.getAttribute('position').array)).toEqual(line)
  expect(boundary.surfacePreview()!.path).toBe(path)
  boundary.dispose()
  geometry.dispose()
})

test('ignores zero-area source triangles in the preview reference without changing source buffers', () => {
  const flat = new PlaneGeometry(2, 2, 4, 4)
  const collapsed = new BufferGeometry().setAttribute(
    'position',
    new Float32BufferAttribute([0, 0, 0.2, 0.5, 0, 0.2, 1, 0, 0.2], 3),
  )
  const before = Array.from(collapsed.getAttribute('position').array)
  const fit = createPreviewSurfaceFit([collapsed, flat])
  try {
    expect(fit.surface.graph.surface.faces.every((face) => face.triangle.getArea() > 0)).toBe(true)
    const fitted = fit([new Vector3(0, 0, 0.2), new Vector3(0.5, 0), new Vector3(0, 0.5)])
    expect(fitted.points[0]!.z).toBe(0)
    expect(fitted.points[0]!.distanceTo(fitted.path.anchorPoints[0]!)).toBeLessThan(1e-7)
    expect(Array.from(collapsed.getAttribute('position').array)).toEqual(before)
  } finally {
    fit.dispose()
    flat.dispose()
    collapsed.dispose()
  }
})
