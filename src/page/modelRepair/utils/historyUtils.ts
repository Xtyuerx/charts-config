import * as THREE from 'three'

import { type RepairJaw } from './modelTransferUtils'
import { type LogicalMeshTopology, writeLogicalPosition } from './meshTopologyUtils'

export type SculptHistoryCommand = {
  jaw: RepairJaw
  logicalGroupIndices: Uint32Array
  before: Float32Array
  after: Float32Array
  byteLength: number
}

export type SculptHistoryOptions = {
  maxOperations: number
  maxBytes: number
}

const DEFAULT_OPTIONS: SculptHistoryOptions = {
  maxOperations: 50,
  maxBytes: 128 * 1024 * 1024,
}

type SculptHistoryEntry = {
  command: SculptHistoryCommand
  byteLength: bigint
}

function normalizeLimit(value: number | undefined, fallback: number, integer: boolean) {
  if (value === undefined || !Number.isFinite(value) || value < 0) return fallback
  return integer ? Math.floor(value) : value
}

function commandByteLength(command: SculptHistoryCommand) {
  const typedArrayBytes =
    BigInt(command.logicalGroupIndices.byteLength) +
    BigInt(command.before.byteLength) +
    BigInt(command.after.byteLength)
  const reportedBytes = command.byteLength
  if (!Number.isFinite(reportedBytes) || reportedBytes < 0) return typedArrayBytes
  const conservativeReportedBytes = BigInt(Math.ceil(reportedBytes))
  return conservativeReportedBytes > typedArrayBytes ? conservativeReportedBytes : typedArrayBytes
}

function normalizeByteLimit(value: number | undefined) {
  const normalized = normalizeLimit(value, DEFAULT_OPTIONS.maxBytes, false)
  return BigInt(Math.floor(normalized))
}

export function createSculptHistory(options: Partial<SculptHistoryOptions> = {}) {
  const maxOperations = normalizeLimit(options.maxOperations, DEFAULT_OPTIONS.maxOperations, true)
  const maxBytes = normalizeByteLimit(options.maxBytes)
  const undoStack: SculptHistoryEntry[] = []
  const redoStack: SculptHistoryEntry[] = []

  function trim() {
    let remainingBytes = maxBytes
    let retainedByBytes = 0
    for (const entry of undoStack.slice().reverse()) {
      if (entry.byteLength > remainingBytes) break
      remainingBytes -= entry.byteLength
      retainedByBytes++
    }

    const removedByBytes = undoStack.length - retainedByBytes
    const removedByOperations = Math.max(0, undoStack.length - maxOperations)
    const removeCount = Math.max(removedByBytes, removedByOperations)
    if (removeCount > 0) undoStack.splice(0, removeCount)
  }

  function push(command: SculptHistoryCommand) {
    const entry = { command, byteLength: commandByteLength(command) }
    undoStack.push(entry)
    redoStack.length = 0
    trim()
  }

  function undo() {
    const entry = undoStack.pop() ?? null
    if (!entry) return null
    redoStack.push(entry)
    return entry.command
  }

  function redo() {
    const entry = redoStack.pop() ?? null
    if (!entry) return null
    undoStack.push(entry)
    return entry.command
  }

  function canUndo() {
    return undoStack.length > 0
  }

  function canRedo() {
    return redoStack.length > 0
  }

  function clear() {
    undoStack.length = 0
    redoStack.length = 0
  }

  return { push, undo, redo, canUndo, canRedo, clear }
}

export function applyHistoryCommand(
  geometry: THREE.BufferGeometry,
  topology: LogicalMeshTopology,
  command: SculptHistoryCommand,
  side: 'before' | 'after',
) {
  const expectedCoordinateLength = command.logicalGroupIndices.length * 3
  for (const coordinateSide of ['before', 'after'] as const) {
    const coordinateLength = command[coordinateSide].length
    if (coordinateLength !== expectedCoordinateLength) {
      throw new RangeError(
        `${coordinateSide} length must equal ${expectedCoordinateLength}; received ${coordinateLength}.`,
      )
    }
  }

  const coordinates = command[side]
  const point = new THREE.Vector3()

  command.logicalGroupIndices.forEach((groupIndex, index) => {
    point.fromArray(coordinates, index * 3)
    writeLogicalPosition(geometry, topology, groupIndex, point)
  })

  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  position.needsUpdate = true
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
}
