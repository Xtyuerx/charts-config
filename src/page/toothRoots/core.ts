import { decode, encode } from '@msgpack/msgpack'
import * as T from 'three'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { splitByLabels, type LabelMode } from '../msgpackTeeth/geometry'

export type Jaw = 'lower' | 'upper'
export type Document = Record<string, any>
export interface Tooth {
  id: number
  jaw: Jaw
  group: T.Group
  crown: T.Mesh
  neck: T.Vector3[]
  vertexIndices: number[]
  originalPosition: T.Vector3
  originalQuaternion: T.Quaternion
  root: { template: string; length: number }
  warning: string
  frameSource: 'stored-axis' | 'geometry'
  neckSource: 'stored-boundary' | 'open-edge'
}

// NumPy 自定义 bin：行排列矩阵数据 + ASCII |4,4,<f8 / |4,4,<f4。
// Matrix4.fromArray 按列排列，因此读入后转置，不能把元数据当浮点数。
export function readStoredFrame(bytes: unknown, crownHint?: T.Vector3) {
  if (!(bytes instanceof Uint8Array)) throw new Error('单牙 axis 必须为矩阵 bin')
  const suffix = new TextDecoder().decode(bytes.subarray(-8))
  const match = /^\|4,4,<f([48])$/.exec(suffix)
  if (!match) throw new Error('单牙 axis 缺少 |4,4,<f8 或 |4,4,<f4 元数据')
  const width = Number(match[1])
  if (bytes.byteLength !== 16 * width + 8) throw new Error('单牙 axis 字节长度与 4×4 布局不匹配')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength - 8)
  const rows = Array.from({ length: 16 }, (_, i) =>
    width === 8 ? view.getFloat64(i * width, true) : view.getFloat32(i * width, true),
  )
  if (
    !rows.every(Number.isFinite) ||
    Math.abs(rows[12]!) + Math.abs(rows[13]!) + Math.abs(rows[14]!) + Math.abs(rows[15]! - 1) > 1e-5
  )
    throw new Error('单牙 axis 不是有效仿射矩阵')
  const worldToLocal = new T.Matrix4().fromArray(rows).transpose()
  const rotation = new T.Matrix3().setFromMatrix4(worldToLocal)
  const axes = [0, 1, 2].map((i) => new T.Vector3(rows[i * 4], rows[i * 4 + 1], rows[i * 4 + 2]))
  if (
    Math.abs(rotation.determinant() - 1) > 1e-4 ||
    axes.some((a) => Math.abs(a.length() - 1) > 1e-4) ||
    Math.abs(axes[0]!.dot(axes[1]!)) +
      Math.abs(axes[0]!.dot(axes[2]!)) +
      Math.abs(axes[1]!.dot(axes[2]!)) >
      1e-4
  )
    throw new Error('单牙 axis 旋转部分非正交或包含缩放/镜像')
  const localToWorld = worldToLocal.clone().invert()
  const origin = new T.Vector3().setFromMatrixPosition(localToWorld)
  const x = new T.Vector3(1, 0, 0).transformDirection(localToWorld)
  const z = new T.Vector3(0, 1, 0).transformDirection(localToWorld)
  // 此数据第二方向为长轴：显示 X=原 X、Z=原 Y、Y=−原 Z，保持右手系。
  if (crownHint && crownHint.lengthSq() > 1e-8 && z.dot(crownHint) < 0) z.negate()
  const y = new T.Vector3().crossVectors(z, x).normalize()
  return {
    origin,
    x,
    y,
    z,
    quaternion: new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(x, y, z)),
  }
}

function storedBoundary(source: Document, jaw: Jaw, id: number): T.Vector3[] {
  const raw = source[`${jaw}_gum`]?.tooth_boundary_dict?.[String(id)]
  if (raw == null) return []
  if (
    !Array.isArray(raw) ||
    raw.length < 3 ||
    !raw.every((p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite))
  )
    throw new Error(`牙 ${id} 原始牙颈边界不是有效 XYZ 点数组`)
  const result = raw.map((p) => new T.Vector3(...(p as [number, number, number])))
  if (result[0]!.distanceToSquared(result[result.length - 1]!) < 1e-10) result.pop()
  if (result.length < 3) throw new Error(`牙 ${id} 原始牙颈有效点不足`)
  return result
}

