import { readFile } from 'node:fs/promises'

import { expect, test, type Page } from '@playwright/test'
import { createGeometryFromPayload } from '../src/utils/geometryPayloadUtils'

const baseUrl = process.env.MODEL_REPAIR_BASE_URL ?? 'http://127.0.0.1:4174'

type TestTransfer = {
  version: 1
  id: string
  jaws: {
    upper: {
      formatVersion: 1
      positions: number[]
      labels: number[]
      normals: number[]
      gumRemoved: boolean
      removedFaceCount: number
      sourceFaceCount: number
    }
  }
  createdAt: string
  updatedAt: string
}

async function clearModelRepairStorage(page: Page) {
  await page.goto(`${baseUrl}/modelRepair`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(async () => {
    window.localStorage.removeItem('model-repair-seed-ready')
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('charts-config-model-repair')
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('IndexedDB cleanup was blocked.'))
    })
  })
}

function createFourTriangleTransfer(id: string): TestTransfer {
  const positions = [
    0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, -1, 0, 0, 0, 0, 0, -1, 0, 0, 0, -1, 0, 0, 0, 0, 0,
    -1, 0, 1, 0, 0,
  ]
  return {
    version: 1,
    id,
    jaws: {
      upper: {
        formatVersion: 1,
        positions,
        labels: Array.from({ length: positions.length / 3 }, () => 11),
        normals: Array.from({ length: positions.length / 3 }, () => [0, 0, 1]).flat(),
        gumRemoved: true,
        removedFaceCount: 2,
        sourceFaceCount: 6,
      },
    },
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
  }
}

async function seedIndexedDbTransfer(page: Page, transfer: TestTransfer) {
  await clearModelRepairStorage(page)
  await page.addInitScript((seed) => {
    if (window.localStorage.getItem('model-repair-seed-ready') === 'done') return

    window.localStorage.setItem('model-repair-seed-ready', 'pending')
    void (async () => {
      try {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('charts-config-model-repair', 1)
          request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains('transfers')) {
              request.result.createObjectStore('transfers', { keyPath: 'id' })
            }
          }
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })

        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction('transfers', 'readwrite')
          transaction.objectStore('transfers').put(seed)
          transaction.oncomplete = () => resolve()
          transaction.onerror = () => reject(transaction.error)
          transaction.onabort = () => reject(transaction.error)
        })
        database.close()
        window.localStorage.setItem('model-repair-seed-ready', 'done')
      } catch {
        window.localStorage.setItem('model-repair-seed-ready', 'failed')
      }
    })()
  }, transfer)
  await page.goto(`${baseUrl}/modelRepair`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => {
    const state = window.localStorage.getItem('model-repair-seed-ready')
    if (state === 'failed') throw new Error('IndexedDB seed failed.')
    return state === 'done'
  })
}

async function openSeededPage(page: Page, id: string) {
  await seedIndexedDbTransfer(page, createFourTriangleTransfer(id))
  await page.goto(`${baseUrl}/modelRepair?task=${id}`)
  await expect(page.locator('canvas')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('模型已加载，默认工具为平滑。')).toBeVisible()
}

test('shows a recoverable empty state when task data is missing', async ({ page }) => {
  await clearModelRepairStorage(page)
  await page.goto(`${baseUrl}/modelRepair?task=missing-model-repair-task`)

  await expect(page.getByText('未找到可修复的模型数据')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: '返回模型分割' })).toBeVisible()
})

test('restores a persisted transfer and enables the default smooth tool', async ({ page }) => {
  await openSeededPage(page, 'repair-page-defaults')

  await expect(page.getByRole('button', { name: '平滑' })).toHaveClass(/active/)
  await expect(page.getByRole('button', { name: '撤销' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '重做' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '保存' })).toBeEnabled()
})

test('keeps repair tools mutually exclusive and controls jaw visibility', async ({ page }) => {
  await openSeededPage(page, 'repair-page-controls')

  const raise = page.getByRole('button', { name: '升高' })
  const lower = page.getByRole('button', { name: '压低' })
  const smooth = page.getByRole('button', { name: '平滑' })
  await raise.click()
  await expect(raise).toHaveClass(/active/)
  await expect(lower).not.toHaveClass(/active/)
  await expect(smooth).not.toHaveClass(/active/)

  await lower.click()
  await expect(lower).toHaveClass(/active/)
  await expect(raise).not.toHaveClass(/active/)

  const upper = page.getByRole('button', { name: '上颌', exact: true })
  await expect(upper).toHaveAttribute('aria-pressed', 'true')
  await upper.click()
  await expect(upper).toHaveAttribute('aria-pressed', 'false')
})

