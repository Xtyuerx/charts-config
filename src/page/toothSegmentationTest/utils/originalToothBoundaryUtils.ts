import * as THREE from 'three'
import { createToothBoundary } from './toothBoundaryEditorUtils'
import type { SurfaceGraph } from './surfaceBoundaryUtils'

/** 从原始面标签提取每颗牙的独立闭环，保留原始沿边采样。 */
export function extractOriginalToothBoundaries(graph: SurfaceGraph, labels: readonly number[]) {
  const faces = graph.surface.faces
  if (labels.length !== faces.length) throw new Error('原始牙号标签与 STL 面数不一致')
  const edges = new Map<string, { a: THREE.Vector3; b: THREE.Vector3; owners: number[] }>()
  const regions = new Map<number, number[]>()
  const key = (p: THREE.Vector3) =>
    `${Math.round(p.x * 100_000)}:${Math.round(p.y * 100_000)}:${Math.round(p.z * 100_000)}`
  faces.forEach((face, index) => {
    const toothId = labels[index]!
    if (toothId > 0) {
      const region = regions.get(toothId) ?? []
      region.push(index)
      regions.set(toothId, region)
    }
    const vertices = [face.triangle.a, face.triangle.b, face.triangle.c]
    vertices.forEach((a, corner) => {
      const b = vertices[(corner + 1) % 3]!,
        ka = key(a),
        kb = key(b)
      const edgeKey = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
      const edge = edges.get(edgeKey) ?? { a, b, owners: [] }
      edge.owners.push(index)
      edges.set(edgeKey, edge)
    })
  })
  const outlines = new Map<number, Array<{ a: THREE.Vector3; b: THREE.Vector3 }>>()
  const invalid = new Set<number>()
  edges.forEach((edge) => {
    const owners = new Set(edge.owners.map((face) => labels[face]!))
    if (edge.owners.length > 2) owners.forEach((toothId) => invalid.add(toothId))
    if (edge.owners.length === 2 && owners.size === 1) return
    owners.forEach((toothId) => {
      if (toothId <= 0) return
      const outline = outlines.get(toothId) ?? []
      outline.push(edge)
      outlines.set(toothId, outline)
    })
  })
  const teeth = [],
    warnings: string[] = []
  for (const [toothId, triangleIndices] of regions) {
    const outline = outlines.get(toothId) ?? []
    const nodes = new Map<string, { point: THREE.Vector3; neighbors: string[] }>()
    outline.forEach(({ a, b }) => {
      for (const [from, to] of [
        [a, b],
        [b, a],
      ] as const) {
        const node = nodes.get(key(from)) ?? { point: from, neighbors: [] }
        node.neighbors.push(key(to))
        nodes.set(key(from), node)
      }
    })
    if (
      invalid.has(toothId) ||
      nodes.size < 3 ||
      Array.from(nodes.values()).some((node) => node.neighbors.length !== 2)
    ) {
      warnings.push(`牙号 ${toothId} 的原始边界非闭环或存在分叉，保留标签，需重新圈选`)
      continue
    }
    const start = nodes.keys().next().value!
    const loop: THREE.Vector3[] = [],
      visited = new Set<string>()
    let current = start,
      previous = ''
    while (!visited.has(current)) {
      visited.add(current)
      const node = nodes.get(current)!
      loop.push(node.point.clone())
      const next = node.neighbors.find((neighbor) => neighbor !== previous)!
      previous = current
      current = next
    }
    if (current !== start || visited.size !== nodes.size) {
      warnings.push(`牙号 ${toothId} 存在多个边界环，保留标签，需重新圈选`)
      continue
    }
    // 从标签区域边缘向内找最深一层，作为稳定的区域生长种子。
    const distance = new Map<number, number>(),
      queue: number[] = []
    triangleIndices.forEach((index) => {
      const portals = faces[index]!.portals
      if (portals.length < 3 || portals.some((p) => labels[p.face] !== toothId)) {
        distance.set(index, 0)
        queue.push(index)
      }
    })
    for (let i = 0; i < queue.length; i++) {
      const index = queue[i]!
      faces[index]!.portals.forEach((portal) => {
        if (labels[portal.face] !== toothId || distance.has(portal.face)) return
        distance.set(portal.face, distance.get(index)! + 1)
        queue.push(portal.face)
      })
    }
    const seed = queue[queue.length - 1] ?? triangleIndices[0]!
    const boundary = createToothBoundary(toothId, loop)
    boundary.source = 'original'
    boundary.surfaceSegments = loop.map((point, index) => [
      point.toArray(),
      loop[(index + 1) % loop.length]!.toArray(),
    ])
    teeth.push({ boundary, triangleIndices, seedFaceIndices: [seed] })
  }
  return { teeth, warnings }
}
