import { expect, test } from '@playwright/test'

test('opens the tooth axis workspace with a 3D scene and three linked slice views', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4175/toothAxisSlice')

  await expect(page.getByRole('heading', { name: '牙轴调整' })).toBeVisible()
  await expect(page.getByTestId('tooth-axis-workspace')).toBeVisible()
  await expect(page.getByTestId('main-scene').locator('canvas')).toBeVisible()
  await expect(page.getByTestId('slice-viewport')).toHaveCount(3)
  await expect(page.getByText('前视图牙位 11')).toBeVisible()
  await expect(page.getByText('侧视图牙位 11')).toBeVisible()
  await expect(page.getByText('顶视图牙位 11')).toBeVisible()
  await expect(page.getByRole('status')).toContainText('个三角面')

  const sliceRendererKinds = await page
    .getByTestId('slice-viewport')
    .locator('canvas')
    .evaluateAll((canvases) =>
      canvases.map((canvas) => {
        const element = canvas as HTMLCanvasElement
        if (element.getContext('webgl2')) return 'webgl2'
        if (element.getContext('webgl')) return 'webgl'
        return '2d'
      }),
    )
  expect(sliceRendererKinds).toEqual(['webgl2', 'webgl2', 'webgl2'])

  const renderedViews = await page.getByTestId('slice-viewport').locator('canvas').all()
  for (const renderedView of renderedViews) {
    const image = await renderedView.screenshot()
    expect(image.byteLength).toBeGreaterThan(3_000)
  }

  const rotateButton = page.getByRole('button', { name: '旋转牙轴' })
  await rotateButton.click()
  await expect(rotateButton).toHaveAttribute('aria-pressed', 'true')
})

test('keeps tooth axis controls accessible on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 900 })
  await page.goto('http://127.0.0.1:4175/toothAxisSlice')
  await expect(page.locator('.status')).toContainText('个三角面')

  const rotateButton = page.getByRole('button', { name: '旋转牙轴' })
  await rotateButton.scrollIntoViewIfNeeded()
  await expect(rotateButton).toBeVisible()
})

test('updates the three dimensional tooth views when the tooth axis rotates', async ({ page }) => {
  await page.goto('http://127.0.0.1:4175/toothAxisSlice')
  await expect(page.getByRole('status')).toContainText('个三角面')

  const frontView = page.getByTestId('slice-viewport').first().locator('canvas')
  const before = await frontView.screenshot()
  const zRotation = page.getByRole('spinbutton', { name: 'Z deg' })
  await zRotation.fill('0')
  await zRotation.press('Tab')

  await expect
    .poll(async () => (await frontView.screenshot()).equals(before))
    .toBe(false)
})
