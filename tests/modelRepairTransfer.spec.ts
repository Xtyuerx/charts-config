import * as THREE from 'three'

import { fileURLToPath, URL } from 'node:url'

import { createPinia, setActivePinia } from 'pinia'
import { expect, test } from '@playwright/test'
import { createServer } from 'vite'

import { useModelRepairStore } from '../src/stores/modelRepair'
import { createGeometryFromPayload } from '../src/utils/geometryPayloadUtils'
import {
  createModelRepairTransfer,
  type ModelRepairRepository,
  getRepairContinuationError,
  normalizeRepairFaceMetadata,
  updateTransferFromMeshes,
} from '../src/page/modelRepair/utils/modelTransferUtils'

test('returns the correct continuation error for each validation branch', () => {
  expect(getRepairContinuationError(true, 2)).toBe('请先确认或取消删除范围，再进入模型修复。')
  expect(getRepairContinuationError(false, 0)).toBe('当前没有可修复的模型。')
  expect(getRepairContinuationError(false, 1)).toBe('')
})

test('normalizes missing and invalid repair face metadata to finite non-negative integers', () => {
  expect(normalizeRepairFaceMetadata(4, undefined, undefined)).toEqual({
    sourceFaceCount: 4,
    removedFaceCount: 0,
  })
  expect(normalizeRepairFaceMetadata(4, Number.NaN, Number.NaN)).toEqual({
    sourceFaceCount: 4,
    removedFaceCount: 0,
  })
  expect(normalizeRepairFaceMetadata(4, -5, -2)).toEqual({
    sourceFaceCount: 4,
    removedFaceCount: 0,
  })
  expect(normalizeRepairFaceMetadata(4, 8.5, 1.5)).toEqual({
    sourceFaceCount: 4,
    removedFaceCount: 0,
  })
})

test('repairs contradictory source counts and preserves valid face metadata', () => {
  expect(normalizeRepairFaceMetadata(4, 5, 2)).toEqual({
    sourceFaceCount: 6,
    removedFaceCount: 2,
  })
  expect(normalizeRepairFaceMetadata(4, 9, 2)).toEqual({
    sourceFaceCount: 9,
    removedFaceCount: 2,
  })
})

test('accepts non-empty integer strings for repair face metadata', () => {
  expect(normalizeRepairFaceMetadata(4, '9', '2')).toEqual({
    sourceFaceCount: 9,
    removedFaceCount: 2,
  })
  expect(normalizeRepairFaceMetadata(4, '9.0', '2.0')).toEqual({
    sourceFaceCount: 9,
    removedFaceCount: 2,
  })
})

test('serializes repaired positions without restoring deleted faces', () => {
  const upper = {
    formatVersion: 1 as const,
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    labels: [11, 11, 11],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
    gumRemoved: true,
    removedFaceCount: 2,
    sourceFaceCount: 3,
  }
  const transfer = createModelRepairTransfer({ upper }, 'save-1', '2026-08-28T00:00:00.000Z')
  const restored = createGeometryFromPayload(transfer.jaws.upper!)
  const mesh = new THREE.Mesh(restored.geometry)
  const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute
  position.setZ(0, 0.75)
  position.needsUpdate = true

  const saved = updateTransferFromMeshes(transfer, { upper: mesh }, '2026-08-28T01:00:00.000Z')

  expect(saved.jaws.upper?.positions[2]).toBeCloseTo(0.75)
  expect(saved.jaws.upper?.positions).toHaveLength(9)
  expect(saved.jaws.upper?.labels).toEqual(upper.labels)
  expect(saved.jaws.upper?.removedFaceCount).toBe(2)
  expect(saved.jaws.upper?.sourceFaceCount).toBe(3)
  expect(saved.jaws.upper?.gumRemoved).toBe(true)
  expect(saved.updatedAt).toBe('2026-08-28T01:00:00.000Z')
})

test('rejects invalid metadata strings without coercing other value types', () => {
  for (const invalid of ['', '   ', 'abc', '-2', '1.5', 'Infinity', '9007199254740992']) {
    expect(normalizeRepairFaceMetadata(4, invalid, invalid)).toEqual({
      sourceFaceCount: 4,
      removedFaceCount: 0,
    })
  }
  expect(normalizeRepairFaceMetadata(4, true, false)).toEqual({
    sourceFaceCount: 4,
    removedFaceCount: 0,
  })
  expect(normalizeRepairFaceMetadata(4, { value: 9 }, [2])).toEqual({
    sourceFaceCount: 4,
    removedFaceCount: 0,
  })
})

test('drops removed faces when adding them would exceed the safe integer range', () => {
  const missingSource = normalizeRepairFaceMetadata(Number.MAX_SAFE_INTEGER, undefined, 1)
  const maxSafeSource = normalizeRepairFaceMetadata(
    Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
    1,
  )

  expect(missingSource).toEqual({
    sourceFaceCount: Number.MAX_SAFE_INTEGER,
    removedFaceCount: 0,
  })
  expect(maxSafeSource).toEqual({
    sourceFaceCount: Number.MAX_SAFE_INTEGER,
    removedFaceCount: 0,
  })
  for (const metadata of [missingSource, maxSafeSource]) {
    expect(Number.isSafeInteger(metadata.sourceFaceCount)).toBe(true)
    expect(Number.isSafeInteger(metadata.removedFaceCount)).toBe(true)
    expect(metadata.sourceFaceCount).toBeGreaterThanOrEqual(0)
    expect(metadata.removedFaceCount).toBeGreaterThanOrEqual(0)
  }
})

