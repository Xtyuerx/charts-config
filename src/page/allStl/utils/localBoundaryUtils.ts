type Edge = { fromKey: string; toKey: string; faceIndices: number[] }
type FaceEdge = { edgeKey: string; neighbor: number | null }

// Recover the actual ordered mesh vertices; branched/disconnected boundaries are not editable.
export function orderedBoundaryVertices(
  keys: string[],
  edges: Map<string, Edge>,
  allowExistingJunctions = false,
) {
  const first = edges.get(keys[0] ?? '')
  const second = edges.get(keys[1] ?? '')
  if (!first || !second) return null
  const shared = [first.fromKey, first.toKey].filter(
    (v) => v === second.fromKey || v === second.toKey,
  )
  if (shared.length !== 1) return null
  const vertices = [first.fromKey === shared[0] ? first.toKey : first.fromKey]
  for (const key of keys) {
    const edge = edges.get(key)
    const last = vertices[vertices.length - 1]
    if (!edge || (edge.fromKey !== last && edge.toKey !== last)) return null
    vertices.push(edge.fromKey === last ? edge.toKey : edge.fromKey)
  }
  const interior = vertices.slice(0, vertices[0] === vertices[vertices.length - 1] ? -1 : undefined)
  return allowExistingJunctions || new Set(interior).size === interior.length ? vertices : null
}

// Only the small components enclosed BETWEEN the old and new arcs may change labels.
// All other components, including disconnected pieces of the same tooth, stay untouched.
export function relabelBoundaryStrip(
  labels: number[],
  faceEdges: FaceEdge[][],
  edges: Map<string, Edge>,
  oldArc: string[],
  newArc: string[],
  toothId: number,
  maxFaces: number,
) {
  const oldSet = new Set(oldArc)
  const newSet = new Set(newArc)
  const removed = new Set(oldArc.filter((key) => !newSet.has(key)))
  const added = new Set(newArc.filter((key) => !oldSet.has(key)))
  const changes = new Map<number, number>()
  if (!removed.size && !added.size) return changes
  const barrier = new Set([...oldArc, ...newArc])
  const visited = new Set<number>()
  for (const key of removed) {
    for (const seed of edges.get(key)?.faceIndices ?? []) {
      if (visited.has(seed)) continue
      const component = [seed]
      visited.add(seed)
      let open = false
      let touchesNew = false
      const targets = new Set<number>()
      const originals = new Set<number>()
      for (let cursor = 0; cursor < component.length; cursor++) {
        const face = component[cursor]!
        originals.add(labels[face]!)
        for (const ref of faceEdges[face] ?? []) {
          if (ref.neighbor == null || edges.get(ref.edgeKey)?.faceIndices.length !== 2) {
            open = true
            continue
          }
          if (barrier.has(ref.edgeKey)) {
            if (added.has(ref.edgeKey)) touchesNew = true
            if (removed.has(ref.edgeKey)) targets.add(labels[ref.neighbor]!)
            continue
          }
          if (!visited.has(ref.neighbor)) {
            visited.add(ref.neighbor)
            component.push(ref.neighbor)
          }
        }
      }
      if (open || !touchesNew || component.length > maxFaces) continue
      // A mixed strip indicates a junction or crossing another tooth's boundary.
      if (originals.size !== 1 || targets.size !== 1) return null
      const original = [...originals][0]!
      const target = [...targets][0]!
      if (original === target) continue
      if (original !== toothId && target !== toothId) return null
      component.forEach((face) => changes.set(face, target))
    }
  }
  return changes.size && changes.size <= maxFaces ? changes : null
}
