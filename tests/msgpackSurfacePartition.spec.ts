import { expect, test } from '@playwright/test'
import { BufferGeometry, Float32BufferAttribute, Line3, PlaneGeometry, Vector3 } from 'three'
import { createPreviewSurfaceFit } from '../src/page/msgpackTeeth/previewSurface'
import { partitionSurface } from '../src/page/msgpackTeeth/surfacePartition'

const rectangle = (right: number) => [
  new Vector3(-0.8, -0.8),
  new Vector3(right, -0.8),
  new Vector3(right, 0.8),
  new Vector3(-0.8, 0.8),
]

function insideXY(point: Vector3, line: Vector3[]) {
  const p = new Vector3(point.x, point.y, 0)
  let inside = false
  for (let i = 0; i < line.length; i++) {
    const a = line[i]!.clone().setZ(0),
      b = line[(i + 1) % line.length]!.clone().setZ(0)
    if (new Line3(a, b).closestPointToPoint(p, true, new Vector3()).distanceTo(p) < 1e-5)
      return true
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside
  }
  return inside
}

test('cuts triangle interiors at the exact displayed boundary without inside holes or outside islands', () => {
  const geometry = new PlaneGeometry(2, 2, 4, 4)
  const before = Array.from(geometry.getAttribute('position').array)
  const fit = createPreviewSurfaceFit([geometry])
  const fitted = fit(rectangle(0.2))
  const result = partitionSurface(fit.surface, fitted.path)
  const seed = new Vector3(0, 0, 0)
  const inside = result.componentAt(seed)
  let area = 0
  result.cells.forEach((cell) => {
    const isInside = result.components[cell.id] === inside
    cell.vertices.forEach((p) => {
      if (isInside) {
        expect(insideXY(p, fitted.line)).toBe(true)
      }
    })
    if (isInside) area += cell.area
    const center = cell.vertices
      .reduce((sum, p) => sum.add(p), new Vector3())
      .divideScalar(cell.vertices.length)
    expect(isInside).toBe(insideXY(center, fitted.line))
  })
  const displayedArea =
    Math.abs(
      fitted.line.reduce((sum, p, i) => {
        const next = fitted.line[(i + 1) % fitted.line.length]!
        return sum + p.x * next.y - next.x * p.y
      }, 0),
    ) / 2
  expect(area).toBeCloseTo(displayedArea, 5)
  expect(Array.from(geometry.getAttribute('position').array)).toEqual(before)
  fit.dispose()
  geometry.dispose()
})

test('classifies a folded surface intrinsically and keeps a nearby disconnected sheet separate', () => {
  const positions: number[] = [],
    indices: number[] = []
  for (let y = 0; y <= 8; y++)
    for (let x = 0; x <= 8; x++) {
      const u = x / 4 - 1,
        v = y / 4 - 1
      positions.push(u, v, Math.abs(u) * 0.75)
    }
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const a = y * 9 + x
      indices.push(a, a + 1, a + 10, a, a + 10, a + 9)
    }
  const geometry = new BufferGeometry()
    .setAttribute('position', new Float32BufferAttribute(positions, 3))
    .setIndex(indices)
  const remote = geometry.clone().translate(0, 0, -0.05)
  const fit = createPreviewSurfaceFit([geometry, remote])
  const points = rectangle(0.2).map((p) => p.setZ(Math.abs(p.x) * 0.75))
  const fitted = fit(points)
  const result = partitionSurface(fit.surface, fitted.path)
  const inside = result.componentAt(new Vector3(0, 0, 0))
  expect(inside).not.toBe(result.componentAt(new Vector3(0, 0, -0.05)))
  result.cells
    .filter((c) => result.components[c.id] === inside)
    .forEach((cell) => {
      expect(fit.surface.sources[cell.face]!.source).toBe(0)
      cell.vertices.forEach((p) => {
        expect(insideXY(p, fitted.line)).toBe(true)
      })
    })
  fit.dispose()
  geometry.dispose()
  remote.dispose()
})
