import { test, expect } from '@playwright/test'
import { BoxGeometry } from 'three'
import { encode } from '@msgpack/msgpack'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
const { PNG } = createRequire(import.meta.url)('../node_modules/playwright-core/lib/utilsBundle.js')

test('same-page gap, point distance and section tools compute and clear their results', async ({
  page,
}) => {
  test.setTimeout(150000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setViewportSize({ width: 1600, height: 1100 })
  await page.goto(`${process.env.TOOTH_ROOTS_BASE_URL ?? 'http://127.0.0.1:4176'}/toothRoots`)
  await expect(page.getByRole('status')).toContainText('已加载', { timeout: 45000 })
  function segment(jaw: 'lower' | 'upper') {
    const positions: number[] = [],
      labels: number[] = []
    for (const [i, x] of [-2, 2].entries()) {
      const g = new BoxGeometry(2, 2, 2).toNonIndexed()
      g.translate(x, 0, jaw === 'upper' ? 4 : 0)
      positions.push(...g.getAttribute('position').array)
      labels.push(
        ...Array(g.getAttribute('position').count).fill(
          jaw === 'lower' ? [31, 41][i] : [11, 21][i],
        ),
      )
    }
    return {
      mesh: { type: 'float32', data: new Uint8Array(new Float32Array(positions).buffer) },
      seg_labels: labels,
    }
  }
  await page.getByLabel('选择本地 msgpack 或 hex').setInputFiles({
    name: 'measurements.msgpack',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(encode({ lower_seg: segment('lower'), upper_seg: segment('upper') })),
  })
  await expect(page.getByRole('status')).toContainText('已加载 4 颗牙')
  await page.getByRole('button', { name: '邻牙间隙', exact: true }).click()
  const panel = page.getByRole('region', { name: '模型测量' })
  await expect(panel).toContainText('已计算 1 对邻牙间隙')
  await expect(panel.getByRole('button', { name: '31 / 41：2.000', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '测距', exact: true }).click()
  await expect(panel).toContainText('Shift')
  const viewport = page.locator('.viewport')
  await viewport.scrollIntoViewIfNeeded()
  const rect = (await viewport.boundingBox())!
  const png = PNG.sync.read(await viewport.screenshot({ timeout: 15000 }))
  const candidates: { x: number; y: number }[][] = [[], []]
  for (let y = Math.floor(png.height * 0.2); y < png.height * 0.8; y++) {
    for (let x = Math.floor(png.width * 0.15); x < png.width * 0.85; x++) {
      const offset = (y * png.width + x) * 4
      const [r, g, b] = Array.from(png.data.subarray(offset, offset + 3)) as number[]
      if (r! > 130 && g! > 60 && b! > 70 && r! > g! * 1.15)
        candidates[x < png.width / 2 ? 0 : 1]!.push({ x, y })
    }
  }
  await page.keyboard.down('Shift')
  for (const points of candidates) {
    expect(points.length).toBeGreaterThan(10)
    const x = points.reduce((sum, p) => sum + p.x, 0) / points.length
    const y = points.reduce((sum, p) => sum + p.y, 0) / points.length
    await page.mouse.click(rect.x + x, rect.y + y)
  }
  await page.keyboard.up('Shift')
  await expect(panel.locator('.measurement-value')).toBeVisible()
  await expect(panel).toContainText('测量完成')
  await page.getByRole('button', { name: '咬合截面', exact: true }).click()
  await expect(page.getByLabel('截面方向', { exact: true })).toHaveValue('tooth')
  await page.getByRole('button', { name: '31', exact: true }).click()
  await expect(page.getByLabel('咬合截面轮廓', { exact: true })).toContainText('下颌 31')
  await expect(panel.locator('.collision-status')).toContainText(/当前截面：[1-9]/)
  const firstContour = await page.locator('.section-inset svg').getAttribute('viewBox')
  await page.getByRole('button', { name: '41', exact: true }).click()
  await expect(page.getByLabel('咬合截面轮廓', { exact: true })).toContainText('下颌 41')
  // Repositioning preserves a complete model and a valid planar preview.
  expect(firstContour).toBeTruthy()
  await expect(page.locator('.section-inset path').first()).toHaveAttribute('d', /M/)
  await viewport.scrollIntoViewIfNeeded()
  const sliceRect = (await viewport.boundingBox())!
  const sliceImage = PNG.sync.read(await viewport.screenshot({ timeout: 15000 }))
  let clickPoint: { x: number; y: number } | undefined
  for (
    let y = Math.floor(sliceImage.height * 0.4);
    y < sliceImage.height * 0.85 && !clickPoint;
    y++
  ) {
    for (let x = Math.floor(sliceImage.width * 0.25); x < sliceImage.width * 0.48; x++) {
      const offset = (y * sliceImage.width + x) * 4
      const r = sliceImage.data[offset],
        g = sliceImage.data[offset + 1],
        b = sliceImage.data[offset + 2]
      if (r > 130 && g > 60 && b > 70 && r > g * 1.15) {
        clickPoint = { x, y }
        break
      }
    }
  }
  expect(clickPoint).toBeTruthy()
  await page.mouse.click(sliceRect.x + clickPoint!.x, sliceRect.y + clickPoint!.y)
  await expect(page.locator('.section-inset strong')).not.toHaveText('牙号 下颌 41')
  await page.getByRole('button', { name: '上颌', exact: true }).click()
  await page.getByRole('button', { name: '11', exact: true }).click()
  await expect(page.getByLabel('咬合截面轮廓', { exact: true })).toContainText('上颌 11')
  await page.getByLabel('截面方向', { exact: true }).selectOption('Z')
  await expect(page.getByLabel('截面位置', { exact: true })).toHaveValue('0')
  await page.getByRole('button', { name: '更新截面', exact: true }).click()
  await page.screenshot({ path: 'outputs/tooth-measurements-section.png', timeout: 15000 })
  await page.getByRole('button', { name: '关闭测量工具', exact: true }).click()
  await expect(panel).toHaveCount(0)
  await expect(page.locator('.section-inset')).toHaveCount(0)
  await expect(page).toHaveURL(/\/toothRoots$/)
  expect(errors).toEqual([])
})

test('real tooth slice moves with selected teeth while showing both complete jaws', async ({
  page,
}) => {
  test.setTimeout(120000)
  const sample = 'E:/rs_zy/python_demo/mesh-processing-and-seg.msgpack'
  test.skip(!existsSync(sample), 'Local sample unavailable')
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setViewportSize({ width: 1600, height: 1100 })
  await page.goto(`${process.env.TOOTH_ROOTS_BASE_URL ?? 'http://127.0.0.1:4176'}/toothRoots`)
  await expect(page.getByRole('status')).toContainText('已加载', { timeout: 45000 })
  await page.getByLabel('选择本地 msgpack 或 hex').setInputFiles(sample)
  await expect(page.getByRole('status')).toContainText('原始牙颈 28/28', { timeout: 45000 })
  await page.getByRole('button', { name: '咬合截面', exact: true }).click()
  await page.getByRole('button', { name: '31', exact: true }).click()
  await expect(page.locator('.section-inset strong')).toHaveText('牙号 下颌 31')
  const anterior = await page.locator('.section-inset svg').getAttribute('viewBox')
  await page.getByRole('button', { name: '37', exact: true }).click()
  await expect(page.locator('.section-inset strong')).toHaveText('牙号 下颌 37')
  await expect(page.locator('.section-inset svg')).not.toHaveAttribute('viewBox', anterior!)
  await expect(page.getByLabel('上下颌同屏', { exact: true })).toBeChecked()
  await page.getByRole('button', { name: '正面', exact: true }).click()
  await page
    .locator('.viewport')
    .screenshot({ path: 'outputs/tooth-slice-complete-jaws.png', timeout: 15000 })
  expect(errors).toEqual([])
})
