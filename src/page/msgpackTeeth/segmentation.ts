import * as THREE from 'three'
import { decode, encode } from '@msgpack/msgpack'
import { createCachedSurfacePath } from './cachedSurfacePath'
import {
  buildToothRegionTopology,
  classifyToothRegion,
} from '../toothSegmentationTest/utils/toothRegionClassifier'
import {
  createClosedSurfacePath,
  type ClosedSurfacePath,
} from '../toothSegmentationTest/utils/surfaceBoundaryUtils'

/** Hex text is only accepted as a complete, even-length byte sequence. */
export function decodeModelBytes(input: Uint8Array): unknown {
  const text = new TextDecoder()
    .decode(input)
    .replace(/^\uFEFF/, '')
    .trim()
  if (/^(?:0x)?[\da-f\s]+$/i.test(text)) {
    const hex = text.replace(/^0x/i, '').replace(/\s/g, '')
    if (!hex.length || hex.length % 2) throw new Error('hex 文本必须包含完整的双位字节')
    input = Uint8Array.from(hex.match(/../g)!, (b) => parseInt(b, 16))
  }
  const value = decode(input)
  if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value))
    throw new Error('msgpack 顶层必须是对象')
  return value
}

export function encodeFullModel(value: unknown): Uint8Array {
  return encode(value)
}

export function writeLabels(value: unknown, path: string, labels: readonly number[]) {
  const literal =
    value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, path)
  const keys = literal ? [path] : path.split('.')
  const key = keys.pop()!
  let parent = value as Record<string, unknown>
  for (const part of keys) {
    if (!parent || typeof parent !== 'object') throw new Error('标签字段路径无效')
    parent = parent[part] as Record<string, unknown>
  }
  const old = parent?.[key]
  if ((!Array.isArray(old) && !(old instanceof Uint8Array)) || old.length !== labels.length)
    throw new Error('标签长度与原数据不一致')
  if (!labels.every((n) => Number.isSafeInteger(n) && n >= 0)) throw new Error('标签必须为非负整数')
  if (old instanceof Uint8Array && labels.some((n) => n > 255))
    throw new Error('bin 标签超出单字节范围')
  parent[key] = old instanceof Uint8Array ? Uint8Array.from(labels) : [...labels]
}

export function sampleClosedLoop(points: THREE.Vector3[], count: number): THREE.Vector3[] {
  if (points.length < 3 || count < 3) throw new Error('闭合边界至少需要三个点')
  const lengths = points.map((p, i) => p.distanceTo(points[(i + 1) % points.length]!))
  const total = lengths.reduce((a, b) => a + b, 0)
  if (total < 1e-10) throw new Error('边界长度为零')
  let segment = 0,
    start = 0
  return Array.from({ length: count }, (_, i) => {
    const distance = (total * i) / count
    while (segment < lengths.length - 1 && start + lengths[segment]! <= distance)
      start += lengths[segment++]!
    return points[segment]!.clone().lerp(
      points[(segment + 1) % points.length]!,
      (distance - start) / (lengths[segment] || 1),
    )
  })
}

function faceVertices(geometry: THREE.BufferGeometry, face: number): number[] {
  const index = geometry.getIndex()
  return [0, 1, 2].map((c) => (index ? index.getX(face * 3 + c) : face * 3 + c))
}

