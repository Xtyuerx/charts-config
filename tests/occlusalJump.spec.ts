import { test, expect } from '@playwright/test'
import { Quaternion, Vector3 } from 'three'
import { defaultJump, jumpFrame, jumpMatrix, readJump } from '../src/page/toothRoots/occlusalJump'
import type { Tooth } from '../src/page/toothRoots/core'

const frame = {
  pivot: new Vector3(0, 2, 0),
  front: new Vector3(0, -1, 0),
  right: new Vector3(-1, 0, 0),
  up: new Vector3(0, 0, 1),
}

test('jaw motion translates in the jaw frame and opens around its posterior pivot without changing distances', () => {
  const matrix = jumpMatrix({ forward: 3, lateral: 2, vertical: 1, opening: 30 }, frame)
  const hinge = frame.pivot.clone().applyMatrix4(matrix)
  expect(hinge.x).toBeCloseTo(-2)
  expect(hinge.y).toBeCloseTo(-1)
  expect(hinge.z).toBeCloseTo(1)
  const anterior = new Vector3(0, 0, 0).applyMatrix4(matrix)
  expect(anterior.x).toBeCloseTo(-2)
  expect(anterior.y).toBeCloseTo(-1 - Math.sqrt(3))
  expect(anterior.z).toBeCloseTo(0)
  expect(anterior.distanceTo(hinge)).toBeCloseTo(2)
  expect(matrix.determinant()).toBeCloseTo(1)
})

test('zero adjustment is identity even when the hinge is away from the origin', () => {
  const point = new Vector3(3, 4, 5).applyMatrix4(jumpMatrix(defaultJump(), frame))
  expect(point.toArray()).toEqual([3, 4, 5])
})

test('a partial rotated jaw uses its saved orientation for the forward direction', () => {
  const tooth = {
    jaw: 'lower',
    id: 31,
    originalPosition: new Vector3(4, 5, 6),
    originalQuaternion: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2),
  } as Tooth
  const actual = jumpFrame([tooth])
  expect(actual.front.x).toBeCloseTo(1)
  expect(actual.front.y).toBeCloseTo(0)
  expect(actual.up.z).toBeCloseTo(1)
  expect(actual.pivot.toArray()).toEqual([4, 5, 6])
})

test('saved adjustment validates all ranges and rejects nonfinite or incompatible values', () => {
  expect(readJump(undefined)).toEqual(defaultJump())
  for (const parameters of [
    { ...defaultJump(), forward: NaN },
    { ...defaultJump(), lateral: 21 },
    { ...defaultJump(), vertical: -21 },
    { ...defaultJump(), opening: -1 },
  ]) {
    expect(() => readJump({ schema: 'occlusal-jump-v1', parameters })).toThrow()
  }
  expect(() => readJump({ schema: 'unknown', parameters: defaultJump() })).toThrow()
  expect(
    readJump({
      schema: 'occlusal-jump-v1',
      parameters: { forward: 20, lateral: -20, vertical: 0, opening: 30 },
    }).opening,
  ).toBe(30)
})
