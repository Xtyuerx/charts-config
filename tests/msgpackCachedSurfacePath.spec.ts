import { expect, test } from '@playwright/test'
import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three'
import {
  buildSurfaceGraph,
  createClosedSurfacePath,
} from '../src/page/toothSegmentationTest/utils/surfaceBoundaryUtils'
import { createCachedSurfacePath } from '../src/page/msgpackTeeth/cachedSurfacePath'

test('cached paths match full fits across a folded surface and recover from a failed route', () => {
  const geometry = new BufferGeometry().setAttribute(
    'position',
    new Float32BufferAttribute(
      [
        0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 1, 0, 1, 0,
        // A nearby disconnected sheet must never be connected by a cached route.
        0, 0, -0.1, 1, 0, -0.1, 0, 1, -0.1,
      ],
      3,
    ),
  )
  const graph = buildSurfaceGraph(geometry)
  const fit = createCachedSurfacePath(graph)
  const points = [
    new Vector3(0.1, 0.1, 0),
    new Vector3(0.8, 0.1, 0),
    new Vector3(0.8, 0.8, 0.6),
    new Vector3(0.1, 0.8, 0),
  ]
  try {
    const first = fit(points)
    expect(first).toEqual(createClosedSurfacePath(graph, points))
    const crossing = (path: typeof first) =>
      path.segmentPoints[1]!.find((p) => Math.abs(p.x + p.y - 1) < 1e-9 && Math.abs(p.z) < 1e-9)!
    points[1]!.x -= 0.1
    const moved = fit(points)
    expect(moved).toEqual(createClosedSurfacePath(graph, points))
    expect(crossing(moved).distanceTo(crossing(first))).toBeGreaterThan(0.001)
    expect(moved.segmentPoints[2]).toBe(first.segmentPoints[2])
    const invalid = points.map((p) => p.clone())
    invalid[0]!.z = -0.1
    expect(() => fit(invalid)).toThrow('没有连续')
    const recovered = fit(points)
    expect(recovered).toEqual(moved)
    recovered.segmentPoints.forEach((segment, i) => expect(segment).toBe(moved.segmentPoints[i]))
    // Duplicate and changed-count samples follow the same closed-loop rules.
    const duplicates = [points[0]!, ...points, points[0]!]
    expect(fit(duplicates)).toEqual(createClosedSurfacePath(graph, duplicates))
  } finally {
    geometry.dispose()
  }
})
