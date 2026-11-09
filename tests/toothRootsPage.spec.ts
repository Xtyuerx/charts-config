import { test, expect } from '@playwright/test'
import { decode } from '@msgpack/msgpack'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { readStoredFrame } from '../src/page/toothRoots/core'
const { PNG } = createRequire(import.meta.url)('../node_modules/playwright-core/lib/utilsBundle.js')
test.setTimeout(60000)

test('real sample uses all stored axes and boundaries, preserves raw data and restores edits', async ({
  page,
}) => {
  const path =
    process.env.TOOTH_ROOTS_SAMPLE ?? 'E:/rs_zy/python_demo/mesh-processing-and-seg.msgpack'
  test.skip(!existsSync(path), 'Set TOOTH_ROOTS_SAMPLE to a local sample file')
  test.setTimeout(90000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const raw = decode(readFileSync(path)) as any
  await page.goto('http://127.0.0.1:4175/toothRoots')
  await expect(page.getByRole('status')).toContainText('已加载 28 颗牙', { timeout: 45000 })
  await page.getByLabel('选择本地 msgpack 或 hex').setInputFiles(path)
  await expect(page.getByRole('status')).toContainText('用户数据 · 原始轴 28/28 · 原始牙颈 28/28', {
    timeout: 45000,
  })
  await expect(page.locator('.warnings')).toHaveCount(0)
  await page.getByRole('button', { name: '31', exact: true }).click()
  await expect(page.locator('.frame-details')).toHaveText('原始单牙坐标系 · 原始牙颈边界')
  const frame = readStoredFrame(raw.lower_axis['31']),
    neck = raw.lower_gum.tooth_boundary_dict['31']
      .reduce((s: Vector3, p: number[]) => s.add(new Vector3().fromArray(p)), new Vector3())
      .divideScalar(raw.lower_gum.tooth_boundary_dict['31'].length)
  const expected = readStoredFrame(raw.lower_axis['31'], frame.origin.clone().sub(neck))
  const event = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出完整数据', exact: true }).click()
  const saved = decode(readFileSync((await (await event).path())!)) as any
  const edit = saved.lower_teeth['31'].editor
  expect(edit.schema).toBe('tooth-roots-v2')
  expect(new Vector3().fromArray(edit.position).distanceTo(expected.origin)).toBeLessThan(1e-5)
  expect(new Quaternion().fromArray(edit.quaternion).angleTo(expected.quaternion)).toBeLessThan(
    1e-5,
  )
  expect(saved.lower_seg).toEqual(raw.lower_seg)
  expect(saved.upper_seg).toEqual(raw.upper_seg)
  expect(saved.lower_axis).toEqual(raw.lower_axis)
  expect(saved.upper_axis).toEqual(raw.upper_axis)
  expect(saved.lower_gum.tooth_boundary_dict).toEqual(raw.lower_gum.tooth_boundary_dict)
  await page.screenshot({ path: 'test-results/tooth-roots-real-data.png', fullPage: true })
  await page.getByRole('button', { name: '沿 X +0.5', exact: true }).click()
  await page.getByRole('button', { name: '绕 Z +5°', exact: true }).click()
  const position = await page.locator('.selection p').innerText()
  const edited = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出完整数据', exact: true }).click()
  const file = (await (await edited).path())!
  await page
    .getByLabel('选择本地 msgpack 或 hex')
    .setInputFiles({
      name: 'edited.msgpack',
      mimeType: 'application/octet-stream',
      buffer: readFileSync(file),
    })
  await expect(page.getByRole('status')).toContainText('用户数据 · 原始轴 28/28', {
    timeout: 45000,
  })
  await page.getByRole('button', { name: '31', exact: true }).click()
  await expect(page.locator('.selection p')).toHaveText(position)
  expect(errors).toEqual([])
})

test('Ctrl picking, blue axis dragging and red arc dragging change only the selected tooth', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4175/toothRoots')
  await expect(page.getByRole('status')).toContainText('已加载 28 颗牙', { timeout: 45000 })
  const canvas = page.locator('canvas')
  let rect = (await canvas.boundingBox())!
  async function pixels(filter: (r: number, g: number, b: number) => boolean) {
    const png = PNG.sync.read(await canvas.screenshot()),
      points: { x: number; y: number }[] = []
    rect = (await canvas.boundingBox())! // Export buttons may scroll the page between drags.
    // Exclude HTML legends / hints drawn over the canvas screenshot.
    for (let y = 70; y < png.height - 45; y++)
      for (let x = 0; x < png.width; x++) {
        const i = (y * png.width + x) * 4
        if (filter(png.data[i], png.data[i + 1], png.data[i + 2]))
          points.push({ x: (x * rect.width) / png.width, y: (y * rect.height) / png.height })
      }
    return points
  }
  const pink = await pixels((r, g, b) => r > 180 && g > 100 && b > g + 6 && r > b + 10)
  expect(pink.length).toBeGreaterThan(100)
  const maxX = Math.max(...pink.map((p) => p.x)),
    right = pink.filter((p) => p.x > maxX - 24 && p.x < maxX - 14)
  const click = {
    x: right.reduce((s, p) => s + p.x, 0) / right.length,
    y: right.reduce((s, p) => s + p.y, 0) / right.length,
  }
  await page.keyboard.down('Control')
  await page.mouse.click(rect.x + click.x, rect.y + click.y)
  await page.keyboard.up('Control')
  await expect(page.locator('.selection h2')).toContainText('37')
  await page.getByRole('button', { name: '31', exact: true }).click()
  const before = await page.locator('.selection p').innerText()
  const blue = await pixels((r, g, b) => Math.abs(r - 89) < 12 && Math.abs(g - 156) < 12 && b > 240)
  expect(blue.length).toBeGreaterThan(5)
  const x = blue.reduce((s, p) => s + p.x, 0) / blue.length,
    y = (Math.min(...blue.map((p) => p.y)) + Math.max(...blue.map((p) => p.y))) / 2
  await page.mouse.move(rect.x + x, rect.y + y)
  await page.mouse.down()
  await page.mouse.move(rect.x + x, rect.y + y - 25, { steps: 10 })
  await page.mouse.up()
  await expect(page.locator('.selection p')).not.toHaveText(before)
  async function exported() {
    const event = page.waitForEvent('download')
    await page.getByRole('button', { name: '导出完整数据', exact: true }).click()
    return decode(readFileSync((await (await event).path())!)) as any
  }
  const translated = await exported()
  const red = await pixels(
    (r, g, b) => Math.abs(r - 232) < 8 && Math.abs(g - 90) < 8 && Math.abs(b - 105) < 8,
  )
  const rightX = Math.max(...red.map((p) => p.x)),
    arc = red.filter((p) => p.x > rightX - 2)
  expect(arc.length).toBeGreaterThan(0)
  const ax = arc.reduce((s, p) => s + p.x, 0) / arc.length,
    ay = arc.reduce((s, p) => s + p.y, 0) / arc.length
  await page.mouse.move(rect.x + ax, rect.y + ay)
  await page.mouse.down()
  await page.mouse.move(rect.x + ax - 10, rect.y + ay + 15, { steps: 10 })
  await page.mouse.up()
  const rotated = await exported()
  expect(rotated.lower_teeth['31'].editor.quaternion).not.toEqual(
    translated.lower_teeth['31'].editor.quaternion,
  )
  expect(rotated.lower_teeth['32']).toEqual(translated.lower_teeth['32'])
  expect(rotated.lower_seg).toEqual(translated.lower_seg)
})

