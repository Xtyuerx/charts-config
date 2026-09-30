import * as THREE from 'three'
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
  type MeshBVH,
} from 'three-mesh-bvh'

import {
  readLogicalPosition,
  type LogicalMeshTopology,
  writeLogicalPosition,
} from './meshTopologyUtils'

type RepairBufferGeometry = THREE.BufferGeometry & {
  boundsTree?: MeshBVH
  computeBoundsTree?: typeof computeBoundsTree
  disposeBoundsTree?: typeof disposeBoundsTree
}

export type SculptTool = 'raise' | 'lower' | 'smooth'

export type SculptSample = {
  geometry: THREE.BufferGeometry
  topology: LogicalMeshTopology
  groupIndices: Iterable<number>
  center: THREE.Vector3
  radius: number
  strength: number
  tool: SculptTool
}

export function calculateBrushFalloff(distance: number, radius: number) {
  if (radius <= 0 || distance >= radius) return 0

  const value = 1 - Math.max(0, distance) / radius
  return value * value * (3 - 2 * value)
}

export function enableSculptRaycast(mesh: THREE.Mesh) {
  mesh.raycast = acceleratedRaycast
}

export function collectBrushGroupsFromBvh(
  geometry: RepairBufferGeometry,
  topology: LogicalMeshTopology,
  center: THREE.Vector3,
  radius: number,
) {
  if (radius <= 0) return []

  if (!geometry.boundsTree) {
    geometry.computeBoundsTree ??= computeBoundsTree
    geometry.disposeBoundsTree ??= disposeBoundsTree
    geometry.computeBoundsTree()
  }

  const groups = new Set<number>()
  const sphere = new THREE.Sphere(center, radius)
  geometry.boundsTree?.shapecast({
    intersectsBounds: (box) => sphere.intersectsBox(box),
    intersectsTriangle: (_triangle, triangleIndex) => {
      const base = triangleIndex * 3
      for (let offset = 0; offset < 3; offset++) {
        const vertexIndex = geometry.index?.getX(base + offset) ?? base + offset
        const groupIndex = topology.vertexToGroup[vertexIndex]
        if (groupIndex !== undefined && groupIndex >= 0) groups.add(groupIndex)
      }
      return false
    },
  })

  return [...groups]
}

function getAveragedLogicalNormal(
  geometry: THREE.BufferGeometry,
  topology: LogicalMeshTopology,
  groupIndex: number,
) {
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals()

  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute
  const group = topology.groups[groupIndex]
  if (!group || group.length === 0) return null

  const average = new THREE.Vector3()
  for (const vertexIndex of group) {
    average.add(
      new THREE.Vector3(
        normal.getX(vertexIndex),
        normal.getY(vertexIndex),
        normal.getZ(vertexIndex),
      ),
    )
  }

  return average.lengthSq() > 1e-12 ? average.normalize() : null
}

function isValidGroup(topology: LogicalMeshTopology, groupIndex: number) {
  if (groupIndex < 0 || groupIndex >= topology.groups.length) return false
  const group = topology.groups[groupIndex]
  return Boolean(group && group.length > 0)
}

function applyDirectionalSample(sample: SculptSample, groupIndices: number[]) {
  const changed = new Set<number>()
  const direction = sample.tool === 'raise' ? 1 : -1

  for (const groupIndex of groupIndices) {
    const current = readLogicalPosition(sample.geometry, sample.topology, groupIndex)
    const falloff = calculateBrushFalloff(current.distanceTo(sample.center), sample.radius)
    if (falloff === 0) continue

    const normal = getAveragedLogicalNormal(sample.geometry, sample.topology, groupIndex)
    if (!normal) continue

    const next = current.addScaledVector(normal, direction * sample.strength * falloff)
    if (
      next.distanceToSquared(readLogicalPosition(sample.geometry, sample.topology, groupIndex)) <=
      1e-12
    )
      continue

    writeLogicalPosition(sample.geometry, sample.topology, groupIndex, next)
    changed.add(groupIndex)
  }

  if (changed.size > 0) {
    sample.geometry.computeVertexNormals()
    const normal = sample.geometry.getAttribute('normal') as THREE.BufferAttribute | undefined
    if (normal) normal.needsUpdate = true
  }

  return changed
}

function applySmoothSample(sample: SculptSample, groupIndices: number[]) {
  const oldPositions = new Map<number, THREE.Vector3>()
  const readOldPosition = (groupIndex: number) => {
    let position = oldPositions.get(groupIndex)
    if (!position) {
      position = readLogicalPosition(sample.geometry, sample.topology, groupIndex)
      oldPositions.set(groupIndex, position)
    }
    return position
  }

  for (const groupIndex of groupIndices) {
    readOldPosition(groupIndex)
    for (const neighborIndex of sample.topology.neighbors[groupIndex] ?? []) {
      if (isValidGroup(sample.topology, neighborIndex)) readOldPosition(neighborIndex)
    }
  }

  const updates: Array<{ groupIndex: number; value: THREE.Vector3 }> = []
  for (const groupIndex of groupIndices) {
    const neighbors = sample.topology.neighbors[groupIndex] ?? []
    if (neighbors.length === 0) continue

    const current = readOldPosition(groupIndex)
    const falloff = calculateBrushFalloff(current.distanceTo(sample.center), sample.radius)
    if (falloff === 0) continue

    const neighborAverage = new THREE.Vector3()
    for (const neighborIndex of neighbors) neighborAverage.add(readOldPosition(neighborIndex))
    neighborAverage.multiplyScalar(1 / neighbors.length)

    const boundaryFactor = sample.topology.boundaryGroups.has(groupIndex) ? 0.25 : 1
    const influence = THREE.MathUtils.clamp(sample.strength * falloff * boundaryFactor, 0, 1)
    const next = current.clone().lerp(neighborAverage, influence)
    if (next.distanceToSquared(current) > 1e-12) updates.push({ groupIndex, value: next })
  }

  const changed = new Set<number>()
  for (const update of updates) {
    writeLogicalPosition(sample.geometry, sample.topology, update.groupIndex, update.value)
    changed.add(update.groupIndex)
  }
  return changed
}

export function applySculptSample(sample: SculptSample) {
  const groupIndices = [...new Set(sample.groupIndices)].filter((groupIndex) =>
    isValidGroup(sample.topology, groupIndex),
  )

  return sample.tool === 'smooth'
    ? applySmoothSample(sample, groupIndices)
    : applyDirectionalSample(sample, groupIndices)
}
