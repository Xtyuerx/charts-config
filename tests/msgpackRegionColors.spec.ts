import { expect, test } from '@playwright/test'
import { Vector3 } from 'three'
import { ToothBoundary } from '../src/page/msgpackTeeth/boundaryEditor'

const loop = (right: number) => [
  new Vector3(0, 0, 0),
  new Vector3(right, 0, 0),
  new Vector3(right, 2, 0),
  new Vector3(0, 2, 0),
]
test('selected contours overlay models, and moving or resetting publishes the updated closed boundary', () => {
  let points: Vector3[] = []
  const b = new ToothBoundary(11, loop(1), 0.01, (p) => {
    points = p
  })
  b.select(true)
  expect(b.line.material.depthTest).toBe(false)
  expect(b.handles[0]!.material.depthWrite).toBe(false)
  expect(b.handles[0]!.material.depthTest).toBe(false)
  b.move(1, new Vector3(2, 0, 0))
  expect(points[1]!.x).toBe(2)
  b.reset()
  expect(points[1]!.x).toBe(1)
  b.select(false)
  expect(b.line.material.depthTest).toBe(false)
  b.dispose()
})
