import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { decode } from '@msgpack/msgpack'

test('loads both jaws of an optional real local msgpack and preserves the original download', async ({
  page,
}) => {
  test.skip(!process.env.MSGPACK_LOAD_SAMPLE, 'Set MSGPACK_LOAD_SAMPLE to a local msgpack')
  test.setTimeout(300000)
  const path = process.env.MSGPACK_LOAD_SAMPLE!
  const original = decode(readFileSync(path))
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const loaded = async () => {
    const status = page.getByRole('status')
    await expect
      .poll(
        async () =>
          status.evaluate(
            (element) =>
              element.classList.contains('error') || element.textContent?.startsWith('已加载'),
          ),
        { timeout: 120000 },
      )
      .toBeTruthy()
    console.log(await status.textContent())
    await expect(status).toContainText('已加载')
  }
  await page.goto(`${process.env.MSGPACK_TEST_URL ?? 'http://127.0.0.1:4175'}/msgpackTeeth`)
  await page.getByLabel('选择本地 msgpack').setInputFiles(path)
  await loaded()
  const jaws = page.getByLabel('查看颌位')
  if (await jaws.isVisible()) {
    await jaws.selectOption('upper')
    await loaded()
    await jaws.selectOption('lower')
    await loaded()
  }
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存完整 msgpack', exact: true }).click()
  const file = await pending
  expect(decode(readFileSync((await file.path())!))).toEqual(original)
  expect(errors).toEqual([])
})
