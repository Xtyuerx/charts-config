import { test, expect } from '@playwright/test'
import { decodePoints, inspectValue } from '../src/page/toothRoots/inspection'
import { existsSync } from 'node:fs'

test('decodes unaligned NumPy XYZ binaries and rejects malformed layouts', () => {
  const suffix = new TextEncoder().encode('|2,3,<f8')
  const bytes = new Uint8Array(48 + suffix.length + 1).subarray(1)
  const view = new DataView(bytes.buffer, bytes.byteOffset, 48)
  ;[1, 2, 3, 4, 5, 6].forEach((n, i) => view.setFloat64(i * 8, n, true))
  bytes.set(suffix, 48)
  expect(decodePoints(bytes)).toEqual([
    [1, 2, 3],
    [4, 5, 6],
  ])
  expect(decodePoints(bytes.subarray(1))).toEqual([])
  expect(decodePoints([[1, 2, 3]])).toEqual([[1, 2, 3]])
})

test('inspection summarizes mesh binaries and retains matrix values and metadata', () => {
  const matrix = new Uint8Array(136)
  const view = new DataView(matrix.buffer)
  for (let i = 0; i < 16; i++) view.setFloat64(i * 8, i, true)
  matrix.set(new TextEncoder().encode('|4,4,<f8'), 128)
  const inspected = inspectValue({ axis: matrix, mesh: new Uint8Array(100000), value: 12n })
  expect(inspected).toContain('100000')
  expect(inspected).toContain('15')
  expect(inspected).toContain('12n')
  expect(inspected.length).toBeLessThan(2000)
})

test('full sample exposes layers, decoded matrices and selected landmark coordinates', async ({
  page,
}) => {
  const sample = 'E:/rs_zy/python_demo/mesh-processing-and-seg.msgpack'
  test.skip(!existsSync(sample), 'Local sample unavailable')
  test.setTimeout(180000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${process.env.TOOTH_ROOTS_BASE_URL ?? 'http://127.0.0.1:4175'}/toothRoots`)
  await expect(page.getByRole('status')).toContainText('已加载', { timeout: 45000 })
  await page.getByLabel('选择本地 msgpack 或 hex').setInputFiles(sample)
  await expect(page.getByRole('status')).toContainText('原始牙颈 28/28', { timeout: 45000 })
  await page.getByLabel('显示牙根', { exact: true }).uncheck()
  for (const label of ['上下颌同屏', '全部牙轴', '牙颈边界', '关键点'])
    await page.getByLabel(label, { exact: true }).check()
  await page.getByRole('button', { name: '31', exact: true }).click()
  const info = page.locator('.data-inspector').filter({ hasText: '所选牙齿：' })
  await info.locator('summary').click()
  await expect(info.locator('pre')).toContainText('"landmarks"')
  await expect(info.locator('pre')).toContainText('"originalAxis": [')
  await expect(page.locator('.data-inspector summary', { hasText: /^lower_gum$/ })).toHaveCount(1)
  await page.locator('.data-inspector summary', { hasText: /^bite_adj_matrix$/ }).click()
  await expect(
    page
      .locator('.data-inspector details')
      .filter({ has: page.locator('summary', { hasText: /^bite_adj_matrix$/ }) })
      .locator('pre'),
  ).toContainText('Upper')
  await expect(page.getByLabel('牙龈', { exact: true })).not.toBeChecked()
  await expect(page.getByLabel('牙龈', { exact: true })).toBeDisabled()
  await page.locator('.viewport').screenshot({
    path: 'outputs/tooth-roots-inspection.png',
    timeout: 15000,
    animations: 'disabled',
  })
  expect(errors).toEqual([])
})

test('axis mode hides gums, caps the crown and restores the original display on exit', async ({
  page,
}) => {
  test.setTimeout(180000)
  const path = 'E:/rs_zy/python_demo/mesh-processing-and-seg.msgpack'
  test.skip(!existsSync(path), 'Local sample unavailable')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1500, height: 1100 })
  await page.goto(`${process.env.TOOTH_ROOTS_BASE_URL ?? 'http://127.0.0.1:4176'}/toothRoots`)
  await expect(page.getByRole('status')).toContainText('已加载', { timeout: 45000 })
  await page.getByLabel('选择本地 msgpack 或 hex').setInputFiles(path)
  await expect(page.getByRole('status')).toContainText('原始牙颈 28/28', { timeout: 45000 })
  await page.getByRole('button', { name: '牙轴', exact: true }).click()
  await expect(page.getByLabel('牙龈', { exact: true })).not.toBeChecked()
  await expect(page.getByLabel('牙龈', { exact: true })).toBeDisabled()
  await expect(page.getByLabel('显示牙根', { exact: true })).not.toBeChecked()
  await expect(page.locator('.axis-mode-note')).toContainText('白色牙冠')
  await page.getByRole('button', { name: '31', exact: true }).click()
  const details = page.locator('.data-inspector').filter({ hasText: '所选牙齿：' })
  await details.locator('summary').click()
  const info = JSON.parse(await details.locator('pre').innerText())
  expect(info.crownClosure.closedLoops).toBeGreaterThan(0)
  expect(info.crownClosure.unresolvedEdges).toBe(0)
  await page.getByRole('button', { name: '上颌面', exact: true }).click()
  await page.screenshot({ path: 'outputs/tooth-axis-closed-crowns.png', timeout: 15000 })
  await page.getByRole('button', { name: '牙轴', exact: true }).click()
  await expect(page.getByLabel('牙龈', { exact: true })).toBeChecked()
  await expect(page.getByLabel('牙龈', { exact: true })).toBeEnabled()
  await expect(page.getByLabel('显示牙根', { exact: true })).toBeChecked()
  expect(errors).toEqual([])
})
