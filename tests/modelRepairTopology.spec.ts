import { expect, test } from '@playwright/test'
import * as THREE from 'three'

import {
  buildLogicalMeshTopology,
  readLogicalPosition,
  writeLogicalPosition,
} from '../src/page/modelRepair/utils/meshTopologyUtils'

function createTwoTriangleGeometry() {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3),
  )
  return geometry
}

function createClosedAndOpenGeometry() {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 0,
        0, 1, 0, 1, 0, 3, 0, 0, 4, 0, 0, 3, 1, 0,
      ],
      3,
    ),
  )
  return geometry
}

test('groups duplicate STL vertices and builds logical adjacency', () => {
  const topology = buildLogicalMeshTopology(createTwoTriangleGeometry())

  expect(topology.groups).toHaveLength(4)
  expect(topology.vertexToGroup[1]).toBe(topology.vertexToGroup[3])
  expect(topology.vertexToGroup[2]).toBe(topology.vertexToGroup[5])
  expect(topology.neighbors[topology.vertexToGroup[1]]).toEqual(
    expect.arrayContaining([topology.vertexToGroup[0], topology.vertexToGroup[4]]),
  )
})

test('derives boundaries from logical edges used by one triangle', () => {
  const topology = buildLogicalMeshTopology(createClosedAndOpenGeometry())
  const sharedFirstGroup = topology.vertexToGroup[0]
  const sharedSecondGroup = topology.vertexToGroup[1]

  expect(topology.boundaryGroups.has(sharedFirstGroup)).toBe(false)
  expect(topology.boundaryGroups.has(sharedSecondGroup)).toBe(false)
  expect(topology.boundaryGroups).toEqual(
    new Set([topology.vertexToGroup[12], topology.vertexToGroup[13], topology.vertexToGroup[14]]),
  )
})

test('reads and writes every physical vertex in a logical group', () => {
  const geometry = createTwoTriangleGeometry()
  const topology = buildLogicalMeshTopology(geometry)
  const duplicatedGroup = topology.vertexToGroup[1]
  const nextPosition = new THREE.Vector3(4, 5, 6)

  writeLogicalPosition(geometry, topology, duplicatedGroup, nextPosition)

  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  for (const vertexIndex of topology.groups[duplicatedGroup]) {
    expect(position.getX(vertexIndex)).toBe(4)
    expect(position.getY(vertexIndex)).toBe(5)
    expect(position.getZ(vertexIndex)).toBe(6)
  }
  expect(readLogicalPosition(geometry, topology, duplicatedGroup)).toEqual(nextPosition)
})
