import { test, expect } from '@playwright/test'
import { encode } from '@msgpack/msgpack'
import { BoxGeometry } from 'three'
import { existsSync } from 'node:fs'

function sample(offset: number, both = true) {
  const segment = (id: number, x: number) => {
    const geometry = new BoxGeometry(2, 2, 2).toNonIndexed()
    geometry.translate(x, 0, 0)
    const positions = geometry.getAttribute('position').array as Float32Array
    return {
      mesh: { type: 'float32', data: new Uint8Array(positions.buffer) },
      seg_labels: Array(positions.length / 3).fill(id),
    }
  }
  return Buffer.from(
    encode({ lower_seg: segment(31, 0), ...(both ? { upper_seg: segment(11, offset) } : {}) }),
  )
}

test('collision stays on the current page, highlights a known overlap and invalidates edited results', async ({
  page,
}) => {
  test.setTimeout(120000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${process.env.TOOTH_ROOTS_BASE_URL ?? 'http://127.0.0.1:4176'}/toothRoots`)
  await expect(page.getByRole('status')).toContainText('已加载', { timeout: 45000 })
  await page.getByLabel('选择本地 msgpack 或 hex').setInputFiles({
    name: 'collision.msgpack',
    mimeType: 'application/octet-stream',
    buffer: sample(1.5),
  })
  await expect(page.getByRole('status')).toContainText('已加载 2 颗牙')
  await page.getByRole('button', { name: '咬合碰撞', exact: true }).click()
  const panel = page.getByRole('region', { name: '咬合碰撞检测' })
  await expect(panel).toContainText('检测完成：1 对表面相交')
  await expect(page).toHaveURL(/\/toothRoots$/)
  await expect(page.getByLabel('上下颌同屏', { exact: true })).toBeChecked()
  await expect(panel.locator('.contact-pair.intersection')).toHaveCount(1)
  await panel.locator('.contact-pair').click()
  await page.getByRole('button', { name: '沿 X +0.5', exact: true }).click()
  await expect(panel).toContainText('请重新检测')
  await expect(panel.locator('.contact-pair')).toHaveCount(0)
  await page.getByRole('button', { name: '重新检测', exact: true }).click()
  await expect(panel).toContainText('检测完成')
  await page.getByRole('button', { name: '上颌面', exact: true }).click()
  await page
    .locator('.viewport')
    .screenshot({ path: 'outputs/occlusal-collision-fixture.png', timeout: 15000 })
  await page.getByRole('button', { name: '咬合碰撞', exact: true }).click()
  await expect(panel).toHaveCount(0)
  expect(errors).toEqual([])
})

test('reports near contacts and missing opposite jaw without retaining stale collision results', async ({
  page,
}) => {
  test.setTimeout(120000)
  await page.goto(`${process.env.TOOTH_ROOTS_BASE_URL ?? 'http://127.0.0.1:4176'}/toothRoots`)
  await expect(page.getByRole('status')).toContainText('已加载', { timeout: 45000 })
  await page.getByLabel('选择本地 msgpack 或 hex').setInputFiles({
    name: 'near.msgpack',
    mimeType: 'application/octet-stream',
    buffer: sample(2.1),
  })
  await expect(page.getByRole('status')).toContainText('已加载 2 颗牙')
  await page.getByRole('button', { name: '咬合碰撞', exact: true }).click()
  const panel = page.getByRole('region', { name: '咬合碰撞检测' })
  await expect(panel).toContainText('0 对表面相交，1 对近接触')
  await expect(panel.locator('.contact-pair')).toContainText('0.100')
  await page.getByLabel('近接触阈值', { exact: true }).fill('0.01')
  await page.getByRole('button', { name: '重新检测', exact: true }).click()
  await expect(panel).toContainText('0 对表面相交，0 对近接触')
  await page.getByLabel('选择本地 msgpack 或 hex').setInputFiles({
    name: 'lower-only.msgpack',
    mimeType: 'application/octet-stream',
    buffer: sample(0, false),
  })
  await expect(page.getByRole('status')).toContainText('已加载 1 颗牙')
  await page.getByRole('button', { name: '重新检测', exact: true }).click()
  await expect(panel).toContainText('需要同时加载上颌和下颌牙齿')
})

test('detects contacts in the full 28-tooth sample on the existing page', async ({ page }) => {
  test.setTimeout(180000)
  const path = 'E:/rs_zy/python_demo/mesh-processing-and-seg.msgpack'
  test.skip(!existsSync(path), 'Local sample unavailable')
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setViewportSize({ width: 1600, height: 1080 })
  await page.goto(`${process.env.TOOTH_ROOTS_BASE_URL ?? 'http://127.0.0.1:4176'}/toothRoots`)
  await expect(page.getByRole('status')).toContainText('已加载', { timeout: 45000 })
  await page.getByLabel('选择本地 msgpack 或 hex').setInputFiles(path)
  await expect(page.getByRole('status')).toContainText('原始牙颈 28/28', { timeout: 45000 })
  await page.getByRole('button', { name: '咬合碰撞', exact: true }).click()
  const panel = page.getByRole('region', { name: '咬合碰撞检测' })
  await expect(panel.locator('.collision-status')).toContainText('检测完成', { timeout: 60000 })
  await expect(page.getByRole('button', { name: '重新检测', exact: true })).toBeEnabled()
  await page.getByLabel('牙龈', { exact: true }).uncheck()
  await page.getByRole('button', { name: '正面', exact: true }).click()
  await page.screenshot({ path: 'outputs/occlusal-collision-page.png', timeout: 15000 })
  expect(errors).toEqual([])
})
