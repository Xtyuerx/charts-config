import { expect, test } from '@playwright/test'
import { encode } from '@msgpack/msgpack'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

// Real Draco encoding: the browser must exercise its worker and WASM decoder.
function fixture() {
  const context = { console, setTimeout, clearTimeout } as Record<string, any>
  runInNewContext(
    readFileSync('node_modules/three/examples/jsm/libs/draco/draco_encoder.js', 'utf8'),
    context,
  )
  const draco = context.DracoEncoderModule()
  const mesh = new draco.Mesh()
  const builder = new draco.MeshBuilder()
  const encoder = new draco.Encoder()
  const output = new draco.DracoInt8Array()
  try {
    builder.AddFloatAttributeToMesh(
      mesh,
      draco.POSITION,
      4,
      3,
      new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
    )
    builder.AddFacesToMesh(mesh, 2, new Uint32Array([0, 1, 2, 0, 2, 3]))
    encoder.SetEncodingMethod(draco.MESH_SEQUENTIAL_ENCODING)
    const size = encoder.EncodeMeshToDracoBuffer(mesh, output)
    const binary = Uint8Array.from({ length: size }, (_, i) => output.GetValue(i))
    return Buffer.from(encode({ mesh: binary, seg_labels: [11, 12] }))
  } finally {
    for (const object of [mesh, builder, encoder, output]) draco.destroy(object)
  }
}

test('fetches a real msgpack, decodes Draco, renders tooth meshes and recovers from invalid input', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const buffer = fixture()
  await page.route('**/models/jaw.msgpack', (route) =>
    route.fulfill({ contentType: 'application/octet-stream', body: buffer }),
  )
  await page.goto('http://127.0.0.1:4175/msgpackTeeth')
  await page.getByRole('button', { name: '加载 URL' }).click()
  await expect(page.getByRole('status')).toContainText('已加载 2 个分区', { timeout: 30000 })
  await expect(page.getByText('牙号 11', { exact: true })).toBeVisible()
  await expect(page.getByText('牙号 12', { exact: true })).toBeVisible()
  await expect(page.locator('canvas')).toBeVisible()
  const before = await page.locator('canvas').screenshot()
  await page.getByLabel('牙号 11', { exact: true }).uncheck()
  await page.getByLabel('牙号 12', { exact: true }).uncheck()
  await expect
    .poll(async () => (await page.locator('canvas').screenshot()).equals(before))
    .toBe(false)
  await page
    .getByLabel('选择本地 msgpack')
    .setInputFiles({
      name: 'bad.msgpack',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(encode({ mesh: new Uint8Array([1]), seg_labels: [1] })),
    })
  await expect(page.getByRole('status')).toContainText('DRACO 文件头')
  await expect(page.getByText('牙号 11', { exact: true })).toBeVisible()
  await page
    .getByLabel('选择本地 msgpack')
    .setInputFiles({ name: 'good.msgpack', mimeType: 'application/octet-stream', buffer })
  await expect(page.getByRole('status')).toContainText('已加载 2 个分区')
  expect(errors).toEqual([])
})
