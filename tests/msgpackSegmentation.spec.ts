import { expect, test } from '@playwright/test'
import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three'
import { encode, decode } from '@msgpack/msgpack'
import * as editing from '../src/page/msgpackTeeth/segmentation'
import { ToothBoundary } from '../src/page/msgpackTeeth/boundaryEditor'

test('cached fitting reuses unchanged local paths with exactly the same result as a full fit', () => {
  const { geometry, labels } = grid()
  const session = new editing.SegmentationSession(geometry, labels)
  const controls = editing.sampleClosedLoop(session.boundaries.get(44)!, 20)
  const fit = session.createCurveFitter()
  const tree = session.topology.graph.surface.tree
  const original = tree.closestPointToPoint
  let queries = 0
  tree.closestPointToPoint = function (...args) {
    queries++
    return original.apply(this, args)
  }
  try {
    const first = fit(controls)
    const initialQueries = queries
    expect(initialQueries).toBeGreaterThan(0)
    queries = 0
    expect(fit(controls)).toEqual(first)
    expect(queries).toBe(0)
    controls[0]!.y -= 0.2
    queries = 0
    const moved = fit(controls)
    expect(queries).toBeGreaterThan(0)
    expect(queries).toBeLessThan(initialQueries / 2)
    expect(moved).toEqual(session.fitCurve(controls))
    expect(moved.segmentPoints.some((segment) => first.segmentPoints.includes(segment))).toBe(true)
    const invalid = controls.map((p) => p.clone())
    invalid[0]!.x = NaN
    expect(() => fit(invalid)).toThrow()
    queries = 0
    expect(fit(controls)).toEqual(moved)
    expect(queries).toBe(0)
  } finally {
    tree.closestPointToPoint = original
    geometry.dispose()
  }
})

function grid() {
  const vertices: number[] = [],
    indices: number[] = [],
    labels: number[] = []
  for (let y = 0; y <= 16; y++)
    for (let x = 0; x <= 16; x++) {
      vertices.push(x, y, 0)
      labels.push(x >= 5 && x <= 11 && y >= 5 && y <= 11 ? 44 : 0)
    }
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const a = y * 17 + x
      indices.push(a, a + 1, a + 18, a, a + 18, a + 17)
    }
  return {
    geometry: new BufferGeometry()
      .setAttribute('position', new Float32BufferAttribute(vertices, 3))
      .setIndex(indices),
    labels,
  }
}

test('extracts closed label contours from mixed triangles, including three-label junctions', () => {
  const { geometry, labels } = grid()
  labels[8 * 17 + 12] = 45
  const loops = editing.extractSegmentationBoundaries(geometry, labels)
  expect(loops.get(44)?.length).toBeGreaterThan(10)
  const loop = loops.get(44)!
  // The three-label face (11,7), (12,8), (11,8) meets at x = 34/3.
  expect(loop.every((p) => p.z === 0 && p.x >= 4.5 && p.x <= 11 + 2 / 3)).toBe(true)
  expect(loop.some((p) => p.x === 4.5)).toBe(true)
  expect(loop.some((p) => p.x === 11.5)).toBe(true)
  geometry.dispose()
})

test('equal arc sampling accounts for uneven input edge lengths', () => {
  const points = [new Vector3(0, 0), new Vector3(3, 0), new Vector3(3, 1), new Vector3(0, 1)]
  expect(editing.sampleClosedLoop(points, 8).map((p) => [p.x, p.y])).toEqual([
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
    [3, 1],
    [2, 1],
    [1, 1],
    [0, 1],
  ])
})

test('release rasterization changes only the local edit band and preserves source geometry', () => {
  const { geometry, labels } = grid()
  const positions = Array.from(geometry.getAttribute('position').array)
  const indices = Array.from(geometry.getIndex()!.array)
  const session = new editing.SegmentationSession(geometry, labels, 4)
  const before = [...labels]
  const square = [
    new Vector3(3.8, 3.8),
    new Vector3(12.2, 3.8),
    new Vector3(12.2, 12.2),
    new Vector3(3.8, 12.2),
  ]
  const result = session.rasterize(44, square)
  expect(result.changed.length).toBeGreaterThan(0)
  expect(result.labels[8 * 17 + 4]).toBe(44)
  expect(result.labels[8 * 17 + 8]).toBe(44)
  expect(result.labels[0]).toBe(0)
  expect(result.changed.every((i) => session.editableVertices.get(44)!.has(i))).toBe(true)
  expect(labels).toEqual(before) // prepare, then explicitly commit
  session.commit(result.labels)
  expect(session.labels).toEqual(result.labels)
  expect(Array.from(geometry.getAttribute('position').array)).toEqual(positions)
  expect(Array.from(geometry.getIndex()!.array)).toEqual(indices)
  geometry.dispose()
})

test('rejects a curve beyond its edit band without changing labels', () => {
  const { geometry, labels } = grid()
  const session = new editing.SegmentationSession(geometry, labels, 1)
  expect(() =>
    session.rasterize(44, [
      new Vector3(1, 1),
      new Vector3(15, 1),
      new Vector3(15, 15),
      new Vector3(1, 15),
    ]),
  ).toThrow(/编辑范围/)
  expect(session.labels).toEqual(labels)
  geometry.dispose()
})