// 1. MessagePack bin 或 hex 文本。保留整个对象，未知字段也会在保存时一起编码。
export function parseDocument(input: Uint8Array | string): Document {
  let bytes: Uint8Array
  const text = (typeof input === 'string' ? input : new TextDecoder().decode(input))
    .replace(/^\uFEFF/, '')
    .trim()
  if (typeof input === 'string' || /^(?:0x)?[\da-f\s]+$/i.test(text)) {
    const hex = text.replace(/^0x/i, '').replace(/\s/g, '')
    if (!/^[\da-f]+$/i.test(hex) || hex.length % 2) throw new Error('hex 必须是完整双位字节')
    bytes = Uint8Array.from(hex.match(/../g)!, (b) => parseInt(b, 16))
  } else bytes = input as Uint8Array
  const value = decode(bytes, { useBigInt64: true })
  if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value))
    throw new Error('MessagePack 顶层必须为对象')
  return value as Document
}

export async function decodeSurface(
  seg: Document,
  format: 'auto' | 'float32',
  draco: DRACOLoader,
): Promise<T.BufferGeometry> {
  const bytes = seg?.mesh?.data
  if (!(bytes instanceof Uint8Array)) throw new Error('seg.mesh.data 必须为 MessagePack bin')
  // type=dcrp/drcp 不是可靠的字节布局说明，优先验证真实 DRACO 文件头。
  const isDraco = String.fromCharCode(...bytes.subarray(0, 5)) === 'DRACO'
  if (format === 'auto' && isDraco) {
    return await new Promise((resolve, reject) =>
      draco.parse(new Uint8Array(bytes).buffer, resolve, reject),
    )
  }
  if (format === 'auto' && seg.mesh.type !== 'float32')
    throw new Error('未知网格格式：请选择 float32，或提供带 DRACO 文件头的数据')
  if (!bytes.length || bytes.length % 12) throw new Error('float32 XYZ 字节长度必须为 12 的倍数')
  // DataView 避免 MessagePack bin 的 byteOffset 不按 4 字节对齐。约定 little endian。
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const positions = new Float32Array(bytes.length / 4)
  for (let i = 0; i < positions.length; i++) {
    positions[i] = view.getFloat32(i * 4, true)
    if (!Number.isFinite(positions[i])) throw new Error('网格包含非有限坐标')
  }
  const geometry = new T.BufferGeometry().setAttribute(
    'position',
    new T.BufferAttribute(positions, 3),
  )
  // 可选显式三角索引；未提供时仅接受 XYZ 三角形汤，不猜测点云拓扑。
  if (Array.isArray(seg.mesh.indices)) {
    if (
      !seg.mesh.indices.length ||
      seg.mesh.indices.length % 3 ||
      !seg.mesh.indices.every(
        (v: number) => Number.isSafeInteger(v) && v >= 0 && v < positions.length / 3,
      )
    )
      throw new Error('mesh.indices 不是有效三角索引')
    geometry.setIndex(seg.mesh.indices)
  } else if (positions.length % 9)
    throw new Error('无 indices 的 float32 必须为三角形汤，无法从点云确定表面')
  return geometry
}

const mean = (points: T.Vector3[]) =>
  points.reduce((sum, p) => sum.add(p), new T.Vector3()).multiplyScalar(1 / points.length)
function uniquePoints(geometry: T.BufferGeometry) {
  const p = geometry.getAttribute('position'),
    result: T.Vector3[] = [],
    seen = new Set<string>()
  for (let i = 0; i < p.count; i++) {
    const v = new T.Vector3().fromBufferAttribute(p, i),
      key = v
        .toArray()
        .map((n) => Math.round(n * 1e5))
        .join(',')
    if (!seen.has(key)) {
      seen.add(key)
      result.push(v)
    }
  }
  return result
}

