import { expect, test } from '@playwright/test'
import * as THREE from 'three'

import {
  buildLogicalMeshTopology,
  readLogicalPosition,
  type LogicalMeshTopology,
} from '../src/page/modelRepair/utils/meshTopologyUtils'
import {
  applySculptSample,
  calculateBrushFalloff,
  collectBrushGroupsFromBvh,
  enableSculptRaycast,
} from '../src/page/modelRepair/utils/sculptUtils'

function createFlatTwoTriangleMesh() {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3),
  )
  geometry.setAttribute('label', new THREE.Uint16BufferAttribute([3, 4, 5, 4, 6, 5], 1))
  geometry.computeVertexNormals()
  const topology = buildLogicalMeshTopology(geometry)

  return {
    geometry,
    topology,
    duplicatedGroup: topology.vertexToGroup[1],
  }
}

function createSmoothingMesh() {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, -1, 0, 0, 0, 0, 1, -1, 0, 0, 0, -1, 0, 4, 0, 0,
        5, 0, 0, 4, 1, 0,
      ],
      3,
    ),
  )
  const topology = buildLogicalMeshTopology(geometry)

  return {
    geometry,
    topology,
    centerGroup: topology.vertexToGroup[0],
    boundaryGroup: topology.vertexToGroup[1],
    outsideGroup: topology.vertexToGroup[9],
  }
}

function createFoldedTwoTriangleMesh() {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1], 3),
  )
  geometry.computeVertexNormals()
  const topology = buildLogicalMeshTopology(geometry)

  return {
    geometry,
    topology,
    foldedGroup: topology.vertexToGroup[0],
  }
}

function createIndexedTopology(vertexCount: number): LogicalMeshTopology {
  return {
    groups: Array.from({ length: vertexCount }, (_, vertexIndex) => [vertexIndex]),
    vertexToGroup: Int32Array.from({ length: vertexCount }, (_, vertexIndex) => vertexIndex),
    neighbors: Array.from({ length: vertexCount }, () => []),
    boundaryGroups: new Set<number>(),
  }
}

function createBvhGeometry(indexed: boolean) {
  const geometry = new THREE.BufferGeometry()
  const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]

  if (indexed) {
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setIndex([0, 1, 2, 1, 3, 2])
    return { geometry, topology: createIndexedTopology(4) }
  }

  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3),
  )
  return { geometry, topology: buildLogicalMeshTopology(geometry) }
}

test('uses smooth falloff and moves duplicate vertices along averaged normal', () => {
  expect(calculateBrushFalloff(0, 2)).toBe(1)
  expect(calculateBrushFalloff(2, 2)).toBe(0)
  expect(calculateBrushFalloff(3, 2)).toBe(0)

  const { geometry, topology, duplicatedGroup } = createFlatTwoTriangleMesh()
  const vertexCount = (geometry.getAttribute('position') as THREE.BufferAttribute).count
  const indexBefore = geometry.index?.array.slice()
  const labelsBefore = Array.from((geometry.getAttribute('label') as THREE.BufferAttribute).array)
  const changed = applySculptSample({
    geometry,
    topology,
    groupIndices: [duplicatedGroup],
    center: new THREE.Vector3(1, 0, 0),
    radius: 2,
    strength: 0.5,
    tool: 'raise',
  })

  expect(changed).toEqual(new Set([duplicatedGroup]))
  expect((geometry.getAttribute('position') as THREE.BufferAttribute).count).toBe(vertexCount)
  expect(geometry.index?.array).toEqual(indexBefore)
  expect(Array.from((geometry.getAttribute('label') as THREE.BufferAttribute).array)).toEqual(
    labelsBefore,
  )
  for (const vertexIndex of topology.groups[duplicatedGroup]) {
    expect(
      (geometry.getAttribute('position') as THREE.BufferAttribute).getZ(vertexIndex),
    ).toBeCloseTo(0.5)
  }
})

test('lowers duplicate vertices along their averaged normal', () => {
  const { geometry, topology, duplicatedGroup } = createFlatTwoTriangleMesh()

  const changed = applySculptSample({
    geometry,
    topology,
    groupIndices: [duplicatedGroup],
    center: new THREE.Vector3(1, 0, 0),
    radius: 2,
    strength: 0.5,
    tool: 'lower',
  })

  expect(changed).toEqual(new Set([duplicatedGroup]))
  for (const vertexIndex of topology.groups[duplicatedGroup]) {
    expect(
      (geometry.getAttribute('position') as THREE.BufferAttribute).getZ(vertexIndex),
    ).toBeCloseTo(-0.5)
  }
})

