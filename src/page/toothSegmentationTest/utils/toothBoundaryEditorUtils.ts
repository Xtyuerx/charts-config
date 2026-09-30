import * as THREE from 'three'
import type { SurfaceAnchor } from './surfaceAnchorUtils'

export type ToothBoundaryPoint = {
  position: [number, number, number]
  type: 'control'
  // 兼容旧 JSON；进入页面编辑前由当前 STL 补齐这两个字段。
  faceIndex?: number
  barycentric?: [number, number, number]
}

export type ToothBoundary = {
  toothId: number
  boundary: ToothBoundaryPoint[]
  /** JSON 恢复缓存；运行时编辑仍以 surfacePath 为准。 */
  surfaceSegments?: [number, number, number][][]
  seedFaceIndices?: number[]
  controlReduction?: 3
  source?: 'original'
}

function assertToothId(toothId: number) {
  if (!Number.isInteger(toothId) || toothId <= 0) throw new Error('牙号必须是正整数')
}

export function inferDominantToothId(labels: number[]) {
  const counts = new Map<number, number>()
  labels.forEach((value) => {
    const label = Number(value)
    if (!Number.isInteger(label) || label <= 0) return
    counts.set(label, (counts.get(label) ?? 0) + 1)
  })
  let result: number | null = null
  let bestCount = 0
  counts.forEach((count, toothId) => {
    if (count <= bestCount) return
    result = toothId
    bestCount = count
  })
  return result
}

export function createToothBoundary(toothId: number, points: THREE.Vector3[]): ToothBoundary {
  assertToothId(toothId)
  return {
    toothId,
    boundary: points.map((point) => ({
      position: [point.x, point.y, point.z],
      type: 'control',
    })),
  }
}

export function upsertToothBoundary(
  boundaries: Map<number, ToothBoundary>,
  boundary: ToothBoundary,
) {
  assertToothId(boundary.toothId)
  boundaries.set(boundary.toothId, boundary)
  return boundary
}

export function moveBoundaryToothId(
  boundaries: Map<number, ToothBoundary>,
  sourceToothId: number,
  targetToothId: number,
) {
  assertToothId(targetToothId)
  const boundary = boundaries.get(sourceToothId)
  if (!boundary) throw new Error(`未找到牙号 ${sourceToothId} 的边界`)
  const moved = { ...boundary, toothId: targetToothId }
  boundaries.delete(sourceToothId)
  boundaries.set(targetToothId, moved)
  return moved
}

export function updateBoundaryControlPoint(
  boundaries: Map<number, ToothBoundary>,
  toothId: number,
  pointIndex: number,
  point: THREE.Vector3,
  anchor?: SurfaceAnchor,
) {
  const boundary = boundaries.get(toothId)
  const control = boundary?.boundary[pointIndex]
  if (!boundary || !control) throw new Error('Boundary Point 不存在')
  control.position = [point.x, point.y, point.z]
  if (anchor) {
    control.faceIndex = anchor.faceIndex
    control.barycentric = [...anchor.barycentric]
  } else {
    // 旧调用没有表面命中信息时，不保留已经过期的锚点。
    delete control.faceIndex
    delete control.barycentric
  }
  return boundary
}

export function boundaryControlVectors(boundary: ToothBoundary) {
  return boundary.boundary.map(
    (point) => new THREE.Vector3(point.position[0], point.position[1], point.position[2]),
  )
}

export function createBoundaryCurvePoints(boundary: ToothBoundary, segmentsPerControl = 8) {
  const controls = boundaryControlVectors(boundary)
  if (controls.length < 3) throw new Error('闭合牙齿边界至少需要 3 个控制点')
  const curve = new THREE.CatmullRomCurve3(controls, true, 'centripetal')
  return curve.getPoints(Math.max(controls.length * segmentsPerControl, 3))
}

export function serializeToothBoundaries(boundaries: Map<number, ToothBoundary>) {
  return JSON.stringify(
    Array.from(boundaries.values()).sort((a, b) => a.toothId - b.toothId),
    null,
    2,
  )
}
