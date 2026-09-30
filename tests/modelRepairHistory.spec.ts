import { expect, test } from '@playwright/test'
import * as THREE from 'three'

import {
  applyHistoryCommand,
  createSculptHistory,
  type SculptHistoryCommand,
} from '../src/page/modelRepair/utils/historyUtils'
import { buildLogicalMeshTopology } from '../src/page/modelRepair/utils/meshTopologyUtils'

function createCommand(
  jaw: SculptHistoryCommand['jaw'],
  logicalGroupIndices: number[],
  before: number[],
  after: number[],
  byteLength = 24,
): SculptHistoryCommand {
  return {
    jaw,
    logicalGroupIndices: Uint32Array.from(logicalGroupIndices),
    before: Float32Array.from(before),
    after: Float32Array.from(after),
    byteLength,
  }
}

function createHistoryGeometry() {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3),
  )
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return { geometry, topology: buildLogicalMeshTopology(geometry) }
}

test('undoes and redoes one stroke and clears redo after a new stroke', () => {
  const history = createSculptHistory({ maxOperations: 50, maxBytes: 128 * 1024 * 1024 })
  const first = createCommand('upper', [2], [0, 0, 0], [0, 0, 1])
  const second = createCommand('upper', [2], [0, 0, 1], [0, 0, 2])

  history.push(first)
  expect(history.undo()).toBe(first)
  expect(history.canRedo()).toBe(true)
  expect(history.redo()).toBe(first)
  expect(history.undo()).toBe(first)
  history.push(second)
  expect(history.canRedo()).toBe(false)
  expect(history.canUndo()).toBe(true)
  expect(history.undo()).toBe(second)
})

test('returns null for empty undo and redo stacks', () => {
  const history = createSculptHistory()

  expect(history.undo()).toBeNull()
  expect(history.redo()).toBeNull()
  expect(history.canUndo()).toBe(false)
  expect(history.canRedo()).toBe(false)
})

test('keeps only the newest commands when maxOperations is reached', () => {
  const history = createSculptHistory({ maxOperations: 2, maxBytes: 128 * 1024 * 1024 })
  const first = createCommand('upper', [0], [0, 0, 0], [0, 0, 1])
  const second = createCommand('upper', [1], [0, 0, 0], [0, 0, 1])
  const third = createCommand('upper', [2], [0, 0, 0], [0, 0, 1])

  history.push(first)
  history.push(second)
  history.push(third)

  expect(history.undo()).toBe(third)
  expect(history.undo()).toBe(second)
  expect(history.undo()).toBeNull()
})

test('removes the oldest commands until maxBytes is satisfied', () => {
  const history = createSculptHistory({ maxOperations: 50, maxBytes: 56 })
  const first = createCommand('upper', [0], [0, 0, 0], [0, 0, 1], 6)
  const second = createCommand('upper', [1], [0, 0, 0], [0, 0, 1], 6)
  const third = createCommand('upper', [2], [0, 0, 0], [0, 0, 1], 6)

  history.push(first)
  history.push(second)
  history.push(third)

  expect(history.undo()).toBe(third)
  expect(history.undo()).toBe(second)
  expect(history.undo()).toBeNull()
})

test('does not retain one command larger than maxBytes', () => {
  const history = createSculptHistory({ maxOperations: 50, maxBytes: 27 })
  const command = createCommand('lower', [0], [0, 0, 0], [0, 0, -1], 6)

  history.push(command)

  expect(history.canUndo()).toBe(false)
  expect(history.undo()).toBeNull()
})

test('uses typed array bytes when reported byteLength is low, NaN, or negative', () => {
  for (const byteLength of [1, Number.NaN, -1]) {
    const history = createSculptHistory({ maxOperations: 50, maxBytes: 27 })
    const command = createCommand('upper', [0], [0, 0, 0], [0, 0, 1], byteLength)

    history.push(command)

    expect(history.canUndo()).toBe(false)
    expect(history.undo()).toBeNull()
  }
})

test('captures safe byte accounting when the reported byteLength is later mutated', () => {
  const history = createSculptHistory({ maxOperations: 50, maxBytes: 55 })
  const first = createCommand('upper', [0], [0, 0, 0], [0, 0, 1], 28)
  const second = createCommand('upper', [1], [0, 0, 0], [0, 0, 1], 28)

  history.push(first)
  first.byteLength = Number.NaN
  history.push(second)

  expect(history.undo()).toBe(second)
  expect(history.undo()).toBeNull()
})

test('keeps history usable when reported byte lengths would overflow a numeric sum', () => {
  const history = createSculptHistory({ maxOperations: 50, maxBytes: Number.MAX_VALUE })
  const first = createCommand('upper', [0], [0, 0, 0], [0, 0, 1], Number.MAX_VALUE)
  const second = createCommand('upper', [1], [0, 0, 0], [0, 0, 1], Number.MAX_VALUE)
  const small = createCommand('lower', [2], [0, 0, 0], [0, 0, -1], 28)

  history.push(first)
  history.push(second)

  expect(history.undo()).toBe(second)
  history.push(small)
  expect(history.undo()).toBe(small)
  expect(history.undo()).toBeNull()
})

test('removes a max-sized old command before retaining a new small command', () => {
  const history = createSculptHistory({ maxOperations: 50, maxBytes: Number.MAX_VALUE })
  const old = createCommand('upper', [0], [0, 0, 0], [0, 0, 1], Number.MAX_VALUE)
  const small = createCommand('lower', [1], [0, 0, 0], [0, 0, -1], 28)

  history.push(old)
  history.push(small)

  expect(history.undo()).toBe(small)
  expect(history.undo()).toBeNull()
})

