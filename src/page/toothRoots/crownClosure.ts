import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2, Vector3 } from 'three'

/** Display-only caps. Weld positions for topology, leaving source buffers and indices untouched. */
export function createCrownCap(source: BufferGeometry) {
  const position = source.getAttribute('position'),
    index = source.getIndex()
  const points: Vector3[] = [],
    mapping: number[] = [],
    keys = new Map<string, number>()
  for (let i = 0; i < position.count; i++) {
    const p = new Vector3().fromBufferAttribute(position, i)
    const key = p
      .toArray()
      .map((n) => Math.round(n * 1e5))
      .join(',')
    if (!keys.has(key)) {
      keys.set(key, points.length)
      points.push(p)
    }
    mapping.push(keys.get(key)!)
  }
  const edges = new Map<string, { a: number; b: number; count: number }>()
  for (let i = 0, count = index?.count ?? position.count; i < count; i += 3) {
    const ids = [0, 1, 2].map((k) => mapping[index ? index.getX(i + k) : i + k]!)
    if (new Set(ids).size < 3) continue
    for (let k = 0; k < 3; k++) {
      const a = ids[k]!,
        b = ids[(k + 1) % 3]!,
        key = a < b ? `${a}:${b}` : `${b}:${a}`
      const edge = edges.get(key)
      if (edge) edge.count++
      else edges.set(key, { a, b, count: 1 })
    }
  }
  const boundary = [...edges.values()].filter((e) => e.count === 1)
  const neighbors = new Map<number, number[]>()
  for (const { a, b } of boundary) {
    neighbors.set(a, [...(neighbors.get(a) ?? []), b])
    neighbors.set(b, [...(neighbors.get(b) ?? []), a])
  }
  const seen = new Set<number>(),
    output: number[] = []
  let closedLoops = 0,
    fallbackLoops = 0,
    unresolvedEdges = [...edges.values()].filter((e) => e.count > 2).length
  for (const start of neighbors.keys()) {
    if (seen.has(start)) continue
    const component = new Set<number>(),
      pending = [start]
    while (pending.length) {
      const id = pending.pop()!
      if (seen.has(id)) continue
      seen.add(id)
      component.add(id)
      pending.push(...neighbors.get(id)!.filter((n) => !seen.has(n)))
    }
    const edgeCount = [...component].reduce((sum, id) => sum + neighbors.get(id)!.length, 0) / 2
    if (component.size < 3 || [...component].some((id) => neighbors.get(id)!.length !== 2)) {
      unresolvedEdges += edgeCount
      continue
    }
    const ids = [start]
    let prev = -1,
      current = start
    do {
      const next = neighbors.get(current)!.find((id) => id !== prev)!
      prev = current
      current = next
      if (current !== start) ids.push(current)
    } while (current !== start && ids.length <= component.size)
    const first = edges.get(ids[0]! < ids[1]! ? `${ids[0]}:${ids[1]}` : `${ids[1]}:${ids[0]}`)!
    if (first.a === ids[0]) ids.reverse() // Cap edges must oppose the crown boundary winding.
    const loop = ids.map((id) => points[id]!),
      normal = new Vector3()
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]!,
        b = loop[(i + 1) % loop.length]!
      normal.x += (a.y - b.y) * (a.z + b.z)
      normal.y += (a.z - b.z) * (a.x + b.x)
      normal.z += (a.x - b.x) * (a.y + b.y)
    }
    if (normal.lengthSq() < 1e-16) {
      unresolvedEdges += edgeCount
      continue
    }
    normal.normalize()
    const u = new Vector3()
      .crossVectors(normal, Math.abs(normal.z) < 0.9 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0))
      .normalize()
    const v = new Vector3().crossVectors(normal, u)
    const contour = loop.map((p) => new Vector2(p.dot(u), p.dot(v)))
    const triangles = ShapeUtils.triangulateShape(contour, [])
    if (triangles.length !== loop.length - 2) {
      // A nonplanar rim can overlap in projection. A display-only fan preserves
      // every original boundary edge, including collinear subdivisions.
      const center = loop.reduce((sum, p) => sum.add(p), new Vector3()).divideScalar(loop.length)
      for (let i = 0; i < loop.length; i++) {
        for (const p of [loop[i]!, loop[(i + 1) % loop.length]!, center]) output.push(p.x, p.y, p.z)
      }
      closedLoops++
      fallbackLoops++
      continue
    }
    for (const triangle of triangles) {
      const [a, b, c] = triangle.map((id) => loop[id]!) as [Vector3, Vector3, Vector3]
      const winding = new Vector3()
        .subVectors(b, a)
        .cross(new Vector3().subVectors(c, a))
        .dot(normal)
      for (const p of winding >= 0 ? [a, b, c] : [a, c, b]) output.push(p.x, p.y, p.z)
    }
    closedLoops++
  }
  const geometry = output.length
    ? new BufferGeometry().setAttribute('position', new Float32BufferAttribute(output, 3))
    : null
  geometry?.computeVertexNormals()
  return { geometry, closedLoops, fallbackLoops, unresolvedEdges }
}
