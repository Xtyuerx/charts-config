import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import type { BvhBufferGeometry } from './bvhRaycastUtils'
import type { SurfaceAnchor } from './surfaceAnchorUtils'

type Portal = { face: number; a: THREE.Vector3; b: THREE.Vector3 }
type Face = {
  triangle: THREE.Triangle
  center: THREE.Vector3
  normal: THREE.Vector3
  portals: Portal[]
}
export type SurfaceFaceTopology = { faces: Face[]; tree: MeshBVH; step: number; epsilon: number }
const cache = new WeakMap<THREE.BufferGeometry, SurfaceFaceTopology>()

/** 模型加载时调用；只缓存参考三角面，不焊接/重写 STL BufferGeometry。 */
export function buildSurfaceFaceTopology(geometry: THREE.BufferGeometry): SurfaceFaceTopology {
  const cached = cache.get(geometry)
  if (cached) return cached
  const positions = geometry.getAttribute('position')
  const indices = geometry.getIndex()
  const count = indices ? indices.count : positions.count
  const faces: Face[] = []
  const edges = new Map<string, Array<{ face: number; a: THREE.Vector3; b: THREE.Vector3 }>>()
  let totalEdgeLength = 0
  // STL 文件常有微小浮点误差；使用与 SurfaceGraph 相同精度连接相邻三角面。
  // 这不是修改 geometry，也不会把不同牙面的远距离顶点焊接在一起。
  const key = (p: THREE.Vector3) =>
    `${Math.round(p.x * 100_000)}:${Math.round(p.y * 100_000)}:${Math.round(p.z * 100_000)}`
  for (let offset = 0; offset + 2 < count; offset += 3) {
    const vertices = [0, 1, 2].map((i) =>
      new THREE.Vector3().fromBufferAttribute(
        positions,
        indices ? indices.getX(offset + i) : offset + i,
      ),
    )
    const triangle = new THREE.Triangle(vertices[0]!, vertices[1]!, vertices[2]!)
    const face = faces.length
    faces.push({
      triangle,
      center: triangle.getMidpoint(new THREE.Vector3()),
      normal: triangle.getNormal(new THREE.Vector3()),
      portals: [],
    })
    if (triangle.getArea() === 0) continue
    for (let i = 0; i < 3; i++) {
      const a = vertices[i]!,
        b = vertices[(i + 1) % 3]!
      totalEdgeLength += a.distanceTo(b)
      const ka = key(a),
        kb = key(b)
      const edgeKey = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
      const owners = edges.get(edgeKey) ?? []
      owners.push({ face, a, b })
      edges.set(edgeKey, owners)
    }
  }
  edges.forEach((owners) => {
    // 开放边界、非流形边不跨越，避免猜测连接到哪个表面。
    if (owners.length !== 2) return
    const left = owners[0]!,
      right = owners[1]!
    faces[left.face]!.portals.push({ face: right.face, a: left.a, b: left.b })
    faces[right.face]!.portals.push({ face: left.face, a: left.a, b: left.b })
  })
  const bvhGeometry = geometry as BvhBufferGeometry
  // 页面已建立 BVH；独立调用此初始化函数时也只构建一次。
  const tree = bvhGeometry.boundsTree ?? new MeshBVH(geometry, { indirect: true })
  bvhGeometry.boundsTree = tree
  const averageEdge = totalEdgeLength / Math.max(1, faces.length * 3)
  const topology = {
    faces,
    tree,
    step: Math.max(averageEdge / 4, 1e-6),
    epsilon: Math.max(averageEdge * 1e-7, 1e-9),
  }
  cache.set(geometry, topology)
  return topology
}

export function bindFacePathPoint(
  topology: SurfaceFaceTopology,
  point: THREE.Vector3,
  anchor?: SurfaceAnchor,
) {
  if (![point.x, point.y, point.z].every(Number.isFinite)) throw new Error('边界控制点坐标无效')
  const face = anchor ? topology.faces[anchor.faceIndex] : undefined
  // 优先保留 Raycaster 的实际命中面；共享边上的最近点查询可能选到另一侧。
  if (face && face.triangle.getArea() > 0) {
    const projected = face.triangle.closestPointToPoint(point, new THREE.Vector3())
    if (projected.distanceTo(point) <= topology.epsilon)
      return { point: point.clone(), faceIndex: anchor!.faceIndex }
  }
  const hit = topology.tree.closestPointToPoint(point)
  if (!hit || topology.faces[hit.faceIndex]!.triangle.getArea() === 0)
    throw new Error('边界点无法绑定到有效 STL 三角面')
  // 页面传入的点已经在表面上，保留其精确值以保证点线端点一致。
  return {
    point: hit.point.distanceTo(point) <= topology.epsilon ? point.clone() : hit.point.clone(),
    faceIndex: hit.faceIndex,
  }
}

