import * as THREE from 'three'

import type { MeshGeometryPayload } from '@/utils/geometryPayloadUtils'
import { buildGeometryPayloadFromMesh } from '@/utils/geometryPayloadUtils'

export type RepairJaw = 'upper' | 'lower'

export type ModelRepairTransfer = {
  version: 1
  id: string
  jaws: Partial<Record<RepairJaw, MeshGeometryPayload>>
  createdAt: string
  updatedAt: string
}

export type ModelRepairRepository = {
  save(transfer: ModelRepairTransfer): Promise<void>
  load(id: string): Promise<ModelRepairTransfer | null>
}

export function getRepairContinuationError(hasDeletePreview: boolean, jawCount: number) {
  if (hasDeletePreview) return '请先确认或取消删除范围，再进入模型修复。'
  if (jawCount === 0) return '当前没有可修复的模型。'
  return ''
}

function finiteNonNegativeInteger(value: unknown) {
  const numericValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN

  return Number.isSafeInteger(numericValue) && numericValue >= 0 ? numericValue : null
}

export function normalizeRepairFaceMetadata(
  currentFaceCount: number,
  sourceFaceCount: unknown,
  removedFaceCount: unknown,
) {
  const current = finiteNonNegativeInteger(currentFaceCount) ?? 0
  let removed = finiteNonNegativeInteger(removedFaceCount) ?? 0
  let minimumSource = current + removed
  if (!Number.isSafeInteger(minimumSource)) {
    removed = 0
    minimumSource = current
  }
  const source = finiteNonNegativeInteger(sourceFaceCount)

  return {
    sourceFaceCount: source != null && source >= minimumSource ? source : minimumSource,
    removedFaceCount: removed,
  }
}

const DATABASE_NAME = 'charts-config-model-repair'
const STORE_NAME = 'transfers'

function isModelRepairTransfer(value: unknown): value is ModelRepairTransfer {
  if (!value || typeof value !== 'object') return false
  const transfer = value as Partial<ModelRepairTransfer>
  return (
    transfer.version === 1 &&
    typeof transfer.id === 'string' &&
    !!transfer.jaws &&
    (!!transfer.jaws.upper || !!transfer.jaws.lower)
  )
}

function openDatabase(factory: IDBFactory) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export function createModelRepairTransfer(
  jaws: ModelRepairTransfer['jaws'],
  id = crypto.randomUUID(),
  now = new Date().toISOString(),
): ModelRepairTransfer {
  if (!jaws.upper && !jaws.lower) throw new Error('至少需要一个可修复的颌骨模型。')
  return { version: 1, id, jaws: structuredClone(jaws), createdAt: now, updatedAt: now }
}

export function updateTransferFromMeshes(
  transfer: ModelRepairTransfer,
  meshes: Partial<Record<RepairJaw, THREE.Mesh>>,
  now = new Date().toISOString(),
) {
  const jaws = { ...transfer.jaws }

  for (const jaw of ['upper', 'lower'] as const) {
    const mesh = meshes[jaw]
    const previous = transfer.jaws[jaw]
    if (!mesh || !previous) continue

    mesh.geometry.computeVertexNormals()
    mesh.geometry.computeBoundingBox()
    mesh.geometry.computeBoundingSphere()
    const next = buildGeometryPayloadFromMesh(mesh.geometry, previous.labels, {
      removedFaceCount: previous.removedFaceCount,
      sourceFaceCount: previous.sourceFaceCount,
    })
    next.gumRemoved = previous.gumRemoved
    jaws[jaw] = next
  }

  return { ...transfer, jaws, updatedAt: now }
}

export function createIndexedDbModelRepairRepository(
  factory: IDBFactory = globalThis.indexedDB,
): ModelRepairRepository {
  return {
    async save(transfer) {
      const database = await openDatabase(factory)
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readwrite')
        transaction.objectStore(STORE_NAME).put(structuredClone(transfer))
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
      database.close()
    },
    async load(id) {
      const database = await openDatabase(factory)
      const value = await new Promise<unknown>((resolve, reject) => {
        const request = database.transaction(STORE_NAME).objectStore(STORE_NAME).get(id)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      database.close()
      return isModelRepairTransfer(value) ? value : null
    },
  }
}
