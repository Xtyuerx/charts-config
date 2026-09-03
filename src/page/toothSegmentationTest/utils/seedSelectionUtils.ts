import type { JawType } from './toothSegmentationState'

export type ScreenPoint = { x: number; y: number }
export type SeedRayHit = { jaw: JawType; faceIndex: number }

const pointOnSegment = (point: ScreenPoint, start: ScreenPoint, end: ScreenPoint) => {
  const cross = (point.x - start.x) * (end.y - start.y) - (point.y - start.y) * (end.x - start.x)
  if (Math.abs(cross) > Number.EPSILON) return false
  return point.x >= Math.min(start.x, end.x) - Number.EPSILON
    && point.x <= Math.max(start.x, end.x) + Number.EPSILON
    && point.y >= Math.min(start.y, end.y) - Number.EPSILON
    && point.y <= Math.max(start.y, end.y) + Number.EPSILON
}

const isInsidePolygon = (point: ScreenPoint, polygon: ScreenPoint[]) => {
  let inside = false
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]!
    const end = polygon[(index + 1) % polygon.length]!
    if (pointOnSegment(point, start, end)) return true
    if ((start.y > point.y) !== (end.y > point.y)) {
      const crossingX = (end.x - start.x) * (point.y - start.y) / (end.y - start.y) + start.x
      if (point.x < crossingX) inside = !inside
    }
  }
  return inside
}

export function sampleClosedScreenPolygon(stroke: ScreenPoint[], spacing = 6): ScreenPoint[] {
  if (stroke.length === 0) return []
  if (!(spacing > 0) || !Number.isFinite(spacing)) throw new Error('采样间距必须为正数')

  const result: ScreenPoint[] = []
  const seen = new Set<string>()
  const add = (point: ScreenPoint) => {
    const key = `${point.x},${point.y}`
    if (!seen.has(key)) {
      seen.add(key)
      result.push(point)
    }
  }
  stroke.forEach(add)
  if (stroke.length < 3) return result

  const xs = stroke.map(point => point.x)
  const ys = stroke.map(point => point.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  for (let x = minX; x <= maxX + Number.EPSILON; x += spacing) {
    for (let y = minY; y <= maxY + Number.EPSILON; y += spacing) {
      const sample = { x, y }
      if (isInsidePolygon(sample, stroke)) add(sample)
    }
  }
  return result
}

export function keepLargestFaceComponent(
  faceIndices: readonly number[],
  faceNeighbors: readonly (readonly number[])[],
): number[] {
  const unique = [...new Set(faceIndices)].sort((a, b) => a - b)
  const selected = new Set(unique)
  const unvisited = new Set(unique)
  const components: number[][] = []
  while (unvisited.size > 0) {
    const start = Math.min(...unvisited)
    const queue = [start]
    const component: number[] = []
    unvisited.delete(start)
    let cursor = 0
    while (cursor < queue.length) {
      const face = queue[cursor++]!
      component.push(face)
      for (const neighbor of faceNeighbors[face] ?? []) {
        if (selected.has(neighbor) && unvisited.delete(neighbor)) queue.push(neighbor)
      }
    }
    components.push(component.sort((a, b) => a - b))
  }
  components.sort((left, right) => right.length - left.length || left[0]! - right[0]!)
  return components[0] ?? []
}

export function collectSeedFaces(
  samples: ScreenPoint[],
  raycast: (point: ScreenPoint) => SeedRayHit | null,
  faceNeighbors: readonly (readonly number[])[],
): { jaw: JawType; faceIndices: number[] } | null {
  let jaw: JawType | null = null
  const faces: number[] = []
  for (const point of samples) {
    const hit = raycast(point)
    if (!hit) continue
    jaw ??= hit.jaw
    if (hit.jaw === jaw) faces.push(hit.faceIndex)
  }
  if (jaw === null) return null
  return { jaw, faceIndices: keepLargestFaceComponent(faces, faceNeighbors) }
}
