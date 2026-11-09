import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { decode, encode } from '@msgpack/msgpack'
import {
  Box3,
  BufferGeometry,
  Float32BufferAttribute,
  PerspectiveCamera,
  Sphere,
  Vector3,
} from 'three'
import { SegmentationSession, sampleClosedLoop } from '../src/page/msgpackTeeth/segmentation'
import { boundaryPoints } from '../src/page/msgpackTeeth/boundaryEditor'

function fixture() {
  const positions: number[] = [],
    indices: number[] = [],
    labels: number[] = []
  for (let y = 0; y <= 16; y++)
    for (let x = 0; x <= 16; x++) {
      positions.push(x, y, 0)
      labels.push(x >= 5 && x <= 11 && y >= 5 && y <= 11 ? 44 : 0)
    }
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const a = y * 17 + x
      indices.push(a, a + 1, a + 18, a, a + 18, a + 17)
    }
  const context = { console, setTimeout, clearTimeout } as Record<string, any>
  runInNewContext(
    readFileSync('node_modules/three/examples/jsm/libs/draco/draco_encoder.js', 'utf8'),
    context,
  )
  const draco = context.DracoEncoderModule()
  const mesh = new draco.Mesh(),
    builder = new draco.MeshBuilder(),
    encoder = new draco.Encoder(),
    output = new draco.DracoInt8Array()
  let bytes: Uint8Array
  try {
    builder.AddFloatAttributeToMesh(
      mesh,
      draco.POSITION,
      labels.length,
      3,
      new Float32Array(positions),
    )
    builder.AddFacesToMesh(mesh, indices.length / 3, new Uint32Array(indices))
    encoder.SetEncodingMethod(draco.MESH_SEQUENTIAL_ENCODING)
    const size = encoder.EncodeMeshToDracoBuffer(mesh, output)
    bytes = Uint8Array.from({ length: size }, (_, i) => output.GetValue(i))
  } finally {
    for (const object of [mesh, builder, encoder, output]) draco.destroy(object)
  }
  const payload = {
    lower_seg: {
      mesh: { type: 'dcrp', data: bytes },
      seg_labels: labels,
      align_matrix: new Uint8Array([1, 2]),
      label_curvature: labels.map(() => 1),
      adj_tooth_ids: { 44: [45] },
    },
    upper_seg: { mesh: { type: 'drcp', data: bytes }, seg_labels: labels.map((n) => (n ? 11 : 0)) },
    lower_teeth: { original: new Uint8Array([1, 2, 3]) },
    metadata: 'unchanged',
  }
  const geometry = new BufferGeometry()
    .setAttribute('position', new Float32BufferAttribute(positions, 3))
    .setIndex(indices)
  return { payload, geometry, labels }
}

