import { test, expect } from '@playwright/test'
import { BoxGeometry, BufferGeometry, CylinderGeometry, Float32BufferAttribute } from 'three'
import { createCrownCap } from '../src/page/toothRoots/crownClosure'

function openEdgeCount(geometries: BufferGeometry[]) {
  const edges = new Map<string, number>()
  const point = (g: BufferGeometry, i: number) => {
    const p = g.getAttribute('position')
    return [p.getX(i), p.getY(i), p.getZ(i)].map((n) => Math.round(n * 1e5)).join(',')
  }
  for (const g of geometries) {
    const index = g.getIndex(),
      count = index?.count ?? g.getAttribute('position').count
    for (let i = 0; i < count; i += 3) {
      const keys = [0, 1, 2].map((k) => point(g, index ? index.getX(i + k) : i + k))
      for (let k = 0; k < 3; k++) {
        const key = [keys[k], keys[(k + 1) % 3]].sort().join('|')
        edges.set(key, (edges.get(key) ?? 0) + 1)
      }
    }
  }
  return [...edges.values()].filter((n) => n !== 2).length
}

test('caps both openings of an indexed crown without altering the original geometry', () => {
  const crown = new CylinderGeometry(2, 1, 4, 16, 1, true)
  const before = Array.from(crown.getAttribute('position').array)
  const cap = createCrownCap(crown)
  expect(cap.closedLoops).toBe(2)
  expect(cap.unresolvedEdges).toBe(0)
  expect(cap.geometry).not.toBeNull()
  expect(openEdgeCount([crown, cap.geometry!])).toBe(0)
  expect(Array.from(crown.getAttribute('position').array)).toEqual(before)
})

test('welds triangle-soup seams and leaves a closed tooth untouched', () => {
  const open = new CylinderGeometry(2, 1, 4, 16, 1, true).toNonIndexed()
  const cap = createCrownCap(open)
  expect(openEdgeCount([open, cap.geometry!])).toBe(0)
  const closed = createCrownCap(new BoxGeometry())
  expect(closed.geometry).toBeNull()
  expect(closed.closedLoops).toBe(0)
  expect(closed.unresolvedEdges).toBe(0)
})

test('reports branching boundaries instead of inventing a cap', () => {
  const branched = new BufferGeometry().setAttribute(
    'position',
    new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, -1, 0], 3),
  )
  const result = createCrownCap(branched)
  expect(result.geometry).toBeNull()
  expect(result.unresolvedEdges).toBeGreaterThan(0)
})

test('closes a nonplanar rim even when its planar projection folds over itself', () => {
  const loop = [
    [0, 0, 0],
    [3, 2, 1],
    [0, 3, 0],
    [3, 0, -1],
    [4, 2, 0],
  ]
  const positions: number[] = []
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]!,
      b = loop[(i + 1) % loop.length]!
    const belowA = [a[0]!, a[1]!, a[2]! - 4],
      belowB = [b[0]!, b[1]!, b[2]! - 4]
    positions.push(...a, ...belowA, ...b, ...b, ...belowA, ...belowB)
  }
  const crown = new BufferGeometry().setAttribute(
    'position',
    new Float32BufferAttribute(positions, 3),
  )
  const cap = createCrownCap(crown)
  expect(cap.unresolvedEdges).toBe(0)
  expect(openEdgeCount([crown, cap.geometry!])).toBe(0)
})