type HeapItem = { face: number; cost: number; score: number }
class FaceQueue {
  items: HeapItem[] = []
  push(item: HeapItem) {
    let i = this.items.length
    this.items.push(item)
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.items[parent]!.score <= item.score) break
      this.items[i] = this.items[parent]!
      i = parent
    }
    this.items[i] = item
  }
  pop() {
    const first = this.items[0]!,
      last = this.items.pop()!
    if (!this.items.length) return first
    let i = 0
    while (2 * i + 1 < this.items.length) {
      let child = 2 * i + 1
      if (child + 1 < this.items.length && this.items[child + 1]!.score < this.items[child]!.score)
        child++
      if (last.score <= this.items[child]!.score) break
      this.items[i] = this.items[child]!
      i = child
    }
    this.items[i] = last
    return first
  }
}

function faceCorridor(topology: SurfaceFaceTopology, start: number, end: number) {
  const queue = new FaceQueue()
  const distances = new Map([[start, 0]])
  const previous = new Map<number, { face: number; portal: Portal }>()
  const target = topology.faces[end]!.center
  queue.push({ face: start, cost: 0, score: topology.faces[start]!.center.distanceTo(target) })
  let visits = 0
  while (queue.items.length) {
    const current = queue.pop()
    if (current.cost !== distances.get(current.face)) continue
    if (current.face === end) {
      const faces = [end],
        portals: Portal[] = []
      let cursor = end
      while (cursor !== start) {
        const entry = previous.get(cursor)!
        portals.push(entry.portal)
        faces.push(entry.face)
        cursor = entry.face
      }
      return { faces: faces.reverse(), portals: portals.reverse() }
    }
    if (++visits > 12000) throw new Error('局部表面路径搜索范围过大，请缩短控制点间距')
    const face = topology.faces[current.face]!
    for (const portal of face.portals) {
      const next = topology.faces[portal.face]!
      const bend = 1 - THREE.MathUtils.clamp(face.normal.dot(next.normal), -1, 1)
      const cost = current.cost + face.center.distanceTo(next.center) * (1 + 0.15 * bend)
      if (cost >= (distances.get(portal.face) ?? Infinity)) continue
      distances.set(portal.face, cost)
      previous.set(portal.face, { face: current.face, portal })
      queue.push({ face: portal.face, cost, score: cost + next.center.distanceTo(target) })
    }
  }
  throw new Error('控制点之间没有连续的 STL 三角面路径（可能存在孔洞或非流形边）')
}

/** 在连续面带中优化公共边交点；每一段始终属于一个三角面，绝不跨面拉直。 */
export function createFaceConstrainedSegment(
  topology: SurfaceFaceTopology,
  from: THREE.Vector3,
  to: THREE.Vector3,
  fromAnchor?: SurfaceAnchor,
  toAnchor?: SurfaceAnchor,
) {
  const start = bindFacePathPoint(topology, from, fromAnchor)
  const end = bindFacePathPoint(topology, to, toAnchor)
  const corridor = faceCorridor(topology, start.faceIndex, end.faceIndex)
  if (corridor.portals.length > 1024) throw new Error('局部三角面路径过长，请缩短控制点间距')
  const knots = [start.point, ...corridor.portals.map((p) => p.a.clone().lerp(p.b, 0.5)), end.point]
  // 固定面带内的凸坐标优化。端点移动时重新求交点，不复用旧折线或 delta。
  const candidate = new THREE.Vector3()
  for (let pass = 0; pass < 16; pass++) {
    let movement = 0
    for (let k = 0; k < corridor.portals.length; k++) {
      const i = pass % 2 ? corridor.portals.length - 1 - k : k
      const portal = corridor.portals[i]!
      const before = knots[i]!,
        after = knots[i + 2]!
      const length = (t: number) => {
        candidate.lerpVectors(portal.a, portal.b, t)
        return candidate.distanceTo(before) + candidate.distanceTo(after)
      }
      let low = 0,
        high = 1
      for (let iteration = 0; iteration < 24; iteration++) {
        const left = low + (high - low) / 3,
          right = high - (high - low) / 3
        if (length(left) <= length(right)) high = right
        else low = left
      }
      const options = [0, (low + high) / 2, 1]
      const best = options.reduce((a, b) => (length(a) <= length(b) ? a : b))
      candidate.lerpVectors(portal.a, portal.b, best)
      movement = Math.max(movement, candidate.distanceTo(knots[i + 1]!))
      knots[i + 1]!.copy(candidate)
    }
    if (movement <= topology.epsilon) break
  }
  const samples = [start.point.clone()]
  for (let i = 0; i < corridor.faces.length; i++) {
    const a = knots[i]!,
      b = knots[i + 1]!
    const triangle = topology.faces[corridor.faces[i]!]!.triangle
    const subdivisions = Math.max(1, Math.ceil(a.distanceTo(b) / topology.step))
    if (samples.length + subdivisions > 16384)
      throw new Error('局部表面路径采样过多，请缩短控制点间距')
    for (let j = 1; j <= subdivisions; j++) {
      // 每个面内独立采样/投影；保留公共边交点，连线也不会穿过折叠表面。
      const point = a.clone().lerp(b, j / subdivisions)
      triangle.closestPointToPoint(point, point)
      samples.push(j === subdivisions ? b.clone() : point)
    }
  }
  return samples
}