test('hex upload, real dragging, local label commit, jaw switching and complete binary/hex downloads', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const { payload, geometry, labels } = fixture()
  const session = new SegmentationSession(geometry, labels)
  const control = sampleClosedLoop(session.boundaries.get(44)!, 20)[0]!
  await page.goto(`${process.env.MSGPACK_TEST_URL ?? 'http://127.0.0.1:4175'}/msgpackTeeth`)
  await page.getByLabel('选择本地 msgpack').setInputFiles({
    name: 'jaw.hex',
    mimeType: 'text/plain',
    buffer: Buffer.from(Buffer.from(encode(payload)).toString('hex')),
  })
  await expect(page.getByRole('status')).toContainText('已加载 2 个分区', { timeout: 30000 })
  const canvas = page.locator('canvas'),
    box = (await canvas.boundingBox())!
  const bounds = new Box3(new Vector3(0, 0, 0), new Vector3(16, 16, 0)),
    sphere = bounds.getBoundingSphere(new Sphere())
  const camera = new PerspectiveCamera(40, box.width / box.height, 0.01, 10000)
  const vertical = Math.PI / 9,
    horizontal = Math.atan(Math.tan(vertical) * camera.aspect)
  const distance = (sphere.radius / Math.sin(Math.min(vertical, horizontal))) * 1.2
  camera.position
    .copy(sphere.center)
    .add(new Vector3(0, -0.65, 1).normalize().multiplyScalar(distance))
  camera.lookAt(sphere.center)
  camera.updateMatrixWorld()
  const screen = (p: Vector3) => {
    const q = p.clone().project(camera)
    return { x: box.x + ((q.x + 1) * box.width) / 2, y: box.y + ((1 - q.y) * box.height) / 2 }
  }
  const center = screen(new Vector3(8, 8, 0))
  await page.keyboard.down('Control')
  await page.mouse.click(center.x, center.y)
  await page.keyboard.up('Control')
  await expect(page.getByText(/已选中牙号 44/)).toBeVisible()
  const before = await canvas.screenshot()
  const from = screen(control),
    to = screen(control.clone().add(new Vector3(0, -1.3, 0)))
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 5 })
  expect((await canvas.screenshot()).equals(before)).toBe(false)
  await page.mouse.up()
  await expect(page.getByRole('status')).toContainText('已更新牙号 44')
  await expect(page.getByRole('status')).not.toContainText('；0 个局部')
  await page.mouse.click(box.x + 10, box.y + 10)
  const editedRender = await canvas.screenshot()
  async function download(hex = false) {
    const pending = page.waitForEvent('download')
    await page
      .getByRole('button', { name: hex ? '保存完整 hex' : '保存完整 msgpack', exact: true })
      .click()
    const file = await pending,
      path = (await file.path())!
    const raw = readFileSync(path)
    return decode(hex ? Buffer.from(raw.toString(), 'hex') : raw) as typeof payload
  }
  const saved = await download()
  expect((saved as any).boundary_editor?.version).toBe(1)
  const changed = saved.lower_seg.seg_labels.flatMap((n, i) => (n !== labels[i] ? [i] : []))
  expect(changed.length).toBeGreaterThan(0)
  expect(changed.every((i) => session.editableVertices.get(44)!.has(i))).toBe(true)
  expect(saved).toEqual({
    ...payload,
    lower_seg: { ...payload.lower_seg, seg_labels: saved.lower_seg.seg_labels },
    boundary_editor: (saved as any).boundary_editor,
  })
  await page.getByLabel('查看颌位').selectOption('upper')
  await expect(page.getByRole('status')).toContainText('已加载 2 个分区')
  expect(await download(true)).toEqual(saved)
  await page.getByLabel('查看颌位').selectOption('lower')
  await expect(page.getByRole('status')).toContainText('已加载 2 个分区')
  expect(await download()).toEqual(saved)
  await page.keyboard.down('Control')
  await page.mouse.click(center.x, center.y)
  await page.keyboard.up('Control')
  await page.getByRole('button', { name: '重置选中边界' }).click()
  await expect(page.getByRole('status')).toContainText('已重置牙号 44')
  expect(await download()).toEqual(payload)
  // Reload a downloaded package through a fresh page, without in-memory edit history.
  await page.reload()
  await page.getByLabel('选择本地 msgpack').setInputFiles({
    name: 'original.msgpack',
    mimeType: 'application/msgpack',
    buffer: Buffer.from(encode(payload)),
  })
  await expect(page.getByRole('status')).toContainText('已加载 2 个分区')
  await page.getByLabel('显示边界').uncheck()
  const originalRender = await canvas.screenshot()
  await page.getByLabel('选择本地 msgpack').setInputFiles({
    name: 'saved-edited.msgpack',
    mimeType: 'application/msgpack',
    buffer: Buffer.from(encode(saved)),
  })
  await expect(page.getByRole('status')).toContainText('已加载 2 个分区')
  expect(await download()).toEqual(saved)
  expect((await canvas.screenshot()).equals(originalRender)).toBe(false)
  await page.getByLabel('显示边界').check()
  const reloadedRender = await canvas.screenshot()
  await test.info().attach('edited', { body: editedRender, contentType: 'image/png' })
  await test.info().attach('reloaded', { body: reloadedRender, contentType: 'image/png' })
  expect(reloadedRender.equals(editedRender)).toBe(true)
  expect(errors).toEqual([])
  geometry.dispose()
})