test('rejects a loop that leaves the tooth seed outside instead of painting exterior gum as tooth', () => {
  const { geometry, labels } = grid()
  const session = new editing.SegmentationSession(geometry, labels)
  expect(() =>
    session.rasterize(44, [
      new Vector3(4.8, 4.8),
      new Vector3(6.2, 4.8),
      new Vector3(6.2, 6.2),
      new Vector3(4.8, 6.2),
    ]),
  ).toThrow(/方向|种子/)
  expect(session.labels).toEqual(labels)
  geometry.dispose()
})

test('exterior seed validation also works when the edit band covers the entire small mesh', () => {
  const { geometry, labels } = grid()
  const session = new editing.SegmentationSession(geometry, labels, 100)
  expect(() =>
    session.rasterize(44, [
      new Vector3(4.8, 4.8),
      new Vector3(6.2, 4.8),
      new Vector3(6.2, 6.2),
      new Vector3(4.8, 6.2),
    ]),
  ).toThrow(/方向|种子/)
  expect(session.labels).toEqual(labels)
  geometry.dispose()
})

test('reset restores the exact labels changed by a tooth edit', () => {
  const { geometry, labels } = grid()
  const session = new editing.SegmentationSession(geometry, labels)
  const result = session.rasterize(44, [
    new Vector3(3.8, 3.8),
    new Vector3(12.2, 3.8),
    new Vector3(12.2, 12.2),
    new Vector3(3.8, 12.2),
  ])
  session.commit(result.labels, 44)
  session.commit(session.resetLabels(44), 44, true)
  expect(session.labels).toEqual(labels)
  geometry.dispose()
})

test('shared vertex edit stacks survive resetting two neighboring teeth in either order', () => {
  for (const order of [
    [45, 44],
    [44, 45],
  ]) {
    const { geometry, labels } = grid()
    const session = new editing.SegmentationSession(geometry, labels)
    const a = [...labels]
    a[0] = 44
    session.commit(a, 44)
    const b = [...a]
    b[0] = 45
    session.commit(b, 45)
    session.commit(session.resetLabels(order[0]!), order[0], true)
    expect(session.labels[0]).toBe(order[0] === 45 ? 44 : 45)
    session.commit(session.resetLabels(order[1]!), order[1], true)
    expect(session.labels).toEqual(labels)
    geometry.dispose()
  }
})

test('hex input and full export preserve all fields and binary mesh bytes', () => {
  const bytes = new Uint8Array([68, 82, 65, 67, 79, 1, 2, 3])
  const payload = {
    lower_seg: {
      mesh: { type: 'dcrp', data: bytes },
      seg_labels: [0, 44, 0],
      label_curvature: [1, 2, 3],
      align_matrix: bytes,
    },
    upper_seg: { mesh: { type: 'drcp', data: bytes }, seg_labels: [11, 0] },
    lower_teeth: { 44: { mesh: bytes } },
    metadata: 'keep',
  }
  const hex = Array.from(encode(payload), (b) => b.toString(16).padStart(2, '0')).join(' ')
  const decoded = editing.decodeModelBytes(new TextEncoder().encode(hex))
  editing.writeLabels(decoded, 'lower_seg.seg_labels', [0, 44, 44])
  const saved = decode(editing.encodeFullModel(decoded)) as typeof payload
  expect(saved).toEqual({
    ...payload,
    lower_seg: { ...payload.lower_seg, seg_labels: [0, 44, 44] },
  })
  expect(() => editing.decodeModelBytes(new TextEncoder().encode('xyz123'))).toThrow()
  expect(() => editing.writeLabels(decoded, 'lower_seg.seg_labels', [44])).toThrow(/长度/)
})

test('spline editing updates the entire dense contour while preserving green selected lines', () => {
  const { geometry, labels } = grid()
  const session = new editing.SegmentationSession(geometry, labels)
  const controls = editing.sampleClosedLoop(session.boundaries.get(44)!, 20)
  const boundary = new ToothBoundary(44, session.boundaries.get(44)!, 0.1, undefined, {
    controls,
    fit: (points) => session.fitCurve(points).curvePoints.slice(0, -1),
  })
  const before = boundary.points()
  boundary.select(true)
  expect(boundary.line.material.color.getHex()).toBe(0x52c41a)
  const target = boundary.handles[0]!.position.clone().add(new Vector3(-0.4, 0, 0))
  boundary.move(0, target)
  const after = boundary.points()
  expect(after.length).toBeGreaterThan(controls.length)
  expect(after.some((p, i) => p.distanceTo(before[i]!) > 0.01)).toBe(true)
  expect(after.every((p) => Math.abs(p.z) < 1e-8)).toBe(true)
  boundary.reset()
  expect(boundary.handles.map((h) => h.position)).toEqual(controls)
  boundary.dispose()
  geometry.dispose()
})