/** March each label through mixed faces. Junctions meet at the face centroid. */
export function extractSegmentationBoundaries(
  geometry: THREE.BufferGeometry,
  labels: readonly number[],
) {
  const position = geometry.getAttribute('position')
  if (!position || labels.length !== position.count)
    throw new Error('需要与原始顶点数一致的 seg_labels')
  const count = (geometry.getIndex()?.count ?? position.count) / 3
  const graphs = new Map<number, Map<string, { point: THREE.Vector3; neighbors: Set<string> }>>()
  const vertex = (i: number) => new THREE.Vector3().fromBufferAttribute(position, i)
  for (let face = 0; face < count; face++) {
    const ids = faceVertices(geometry, face),
      values = ids.map((i) => labels[i]!)
    if (new Set(values).size === 1) continue
    for (const label of new Set(values)) {
      if (label <= 0) continue
      const graph =
        graphs.get(label) ?? new Map<string, { point: THREE.Vector3; neighbors: Set<string> }>()
      graphs.set(label, graph)
      const cuts: { key: string; point: THREE.Vector3 }[] = []
      for (let j = 0; j < 3; j++) {
        const a = ids[j]!,
          b = ids[(j + 1) % 3]!
        if ((labels[a] === label) === (labels[b] === label)) continue
        cuts.push({
          key: `e${Math.min(a, b)}:${Math.max(a, b)}`,
          point: vertex(a).lerp(vertex(b), 0.5),
        })
      }
      const connect = (a: (typeof cuts)[number], b: (typeof cuts)[number]) => {
        for (const [p, q] of [
          [a, b],
          [b, a],
        ] as const) {
          const node = graph.get(p.key) ?? { point: p.point, neighbors: new Set<string>() }
          node.neighbors.add(q.key)
          graph.set(p.key, node)
        }
      }
      if (new Set(values).size === 3) {
        const center = {
          key: `f${face}`,
          point: ids
            .reduce((sum, i) => sum.add(vertex(i)), new THREE.Vector3())
            .multiplyScalar(1 / 3),
        }
        cuts.forEach((p) => connect(p, center))
      } else if (cuts.length === 2) connect(cuts[0]!, cuts[1]!)
    }
  }
  const result = new Map<number, THREE.Vector3[]>()
  for (const [label, graph] of graphs) {
    const visited = new Set<string>()
    let best: THREE.Vector3[] = [],
      bestLength = 0
    for (const start of graph.keys()) {
      if (visited.has(start)) continue
      let current = start,
        previous = ''
      const loop: THREE.Vector3[] = []
      while (!visited.has(current) && graph.get(current)?.neighbors.size === 2) {
        visited.add(current)
        const node = graph.get(current)!
        loop.push(node.point.clone())
        const next = [...node.neighbors].find((n) => n !== previous)!
        previous = current
        current = next
      }
      if (current !== start || loop.length < 3) continue
      const length = loop.reduce((sum, p, i) => sum + p.distanceTo(loop[(i + 1) % loop.length]!), 0)
      if (length > bestLength) {
        best = loop
        bestLength = length
      }
    }
    if (best.length) result.set(label, best)
  }
  return result
}

export class SegmentationSession {
  readonly topology: ReturnType<typeof buildToothRegionTopology>
  readonly boundaries: Map<number, THREE.Vector3[]>
  readonly editableVertices = new Map<number, Set<number>>()
  private readonly editableFaces = new Map<number, Set<number>>()
  private readonly neighbors: Set<number>[]
  private readonly seeds = new Map<number, number>()
  private readonly exteriorSeeds = new Map<number, number>()
  private readonly history = new Map<number, { label: number; value: number }[]>()
  private readonly original: number[]
  labels: number[]

  get changedVertexCount() {
    return this.labels.reduce((total, value, i) => total + Number(value !== this.original[i]), 0)
  }

