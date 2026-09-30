import { BufferGeometry, Float32BufferAttribute } from 'three'

export type LabelMode = 'auto' | 'vertex' | 'face'

function valueType(value: unknown): string {
  if (value === null) return 'null'
  if (value instanceof Uint8Array) return `Uint8Array(${value.byteLength} bytes)`
  if (Array.isArray(value)) return `Array(${value.length})`
  if (typeof value === 'string') return `string(${value.length} chars)`
  if (typeof value === 'object') return `object { ${Object.keys(value).slice(0, 20).join(', ')} }`
  return typeof value
}

/** Bounded structural diagnostics: never dump mesh bytes, labels or string values. */
export function describePayload(value: unknown): string {
  const lines: string[] = []
  function visit(item: unknown, path: string, depth: number) {
    if (lines.length >= 80) return
    lines.push(`${path}: ${valueType(item)}`)
    if (depth >= 3 || !item || typeof item !== 'object' || ArrayBuffer.isView(item)) return
    if (Array.isArray(item)) {
      if (item.length) visit(item[0], `${path}[0]`, depth + 1)
    } else {
      for (const key of Object.keys(item).slice(0, 20)) {
        visit((item as Record<string, unknown>)[key], `${path}.${key}`, depth + 1)
      }
    }
  }
  visit(value, '$', 0)
  return lines.join('\n')
}

