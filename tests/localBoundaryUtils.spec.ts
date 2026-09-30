import { expect, test } from '@playwright/test'
import {
  orderedBoundaryVertices,
  relabelBoundaryStrip,
} from '../src/page/allStl/utils/localBoundaryUtils'

function fixture() {
  const edges = new Map<string, { fromKey: string; toKey: string; faceIndices: number[] }>()
  const faceKeys: string[][] = []
  const labels: number[] = []
  const key = (a: string, b: string) => [a, b].sort().join('|')
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const a = `${x},${y}`,
        b = `${x + 1},${y}`,
        c = `${x + 1},${y + 1}`,
        d = `${x},${y + 1}`
      for (const triangle of [
        [a, b, c],
        [a, c, d],
      ]) {
        const face = labels.length
        labels.push(x < 3 || (x === 6 && y === 6) ? 44 : 0)
        faceKeys.push(
          triangle.map((from, i) => {
            const to = triangle[(i + 1) % 3]!
            const edgeKey = key(from, to)
            if (!edges.has(edgeKey))
              edges.set(edgeKey, { fromKey: from, toKey: to, faceIndices: [] })
            edges.get(edgeKey)!.faceIndices.push(face)
            return edgeKey
          }),
        )
      }
    }
  const faceEdges = faceKeys.map((keys, face) =>
    keys.map((edgeKey) => ({
      edgeKey,
      neighbor: edges.get(edgeKey)!.faceIndices.find((other) => other !== face) ?? null,
    })),
  )
  const path = (vertices: string[]) => vertices.slice(1).map((v, i) => key(vertices[i]!, v))
  const oldArc = path(['3,2', '3,3', '3,4', '3,5'])
  const newArc = path(['3,2', '4,2', '4,3', '4,4', '4,5', '3,5'])
  return { edges, labels, faceEdges, oldArc, newArc, path }
}

test('expands only the swept strip, preserving remote islands and all other faces', () => {
  const f = fixture()
  const original = [...f.labels]
  const changes = relabelBoundaryStrip(f.labels, f.faceEdges, f.edges, f.oldArc, f.newArc, 44, 20)!
  expect(changes.size).toBe(6)
  const next = f.labels.map((label, face) => changes.get(face) ?? label)
  for (let face = 0; face < next.length; face++) {
    const x = Math.floor(face / 2) % 8,
      y = Math.floor(face / 16)
    expect(next[face]).toBe(x === 3 && y >= 2 && y < 5 ? 44 : original[face])
  }
  expect(f.labels).toEqual(original)
})

test('contracts locally back to gingiva', () => {
  const f = fixture()
  const arc = f.path(['3,2', '2,2', '2,3', '2,4', '2,5', '3,5'])
  const changes = relabelBoundaryStrip(f.labels, f.faceEdges, f.edges, f.oldArc, arc, 44, 20)!
  expect(changes.size).toBe(6)
  expect([...changes.values()]).toEqual(Array(6).fill(0))
})

test('does not relabel on a click or return to the original boundary', () => {
  const f = fixture()
  expect(
    relabelBoundaryStrip(f.labels, f.faceEdges, f.edges, f.oldArc, f.oldArc, 44, 20)?.size,
  ).toBe(0)
})

test('rejects an open strip instead of flooding the jaw', () => {
  const f = fixture()
  expect(
    relabelBoundaryStrip(f.labels, f.faceEdges, f.edges, f.oldArc, f.newArc.slice(1), 44, 20),
  ).toBeNull()
})

test('rejects excessive changes and crossing a third label', () => {
  const f = fixture()
  expect(relabelBoundaryStrip(f.labels, f.faceEdges, f.edges, f.oldArc, f.newArc, 44, 3)).toBeNull()
  f.labels[(3 * 8 + 3) * 2] = 45
  expect(
    relabelBoundaryStrip(f.labels, f.faceEdges, f.edges, f.oldArc, f.newArc, 44, 20),
  ).toBeNull()
})

test('validates ordered edges and refuses disconnected or self-intersecting paths', () => {
  const f = fixture()
  expect(orderedBoundaryVertices(f.oldArc, f.edges)).toEqual(['3,2', '3,3', '3,4', '3,5'])
  expect(orderedBoundaryVertices([f.oldArc[0]!, f.oldArc[2]!], f.edges)).toBeNull()
  expect(orderedBoundaryVertices([...f.oldArc, ...f.oldArc.slice().reverse()], f.edges)).toBeNull()
})
