import { Vector3 } from 'three'
import {
  createSurfaceSegmentPoints,
  type ClosedSurfacePath,
  type SurfaceGraph,
} from '../toothSegmentationTest/utils/surfaceBoundaryUtils'
import { bindFacePathPoint } from '../toothSegmentationTest/utils/surfaceFacePathUtils'

const key = (p: Vector3) => `${p.x},${p.y},${p.z}`

/** One cache per boundary. Exact keys preserve full-fit precision and surface routing. */
export function createCachedSurfacePath(graph: SurfaceGraph) {
  let projections = new Map<string, Vector3>()
  let segments = new Map<string, Vector3[]>()
  return (sampledPoints: Vector3[]): ClosedSurfacePath => {
    const nextProjections = new Map<string, Vector3>()
    const nextSegments = new Map<string, Vector3[]>()
    const seen = new Set<string>()
    const anchors: Vector3[] = []
    const epsilon = graph.surface.epsilon
    for (const sample of sampledPoints) {
      const sampleKey = key(sample)
      const point = projections.get(sampleKey) ?? bindFacePathPoint(graph.surface, sample).point
      nextProjections.set(sampleKey, point)
      // Keep the same deduplication and order as createClosedSurfacePath.
      const anchorKey = `${Math.round(point.x / epsilon)}:${Math.round(point.y / epsilon)}:${Math.round(point.z / epsilon)}`
      if (seen.has(anchorKey)) continue
      seen.add(anchorKey)
      anchors.push(point)
    }
    if (anchors.length < 3) throw new Error('至少需要 3 个不同的 Boundary Points')
    const segmentPoints = anchors.map((point, i) => {
      const next = anchors[(i + 1) % anchors.length]!
      const segmentKey = `${key(point)}|${key(next)}`
      const segment = segments.get(segmentKey) ?? createSurfaceSegmentPoints(graph, point, next)
      nextSegments.set(segmentKey, segment)
      return segment
    })
    // Failed fits leave the previous valid cache intact. Retain only one fit.
    projections = nextProjections
    segments = nextSegments
    return {
      anchorPoints: anchors,
      curvePoints: segmentPoints.flatMap((segment, i) => (i ? segment.slice(1) : segment)),
      segmentPoints,
    }
  }
}