test('refreshes normals so consecutive directional samples follow the deformed surface', () => {
  const { geometry, topology, foldedGroup } = createFoldedTwoTriangleMesh()
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute
  const normalVersionBefore = normal.version

  applySculptSample({
    geometry,
    topology,
    groupIndices: [foldedGroup],
    center: new THREE.Vector3(0, 0, 0),
    radius: 1,
    strength: 0.4,
    tool: 'raise',
  })

  const afterFirst = readLogicalPosition(geometry, topology, foldedGroup)
  expect(afterFirst.x).toBeCloseTo(0.2828427)
  expect(afterFirst.y).toBeCloseTo(0)
  expect(afterFirst.z).toBeCloseTo(0.2828427)
  expect(normal.version).toBeGreaterThan(normalVersionBefore)

  applySculptSample({
    geometry,
    topology,
    groupIndices: [foldedGroup],
    center: afterFirst,
    radius: 1,
    strength: 0.4,
    tool: 'raise',
  })

  const afterSecond = readLogicalPosition(geometry, topology, foldedGroup)
  expect(afterSecond.x).toBeCloseTo(0.5454556)
  expect(afterSecond.y).toBeCloseTo(0.1485563)
  expect(afterSecond.z).toBeCloseTo(0.5454556)
  for (const vertexIndex of topology.groups[foldedGroup] ?? []) {
    const position = geometry.getAttribute('position') as THREE.BufferAttribute
    expect(position.getX(vertexIndex)).toBeCloseTo(afterSecond.x)
    expect(position.getY(vertexIndex)).toBeCloseTo(afterSecond.y)
    expect(position.getZ(vertexIndex)).toBeCloseTo(afterSecond.z)
  }
})

test('smooths from an old-position snapshot while protecting boundaries and outside groups', () => {
  const { geometry, topology, centerGroup, boundaryGroup, outsideGroup } = createSmoothingMesh()
  const centerBefore = readLogicalPosition(geometry, topology, centerGroup)
  const boundaryBefore = readLogicalPosition(geometry, topology, boundaryGroup)
  const outsideBefore = readLogicalPosition(geometry, topology, outsideGroup)

  const changed = applySculptSample({
    geometry,
    topology,
    groupIndices: [centerGroup, boundaryGroup, outsideGroup],
    center: new THREE.Vector3(0, 0, 1),
    radius: 1.5,
    strength: 0.5,
    tool: 'smooth',
  })

  const centerAfter = readLogicalPosition(geometry, topology, centerGroup)
  const boundaryAfter = readLogicalPosition(geometry, topology, boundaryGroup)
  expect(changed.has(centerGroup)).toBe(true)
  expect(changed.has(boundaryGroup)).toBe(true)
  expect(changed.has(outsideGroup)).toBe(false)
  expect(centerAfter.z).toBeLessThan(1)
  expect(centerAfter.z).toBeGreaterThan(0)
  expect(outsideBefore).toEqual(readLogicalPosition(geometry, topology, outsideGroup))
  expect(boundaryAfter.distanceTo(boundaryBefore)).toBeLessThan(
    centerAfter.distanceTo(centerBefore),
  )
})

test('leaves isolated logical groups unchanged when smoothing', () => {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 3, 0, 0], 3),
  )
  const topology = buildLogicalMeshTopology(geometry)
  const isolatedGroup = topology.vertexToGroup[3]
  const isolatedBefore = readLogicalPosition(geometry, topology, isolatedGroup)

  const changed = applySculptSample({
    geometry,
    topology,
    groupIndices: [isolatedGroup],
    center: isolatedBefore,
    radius: 1,
    strength: 1,
    tool: 'smooth',
  })

  expect(changed).toEqual(new Set())
  expect(readLogicalPosition(geometry, topology, isolatedGroup)).toEqual(isolatedBefore)
})

test('ignores missing entries in a sparse logical group array', () => {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1], 3))
  const topology: LogicalMeshTopology = {
    groups: [[0]],
    vertexToGroup: new Int32Array([0]),
    neighbors: [[]],
    boundaryGroups: new Set<number>(),
  }
  topology.groups.length = 2

  expect(
    applySculptSample({
      geometry,
      topology,
      groupIndices: [1],
      center: new THREE.Vector3(),
      radius: 1,
      strength: 1,
      tool: 'raise',
    }),
  ).toEqual(new Set())
})

test('collects unique logical groups from indexed and non-indexed BVH triangles', () => {
  for (const indexed of [false, true]) {
    const { geometry, topology } = createBvhGeometry(indexed)
    const groups = collectBrushGroupsFromBvh(
      geometry,
      topology,
      new THREE.Vector3(0.1, 0.1, 0),
      0.2,
    )

    expect(groups.sort((left, right) => left - right)).toEqual([0, 1, 2, 3])
    expect(geometry.boundsTree).toBeDefined()
  }
})

test('installs accelerated raycasting on the sculpt mesh', () => {
  const mesh = new THREE.Mesh(createFlatTwoTriangleMesh().geometry)
  const originalRaycast = mesh.raycast

  enableSculptRaycast(mesh)

  expect(mesh.raycast).not.toBe(originalRaycast)
})
