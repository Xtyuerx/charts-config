import { expect, test, type Page } from '@playwright/test'

const baseUrl = process.env.MODEL_REPAIR_BASE_URL ?? 'http://127.0.0.1:4174'

test.describe.configure({ mode: 'serial' })
test.setTimeout(90_000)

async function waitForAllStl(page: Page) {
  await page.goto(`${baseUrl}/allStl`)
  await expect(page.locator('.status')).toContainText('已加载', { timeout: 60_000 })
}

test('saves current jaws and navigates to model repair', async ({ page }) => {
  await waitForAllStl(page)

  const next = page.getByRole('button', { name: '保存并下一步' })
  await expect(next).toBeEnabled()
  await next.click()

  await expect(page).toHaveURL(/\/modelRepair\?task=[^&]+$/, { timeout: 30_000 })
  await expect(page.getByRole('heading', { name: '模型修复', level: 1 })).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByText('模型已加载，默认工具为平滑。')).toBeVisible({
    timeout: 30_000,
  })

  const taskId = new URL(page.url()).searchParams.get('task')
  expect(taskId).toBeTruthy()
  if (!taskId) throw new Error('模型修复 URL 缺少 task。')

  const persisted = await page.evaluate(async (id) => {
    type PersistedJaw = {
      positions: number[]
      labels: number[]
      sourceFaceCount: number
      removedFaceCount: number
    }
    type PersistedTransfer = {
      jaws?: {
        upper?: PersistedJaw
        lower?: PersistedJaw
      }
    }

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('charts-config-model-repair')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })

    try {
      const transfer = await new Promise<PersistedTransfer | null>((resolve, reject) => {
        const request = database.transaction('transfers').objectStore('transfers').get(id)
        request.onsuccess = () => resolve((request.result as PersistedTransfer | undefined) ?? null)
        request.onerror = () => reject(request.error)
      })
      const upper = transfer?.jaws?.upper
      const lower = transfer?.jaws?.lower
      return {
        hasUpper: !!upper,
        hasLower: !!lower,
        sameJawObject: !!upper && upper === lower,
        upper: upper
          ? {
              positionCount: upper.positions.length,
              labelCount: upper.labels.length,
              currentFaceCount: upper.positions.length / 9,
              sourceFaceCount: upper.sourceFaceCount,
              removedFaceCount: upper.removedFaceCount,
              hasExpectedJawLabel: upper.labels.some((label) => label >= 11 && label <= 28),
            }
          : null,
        lower: lower
          ? {
              positionCount: lower.positions.length,
              labelCount: lower.labels.length,
              currentFaceCount: lower.positions.length / 9,
              sourceFaceCount: lower.sourceFaceCount,
              removedFaceCount: lower.removedFaceCount,
              hasExpectedJawLabel: lower.labels.some((label) => label >= 31 && label <= 48),
            }
          : null,
      }
    } finally {
      database.close()
    }
  }, taskId)

  expect(persisted.hasUpper).toBe(true)
  expect(persisted.hasLower).toBe(true)
  expect(persisted.sameJawObject).toBe(false)
  for (const jaw of [persisted.upper, persisted.lower]) {
    expect(jaw).not.toBeNull()
    if (!jaw) continue
    expect(jaw.labelCount).toBeGreaterThan(0)
    expect(jaw.labelCount).toBe(jaw.positionCount / 3)
    expect(jaw.sourceFaceCount).toBeGreaterThanOrEqual(jaw.currentFaceCount + jaw.removedFaceCount)
    expect(jaw.hasExpectedJawLabel).toBe(true)
  }
})

test('blocks navigation while a delete preview is waiting for confirmation', async ({ page }) => {
  await waitForAllStl(page)
  await page.getByRole('button', { name: '删除牙龈' }).click()

  const canvas = page.locator('.viewer canvas').first()
  const bounds = await canvas.boundingBox()
  expect(bounds).not.toBeNull()
  if (!bounds) return

  await page.mouse.move(bounds.x + 24, bounds.y + 24)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width - 24, bounds.y + 24)
  await page.mouse.move(bounds.x + bounds.width - 24, bounds.y + bounds.height - 24)
  await page.mouse.move(bounds.x + 24, bounds.y + bounds.height - 24)
  await page.mouse.up()

  await expect(page.locator('.status')).toContainText('已累计圈选')
  await page.getByRole('button', { name: '保存并下一步' }).click()

  await expect(page).toHaveURL(/\/allStl$/)
  await expect(page.locator('.status')).toContainText('请先确认或取消删除范围，再进入模型修复。')
})

test('stays on allStl and reports a save failure', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(indexedDB, 'open', {
      configurable: true,
      value: () => {
        throw new Error('测试保存失败')
      },
    })
  })
  await waitForAllStl(page)

  const next = page.getByRole('button', { name: '保存并下一步' })
  await next.click()

  await expect(page).toHaveURL(/\/allStl$/)
  await expect(page.locator('.status')).toContainText('保存模型修复任务失败：测试保存失败')
  await expect(next).toBeEnabled()
})

test('stays on allStl and recovers when the model repair route fails to load', async ({ page }) => {
  await page.route('**/src/page/modelRepair/index.vue*', (route) => route.abort('failed'))
  await waitForAllStl(page)

  const next = page.getByRole('button', { name: '保存并下一步' })
  await next.click()

  await expect(page).toHaveURL(/\/allStl$/)
  await expect(page.locator('.status')).toContainText('进入模型修复页面失败')
  await expect(next).toBeEnabled()
})

test('disables continuation when no jaw model can be loaded', async ({ page }) => {
  await page.route('**/models/*.stl', (route) =>
    route.fulfill({ status: 503, body: 'unavailable' }),
  )
  await page.route('**/points/*.json', (route) =>
    route.fulfill({ status: 503, body: 'unavailable' }),
  )
  await page.goto(`${baseUrl}/allStl`)

  const next = page.getByRole('button', { name: '保存并下一步' })
  await expect(next).toBeDisabled()
  await expect(page.locator('.status')).toContainText('模型加载失败', { timeout: 30_000 })
  await expect(page).toHaveURL(/\/allStl$/)
})
