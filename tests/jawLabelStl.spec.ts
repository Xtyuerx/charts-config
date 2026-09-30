import { expect, test } from '@playwright/test'

test('imports local jaws and preserves the model when labels are invalid', async ({ page }) => {
  await page.goto('http://127.0.0.1:4175/jawLabelStl')
  await expect(page.getByRole('status')).toContainText('已加载', { timeout: 30000 })
  await expect(page.getByRole('button', { name: '加载本地数据' })).toBeDisabled()
  await page.getByLabel('STL 文件').setInputFiles('public/models/upper.stl')
  await page.getByLabel('JSON 文件').setInputFiles('public/models/upper.json')
  await page.getByRole('button', { name: '加载本地数据' }).click()
  await expect(page.getByRole('status')).toContainText('已加载本地上颌')
  await page.getByLabel('JSON 文件').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ labels: [99] })),
  })
  await page.getByRole('button', { name: '加载本地数据' }).click()
  await expect(page.getByRole('status')).toContainText('顶点数量不匹配')
  await expect(page.getByText('牙号 11', { exact: true })).toBeVisible()
  await expect(page.getByText('牙号 99', { exact: true })).toHaveCount(0)
  await page.getByLabel('导入位置').selectOption('lower')
  await page.getByLabel('STL 文件').setInputFiles('public/models/lower.stl')
  await page.getByLabel('JSON 文件').setInputFiles('public/models/lower.json')
  await page.getByRole('button', { name: '加载本地数据' }).click()
  await expect(page.getByRole('status')).toContainText('已加载本地下颌')
  await expect(page.getByText('牙号 31', { exact: true })).toBeVisible()
  // A different label set must replace the old jaw's legend, not accumulate it.
  await page.getByLabel('STL 文件').setInputFiles({
    name: 'triangle.stl',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(
      'solid triangle\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid triangle',
    ),
  })
  await page.getByLabel('JSON 文件').setInputFiles({
    name: 'triangle.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ labels: [99, 99, 99] })),
  })
  await page.getByRole('button', { name: '加载本地数据' }).click()
  await expect(page.getByText('牙号 99', { exact: true })).toBeVisible()
  await expect(page.getByText('牙号 31', { exact: true })).toHaveCount(0)
  await expect(page.getByText('牙号 11', { exact: true })).toBeVisible()
})

test('allows local import after bundled data fails to load', async ({ page }) => {
  await page.route('**/models/*.json', (route) => route.fulfill({ status: 404, body: '' }))
  await page.goto('http://127.0.0.1:4175/jawLabelStl')
  await expect(page.getByRole('status')).toContainText('文件加载失败', { timeout: 30000 })
  await page.getByLabel('STL 文件').setInputFiles('public/models/upper.stl')
  await page.getByLabel('JSON 文件').setInputFiles('public/models/upper.json')
  await page.getByRole('button', { name: '加载本地数据' }).click()
  await expect(page.getByRole('status')).toContainText('已加载本地上颌')
  await expect(page.getByText('牙号 11', { exact: true })).toBeVisible()
})

test('renders complete jaws using JSON labels without tooth STL files', async ({ page }) => {
  const requests: string[] = []
  const errors: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('http://127.0.0.1:4175/jawLabelStl')
  await expect(page.getByRole('status')).toContainText('已加载', { timeout: 30000 })
  await expect(page.locator('canvas')).toBeVisible()
  await expect(page.getByText('0 · 牙龈', { exact: true })).toBeVisible()
  await expect(page.getByText('牙号 11', { exact: true })).toBeVisible()
  await expect(page.getByText('牙号 31', { exact: true })).toBeVisible()
  for (const name of ['upper.stl', 'lower.stl', 'upper.json', 'lower.json']) {
    expect(requests.some((url) => url.endsWith(`/models/${name}`))).toBe(true)
  }
  expect(requests.some((url) => /tooth.*\.stl/.test(url))).toBe(false)
  const canvas = page.locator('canvas')
  const before = await canvas.screenshot()
  await page.getByLabel('显示上颌').uncheck()
  await page.getByLabel('显示下颌').uncheck()
  await expect.poll(async () => (await canvas.screenshot()).equals(before)).toBe(false)
  await page.getByLabel('显示上颌').check()
  await page.getByLabel('显示下颌').check()
  expect(errors).toEqual([])
})
