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
  return {
    position: [...value.position] as [number, number, number],
    type: 'control',
  } satisfies ToothBoundaryPoint
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
    boundaries.set(toothId, {
      toothId,
      boundary: entry.boundary.map((point, pointIndex) =>
        parseBoundaryPoint(point, toothId, pointIndex),
      ),
    })
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
