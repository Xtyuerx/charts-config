import { expect, test } from '@playwright/test'

const baseUrl = process.env.TOOTH_SEGMENTATION_TEST_BASE_URL ?? 'http://127.0.0.1:4176'

test('displays the allStl upper and lower jaw data in a standalone workspace', async ({ page }) => {
  await page.goto(`${baseUrl}/toothSegmentationTest`)

  await expect(page.getByRole('heading', { name: '牙齿分割技术测试' })).toBeVisible()
  await expect(page.getByTestId('tooth-segmentation-viewer').locator('canvas')).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByRole('status')).toContainText('已加载上颌和下颌')
  await expect(page.getByRole('button', { name: '上颌' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: '下颌' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: '分牙' })).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('button', { name: '清除边界' })).toBeDisabled()
})