test('a custom-field candidate remains inspectable without blocking the active jaw, then loads manually', async ({
  page,
}) => {
  const { payload, geometry, labels } = fixture()
  await page.goto(`${process.env.MSGPACK_TEST_URL ?? 'http://127.0.0.1:4175'}/msgpackTeeth`)
  await page.getByLabel('选择本地 msgpack').setInputFiles({
    name: 'original.msgpack',
    mimeType: 'application/msgpack',
    buffer: Buffer.from(encode(payload)),
  })
  await expect(page.getByRole('status')).toContainText('已加载 2 个分区')
  const custom = { custom: { mesh: payload.lower_seg.mesh, labels }, metadata: 'keep' }
  await page.getByLabel('选择本地 msgpack').setInputFiles({
    name: 'custom.msgpack',
    mimeType: 'application/msgpack',
    buffer: Buffer.from(encode(custom)),
  })
  await expect(page.getByRole('status')).toContainText('未包含可识别')
  await expect(page.getByRole('button', { name: '应用字段路径' })).toBeEnabled()
  await page.getByLabel('查看对象').selectOption('')
  await expect(page.locator('.payload-structure pre')).toContainText('custom')
  await page.getByLabel('查看颌位').selectOption('upper')
  await expect(page.getByRole('status')).toContainText('已加载 2 个分区')
  await expect(page.getByText('牙号 11', { exact: true })).toBeVisible()
  await page.getByLabel('Draco 字段路径').fill('custom.mesh')
  await page.getByLabel('标签字段路径').fill('custom.labels')
  await page.getByRole('button', { name: '应用字段路径' }).click()
  await expect(page.getByRole('status')).toContainText('已加载 2 个分区')
  await expect(page.getByText('牙号 44', { exact: true })).toBeVisible()
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存完整 msgpack', exact: true }).click()
  const downloaded = await pending
  expect(decode(readFileSync((await downloaded.path())!))).toEqual(custom)
  geometry.dispose()
})