  constructor(
    readonly geometry: THREE.BufferGeometry,
    labels: readonly number[],
    rings = 4,
  ) {
    this.original = [...labels]
    this.labels = [...labels]
    this.boundaries = extractSegmentationBoundaries(geometry, labels)
    this.topology = buildToothRegionTopology(geometry)
    this.neighbors = Array.from({ length: labels.length }, () => new Set<number>())
    for (let f = 0; f < this.topology.faceNeighbors.length; f++) {
      const ids = faceVertices(geometry, f)
      ids.forEach((a) =>
        ids.forEach((b) => {
          if (a !== b) this.neighbors[a]!.add(b)
        }),
      )
    }
    for (const [label, loop] of this.boundaries) {
      const faces = new Set<number>()
      loop.forEach((p) => {
        const hit = this.topology.graph.surface.tree.closestPointToPoint(p)
        if (hit) faces.add(hit.faceIndex)
      })
      const boundaryFaces = [...faces]
      let front = [...faces]
      for (let r = 0; r < rings; r++) {
        const next: number[] = []
        front.forEach((f) =>
          this.topology.faceNeighbors[f]!.forEach((n) => {
            if (!faces.has(n.neighbor)) {
              faces.add(n.neighbor)
              next.push(n.neighbor)
            }
          }),
        )
        front = next
      }
      this.editableFaces.set(label, faces)
      const vertices = new Set<number>()
      faces.forEach((f) => faceVertices(geometry, f).forEach((i) => vertices.add(i)))
      this.editableVertices.set(label, vertices)
      // Pick an original all-tooth face farthest (in graph hops) from the boundary.
      const distances = new Int32Array(this.topology.faceNeighbors.length).fill(-1)
      const queue = boundaryFaces
      queue.forEach((f) => {
        distances[f] = 0
      })
      let seed = -1,
        best = -1
      for (let q = 0; q < queue.length; q++) {
        const f = queue[q]!,
          d = distances[f]!
        if (faceVertices(geometry, f).some((i) => labels[i] === label)) {
          if (d > best && faceVertices(geometry, f).every((i) => labels[i] === label)) {
            seed = f
            best = d
          }
          this.topology.faceNeighbors[f]!.forEach((n) => {
            if (distances[n.neighbor] === -1) {
              distances[n.neighbor] = d + 1
              queue.push(n.neighbor)
            }
          })
        }
      }
      if (seed >= 0) this.seeds.set(label, seed)
      // Keep a background/neighbor seed in the same original surface component,
      // even when a small mesh is entirely covered by the editable band.
      distances.fill(-1)
      const exteriorQueue = [...boundaryFaces]
      exteriorQueue.forEach((f) => {
        distances[f] = 0
      })
      let exterior = -1,
        exteriorDistance = -1
      for (let q = 0; q < exteriorQueue.length; q++) {
        const f = exteriorQueue[q]!,
          d = distances[f]!
        if (d > exteriorDistance && faceVertices(geometry, f).every((i) => labels[i] !== label)) {
          exterior = f
          exteriorDistance = d
        }
        this.topology.faceNeighbors[f]!.forEach((n) => {
          if (distances[n.neighbor] === -1) {
            distances[n.neighbor] = d + 1
            exteriorQueue.push(n.neighbor)
          }
        })
      }
      if (exterior >= 0) this.exteriorSeeds.set(label, exterior)
    }
  }

  project(point: THREE.Vector3) {
    const hit = this.topology.graph.surface.tree.closestPointToPoint(point)
    if (!hit) throw new Error('控制点无法投影到网格')
    return hit.point.clone()
  }

  createCurveFitter() {
    const fitPath = createCachedSurfacePath(this.topology.graph)
    return (controls: THREE.Vector3[]) => this.fitCurve(controls, fitPath)
  }

  fitCurve(
    controls: THREE.Vector3[],
    fitPath = (points: THREE.Vector3[]) => createClosedSurfacePath(this.topology.graph, points),
  ): ClosedSurfacePath {
    const curve = new THREE.CatmullRomCurve3(
      controls.map((p) => p.clone()),
      true,
      'centripetal',
    )
    return fitPath(curve.getPoints(Math.max(64, controls.length * 8)).slice(0, -1))
  }

