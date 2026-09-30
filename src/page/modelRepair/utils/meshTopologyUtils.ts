import * as THREE from 'three'

export type LogicalMeshTopology = {
  groups: number[][]
  vertexToGroup: Int32Array
  neighbors: number[][]
  boundaryGroups: Set<number>
}

function positionKey(x: number, y: number, z: number, tolerance: number) {
  return `${Math.round(x / tolerance)},${Math.round(y / tolerance)},${Math.round(z / tolerance)}`
}

export function buildLogicalMeshTopology(
  geometry: THREE.BufferGeometry,
  tolerance = 1e-5,
): LogicalMeshTopology {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const groups: number[][] = []
  const vertexToGroup = new Int32Array(position.count)
  const keyToGroup = new Map<string, number>()

  for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex++) {
    const key = positionKey(
      position.getX(vertexIndex),
      position.getY(vertexIndex),
      position.getZ(vertexIndex),
      tolerance,
    )
    let groupIndex = keyToGroup.get(key)
    if (groupIndex === undefined) {
      groupIndex = groups.length
      keyToGroup.set(key, groupIndex)
      groups.push([])
    }
    const group = groups[groupIndex]
    if (!group) throw new Error(`Logical group ${groupIndex} was not initialized.`)
    group.push(vertexIndex)
    vertexToGroup[vertexIndex] = groupIndex
  }

  const neighborSets = groups.map(() => new Set<number>())
  const edgeCounts = new Map<string, number>()
  for (let base = 0; base + 2 < position.count; base += 3) {
    const faceGroups = [vertexToGroup[base], vertexToGroup[base + 1], vertexToGroup[base + 2]]

    for (const [left, right] of [
      [0, 1],
      [1, 2],
      [2, 0],
    ] as const) {
      const a = faceGroups[left]
      const b = faceGroups[right]
      if (a === undefined || b === undefined || a === b) continue

      const aNeighbors = neighborSets[a]
      const bNeighbors = neighborSets[b]
      if (!aNeighbors || !bNeighbors) continue
      aNeighbors.add(b)
      bNeighbors.add(a)
      const edgeKey = a < b ? `${a}:${b}` : `${b}:${a}`
      edgeCounts.set(edgeKey, (edgeCounts.get(edgeKey) ?? 0) + 1)
    }
  }

  const boundaryGroups = new Set<number>()
  edgeCounts.forEach((count, key) => {
    if (count !== 1) return
    const [a, b] = key.split(':').map(Number)
    if (a === undefined || b === undefined) return
    boundaryGroups.add(a)
    boundaryGroups.add(b)
  })

  return {
    groups,
    vertexToGroup,
    neighbors: neighborSets.map((set) => [...set]),
    boundaryGroups,
  }
}

export function readLogicalPosition(
  geometry: THREE.BufferGeometry,
  topology: LogicalMeshTopology,
  groupIndex: number,
) {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const group = topology.groups[groupIndex]
  const vertexIndex = group?.[0]
  if (vertexIndex === undefined) throw new Error(`Logical group ${groupIndex} has no vertices.`)
  return new THREE.Vector3(
    position.getX(vertexIndex),
    position.getY(vertexIndex),
    position.getZ(vertexIndex),
  )
}

export function writeLogicalPosition(
  geometry: THREE.BufferGeometry,
  topology: LogicalMeshTopology,
  groupIndex: number,
  value: THREE.Vector3,
) {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const group = topology.groups[groupIndex]
  if (!group) throw new Error(`Logical group ${groupIndex} does not exist.`)
  for (const vertexIndex of group) {
    position.setXYZ(vertexIndex, value.x, value.y, value.z)
  }
  position.needsUpdate = true
}