test('rounds fractional byte costs up and fractional capacity down', () => {
  const history = createSculptHistory({ maxOperations: 50, maxBytes: 57.9 })
  const first = createCommand('upper', [0], [0, 0, 0], [0, 0, 1], 28.1)
  const second = createCommand('upper', [1], [0, 0, 0], [0, 0, 1], 28.1)

  history.push(first)
  history.push(second)

  expect(history.undo()).toBe(second)
  expect(history.undo()).toBeNull()
})

test('retains no commands when maxOperations is zero', () => {
  const history = createSculptHistory({ maxOperations: 0, maxBytes: 128 * 1024 * 1024 })

  history.push(createCommand('upper', [0], [0, 0, 0], [0, 0, 1]))

  expect(history.canUndo()).toBe(false)
  expect(history.undo()).toBeNull()
})

test('retains no commands when maxBytes is zero', () => {
  const history = createSculptHistory({ maxOperations: 50, maxBytes: 0 })

  history.push(createCommand('upper', [0], [0, 0, 0], [0, 0, 1]))

  expect(history.canUndo()).toBe(false)
  expect(history.undo()).toBeNull()
})

test('clear removes both undo and redo history', () => {
  const history = createSculptHistory()
  const command = createCommand('lower', [0], [0, 0, 0], [0, 0, -1])

  history.push(command)
  expect(history.undo()).toBe(command)
  history.clear()

  expect(history.canUndo()).toBe(false)
  expect(history.canRedo()).toBe(false)
  expect(history.redo()).toBeNull()
})

test('uses defaults for empty and invalid options without discarding a command', () => {
  const emptyOptionsHistory = createSculptHistory({})
  const invalidOptionsHistory = createSculptHistory({ maxOperations: -1, maxBytes: Number.NaN })
  const emptyOptionsCommand = createCommand('upper', [0], [0, 0, 0], [0, 0, 1])
  const invalidOptionsCommand = createCommand('lower', [0], [0, 0, 0], [0, 0, -1])

  emptyOptionsHistory.push(emptyOptionsCommand)
  invalidOptionsHistory.push(invalidOptionsCommand)

  expect(emptyOptionsHistory.undo()).toBe(emptyOptionsCommand)
  expect(invalidOptionsHistory.undo()).toBe(invalidOptionsCommand)
})

test('applies after and before positions to every physical vertex in each logical group', () => {
  const { geometry, topology } = createHistoryGeometry()
  const duplicatedGroup = topology.vertexToGroup[1]
  const command = createCommand('upper', [duplicatedGroup], [1, 0, 0], [1, 0, 1])
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const positionVersionBefore = position.version
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute
  const normalVersionBefore = normal.version

  applyHistoryCommand(geometry, topology, command, 'after')

  for (const vertexIndex of topology.groups[duplicatedGroup] ?? []) {
    expect(position.getX(vertexIndex)).toBeCloseTo(1)
    expect(position.getY(vertexIndex)).toBeCloseTo(0)
    expect(position.getZ(vertexIndex)).toBeCloseTo(1)
  }
  expect(position.version).toBeGreaterThan(positionVersionBefore)
  expect(normal.version).toBeGreaterThan(normalVersionBefore)
  expect(geometry.boundingBox?.min.z).toBeCloseTo(0)
  expect(geometry.boundingBox?.max.z).toBeCloseTo(1)
  expect(geometry.boundingSphere?.center.z).toBeCloseTo(0.5)
  expect(geometry.boundingSphere?.radius).toBeGreaterThan(0)

  const normalVersionAfter = normal.version
  applyHistoryCommand(geometry, topology, command, 'before')

  for (const vertexIndex of topology.groups[duplicatedGroup] ?? []) {
    expect(position.getX(vertexIndex)).toBeCloseTo(1)
    expect(position.getY(vertexIndex)).toBeCloseTo(0)
    expect(position.getZ(vertexIndex)).toBeCloseTo(0)
  }
  expect(geometry.boundingBox?.max.z).toBeCloseTo(0)
  expect(geometry.boundingSphere?.center.z).toBeCloseTo(0)
  expect(normal.version).toBeGreaterThan(normalVersionAfter)
})

test('rejects short before coordinates before writing the requested after side', () => {
  const { geometry, topology } = createHistoryGeometry()
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const positionsBefore = Array.from(position.array)
  const command = createCommand(
    'upper',
    [topology.vertexToGroup[0], topology.vertexToGroup[1]],
    [0, 0, 0],
    [4, 5, 6, 7, 8, 9],
  )

  let error: unknown
  try {
    applyHistoryCommand(geometry, topology, command, 'after')
  } catch (caught) {
    error = caught
  }

  expect(error).toBeInstanceOf(RangeError)
  expect((error as Error).message).toContain('before length must equal 6')
  expect(Array.from(position.array)).toEqual(positionsBefore)
})

test('rejects long after coordinates before writing the requested before side', () => {
  const { geometry, topology } = createHistoryGeometry()
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const positionsBefore = Array.from(position.array)
  const command = createCommand(
    'lower',
    [topology.vertexToGroup[0], topology.vertexToGroup[1]],
    [4, 5, 6, 7, 8, 9],
    [0, 0, 0, 1, 0, 0, 2, 0, 0],
  )

  let error: unknown
  try {
    applyHistoryCommand(geometry, topology, command, 'before')
  } catch (caught) {
    error = caught
  }

  expect(error).toBeInstanceOf(RangeError)
  expect((error as Error).message).toContain('after length must equal 6')
  expect(Array.from(position.array)).toEqual(positionsBefore)
})
