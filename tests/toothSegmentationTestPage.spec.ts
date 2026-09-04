import { expect, test } from '@playwright/test'

const baseUrl = process.env.TOOTH_SEGMENTATION_TEST_BASE_URL ?? 'http://127.0.0.1:4176'

function createGridStl(z: number, cells: number, spacing: number) {
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
  for (let row = 0; row < cells; row += 1) {
    for (let column = 0; column < cells; column += 1) {
      const x = (column - cells / 2) * spacing
      const y = (row - cells / 2) * spacing
      const nextX = x + spacing
      const nextY = y + spacing
      addTriangle([[x, y, z], [nextX, y, z], [nextX, nextY, z]])
      addTriangle([[x, y, z], [nextX, nextY, z], [x, nextY, z]])
    }
  }
  return `solid jaw\n${facets.join('\n')}\nendsolid jaw`
}

async function installSmallJawFixtures(
  page: import('@playwright/test').Page,
  options: { cells?: number; spacing?: number; includeLowerTooth32?: boolean } = {},
) {
  const cells = options.cells ?? 60
  const spacing = options.spacing ?? 0.25
  const faceCount = cells * cells * 2
  await page.route('**/models/upper.stl', (route) =>
    route.fulfill({ body: createGridStl(0, cells, spacing), contentType: 'model/stl' }),
  )
  await page.route('**/models/lower.stl', (route) =>
    route.fulfill({ body: createGridStl(-18, cells, spacing), contentType: 'model/stl' }),
  )
  await page.route('**/points/upper.json', (route) =>
    route.fulfill({ json: { labels: new Array(faceCount * 3).fill(11) } }),
  )
  await page.route('**/points/lower.json', (route) =>
    route.fulfill({
      json: {
        labels: (() => {
          const labels = new Array(faceCount * 3).fill(31)
          if (options.includeLowerTooth32) labels.fill(32, 0, 3)
          return labels
        })(),
      },
    }),
  )
}

async function drawCircle(page: import('@playwright/test').Page, radius: number) {
  const canvas = page.locator('.drawing-canvas')
  const bounds = await canvas.boundingBox()
  expect(bounds).not.toBeNull()
  const center = { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 }
  await page.mouse.move(center.x + radius, center.y)
  await page.mouse.down()
  for (let step = 1; step <= 24; step += 1) {
    const angle = (Math.PI * 2 * step) / 24
    await page.mouse.move(center.x + Math.cos(angle) * radius, center.y + Math.sin(angle) * radius)
  }
  await page.mouse.up()
}

async function generateAndConfirmLowerJaw(
  page: import('@playwright/test').Page,
  radius = 34,
  segmentationAlreadyEnabled = false,
) {
  if (!segmentationAlreadyEnabled) await page.getByRole('button', { name: '分牙' }).click()
  await page.getByRole('button', { name: '上颌' }).click()
  await page.getByRole('button', { name: '重置视角' }).click()
  await drawCircle(page, radius)
  await page.getByRole('button', { name: '生成边界' }).click()
  await expect(page.getByTestId('active-boundary')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '确认分牙' }).click()
  await expect(page.getByRole('status')).toContainText('已确认分牙')
}

function boundaryPayload(toothId: number, points: Array<[number, number, number]>) {
  return JSON.stringify({
    boundaries: [
      {
        toothId,
        boundary: points.map((position) => ({ position, type: 'control' })),
      },
    ],
  })
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
  await drawCircle(page, 34)

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

  await page.getByLabel('当前牙号').fill('12')
  await page.getByRole('button', { name: '应用牙号' }).click()
  await drawCircle(page, 18)
  await expect(page.getByTestId('inactive-boundary')).toHaveAttribute(
    'data-line-color',
    '#35d07f',
  )
  await expect(page.getByTestId('inactive-boundary')).toHaveAttribute(
    'data-point-color',
    '#2474e8',
  )
})

