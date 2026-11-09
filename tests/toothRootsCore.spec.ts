import { test, expect } from '@playwright/test'
import { decode, encode } from '@msgpack/msgpack'
import {
  BufferGeometry,
  Float32BufferAttribute,
  CylinderGeometry,
  Group,
  Matrix4,
  Vector3,
} from 'three'
import * as roots from '../src/page/toothRoots/core'

function packedMatrix(matrix: Matrix4, width: 4 | 8 = 8) {
  const rows = matrix.clone().transpose().toArray()
  const tail = Buffer.from(`|4,4,<f${width}`)
  const bytes = Buffer.alloc(rows.length * width + tail.length)
  rows.forEach((v, i) =>
    width === 8 ? bytes.writeDoubleLE(v, i * width) : bytes.writeFloatLE(v, i * width),
  )
  tail.copy(bytes, rows.length * width)
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

test('stored axis is decoded as row-major world-to-local, inverted and mapped with local Y as display Z', () => {
  const world = new Matrix4().makeRotationZ(0.4).setPosition(12, -8, 3)
  const bytes = packedMatrix(world.clone().invert())
  const frame = roots.readStoredFrame(bytes, new Vector3(0, 1, 0))
  expect(frame.origin.distanceTo(new Vector3(12, -8, 3))).toBeLessThan(1e-8)
  const expectedZ = new Vector3(0, 1, 0).transformDirection(world)
  expect(frame.z.distanceTo(expectedZ)).toBeLessThan(1e-8)
  expect(frame.x.dot(frame.z)).toBeCloseTo(0)
  expect(new Vector3().crossVectors(frame.x, frame.y).distanceTo(frame.z)).toBeLessThan(1e-8)
  expect(() => roots.readStoredFrame(bytes.subarray(1), expectedZ)).toThrow()
  const nonRigid = packedMatrix(new Matrix4().makeScale(2, 1, 1))
  expect(() => roots.readStoredFrame(nonRigid, expectedZ)).toThrow()
})

test('real boundary and stored axis take precedence over the root hint without moving raw crown vertices', () => {
  const geometry = new CylinderGeometry(2, 2, 4, 16, 1, false).toNonIndexed()
  const boundary = Array.from({ length: 16 }, (_, i) => [
    2 * Math.cos((i * Math.PI) / 8),
    -2,
    2 * Math.sin((i * Math.PI) / 8),
  ])
  const source = {
    lower_axis: { 31: packedMatrix(new Matrix4().makeTranslation(-1, 0, 0)) },
    lower_gum: { tooth_boundary_dict: { 31: boundary } },
  }
  const before = Array.from(geometry.getAttribute('position').array)
  const result = roots.extractTeeth(
    geometry,
    Array(geometry.getAttribute('position').count).fill(31),
    'lower',
    'vertex',
    new Vector3(0, 0, -1),
    source,
  )
  const tooth = result.teeth[0]!
  expect(tooth.frameSource).toBe('stored-axis')
  expect(tooth.neckSource).toBe('stored-boundary')
  expect(tooth.neck.length).toBe(16)
  expect(tooth.originalPosition.x).toBeCloseTo(1)
  expect(
    new Vector3(0, 0, 1).applyQuaternion(tooth.originalQuaternion).distanceTo(new Vector3(0, 1, 0)),
  ).toBeLessThan(1e-8)
  const p = tooth.crown.geometry.getAttribute('position')
  tooth.group.updateMatrixWorld(true)
  for (let i = 0; i < p.count; i++) {
    const v = new Vector3().fromBufferAttribute(p, i).applyMatrix4(tooth.group.matrixWorld)
    expect(
      v.distanceTo(new Vector3(...(before.slice(i * 3, i * 3 + 3) as [number, number, number]))),
    ).toBeLessThan(1e-5)
  }
  expect(Array.from(geometry.getAttribute('position').array)).toEqual(before)
})

test('root hint resolves stored-axis sign before choosing a fallback open neck', () => {
  const geometry = new CylinderGeometry(2, 2, 4, 16, 1, true).toNonIndexed()
  const source = { lower_axis: { 31: packedMatrix(new Matrix4()) } }
  const tooth = roots.extractTeeth(
    geometry,
    Array(geometry.getAttribute('position').count).fill(31),
    'lower',
    'vertex',
    new Vector3(0, 1, 0),
    source,
  ).teeth[0]!
  const worldNeck = tooth.neck.map((p) =>
    p.clone().applyQuaternion(tooth.originalQuaternion).add(tooth.originalPosition),
  )
  expect(worldNeck.every((p) => Math.abs(p.y - 2) < 1e-5)).toBe(true)
  expect(
    new Vector3(0, 0, -1)
      .applyQuaternion(tooth.originalQuaternion)
      .distanceTo(new Vector3(0, 1, 0)),
  ).toBeLessThan(1e-5)
})

test('root shaft remains regular below an uneven neck instead of extending neck spikes to the root tip', () => {
  const neck = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4,
      r = i % 2 ? 4 : 2
    return new Vector3(r * Math.cos(a), r * Math.sin(a), 0)
  })
  const positions: number[] = []
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4
    positions.push(Math.cos(a), Math.sin(a), -0.5)
  }
  const template = new BufferGeometry().setAttribute(
    'position',
    new Float32BufferAttribute(positions, 3),
  )
  const geometry = roots.fitRoot(template, neck, 12),
    p = geometry.getAttribute('position')
  const radii = Array.from({ length: p.count }, (_, i) => Math.hypot(p.getX(i), p.getY(i)))
  expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(1e-5)
  expect(Array.from({ length: p.count }, (_, i) => p.getZ(i))).toEqual(Array(p.count).fill(-6))
})