// 2. 沿现有牙冠三角面开放边提取闭环，焊接几何坐标以兼容三角形汤。
// 闭合牙冠、断裂轮廓不伪造牙颈，返回空数组并在 UI 告知。
export function cervicalLoop(geometry: T.BufferGeometry, rootHint?: T.Vector3): T.Vector3[] {
  const p = geometry.getAttribute('position'),
    index = geometry.getIndex()
  const points: T.Vector3[] = [],
    mapping: number[] = [],
    keys = new Map<string, number>()
  for (let i = 0; i < p.count; i++) {
    const v = new T.Vector3().fromBufferAttribute(p, i),
      key = v
        .toArray()
        .map((n) => Math.round(n * 1e5))
        .join(',')
    if (!keys.has(key)) {
      keys.set(key, points.length)
      points.push(v)
    }
    mapping.push(keys.get(key)!)
  }
  const edges = new Map<string, { a: number; b: number; count: number }>()
  const count = index?.count ?? p.count
  for (let i = 0; i < count; i += 3) {
    const ids = [0, 1, 2].map((k) => mapping[index ? index.getX(i + k) : i + k]!)
    for (let k = 0; k < 3; k++) {
      const a = ids[k]!,
        b = ids[(k + 1) % 3]!
      if (a === b) continue
      const key = a < b ? `${a}:${b}` : `${b}:${a}`
      const edge = edges.get(key)
      if (edge) edge.count++
      else edges.set(key, { a, b, count: 1 })
    }
  }
  const neighbors = new Map<number, number[]>()
  for (const e of edges.values())
    if (e.count === 1) {
      neighbors.set(e.a, [...(neighbors.get(e.a) ?? []), e.b])
      neighbors.set(e.b, [...(neighbors.get(e.b) ?? []), e.a])
    }
  const seen = new Set<number>(),
    loops: T.Vector3[][] = []
  for (const start of neighbors.keys()) {
    if (seen.has(start)) continue
    const ids: number[] = [],
      component = [start]
    // 拒绝含岔路或开口的连通分量。
    while (component.length) {
      const id = component.pop()!
      if (seen.has(id)) continue
      seen.add(id)
      ids.push(id)
      component.push(...(neighbors.get(id) ?? []).filter((v) => !seen.has(v)))
    }
    if (ids.length < 3 || ids.some((id) => neighbors.get(id)!.length !== 2)) continue
    const ordered: number[] = [start]
    let prev = -1,
      current = start
    do {
      const next = neighbors.get(current)!.find((id) => id !== prev)!
      prev = current
      current = next
      if (current !== start) ordered.push(current)
    } while (current !== start && ordered.length <= ids.length)
    if (current === start && ordered.length === ids.length)
      loops.push(ordered.map((id) => points[id]!.clone()))
  }
  // 多个开口时先按根向排序（排除咬合面洞）；没有方向时取最长闭环。
  loops.sort((a, b) =>
    rootHint ? mean(b).dot(rootHint) - mean(a).dot(rootHint) : b.length - a.length,
  )
  return loops[0] ?? []
}

// 对称协方差矩阵的 Jacobi 特征分解；选与牙颈→牙冠方向最一致的主轴，避免磨牙横宽成为长轴。
export function longAxis(points: T.Vector3[], hint: T.Vector3): T.Vector3 {
  const center = mean(points),
    a = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ],
    v = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]
  for (const p of points) {
    const d = p.clone().sub(center).toArray()
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) a[i]![j]! += d[i]! * d[j]!
  }
  for (let n = 0; n < 30; n++) {
    let p = 0,
      q = 1
    for (const [i, j] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ])
      if (Math.abs(a[i!]![j!]!) > Math.abs(a[p]![q]!)) {
        p = i!
        q = j!
      }
    if (Math.abs(a[p]![q]!) < 1e-10) break
    const angle = 0.5 * Math.atan2(2 * a[p]![q]!, a[q]![q]! - a[p]![p]!),
      c = Math.cos(angle),
      s = Math.sin(angle)
    const app = a[p]![p]!,
      aqq = a[q]![q]!,
      apq = a[p]![q]!
    a[p]![p] = c * c * app - 2 * s * c * apq + s * s * aqq
    a[q]![q] = s * s * app + 2 * s * c * apq + c * c * aqq
    a[p]![q] = a[q]![p] = 0
    for (let k = 0; k < 3; k++) {
      if (k !== p && k !== q) {
        const kp = a[k]![p]!,
          kq = a[k]![q]!
        a[k]![p] = a[p]![k] = c * kp - s * kq
        a[k]![q] = a[q]![k] = s * kp + c * kq
      }
      const vp = v[k]![p]!,
        vq = v[k]![q]!
      v[k]![p] = c * vp - s * vq
      v[k]![q] = s * vp + c * vq
    }
  }
  const axes = [0, 1, 2].map((i) => new T.Vector3(v[0]![i], v[1]![i], v[2]![i]).normalize())
  axes.sort((a, b) => Math.abs(b.dot(hint)) - Math.abs(a.dot(hint)))
  const axis = axes[0]!
  if (axis.dot(hint) < 0) axis.negate()
  return axis
}