test('keeps the seed preview when a generated boundary cannot be prepared', async ({ page }) => {
  await installSmallJawFixtures(page, { cells: 20, spacing: 1 })
  await page.route('**/toothGraphCut.worker.ts*', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `self.onmessage = ({ data }) => {
        const foregroundMask = data.foregroundMask
        self.postMessage({ jobId: data.jobId, foregroundMask }, [foregroundMask.buffer])
      }`,
    }),
  )
  await page.goto(`${baseUrl}/toothSegmentationTest`)
  await expect(page.getByRole('status')).toContainText('已加载上颌和下颌', {
    timeout: 30_000,
  })
  await page.getByRole('button', { name: '分牙' }).click()
  await page.getByRole('button', { name: '下颌' }).click()
  await page.getByRole('button', { name: '重置视角' }).click()
  await drawCircle(page, 34)

  const generateButton = page.getByRole('button', { name: '生成边界' })
  await generateButton.click()
  await expect(page.getByRole('status')).toContainText('重复 Boundary Points')
  await expect(page.getByTestId('seed-preview')).toHaveAttribute('data-color', '#ef6f91')
  await expect(page.getByTestId('active-boundary')).toHaveCount(0)
  await expect(generateButton).toBeEnabled()
})

test('confirms a lower-jaw region with its jaw key and required independent Mesh material', async ({ page }) => {
  await installSmallJawFixtures(page)
  await page.goto(`${baseUrl}/toothSegmentationTest`)
  await expect(page.getByRole('status')).toContainText('已加载上颌和下颌', { timeout: 30_000 })

  await generateAndConfirmLowerJaw(page)

  const region = page.locator('[data-testid="confirmed-region"][data-key="lower:31"]')
  await expect(region).toHaveCount(1)
  await expect(region).toHaveAttribute('data-key', 'lower:31')
  await expect(region).toHaveAttribute('data-material', 'MeshStandardMaterial')
  await expect(region).toHaveAttribute('data-color', '#35d07f')
  await expect(region).toHaveAttribute('data-opacity', '0.55')
  await expect(region).toHaveAttribute('data-depth-write', 'false')
})

test('keeps an existing confirmed Mesh when another tooth boundary overlaps it', async ({ page }) => {
  await installSmallJawFixtures(page, { includeLowerTooth32: true })
  await page.goto(`${baseUrl}/toothSegmentationTest`)
  await expect(page.getByRole('status')).toContainText('已加载上颌和下颌', { timeout: 30_000 })
  await page.locator('input[type="file"]').setInputFiles({
    name: 'overlap-boundary.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      boundaryPayload(32, [
        [-2, -2, -18],
        [2, -2, -18],
        [2, 2, -18],
        [-2, 2, -18],
      ]),
    ),
  })
  await expect(page.getByRole('status')).toContainText('恢复')

  await generateAndConfirmLowerJaw(page, 34, true)
  const confirmed = page.locator('[data-testid="confirmed-region"][data-key="lower:31"]')
  const originalUuid = await confirmed.getAttribute('data-uuid')
  await page.getByLabel('已保存').selectOption('32')
  await page.getByRole('button', { name: '确认分牙' }).click()

  await expect(page.getByRole('status')).toContainText('确认失败：当前区域与已确认区域重叠')
  await expect(confirmed).toHaveAttribute('data-uuid', originalUuid ?? '')
  await expect(page.getByTestId('confirmed-region')).toHaveCount(1)
})

test('reconfirms the same tooth by replacing its Mesh at the same jaw key', async ({ page }) => {
  await installSmallJawFixtures(page)
  await page.goto(`${baseUrl}/toothSegmentationTest`)
  await expect(page.getByRole('status')).toContainText('已加载上颌和下颌', { timeout: 30_000 })

  await generateAndConfirmLowerJaw(page, 34)
  const confirmed = page.locator('[data-testid="confirmed-region"][data-key="lower:31"]')
  const originalUuid = await confirmed.getAttribute('data-uuid')
  await drawCircle(page, 24)
  await page.getByRole('button', { name: '生成边界' }).click()
  await expect(page.getByTestId('active-boundary')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '确认分牙' }).click()

  await expect(page.getByTestId('confirmed-region')).toHaveCount(1)
  await expect(confirmed).toHaveAttribute('data-key', 'lower:31')
  await expect(confirmed).not.toHaveAttribute('data-uuid', originalUuid ?? '')
})