test('creates and restores separate upper and lower payloads without mixing metadata', async () => {
  const records = new Map<string, unknown>()
  const repository: ModelRepairRepository = {
    save: async (value) => void records.set(value.id, structuredClone(value)),
    load: async (id) => (records.get(id) as ReturnType<typeof createModelRepairTransfer>) ?? null,
  }
  const upper = {
    formatVersion: 1 as const,
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    labels: [11, 11, 11],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
    gumRemoved: true,
    removedFaceCount: 3,
    sourceFaceCount: 4,
  }
  const lower = {
    formatVersion: 1 as const,
    positions: [9, 9, 9, 10, 9, 9, 9, 10, 9],
    labels: [31, 32, 33],
    normals: [0, 0, -1, 0, 0, -1, 0, 0, -1],
    gumRemoved: false,
    removedFaceCount: 0,
    sourceFaceCount: 1,
  }
  const transfer = createModelRepairTransfer(
    { upper, lower },
    'repair-1',
    '2026-08-27T00:00:00.000Z',
  )

  setActivePinia(createPinia())
  const store = useModelRepairStore()
  await store.setTransfer(transfer, repository)
  store.clearMemory()
  await store.restoreTransfer('repair-1', repository)

  expect(store.activeTransfer?.jaws.upper).toEqual({
    formatVersion: 1,
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    labels: [11, 11, 11],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
    gumRemoved: true,
    removedFaceCount: 3,
    sourceFaceCount: 4,
  })
  expect(store.activeTransfer?.jaws.lower).toEqual({
    formatVersion: 1,
    positions: [9, 9, 9, 10, 9, 9, 9, 10, 9],
    labels: [31, 32, 33],
    normals: [0, 0, -1, 0, 0, -1, 0, 0, -1],
    gumRemoved: false,
    removedFaceCount: 0,
    sourceFaceCount: 1,
  })
})

test('round-trips a two-jaw transfer through browser IndexedDB', async ({ page }) => {
  const rootDirectory = fileURLToPath(new URL('..', import.meta.url))
  const sourceDirectory = fileURLToPath(new URL('../src', import.meta.url))
  const server = await createServer({
    appType: 'custom',
    configFile: false,
    root: rootDirectory,
    logLevel: 'silent',
    resolve: { alias: { '@': sourceDirectory } },
    server: { host: '127.0.0.1', port: 0 },
    plugins: [
      {
        name: 'model-repair-indexeddb-test-page',
        configureServer(viteServer) {
          viteServer.middlewares.use((request, response, next) => {
            if (request.url !== '/__model-repair-test__') return next()
            response.statusCode = 200
            response.setHeader('Content-Type', 'text/html; charset=utf-8')
            response.end('<!doctype html><html><body></body></html>')
          })
        },
      },
    ],
  })

  try {
    await server.listen()
    const address = server.httpServer?.address()
    if (!address || typeof address === 'string') throw new Error('Vite test server did not start.')

    await page.goto(`http://127.0.0.1:${address.port}/__model-repair-test__`, {
      waitUntil: 'domcontentloaded',
    })
    const restored = await page.evaluate(async () => {
      const deleteDatabase = () =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase('charts-config-model-repair')
          request.onsuccess = () => resolve()
          request.onerror = () => reject(request.error)
          request.onblocked = () => reject(new Error('IndexedDB cleanup was blocked.'))
        })

      await deleteDatabase()
      try {
        const { createIndexedDbModelRepairRepository, createModelRepairTransfer } = await import(
          '/src/page/modelRepair/utils/modelTransferUtils.ts'
        )
        const repository = createIndexedDbModelRepairRepository()
        const transfer = createModelRepairTransfer(
          {
            upper: {
              formatVersion: 1,
              positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
              labels: [11, 11, 11],
              normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
              gumRemoved: true,
              removedFaceCount: 3,
              sourceFaceCount: 4,
            },
            lower: {
              formatVersion: 1,
              positions: [9, 9, 9, 10, 9, 9, 9, 10, 9],
              labels: [31, 32, 33],
              normals: [0, 0, -1, 0, 0, -1, 0, 0, -1],
              gumRemoved: false,
              removedFaceCount: 0,
              sourceFaceCount: 1,
            },
          },
          'indexeddb-repair-1',
          '2026-08-27T01:00:00.000Z',
        )

        await repository.save(transfer)
        return await repository.load('indexeddb-repair-1')
      } finally {
        await deleteDatabase()
      }
    })

    expect(restored).toEqual({
      version: 1,
      id: 'indexeddb-repair-1',
      jaws: {
        upper: {
          formatVersion: 1,
          positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
          labels: [11, 11, 11],
          normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
          gumRemoved: true,
          removedFaceCount: 3,
          sourceFaceCount: 4,
        },
        lower: {
          formatVersion: 1,
          positions: [9, 9, 9, 10, 9, 9, 9, 10, 9],
          labels: [31, 32, 33],
          normals: [0, 0, -1, 0, 0, -1, 0, 0, -1],
          gumRemoved: false,
          removedFaceCount: 0,
          sourceFaceCount: 1,
        },
      },
      createdAt: '2026-08-27T01:00:00.000Z',
      updatedAt: '2026-08-27T01:00:00.000Z',
    })
  } finally {
    try {
      if (!page.isClosed()) await page.close()
    } finally {
      await server.close()
    }
  }
})