function readField(value: unknown, path: string): unknown {
  let current = value
  // Prefer a literal field name if it itself contains dots.
  const keys =
    value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, path)
      ? [path]
      : path.split('.')
  for (const key of keys) {
    if (
      !current ||
      typeof current !== 'object' ||
      !Object.prototype.hasOwnProperty.call(current, key)
    ) {
      const available =
        current && typeof current === 'object'
          ? Object.keys(current).slice(0, 30).join(', ')
          : valueType(current)
      throw new Error(`字段 ${path} 不存在；当前层可用字段：${available}。请查看下方文件结构。`)
    }
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/** Explicit paths prevent accidentally pairing upper mesh with lower labels. */
export function readDraco(value: unknown, meshField: string) {
  const rawMesh = readField(value, meshField)
  const mesh =
    rawMesh &&
    typeof rawMesh === 'object' &&
    'type' in rawMesh &&
    (rawMesh.type === 'drcp' || rawMesh.type === 'drc') &&
    'data' in rawMesh
      ? rawMesh.data
      : rawMesh
  if (!(mesh instanceof Uint8Array)) {
    throw new Error(
      `字段 ${meshField} 实际类型为 ${valueType(mesh)}；当前需要 msgpack bin 类型的 Draco 二进制。请查看下方文件结构。`,
    )
  }
  if (mesh.length < 5) {
    throw new Error(`字段 ${meshField} 只有 ${mesh.length} 字节，不足以包含 DRACO 文件头`)
  }
  if (String.fromCharCode(...mesh.subarray(0, 5)) !== 'DRACO') {
    throw new Error(`字段 ${meshField} 缺少 DRACO 文件头`)
  }
  return new Uint8Array(mesh).buffer
}

export function readPayload(value: unknown, meshField: string, labelsField = 'seg_labels') {
  if (!value || typeof value !== 'object') throw new Error('msgpack 顶层必须是对象')
  const buffer = readDraco(value, meshField)
  const labelData = readField(value, labelsField)
  if (!Array.isArray(labelData) && !(labelData instanceof Uint8Array)) {
    throw new Error(
      `字段 ${labelsField} 必须是整数数组（或每标签一字节的 bin），实际为 ${valueType(labelData)}`,
    )
  }
  const labels = Array.from(labelData as ArrayLike<number>)
  if (!labels.length || !labels.every(Number.isSafeInteger)) {
    throw new Error('seg_labels 必须包含有效整数标签')
  }
  // A msgpack bin is a view into the whole payload. Copy only its range before
  // DRACOLoader transfers ownership of the buffer to its worker.
  return { buffer, labels }
}

export function jawPaths(value: unknown, jaw: 'lower' | 'upper') {
  if (!value || typeof value !== 'object') return null
  const key = `${jaw}_seg`
  const seg = (value as Record<string, unknown>)[key]
  if (
    !seg ||
    typeof seg !== 'object' ||
    !Object.prototype.hasOwnProperty.call(seg, 'mesh') ||
    !Object.prototype.hasOwnProperty.call(seg, 'seg_labels')
  )
    return null
  return { mesh: `${key}.mesh`, labels: `${key}.seg_labels` }
}

export function jawSource(value: unknown, jaw: 'lower' | 'upper'): 'seg' | 'teeth' | null {
  if (jawPaths(value, jaw)) return 'seg'
  if (!value || typeof value !== 'object') return null
  const teeth = (value as Record<string, unknown>)[`${jaw}_teeth`]
  return teeth && typeof teeth === 'object' && !Array.isArray(teeth) && Object.keys(teeth).length
    ? 'teeth'
    : null
}

/** Already separated teeth have their labels in the dictionary keys, not seg_labels. */
export function readJawParts(value: unknown, jaw: 'lower' | 'upper') {
  const path = `${jaw}_teeth`
  const teeth = readField(value, path)
  if (!teeth || typeof teeth !== 'object' || Array.isArray(teeth) || !Object.keys(teeth).length)
    throw new Error(`${path} 不含单牙模型`)
  const parts = Object.keys(teeth)
    .map((key) => {
      const label = Number(key)
      if (!/^\d+$/.test(key) || !Number.isSafeInteger(label) || label <= 0)
        throw new Error(`${path}.${key} 不是有效牙号`)
      return { label, buffer: readDraco(value, `${path}.${key}`) }
    })
    .sort((a, b) => a.label - b.label)
  const gum = (value as Record<string, unknown>)[`${jaw}_gum`]
  if (gum && typeof gum === 'object' && 'gum' in gum && gum.gum != null) {
    parts.unshift({ label: 0, buffer: readDraco(value, `${jaw}_gum.gum`) })
  }
  return parts
}

/** Labels MUST follow decoded Draco vertex/face order, not pre-encoding order. */
export function splitByLabels(geometry: BufferGeometry, labels: number[], mode: LabelMode) {
  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()
  if (!position || position.itemSize !== 3 || !position.count) throw new Error('网格缺少 position')
  const corners = index?.count ?? position.count
  const faceCount = corners / 3
  if (!Number.isInteger(faceCount) || !faceCount) throw new Error('数据不是有效三角网格')
  if (!labels.every(Number.isSafeInteger)) throw new Error('seg_labels 包含无效标签')
  if (mode === 'auto') {
    if (labels.length === position.count && labels.length === faceCount) {
      throw new Error('顶点数与面数相同，请明确选择标签对应顶点还是面')
    }
    mode = labels.length === position.count ? 'vertex' : 'face'
  }
  const expected = mode === 'vertex' ? position.count : faceCount
  if (labels.length !== expected) {
    throw new Error(
      `seg_labels 长度 ${labels.length} 不匹配：顶点 ${position.count}，三角面 ${faceCount}`,
    )
  }
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals()
  const normal = geometry.getAttribute('normal')
  const buckets = new Map<number, { positions: number[]; normals: number[] }>()
  let boundaryFaces = 0
  for (let face = 0; face < faceCount; face++) {
    const vertices = [0, 1, 2].map((corner) =>
      index ? index.getX(face * 3 + corner) : face * 3 + corner,
    )
    if (vertices.some((v) => !Number.isInteger(v) || v < 0 || v >= position.count)) {
      throw new Error('网格索引超出顶点范围')
    }
    let label = labels[face]!
    if (mode === 'vertex') {
      const [a, b, c] = vertices.map((v) => labels[v]!) as [number, number, number]
      label = b === c ? b : a
      if (a !== b || b !== c) boundaryFaces++
    }
    let bucket = buckets.get(label)
    if (!bucket) {
      bucket = { positions: [], normals: [] }
      buckets.set(label, bucket)
    }
    for (const vertex of vertices) {
      const xyz = [position.getX(vertex), position.getY(vertex), position.getZ(vertex)]
      if (!xyz.every(Number.isFinite)) throw new Error('网格包含无效坐标')
      bucket.positions.push(...xyz)
      bucket.normals.push(normal.getX(vertex), normal.getY(vertex), normal.getZ(vertex))
    }
  }
  const parts = Array.from(buckets, ([label, bucket]) => {
    const part = new BufferGeometry()
    part.setAttribute('position', new Float32BufferAttribute(bucket.positions, 3))
    part.setAttribute('normal', new Float32BufferAttribute(bucket.normals, 3))
    return { label, geometry: part }
  }).sort((a, b) => a.label - b.label)
  return { parts, boundaryFaces, faceCount }
}