  rasterize(label: number, points: THREE.Vector3[], path?: ClosedSurfacePath) {
    const faces = this.editableFaces.get(label),
      roi = this.editableVertices.get(label),
      seed = this.seeds.get(label)
    if (!faces || !roi || seed === undefined) throw new Error('缺少可可靠判断牙齿侧的闭合边界')
    path ??= createClosedSurfacePath(this.topology.graph, points)
    for (const p of path.curvePoints) {
      const hit = this.topology.graph.surface.tree.closestPointToPoint(p)
      if (!hit || !faces.has(hit.faceIndex))
        throw new Error('曲线超出原边界的局部编辑范围，请减小拖动距离')
    }
    const boundary = {
      toothId: label,
      boundary: path.anchorPoints.map((p) => ({
        type: 'control' as const,
        position: [p.x, p.y, p.z] as [number, number, number],
      })),
    }
    const inside = new Set(
      classifyToothRegion(this.topology, boundary, {
        surfacePath: path,
        seedFaceIndices: [seed],
      }).triangleIndices,
    )
    const exterior = this.exteriorSeeds.get(label)
    if (exterior === undefined || inside.has(exterior)) {
      throw new Error('新边界的内外方向无效：牙齿与外侧种子未被可靠分隔，已拒绝修改')
    }
    // A loop must separate the original tooth seed from reliable exterior faces.
    // Otherwise the seed component is the *outside* of a displaced small loop.
    for (const f of inside) {
      if (
        !faces.has(f) &&
        faceVertices(this.geometry, f).every((i) => this.original[i] !== label)
      ) {
        throw new Error('新边界的内外方向无效：牙齿种子与原外侧区域连通，已拒绝修改')
      }
    }
    const votes = new Int32Array(this.labels.length),
      totals = new Int32Array(this.labels.length)
    this.topology.faceNeighbors.forEach((_, f) =>
      faceVertices(this.geometry, f).forEach((i) => {
        totals[i]!++
        if (inside.has(f)) votes[i]!++
      }),
    )
    // Releasing a tooth vertex restores the nearest original non-tooth label through topology.
    const fallback = new Map<number, number>(),
      queue: number[] = []
    roi.forEach((i) => {
      if (this.original[i] !== label) {
        fallback.set(i, this.original[i]!)
        queue.push(i)
      }
    })
    for (let q = 0; q < queue.length; q++)
      this.neighbors[queue[q]!]!.forEach((i) => {
        if (roi.has(i) && !fallback.has(i)) {
          fallback.set(i, fallback.get(queue[q]!)!)
          queue.push(i)
        }
      })
    const labels = [...this.labels],
      changed: number[] = []
    roi.forEach((i) => {
      // Face votes quantize the continuous surface partition back to original vertices.
      const isInside =
        votes[i]! * 2 === totals[i] ? this.labels[i] === label : votes[i]! * 2 > totals[i]!
      const next = isInside ? label : this.labels[i] === label ? fallback.get(i) : this.labels[i]
      if (next === undefined) throw new Error('边界外侧缺少可恢复的标签')
      if (next !== labels[i]) {
        labels[i] = next
        changed.push(i)
      }
    })
    // A local edit must leave the original interior seed on the tooth side.
    if (!faceVertices(this.geometry, seed).every((i) => labels[i] === label))
      throw new Error('新边界越过牙齿内部种子，已拒绝修改')
    return { labels, changed, path }
  }

  resetLabels(label: number) {
    const labels = [...this.labels]
    this.history.forEach((stack, i) => {
      const remaining = stack.filter((edit) => edit.label !== label)
      labels[i] = remaining[remaining.length - 1]?.value ?? this.original[i]!
    })
    return labels
  }

  commit(labels: readonly number[], label?: number, reset = false) {
    if (labels.length !== this.labels.length) throw new Error('标签长度发生变化')
    if (label !== undefined) {
      if (reset)
        this.history.forEach((stack, i) => {
          const remaining = stack.filter((edit) => edit.label !== label)
          if (remaining.length) this.history.set(i, remaining)
          else this.history.delete(i)
        })
      else
        labels.forEach((next, i) => {
          if (next === this.labels[i]) return
          const stack = this.history.get(i) ?? []
          if (stack[stack.length - 1]?.label === label) stack[stack.length - 1]!.value = next
          else stack.push({ label, value: next })
          this.history.set(i, stack)
        })
    }
    this.labels = [...labels]
  }
}