export function extractTeeth(
  geometry: T.BufferGeometry,
  labels: number[],
  jaw: Jaw,
  mode: LabelMode,
  rootHint: T.Vector3,
  source: Document = {},
): { teeth: Tooth[]; gum?: T.BufferGeometry; warnings: string[] } {
  const result = splitByLabels(geometry, labels, mode),
    warnings: string[] = []
  const valid = (id: number) =>
    (jaw === 'lower' ? [3, 4] : [1, 2]).includes(Math.floor(id / 10)) &&
    id % 10 >= 1 &&
    id % 10 <= 8
  const parts = result.parts.filter((p) => valid(p.label))
  if (!parts.length) throw new Error('当前颌位没有有效 FDI 牙位标签')
  const centers = new Map(parts.map((p) => [p.label, mean(uniquePoints(p.geometry))]))
  const archOrder =
    jaw === 'lower'
      ? [38, 37, 36, 35, 34, 33, 32, 31, 41, 42, 43, 44, 45, 46, 47, 48]
      : [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]
  const ordered = archOrder.filter((id) => centers.has(id))
  const labelMode =
    mode === 'auto'
      ? labels.length === geometry.getAttribute('position').count
        ? 'vertex'
        : 'face'
      : mode
  const teeth = parts.map(({ label: id, geometry: crownGeometry }) => {
    const points = uniquePoints(crownGeometry),
      center = centers.get(id)!
    let savedFrame: ReturnType<typeof readStoredFrame> | undefined
    const rawAxis = source[`${jaw}_axis`]?.[String(id)]
    if (rawAxis != null) {
      try {
        savedFrame = readStoredFrame(rawAxis)
      } catch (error) {
        warnings.push(
          `牙 ${id} axis 无效，改用几何估计：${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    let neck: T.Vector3[] = []
    try {
      neck = storedBoundary(source, jaw, id)
    } catch (error) {
      warnings.push(String(error))
    }
    const neckSource: Tooth['neckSource'] = neck.length ? 'stored-boundary' : 'open-edge'
    if (!neck.length) {
      // 没有原始边界时先用备用根向消除轴正负号歧义，再选择颈圈。
      // 不能先任意选择闭环、再从这个闭环反推方向。
      if (savedFrame) savedFrame = readStoredFrame(rawAxis, rootHint.clone().negate())
      neck = cervicalLoop(crownGeometry, savedFrame ? savedFrame.z.clone().negate() : rootHint)
    }
    const hint = neck.length
      ? center.clone().sub(mean(neck)).normalize()
      : rootHint.clone().negate()
    if (!hint.lengthSq()) hint.copy(rootHint).negate()
    let z = longAxis(points, hint)
    const i = ordered.indexOf(id)
    const before = centers.get(ordered[Math.max(0, i - 1)]!)!,
      after = centers.get(ordered[Math.min(ordered.length - 1, i + 1)]!)!
    const x = after.clone().sub(before).addScaledVector(z, -after.clone().sub(before).dot(z))
    if (x.lengthSq() < 1e-8) x.set(1, 0, 0).addScaledVector(z, -z.x)
    if (x.lengthSq() < 1e-8) x.set(0, 1, 0).addScaledVector(z, -z.y)
    x.normalize()
    let y = new T.Vector3().crossVectors(z, x).normalize()
    let quaternion = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(x, y, z))
    let origin = center.clone()
    // 旧 v1 保存使用开放边/PCA，记录原算法基准用于恢复旧编辑产生的世界变换。
    const legacyNeck = cervicalLoop(crownGeometry, rootHint)
    const legacyHint = legacyNeck.length
      ? center.clone().sub(mean(legacyNeck)).normalize()
      : rootHint.clone().negate()
    if (!legacyHint.lengthSq()) legacyHint.copy(rootHint).negate()
    const legacyZ = longAxis(points, legacyHint),
      legacyX = after
        .clone()
        .sub(before)
        .addScaledVector(legacyZ, -after.clone().sub(before).dot(legacyZ))
    if (legacyX.lengthSq() < 1e-8) legacyX.set(1, 0, 0).addScaledVector(legacyZ, -legacyZ.x)
    if (legacyX.lengthSq() < 1e-8) legacyX.set(0, 1, 0).addScaledVector(legacyZ, -legacyZ.y)
    legacyX.normalize()
    const legacyQ = new T.Quaternion().setFromRotationMatrix(
      new T.Matrix4().makeBasis(
        legacyX,
        new T.Vector3().crossVectors(legacyZ, legacyX).normalize(),
        legacyZ,
      ),
    )
    if (savedFrame) {
      savedFrame = readStoredFrame(rawAxis, hint)
      origin = savedFrame.origin
      x.copy(savedFrame.x)
      y = savedFrame.y
      z = savedFrame.z
      quaternion = savedFrame.quaternion
    }
    const baseFrame = new T.Matrix4().compose(origin, quaternion, new T.Vector3(1, 1, 1))
    const inverse = baseFrame.clone().invert()
    crownGeometry.applyMatrix4(inverse)
    const crown = new T.Mesh(
      crownGeometry,
      new T.MeshStandardMaterial({ color: '#e7a1ae', roughness: 0.52, side: T.DoubleSide }),
    )
    const group = new T.Group()
    group.position.copy(origin)
    group.quaternion.copy(quaternion)
    group.add(crown)
    group.userData.toothId = id
    group.userData.baseFrame = baseFrame.toArray()
    group.userData.legacyFrame = new T.Matrix4()
      .compose(center, legacyQ, new T.Vector3(1, 1, 1))
      .toArray()
    // 每颗牙的原始顶点集合；按面标签时为该牙三角面所引用顶点的并集。
    const indices = new Set<number>(),
      srcIndex = geometry.getIndex()
    if (labelMode === 'vertex')
      labels.forEach((label, i) => {
        if (label === id) indices.add(i)
      })
    else
      labels.forEach((label, face) => {
        if (label === id)
          for (let k = 0; k < 3; k++)
            indices.add(srcIndex ? srcIndex.getX(face * 3 + k) : face * 3 + k)
      })
    const warning = neck.length ? '' : `牙 ${id} 无可用牙颈闭环，保留牙冠并跳过牙根`
    if (warning) warnings.push(warning)
    return {
      id,
      jaw,
      group,
      crown,
      neck: neck.map((p) => p.applyMatrix4(inverse)),
      vertexIndices: [...indices],
      originalPosition: origin.clone(),
      originalQuaternion: quaternion.clone(),
      root: { template: `${id}.obj`, length: rootLength(id) },
      warning,
      frameSource: savedFrame ? ('stored-axis' as const) : ('geometry' as const),
      neckSource,
    }
  })
  const gum = result.parts.find((p) => p.label === 0)?.geometry
  for (const part of result.parts)
    if (!valid(part.label) && part.label !== 0) part.geometry.dispose()
  if (result.boundaryFaces)
    warnings.push(`${result.boundaryFaces} 个跨标签面按原查看器多数标签归属；牙颈为开放边近似`)
  return { teeth, gum, warnings }
}

export function rootLength(id: number) {
  return [12, 12, 16, 14, 13, 13, 12, 11][(id % 10) - 1] ?? 12
}

// 3. 模板约定：颈圈半径 1，z=0；根向 -Z，尖端 z=-1。每牙位单独 OBJ。
export async function loadRootTemplate(url: string): Promise<T.BufferGeometry> {
  if (/\.ply(?:\?|$)/i.test(url)) return new PLYLoader().loadAsync(url)
  const obj = await new OBJLoader().loadAsync(url),
    meshes: T.Mesh[] = []
  obj.updateMatrixWorld(true)
  obj.traverse((child) => {
    if (child instanceof T.Mesh) meshes.push(child)
  })
  if (meshes.length !== 1) {
    meshes.forEach((m) => m.geometry.dispose())
    throw new Error('牙根 OBJ 必须包含一个网格（多根请放在同一对象）')
  }
  const geometry = meshes[0]!.geometry.clone().applyMatrix4(meshes[0]!.matrixWorld)
  meshes.forEach((m) => {
    m.geometry.dispose()
    const materials = Array.isArray(m.material) ? m.material : [m.material]
    materials.forEach((m) => m.dispose())
  })
  return geometry
}

export function fitRoot(
  template: T.BufferGeometry,
  neck: T.Vector3[],
  length: number,
): T.BufferGeometry {
  if (neck.length < 3 || !Number.isFinite(length) || length <= 0)
    throw new Error('无有效牙颈或牙根长度')
  const geometry = template.clone(),
    p = geometry.getAttribute('position'),
    center = mean(neck)
  if (!p || !p.count) throw new Error('牙根模板无顶点')
  const ring = neck
    .map((point) => ({ point, angle: Math.atan2(point.y - center.y, point.x - center.x) }))
    .sort((a, b) => a.angle - b.angle)
  const radiusX = Math.max(...neck.map((v) => Math.abs(v.x - center.x))),
    radiusY = Math.max(...neck.map((v) => Math.abs(v.y - center.y)))
  if (radiusX < 1e-6 || radiusY < 1e-6) {
    geometry.dispose()
    throw new Error('牙颈投影退化，无法贴合牙根')
  }
  // 用颈部径向轮廓映射单位模板；颈圈顶点贴到同角度的边界线段。
  // 要求牙颈相对中心为星形；复杂轮廓需换用定制非刚性配准。
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i)
    if (!Number.isFinite(x + y + z) || z > 1e-4 || z < -1.001)
      throw new Error('模板须满足颈圈 z=0、根尖 z=-1')
    const angle = Math.atan2(y, x),
      r = Math.hypot(x, y)
    let j = ring.findIndex((v) => v.angle > angle)
    if (j < 0) j = 0
    const b = ring[j]!,
      a = ring[(j + ring.length - 1) % ring.length]!
    let aa = a.angle,
      bb = b.angle,
      t = angle
    if (bb <= aa) bb += Math.PI * 2
    if (t < aa) t += Math.PI * 2
    const edge = a.point.clone().lerp(b.point, (t - aa) / (bb - aa))
    // 根颈上方 25% 贴边界，其余保留模板形状，避免不规则颈圈成为长尖刺。
    const fade = Math.max(0, 1 + z / 0.25)
    const templateX = center.x + x * radiusX,
      templateY = center.y + y * radiusY
    p.setXYZ(
      i,
      T.MathUtils.lerp(templateX, center.x + (edge.x - center.x) * r, fade),
      T.MathUtils.lerp(templateY, center.y + (edge.y - center.y) * r, fade),
      center.z + z * length + (edge.z - center.z) * fade,
    )
  }
  // OBJ 通常是非索引三角形汤；焊接后重算平滑法线，不把原口扫网格焊接或改写。
  geometry.deleteAttribute('normal')
  const smooth = mergeVertices(geometry, 1e-5)
  geometry.dispose()
  smooth.computeVertexNormals()
  return smooth
}

// 5. 每牙新增 editor 字段（适配点），不覆盖原牙数据或猜测后端位置字段。
// position/quaternion 是模型坐标中绝对姿态；牙冠几何已转到原局部坐标。
export function saveDocument(
  source: Document,
  teeth: Pick<Tooth, 'id' | 'jaw' | 'group' | 'root'>[],
): Uint8Array {
  const result: Document = { ...source }
  for (const jaw of ['lower', 'upper'] as const) {
    const edits = teeth.filter((t) => t.jaw === jaw)
    if (!edits.length) continue
    const key = `${jaw}_teeth`,
      old = source[key]
    if (old != null && (typeof old !== 'object' || Array.isArray(old) || ArrayBuffer.isView(old)))
      throw new Error(`${key} 必须为牙号字典，需先适配实际结构`)
    const entries = { ...(old ?? {}) }
    for (const tooth of edits) {
      const previous = entries[String(tooth.id)]
      if (
        previous != null &&
        (typeof previous !== 'object' || Array.isArray(previous) || ArrayBuffer.isView(previous))
      )
        throw new Error(`牙 ${tooth.id} 原数据不是对象，无法安全追加 editor 字段`)
      entries[String(tooth.id)] = {
        ...(previous ?? {}),
        editor: {
          ...(previous?.editor ?? {}),
          schema: tooth.group.userData.baseFrame ? 'tooth-roots-v2' : 'tooth-roots-v1',
          ...(tooth.group.userData.baseFrame
            ? { baseFrame: [...tooth.group.userData.baseFrame] }
            : {}),
          position: tooth.group.position.toArray(),
          quaternion: tooth.group.quaternion.toArray(),
          root: { ...tooth.root },
        },
      }
    }
    result[key] = entries
  }
  return encode(result, { useBigInt64: true })
}

export function restoreTooth(source: Document, tooth: Tooth) {
  const edit = source[`${tooth.jaw}_teeth`]?.[String(tooth.id)]?.editor
  if (!edit) return
  if (
    !['tooth-roots-v1', 'tooth-roots-v2'].includes(edit.schema) ||
    !Array.isArray(edit.position) ||
    edit.position.length !== 3 ||
    !Array.isArray(edit.quaternion) ||
    edit.quaternion.length !== 4 ||
    ![...edit.position, ...edit.quaternion].every(Number.isFinite)
  )
    throw new Error(`牙 ${tooth.id} 保存姿态无效`)
  const q = new T.Quaternion().fromArray(edit.quaternion)
  if (q.lengthSq() < 1e-8) throw new Error(`牙 ${tooth.id} 四元数无效`)
  const pose = new T.Matrix4().compose(
    new T.Vector3().fromArray(edit.position),
    q.normalize(),
    new T.Vector3(1, 1, 1),
  )
  const previousBase =
    edit.schema === 'tooth-roots-v2' ? edit.baseFrame : tooth.group.userData.legacyFrame
  const currentBase = tooth.group.userData.baseFrame
  if (
    edit.schema === 'tooth-roots-v2' &&
    (!Array.isArray(previousBase) ||
      previousBase.length !== 16 ||
      !previousBase.every(Number.isFinite))
  )
    throw new Error(`牙 ${tooth.id} 保存坐标基准无效`)
  if (previousBase && currentBase) {
    const base = new T.Matrix4().fromArray(previousBase)
    if (Math.abs(base.determinant()) < 1e-8) throw new Error(`牙 ${tooth.id} 保存坐标基准不可逆`)
    pose.multiply(base.invert()).multiply(new T.Matrix4().fromArray(currentBase))
  }
  pose.decompose(tooth.group.position, tooth.group.quaternion, tooth.group.scale)
  if (edit.root) {
    if (
      typeof edit.root.template !== 'string' ||
      !Number.isFinite(edit.root.length) ||
      edit.root.length <= 0
    )
      throw new Error(`牙 ${tooth.id} 牙根参数无效`)
    tooth.root = { ...edit.root }
  }
}

export interface SaveApi {
  getUpdateEditVersion(): Promise<string | number>
  getUploadPath(
    version: string | number,
  ): Promise<{ url: string; key: string; headers?: Record<string, string> }>
  update(data: { version: string | number; key: string }): Promise<void>
}
export async function uploadDocument(bytes: Uint8Array, api: SaveApi, put: typeof fetch = fetch) {
  const version = await api.getUpdateEditVersion()
  const path = await api.getUploadPath(version)
  if (!path.url || !path.key) throw new Error('上传接口缺少 url/key')
  // 拷贝精确字节区间；OSS PUT 不携带应用 Cookie。
  const response = await put(path.url, {
    method: 'PUT',
    headers: path.headers,
    body: new Uint8Array(bytes).buffer,
  })
  if (!response.ok) throw new Error(`OSS PUT 失败：HTTP ${response.status}`)
  await api.update({ version, key: path.key })
}

/** 可运行示意数据：开口椭球牙冠，不是真实口扫；上下颌均按逐顶点标签。 */
export function demoDocument(): Document {
  const result: Document = { lower_teeth: {}, upper_teeth: {}, demo: true }
  for (const jaw of ['lower', 'upper'] as const) {
    const positions: number[] = [],
      labels: number[] = []
    const ids =
      jaw === 'lower'
        ? [37, 36, 35, 34, 33, 32, 31, 41, 42, 43, 44, 45, 46, 47]
        : [17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27]
    ids.forEach((id, i) => {
      const angle = Math.PI * (i / (ids.length - 1)),
        direction = jaw === 'lower' ? 1 : -1
      const crown = new T.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.65)
      crown.rotateX((Math.PI / 2) * direction)
      crown.scale(id % 10 >= 6 ? 4.3 : 3.2, 3.4, 5)
      crown.translate(25 * Math.cos(angle), 30 * Math.sin(angle) - 12, jaw === 'lower' ? -7 : 7)
      const soup = crown.toNonIndexed(),
        p = soup.getAttribute('position')
      for (let j = 0; j < p.count; j++) {
        positions.push(p.getX(j), p.getY(j), p.getZ(j))
        labels.push(id)
      }
      crown.dispose()
      soup.dispose()
    })
    const data = new Uint8Array(positions.length * 4),
      view = new DataView(data.buffer)
    positions.forEach((v, i) => view.setFloat32(i * 4, v, true))
    result[`${jaw}_seg`] = { mesh: { type: 'float32', data }, seg_labels: labels }
  }
  return result
}