test('preview-only data persists dragged boundary points and restores them in a fresh page', async ({
  page,
}) => {
  const { payload, geometry } = fixture()
  const preview = { mesh: payload.lower_seg.mesh, seg_labels: Array(512).fill(44) }
  await page.goto(`${process.env.MSGPACK_TEST_URL ?? 'http://127.0.0.1:4175'}/msgpackTeeth`)
  await page.getByLabel('选择本地 msgpack').setInputFiles({
    name: 'face-labels.msgpack',
    mimeType: 'application/msgpack',
    buffer: Buffer.from(encode(preview)),
  })
  await expect(page.getByRole('status')).toContainText('已加载 1 个分区')
  const canvas = page.locator('canvas'),
    box = (await canvas.boundingBox())!
  const camera = new PerspectiveCamera(40, box.width / box.height, 0.01, 10000)
  const radius = Math.sqrt(128),
    halfFov = Math.PI / 9
  const distance =
    (radius / Math.sin(Math.min(halfFov, Math.atan(Math.tan(halfFov) * camera.aspect)))) * 1.2
  camera.position
    .copy(new Vector3(8, 8, 0))
    .add(new Vector3(0, -0.65, 1).normalize().multiplyScalar(distance))
  camera.lookAt(8, 8, 0)
  camera.updateMatrixWorld()
  const screen = (point: Vector3) => {
    const p = point.clone().project(camera)
    return { x: box.x + ((p.x + 1) * box.width) / 2, y: box.y + ((1 - p.y) * box.height) / 2 }
  }
  const point = boundaryPoints(null, 'lower', 44, geometry)[0]!
  const from = screen(point),
    to = screen(point.clone().add(new Vector3(1, 1, 0)))
  const originalRender = await canvas.screenshot()
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 5 })
  await page.mouse.up()
  await expect(page.getByRole('status')).toContainText('已保存牙号 44 的边界点位')
  await page.mouse.click(box.x + 10, box.y + 10)
  const editedRender = await canvas.screenshot()
  expect(editedRender.equals(originalRender)).toBe(false)
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存完整 msgpack', exact: true }).click()
  const file = await pending
  const savedBytes = readFileSync((await file.path())!)
  const saved = decode(savedBytes) as typeof preview & { boundary_editor: unknown }
  expect(saved).toEqual({ ...preview, boundary_editor: saved.boundary_editor })
  expect(saved.boundary_editor).toBeDefined()
  await expect(page.getByRole('status')).toContainText('边界点位已包含在文件中')
  await page.reload()
  await page.getByLabel('选择本地 msgpack').setInputFiles({
    name: 'saved.msgpack',
    mimeType: 'application/msgpack',
    buffer: savedBytes,
  })
  await expect(page.getByRole('status')).toContainText('已加载 1 个分区')
  const reloadedRender = await canvas.screenshot()
  await test.info().attach('preview-edited', { body: editedRender, contentType: 'image/png' })
  await test.info().attach('preview-reloaded', { body: reloadedRender, contentType: 'image/png' })
  const difference = await page.evaluate(async ([a, b]) => {
    const pixels = async (data: string) => {
      const image = new Image()
      image.src = `data:image/png;base64,${data}`
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.width; canvas.height = image.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(image, 0, 0)
      return ctx.getImageData(0, 0, image.width, image.height).data
    }
    const before = await pixels(a!), after = await pixels(b!)
    let changed = 0, maxDifference = 0
    for (let i = 0; i < before.length; i += 4) {
      const delta = Math.max(...[0, 1, 2].map((j) => Math.abs(before[i + j]! - after[i + j]!)))
      if (delta) changed++
      maxDifference = Math.max(maxDifference, delta)
    }
    return { changed, maxDifference, pixels: before.length / 4 }
  }, [editedRender.toString('base64'), reloadedRender.toString('base64')])
  console.log(JSON.stringify(difference))
  expect(reloadedRender.equals(editedRender)).toBe(true)
  geometry.dispose()
})

test('a rejected restored preview keeps the previously loaded model and payload', async ({
  page,
}) => {
  const { payload, geometry } = fixture()
  await page.goto(`${process.env.MSGPACK_TEST_URL ?? 'http://127.0.0.1:4175'}/msgpackTeeth`)
  const upload = async (value: unknown) =>
    page.getByLabel('选择本地 msgpack').setInputFiles({
      name: 'fixture.msgpack',
      mimeType: 'application/msgpack',
      buffer: Buffer.from(encode(value)),
    })
  await upload(payload)
  await expect(page.getByRole('status')).toContainText('已加载 2 个分区')
  const invalid = {
    mesh: payload.lower_seg.mesh,
    seg_labels: Array(512).fill(44),
    boundary_editor: {
      version: 1,
      scopes: {
        'lower:mesh|seg_labels': {
          '44': {
            kind: 'preview',
            points: [
              [0, 0, 0],
              [16, 0, 0],
              [16, 16, 0],
              [0, 16, 0],
            ],
            controls: [
              [0, 0, 0],
              [16, 16, 0],
              [16, 0, 0],
              [0, 16, 0],
            ],
          },
        },
      },
    },
  }
  await upload(invalid)
  await expect(page.getByRole('status')).toContainText(/自交|内外|分隔/)
  await expect(page.getByText('0 · 背景 / 牙龈', { exact: true })).toBeVisible()
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存完整 msgpack', exact: true }).click()
  const file = await pending
  expect(decode(readFileSync((await file.path())!))).toEqual(payload)
  geometry.dispose()
})