test('invalid root length is reported without breaking the renderer', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('http://127.0.0.1:4175/toothRoots')
  await expect(page.getByRole('status')).toContainText('已加载 28 颗牙', { timeout: 45000 })
  await page.getByRole('button', { name: '31', exact: true }).click()
  await page.getByLabel('牙根长度').fill('0')
  await page.getByLabel('牙根长度').press('Tab')
  await expect(page.getByRole('status')).toContainText('牙根长度')
  expect(errors).toEqual([])
  await expect(page.getByLabel('牙根长度')).toHaveValue('12')
})

test('renders roots, independently edits teeth, exports full data and restores both jaws', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('http://127.0.0.1:4175/toothRoots')
  await expect(page.getByRole('status')).toContainText('已加载 28 颗牙', { timeout: 45000 })
  await expect(page.locator('.warnings')).toHaveCount(0)
  await page.getByRole('button', { name: '31', exact: true }).click()
  const original = await page.locator('.selection p').innerText()
  await page.getByRole('button', { name: '沿 X +0.5', exact: true }).click()
  await expect(page.locator('.selection p')).not.toHaveText(original)
  await page.getByRole('button', { name: '绕 Z +5°', exact: true }).click()
  await page.getByLabel('牙根长度').fill('15')
  await page.getByLabel('牙根长度').press('Tab')
  const position = await page.locator('.selection p').innerText()
  await page.getByRole('button', { name: '上颌', exact: true }).click()
  await page.getByRole('button', { name: '11', exact: true }).click()
  await page.getByRole('button', { name: '沿 X +0.5', exact: true }).click()
  await page.getByRole('button', { name: '下颌', exact: true }).click()
  await page.getByRole('button', { name: '31', exact: true }).click()
  await expect(page.locator('.selection p')).toHaveText(position)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出完整数据', exact: true }).click()
  const result = await download,
    bytes = readFileSync((await result.path())!)
  const data = decode(bytes) as any
  expect(data.lower_teeth['31'].editor.root.length).toBe(15)
  expect(data.upper_teeth['11'].editor.position).not.toEqual(data.upper_teeth['12'].editor.position)
  const beforeMesh = Buffer.from(data.lower_seg.mesh.data),
    beforeLabels = data.lower_seg.seg_labels
  await page.getByLabel('选择本地 msgpack 或 hex').setInputFiles({
    name: 'restored.msgpack',
    mimeType: 'application/octet-stream',
    buffer: bytes,
  })
  await expect(page.getByRole('status')).toContainText('内置示意数据')
  await page.getByRole('button', { name: '31', exact: true }).click()
  await expect(page.getByLabel('牙根长度')).toHaveValue('15')
  await expect(page.locator('.selection p')).toHaveText(position)
  const again = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出完整数据', exact: true }).click()
  const saved = decode(readFileSync((await (await again).path())!)) as any
  expect(Buffer.from(saved.lower_seg.mesh.data)).toEqual(beforeMesh)
  expect(saved.lower_seg.seg_labels).toEqual(beforeLabels)
  await page.screenshot({ path: 'test-results/tooth-roots-page.png', fullPage: true })
  expect(errors).toEqual([])
})
