import { test, expect } from '@playwright/test'
import { encode, decode } from '@msgpack/msgpack'
import { BoxGeometry } from 'three'
import { readFileSync } from 'node:fs'

test('whole-jaw adjustment changes contacts, compares the baseline and survives export', async ({
  page,
}) => {
  test.setTimeout(120000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const segment = (id: number, x: number) => {
    const mesh = new BoxGeometry(2, 2, 2).toNonIndexed()
    mesh.translate(x, 0, 0)
    const positions = mesh.getAttribute('position').array as Float32Array
    return {
      mesh: { type: 'float32', data: new Uint8Array(positions.buffer) },
      seg_labels: Array(positions.length / 3).fill(id),
    }
  }
  await page.goto('http://127.0.0.1:4176/toothRoots')
  await expect(page.getByRole('status')).toContainText('已加载', { timeout: 45000 })
  await page.getByLabel('选择本地 msgpack 或 hex').setInputFiles({
    name: 'jump.msgpack',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(encode({ lower_seg: segment(31, 0), upper_seg: segment(11, 1.5) })),
  })
  await expect(page.getByRole('status')).toContainText('已加载 2 颗牙')
  await page.getByRole('button', { name: '咬合跳跃', exact: true }).click()
  const panel = page.getByRole('region', { name: '咬合跳跃设计' })
  await expect(panel).toBeVisible()
  await expect(page.getByLabel('上下颌同屏', { exact: true })).toBeChecked()
  await panel.getByLabel('前后位移数值').fill('99')
  await panel.getByLabel('前后位移数值').blur()
  await expect(panel.getByRole('alert')).toBeVisible()
  await expect(panel.getByLabel('前后位移数值')).toHaveValue('0')
  await panel.getByLabel('前后位移数值').fill('8')
  await panel.getByLabel('前后位移数值').blur()
  await expect(panel.getByLabel('前后位移滑块')).toHaveValue('8')
  await expect(panel.getByRole('alert')).toHaveCount(0)
  await page.getByRole('button', { name: '咬合碰撞', exact: true }).click()
  const collision = page.getByRole('region', { name: '咬合碰撞检测' })
  await expect(collision).toContainText('检测完成：0 对表面相交')
  await panel.getByRole('button', { name: '原始', exact: true }).click()
  await expect(collision).toContainText('请重新检测')
  await page.getByRole('button', { name: '重新检测', exact: true }).click()
  await expect(collision).toContainText('检测完成：1 对表面相交')
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出完整数据', exact: true }).click()
  const download = await downloading
  const bytes = readFileSync((await download.path())!)
  const saved = decode(bytes) as any
  expect(saved.occlusal_jump.parameters.forward).toBe(8)
  // Whole-jaw preview must not be baked into each tooth's independent pose.
  expect(saved.lower_teeth['31'].editor.position.every((v: number) => Math.abs(v) < 0.01)).toBe(
    true,
  )
  await page.getByLabel('选择本地 msgpack 或 hex').setInputFiles({
    name: 'restored.msgpack',
    mimeType: 'application/octet-stream',
    buffer: bytes,
  })
  await expect(page.getByRole('status')).toContainText('已加载 2 颗牙')
  await expect(panel.getByLabel('前后位移数值')).toHaveValue('8')
  await page.getByRole('button', { name: '重新检测', exact: true }).click()
  await expect(collision).toContainText('检测完成：0 对表面相交')
  for (const label of ['左右位移', '上下位移', '张口角度']) {
    await panel.getByLabel(`${label}数值`).fill('2')
    await panel.getByLabel(`${label}数值`).blur()
    await expect(panel.getByLabel(`${label}滑块`)).toHaveValue('2')
  }
  await panel.getByRole('button', { name: '一键复位', exact: true }).click()
  await expect(panel.getByLabel('前后位移数值')).toHaveValue('0')
  await page.getByRole('button', { name: '重新检测', exact: true }).click()
  await expect(collision).toContainText('检测完成：1 对表面相交')
  await page.screenshot({ path: 'outputs/occlusal-jump.png' })
  expect(errors).toEqual([])
})
