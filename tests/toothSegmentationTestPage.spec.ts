import { expect, test } from '@playwright/test'

const baseUrl = process.env.TOOTH_SEGMENTATION_TEST_BASE_URL ?? 'http://127.0.0.1:4176'

const fixtureCells = 60
const fixtureSpacing = 0.25

function createGridStl(z: number) {
  const facets: string[] = []
  const addTriangle = (points: Array<[number, number, number]>) => {
    facets.push(
      'facet normal 0 0 1',
      'outer loop',
      ...points.map((point) => `vertex ${point.join(' ')}`),
      'endloop',
      'endfacet',
    )
  }
  for (let row = 0; row < fixtureCells; row += 1) {
    for (let column = 0; column < fixtureCells; column += 1) {
      const x = (column - fixtureCells / 2) * fixtureSpacing
      const y = (row - fixtureCells / 2) * fixtureSpacing
      const nextX = x + fixtureSpacing
      const nextY = y + fixtureSpacing
      addTriangle([[x, y, z], [nextX, y, z], [nextX, nextY, z]])
      addTriangle([[x, y, z], [nextX, nextY, z], [x, nextY, z]])
    }
  }
  return `solid jaw\n${facets.join('\n')}\nendsolid jaw`
}

async function installSmallJawFixtures(page: import('@playwright/test').Page) {
  const faceCount = fixtureCells * fixtureCells * 2
  await page.route('**/models/upper.stl', (route) =>
    route.fulfill({ body: createGridStl(0), contentType: 'model/stl' }),
  )
  await page.route('**/models/lower.stl', (route) =>
    route.fulfill({ body: createGridStl(-18), contentType: 'model/stl' }),
  )
  await page.route('**/points/upper.json', (route) =>
    route.fulfill({ json: { labels: new Array(faceCount * 3).fill(11) } }),
  )
  await page.route('**/points/lower.json', (route) =>
    route.fulfill({ json: { labels: new Array(faceCount * 3).fill(31) } }),
  )
}

test('displays the allStl upper and lower jaw data in a standalone workspace', async ({ page }) => {
  await installSmallJawFixtures(page)
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

  await page.getByRole('button', { name: '分牙' }).click()
  const generateButton = page.getByRole('button', { name: '生成边界' })
  await expect(generateButton).toBeDisabled()

  await page.getByRole('button', { name: '下颌' }).click()
  await page.getByRole('button', { name: '重置视角' }).click()
  const canvas = page.locator('.drawing-canvas')
  const bounds = await canvas.boundingBox()
  expect(bounds).not.toBeNull()
  const center = { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 }
  const radius = 34
  await page.mouse.move(center.x + radius, center.y)
  await page.mouse.down()
  for (let step = 1; step <= 24; step += 1) {
    const angle = (Math.PI * 2 * step) / 24
    await page.mouse.move(center.x + Math.cos(angle) * radius, center.y + Math.sin(angle) * radius)
  }
  await page.mouse.up()

  await expect(page.getByRole('status')).toContainText('种子面')
  await expect(generateButton).toBeEnabled()
  await expect(page.getByTestId('seed-preview')).toHaveAttribute('data-color', '#ef6f91')

  const generationState = await generateButton.evaluate(async (button: HTMLButtonElement) => {
    button.click()
    await Promise.resolve()
    await Promise.resolve()
    const statusBeforeDuplicate = document.querySelector('[role="status"]')?.textContent ?? ''
    button.click()
    return {
      disabled: button.disabled,
      statusBeforeDuplicate,
      statusAfterDuplicate: document.querySelector('[role="status"]')?.textContent ?? '',
    }
  })
  expect(generationState.disabled).toBe(true)
  expect(generationState.statusBeforeDuplicate).toContain('生成边界中')
  expect(generationState.statusAfterDuplicate).toBe(generationState.statusBeforeDuplicate)
  await expect(page.getByTestId('active-boundary')).toHaveAttribute(
    'data-line-color',
    '#ffffff',
    { timeout: 30_000 },
  )
  await expect(page.getByTestId('active-boundary')).toHaveAttribute('data-point-color', '#00e676')
  await expect(page.getByTestId('seed-preview')).toHaveCount(0)
})