test('v2 save records its base frame and restores the same world delta after a frame change', () => {
  const geometry = new CylinderGeometry(2, 2, 4, 16, 1, true).toNonIndexed(),
    labels = Array(geometry.getAttribute('position').count).fill(31)
  const tooth = roots.extractTeeth(geometry, labels, 'lower', 'vertex', new Vector3(0, -1, 0))
    .teeth[0]!
  tooth.group.position.add(new Vector3(3, 4, 5))
  tooth.group.rotateZ(0.2)
  tooth.group.updateMatrix()
  const delta = tooth.group.matrix
    .clone()
    .multiply(new Matrix4().fromArray(tooth.group.userData.baseFrame).invert())
  const document = roots.parseDocument(roots.saveDocument({ lower_teeth: {} }, [tooth]))
  expect(document.lower_teeth['31'].editor.schema).toBe('tooth-roots-v2')
  const base = new Matrix4().makeRotationX(0.3).setPosition(7, 8, 9)
  tooth.group.userData.baseFrame = base.toArray()
  roots.restoreTooth(document, tooth)
  tooth.group.updateMatrix()
  const expected = delta.multiply(base)
  tooth.group.matrix.elements.forEach((v, i) => expect(v).toBeCloseTo(expected.elements[i]!, 6))
})
import {
  parseDocument,
  cervicalLoop,
  saveDocument,
  uploadDocument,
} from '../src/page/toothRoots/core'

test('hex parsing and saving preserve source bytes, labels, unknown fields and other jaw', () => {
  const raw = {
    lower_seg: { mesh: { type: 'float32', data: new Uint8Array([1, 2, 3, 4]) }, seg_labels: [31] },
    lower_teeth: { '31': { note: 'keep', editor: { custom: 'keep-editor' } } },
    upper_teeth: { '11': { note: 'upper' } },
    extra: 'opaque',
  }
  const hex = Array.from(encode(raw), (v) => v.toString(16).padStart(2, '0')).join(' ')
  const source = parseDocument(hex)
  const group = new Group()
  group.position.set(1, 2, 3)
  const saved = decode(
    saveDocument(source, [
      { id: 31, jaw: 'lower', group, root: { template: '31.obj', length: 12 } },
    ]),
  ) as typeof raw & { lower_teeth: Record<string, any> }
  expect(saved.lower_seg).toEqual(raw.lower_seg)
  expect(saved.upper_teeth).toEqual(raw.upper_teeth)
  expect(saved.extra).toBe('opaque')
  expect(saved.lower_teeth['31'].note).toBe('keep')
  expect(saved.lower_teeth['31'].editor.custom).toBe('keep-editor')
  expect(saved.lower_teeth['31'].editor.position).toEqual([1, 2, 3])
  expect((source.lower_teeth as any)['31'].editor).toEqual({ custom: 'keep-editor' })
  expect(() => parseDocument('0xzz')).toThrow()
})

test('cervical loop welds duplicated triangle vertices and finds a closed neck', () => {
  const geometry = new CylinderGeometry(2, 2, 4, 16, 1, true).toNonIndexed()
  const loop = cervicalLoop(geometry)
  expect(loop.length).toBe(16)
  expect(new Set(loop.map((p) => p.y)).size).toBe(1)
  expect(loop.every((p) => Math.abs(Math.hypot(p.x, p.z) - 2) < 1e-5)).toBe(true)
})

test('unknown uint64 fields survive decode and full-data save without rounding', () => {
  const raw = { lower_teeth: {}, counter: 9007199254740993n }
  const source = parseDocument(encode(raw, { useBigInt64: true }))
  const saved = decode(saveDocument(source, []), { useBigInt64: true }) as typeof raw
  expect(saved.counter).toBe(raw.counter)
})

test('upload order is version, path, full binary PUT, update; PUT failure stops update', async () => {
  const calls: string[] = []
  const api = {
    getUpdateEditVersion: async () => {
      calls.push('version')
      return 'v2'
    },
    getUploadPath: async () => {
      calls.push('path')
      return { url: 'https://oss.example/data', key: 'data' }
    },
    update: async () => {
      calls.push('update')
    },
  }
  const body = encode({ lower_teeth: {}, extra: 7 })
  await uploadDocument(body, api, async (_url, options) => {
    calls.push('PUT')
    expect(options?.method).toBe('PUT')
    expect(Array.from(new Uint8Array(options?.body as ArrayBuffer))).toEqual(Array.from(body))
    return new Response('', { status: 200 })
  })
  expect(calls).toEqual(['version', 'path', 'PUT', 'update'])
  calls.length = 0
  await expect(
    uploadDocument(body, api, async () => new Response('', { status: 403 })),
  ).rejects.toThrow('403')
  expect(calls).toEqual(['version', 'path'])
})
