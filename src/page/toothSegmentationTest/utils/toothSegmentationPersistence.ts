import type {
  ToothBoundary,
  ToothBoundaryPoint,
} from './toothBoundaryEditorUtils'

type JawType = 'upper' | 'lower'

type FaceCounts = Record<JawType, number>

export type ImportedSegmentationState = {
  boundaries: Map<number, ToothBoundary>
  jaws: Record<JawType, number[]>
}

export function findJawForToothId(
  originalLabels: Record<JawType, number[]>,
  toothId: number,
): JawType | null {
  if (originalLabels.upper.includes(toothId)) return 'upper'
  if (originalLabels.lower.includes(toothId)) return 'lower'
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseBoundaryPoint(value: unknown, toothId: number, pointIndex: number) {
  if (!isRecord(value) || value.type !== 'control' || !Array.isArray(value.position)) {
    throw new Error(`牙号 ${toothId} 的第 ${pointIndex + 1} 个 Boundary Point 格式无效`)
  }
  if (
    value.position.length !== 3 ||
    !value.position.every((coordinate) =>
      typeof coordinate === 'number' && Number.isFinite(coordinate),
    )
  ) {
    throw new Error(`牙号 ${toothId} 的第 ${pointIndex + 1} 个 Boundary Point 三维坐标无效`)
  }
  const point: ToothBoundaryPoint = {
    position: [...value.position] as [number, number, number],
    type: 'control',
  }
  if (value.faceIndex !== undefined || value.barycentric !== undefined) {
    const weights = value.barycentric
    if (!Number.isInteger(value.faceIndex) || Number(value.faceIndex) < 0 || !Array.isArray(weights) || weights.length !== 3 ||
      !weights.every((weight) => typeof weight === 'number' && Number.isFinite(weight) && weight >= -1e-6 && weight <= 1 + 1e-6) ||
      Math.abs(weights.reduce((a: number, b: number) => a + b, 0) - 1) > 1e-6) throw new Error('Boundary 表面锚点无效')
    point.faceIndex = Number(value.faceIndex)
    point.barycentric = [...weights] as [number, number, number]
  }
  return point
}

function parseBoundaries(value: unknown) {
  if (!Array.isArray(value)) throw new Error('JSON 缺少 boundaries 数组')
  const boundaries = new Map<number, ToothBoundary>()
  value.forEach((entry, entryIndex) => {
    if (!isRecord(entry) || !Number.isInteger(entry.toothId) || Number(entry.toothId) <= 0) {
      throw new Error(`第 ${entryIndex + 1} 个 Boundary 的 toothId 无效`)
    }
    const toothId = Number(entry.toothId)
    if (boundaries.has(toothId)) throw new Error(`牙号 ${toothId} 重复`)
    if (!Array.isArray(entry.boundary) || entry.boundary.length < 3) {
      throw new Error(`牙号 ${toothId} 至少需要 3 个 Boundary Points`)
    }
    const boundary: ToothBoundary = {
      toothId,
      boundary: entry.boundary.map((point, pointIndex) =>
        parseBoundaryPoint(point, toothId, pointIndex),
      ),
    }
    if (entry.controlReduction !== undefined) {
      if (entry.controlReduction !== 3) throw new Error('Boundary 控制点减量标记无效')
      boundary.controlReduction = 3
    }
    if (entry.source !== undefined) {
      if (entry.source !== 'original') throw new Error('Boundary 来源无效')
      boundary.source = 'original'
    }
    if (entry.surfaceSegments !== undefined) {
      if (!Array.isArray(entry.surfaceSegments) || entry.surfaceSegments.length !== boundary.boundary.length) throw new Error('保存的表面路径段数无效')
      boundary.surfaceSegments = entry.surfaceSegments.map((segment) => {
        if (!Array.isArray(segment) || segment.length < 2 || segment.length > 16384) throw new Error('保存的表面路径采样数无效')
        return segment.map((position) => parseBoundaryPoint({ type: 'control', position }, toothId, 0).position)
      })
    }
    if (entry.seedFaceIndices !== undefined) {
      if (!Array.isArray(entry.seedFaceIndices) || !entry.seedFaceIndices.every((face) => Number.isInteger(face) && face >= 0)) throw new Error('保存的种子面编号无效')
      boundary.seedFaceIndices = [...entry.seedFaceIndices]
    }
    boundaries.set(toothId, boundary)
  })
  return boundaries
}

function parseJawLabels(value: unknown, jaw: JawType, expectedCount: number) {
  const jawName = jaw === 'upper' ? '上颌' : '下颌'
  if (!isRecord(value) || !Array.isArray(value.triangleLabels)) {
    throw new Error(`${jawName}缺少 triangleLabels 数组`)
  }
  if (value.triangleLabels.length !== expectedCount) {
    throw new Error(
      `${jawName} triangleLabels 数量应为 ${expectedCount}，实际为 ${value.triangleLabels.length}`,
    )
  }
  return value.triangleLabels.map((label, index) => {
    if (!Number.isInteger(label) || Number(label) < 0) {
      throw new Error(`${jawName}第 ${index + 1} 个 triangleLabel 无效`)
    }
    return Number(label)
  })
}

export function parseSegmentationImportPayload(
  input: unknown,
  faceCounts: FaceCounts,
): ImportedSegmentationState {
  let payload = input
  if (typeof input === 'string') {
    try {
      payload = JSON.parse(input) as unknown
    } catch {
      throw new Error('JSON 文件格式无效')
    }
  }

  const root = Array.isArray(payload) ? { boundaries: payload } : payload
  if (!isRecord(root)) throw new Error('JSON 根节点格式无效')
  const boundaries = parseBoundaries(root.boundaries)
  const emptyJaws = {
    upper: new Array<number>(faceCounts.upper).fill(0),
    lower: new Array<number>(faceCounts.lower).fill(0),
  }
  if (root.jaws == null) return { boundaries, jaws: emptyJaws }
  if (!isRecord(root.jaws)) throw new Error('jaws 格式无效')

  return {
    boundaries,
    jaws: {
      upper: parseJawLabels(root.jaws.upper, 'upper', faceCounts.upper),
      lower: parseJawLabels(root.jaws.lower, 'lower', faceCounts.lower),
    },
  }
}