test('updates the strength range and clamps numeric input to its supported range', async ({
  page,
}) => {
  await openSeededPage(page, 'repair-page-strength')

  const range = page.locator('#brush-strength')
  await range.fill('4.5')
  await expect(range).toHaveValue('4.5')

  const numeric = page.getByRole('spinbutton', { name: '强度数值' })
  await numeric.fill('0.01')
  await numeric.blur()
  await expect(numeric).toHaveValue('0.1')
})

test('records one real pointer drag as one undoable command and enables redo after undo', async ({
  page,
}) => {
  await openSeededPage(page, 'repair-page-pointer')
  await page.getByRole('button', { name: '升高' }).click()

  const canvas = page.locator('canvas')
  const bounds = await canvas.boundingBox()
  expect(bounds).not.toBeNull()
  if (!bounds) return

  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2
  await page.mouse.move(centerX, centerY)
  await page.mouse.down()
  await page.mouse.move(centerX + 8, centerY + 4)
  await page.mouse.move(centerX + 16, centerY + 8)
  await page.mouse.up()

  const undo = page.getByRole('button', { name: '撤销' })
  const redo = page.getByRole('button', { name: '重做' })
  await expect(undo).toBeEnabled()
  await expect(redo).toBeDisabled()

  await undo.click()
  await expect(undo).toBeDisabled()
  await expect(redo).toBeEnabled()
})

test('saves repaired geometry across refresh and exports JSON and binary STL', async ({ page }) => {
  const taskId = 'repair-page-save-export'
  await openSeededPage(page, taskId)
  await page.getByRole('button', { name: '升高' }).click()

  const canvas = page.locator('canvas')
  const bounds = await canvas.boundingBox()
  expect(bounds).not.toBeNull()
  if (!bounds) return

  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2
  await page.mouse.move(centerX, centerY)
  await page.mouse.down()
  await page.mouse.move(centerX + 10, centerY + 6)
  await page.mouse.up()

  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('模型修复结果已保存')).toBeVisible()
  await expect(page.getByRole('button', { name: '撤销' })).toBeDisabled()

  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.locator('canvas')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('模型已加载，默认工具为平滑。')).toBeVisible()
  await expect(page.getByRole('button', { name: '撤销' })).toBeDisabled()

  const [jsonDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出上颌 JSON' }).click(),
  ])
  expect(jsonDownload.suggestedFilename()).toBe('upper-repaired.json')
  const jsonPath = await jsonDownload.path()
  expect(jsonPath).not.toBeNull()
  if (!jsonPath) return
  const exportedJson = JSON.parse(await readFile(jsonPath, 'utf8')) as {
    jaw: string
    labels: number[]
    geometry: {
      positions: number[]
      gumRemoved: boolean
      removedFaceCount: number
      sourceFaceCount: number
    }
    metadata: { source: string; taskId: string }
  }
  expect(exportedJson.jaw).toBe('upper')
  expect(exportedJson.labels).toEqual(Array.from({ length: 12 }, () => 11))
  expect(exportedJson.geometry.gumRemoved).toBe(true)
  expect(exportedJson.geometry.removedFaceCount).toBe(2)
  expect(exportedJson.geometry.sourceFaceCount).toBe(6)
  expect(exportedJson.metadata).toEqual({ source: 'modelRepair', taskId })
  const restoredJson = createGeometryFromPayload(exportedJson.geometry)
  const restoredPosition = restoredJson.geometry.getAttribute('position')
  expect(restoredPosition.count).toBe(12)
  expect(Array.from(restoredPosition.array, Number)).toEqual(exportedJson.geometry.positions)
  expect(restoredJson.labels).toEqual(exportedJson.labels)
  const zCoordinates = exportedJson.geometry.positions.filter((_, index) => index % 3 === 2)
  expect(Math.max(...zCoordinates)).toBeGreaterThan(0)
  await expect(page.getByRole('button', { name: '撤销' })).toBeDisabled()

  const [stlDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出上颌 STL' }).click(),
  ])
  expect(stlDownload.suggestedFilename()).toBe('upper-repaired.stl')
  const stlPath = await stlDownload.path()
  expect(stlPath).not.toBeNull()
  if (!stlPath) return
  const stlBytes = await readFile(stlPath)
  expect(stlBytes.byteLength).toBe(84 + 50 * 4)
  expect(stlBytes.readUInt32LE(80)).toBe(4)
  await expect(page.getByRole('button', { name: '撤销' })).toBeDisabled()
})
