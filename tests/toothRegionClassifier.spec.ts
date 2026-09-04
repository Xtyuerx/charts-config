import { expect, test } from '@playwright/test'
import * as THREE from 'three'

import { createToothBoundary } from '../src/page/toothSegmentationTest/utils/toothBoundaryEditorUtils'
import {
  buildConfirmedToothGeometry,
  buildSegmentationExportPayload,
  buildToothRegionTopology,
  classifyToothRegion,
  commitConfirmedToothTransaction,
  prepareConfirmedToothRegion,
} from '../src/page/toothSegmentationTest/utils/toothRegionClassifier'

function createTwoFaceGeometry() {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        0, 0, 0,
        1, 0, 0,
        1, 1, 0,
        0, 0, 0,
        1, 1, 0,
        0, 1, 0,
      ],
      3,
    ),
  )
  return geometry
}

function createBoundarySplitGeometryWithUnrelatedIsland() {
  const a: [number, number, number] = [0, 0, 0]
  const b: [number, number, number] = [1, 0, 0]
  const c: [number, number, number] = [1, 1, 0]
  const d: [number, number, number] = [0, 1, 0]
  const outerA: [number, number, number] = [-1, -1, 0]
  const outerB: [number, number, number] = [2, -1, 0]
  const outerC: [number, number, number] = [2, 2, 0]
  const outerD: [number, number, number] = [-1, 2, 0]
  const islandA: [number, number, number] = [10, 0, 0]
  const islandB: [number, number, number] = [11, 0, 0]
  const islandC: [number, number, number] = [10, 1, 0]
  const triangles = [
    a, b, c,
    a, c, d,
    a, b, outerB,
    a, outerB, outerA,
    b, c, outerC,
    b, outerC, outerB,
    c, d, outerD,
    c, outerD, outerC,
    d, a, outerA,
    d, outerA, outerD,
    islandA, islandB, islandC,
  ]
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(triangles.flat(), 3))
  return {
    boundary: createToothBoundary(11, [
      new THREE.Vector3(...a),
      new THREE.Vector3(...b),
      new THREE.Vector3(...c),
      new THREE.Vector3(...d),
    ]),
    geometry,
  }
}

test('classifies the closed surface-boundary interior without original tooth labels', () => {
  const geometry = createTwoFaceGeometry()
  const topology = buildToothRegionTopology(geometry)
  const boundary = createToothBoundary(11, [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(1, 1, 0),
  ])

  const region = classifyToothRegion(topology, boundary)

  expect(region.toothId).toBe(11)
  expect(region.triangleIndices).toEqual([0])
  expect(region.blockedEdgeCount).toBe(3)
})

test('chooses only a boundary-adjacent side instead of an unrelated smaller STL component', () => {
  const { geometry, boundary } = createBoundarySplitGeometryWithUnrelatedIsland()

  const region = classifyToothRegion(buildToothRegionTopology(geometry), boundary)

  expect(region.triangleIndices).toEqual([0, 1])
})

test('rejects a boundary that does not split its source surface component', () => {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
  )
  const boundary = createToothBoundary(11, [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0),
  ])

  expect(() => classifyToothRegion(buildToothRegionTopology(geometry), boundary)).toThrow(
    'Boundary 未分割',
  )
})

test('replaces the previous region for the same tooth', () => {
  expect(prepareConfirmedToothRegion([11, 11, 0], 11, [2])).toEqual([0, 0, 11])
})

test('rejects a region that overlaps another confirmed tooth', () => {
  const labels = [0, 12]

  expect(() => prepareConfirmedToothRegion(labels, 11, [0, 1])).toThrow(
    '牙号 12（1 个三角形）',
  )
  expect(labels).toEqual([0, 12])
})

test('rolls back labels, state, and mesh references when a prepared commit callback fails', () => {
  const previousLabels = [11, 0]
  const nextLabels = [0, 11]
  const previousState = { status: 'confirmed' }
  const nextState = { status: 'confirmed-next' }
  const oldMesh = { id: 'old' }
  const newMesh = { id: 'new' }
  const meshes = new Map([['lower:11', oldMesh]])
  let labels = previousLabels
  let state = previousState
  let attached = false
  let removed = false
  const source = {
    add(mesh: typeof newMesh) {
      attached = mesh === newMesh
      throw new Error('source mesh add failed')
    },
    remove(mesh: typeof newMesh) {
      if (mesh === newMesh) removed = true
    },
  }

  expect(() =>
    commitConfirmedToothTransaction(
      () => {
        labels = nextLabels
        state = nextState
        meshes.set('lower:11', newMesh)
        source.add(newMesh)
      },
      () => {
        if (attached) source.remove(newMesh)
        labels = previousLabels
        state = previousState
        meshes.set('lower:11', oldMesh)
      },
      () => {
        throw new Error('old mesh cleanup must not run after rollback')
      },
    ),
  ).toThrow('source mesh add failed')

  expect(labels).toBe(previousLabels)
  expect(state).toBe(previousState)
  expect(meshes.get('lower:11')).toBe(oldMesh)
  expect(removed).toBe(true)
})

test('builds an independent non-indexed confirmed geometry without mutating the STL geometry', () => {
  const source = new THREE.BufferGeometry()
  const positions = new THREE.Float32BufferAttribute(
    [
      0, 0, 0,
      1, 0, 0,
      1, 1, 0,
      0, 1, 0,
    ],
    3,
  )
  const index = new THREE.Uint16BufferAttribute([0, 1, 2, 0, 2, 3], 1)
  source.setAttribute('position', positions)
  source.setIndex(index)
  const sourcePositionArray = positions.array
  const sourceIndexArray = index.array
  const sourcePositionVersion = positions.version
  const sourceIndexVersion = index.version

  const geometry = buildConfirmedToothGeometry(source, [1])

  expect(geometry.index).toBeNull()
  expect(geometry.getAttribute('position').count).toBe(3)
  expect(Array.from(geometry.getAttribute('position').array)).toEqual([
    0, 0, 0,
    1, 1, 0,
    0, 1, 0,
  ])
  expect(geometry.getAttribute('normal').count).toBe(3)
  expect(source.getAttribute('position')).toBe(positions)
  expect(source.index).toBe(index)
  expect(positions.array).toBe(sourcePositionArray)
  expect(index.array).toBe(sourceIndexArray)
  expect(positions.version).toBe(sourcePositionVersion)
  expect(index.version).toBe(sourceIndexVersion)
})

test('exports boundaries together with per-jaw triangle labels and tooth indices', () => {
  const boundary = createToothBoundary(11, [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0),
  ])

  expect(
    buildSegmentationExportPayload(new Map([[11, boundary]]), {
      upper: [11, 0, 11],
      lower: [0, 31],
    }),
  ).toEqual({
    boundaries: [boundary],
    jaws: {
      upper: {
        triangleLabels: [11, 0, 11],
        teeth: [{ toothId: 11, triangleIndices: [0, 2] }],
      },
      lower: {
        triangleLabels: [0, 31],
        teeth: [{ toothId: 31, triangleIndices: [1] }],
      },
    },
  })
})
