import { expect, test } from '@playwright/test'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import {
  splitByLabels,
  readPayload,
  describePayload,
  jawPaths,
  jawSource,
  readJawParts,
} from '../src/page/msgpackTeeth/geometry'

test('already segmented jaws load tooth dictionaries with drc wrappers and optional gum', () => {
  const data = {
    lower_teeth: { '31': { type: 'drc', data: new Uint8Array([68, 82, 65, 67, 79]) } },
  }
  expect(jawSource(data, 'lower')).toBe('teeth')
  expect(jawSource(data, 'upper')).toBeNull()
  const parts = readJawParts(data, 'lower')
  expect(parts.map((p) => p.label)).toEqual([31])
  expect(parts[0]!.buffer.byteLength).toBe(5)
  expect(jawSource({ lower_teeth: {} }, 'lower')).toBeNull()
  expect(jawSource({ attachment_step_info: {} }, 'lower')).toBeNull()
})

test('a segmented jaw is preferred when both representations exist', () => {
  expect(
    jawSource({ lower_seg: { mesh: {}, seg_labels: [31] }, lower_teeth: { 31: {} } }, 'lower'),
  ).toBe('seg')
})

test('invalid individual teeth fail explicitly instead of silently disappearing', () => {
  expect(() =>
    readJawParts({ lower_teeth: { 31: { type: 'drc', data: new Uint8Array([1]) } } }, 'lower'),
  ).toThrow(/31.*DRACO/)
})

function square() {
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3),
  )
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  return geometry
}

test('face labels produce independent meshes without losing faces or coordinates', () => {
  const result = splitByLabels(square(), [11, 12], 'face')
  expect(result.parts.map((p) => p.label)).toEqual([11, 12])
  expect(Array.from(result.parts[1]!.geometry.getAttribute('position').array)).toEqual([
    0, 0, 0, 1, 1, 0, 0, 1, 0,
  ])
  expect(result.parts[0]!.geometry.getAttribute('normal').getZ(0)).toBeCloseTo(1)
})

test('vertex labels retain boundary faces with majority assignment', () => {
  const result = splitByLabels(square(), [11, 11, 12, 12], 'vertex')
  expect(result.parts.map((p) => [p.label, p.geometry.getAttribute('position').count])).toEqual([
    [11, 3],
    [12, 3],
  ])
  expect(result.boundaryFaces).toBe(2)
})

test('invalid labels and ambiguous automatic mode cannot silently missegment', () => {
  expect(() => splitByLabels(square(), [11], 'auto')).toThrow()
  expect(() => splitByLabels(square(), [11, NaN], 'face')).toThrow()
  const tetra = square().setIndex([0, 1, 2, 0, 2, 3, 0, 1, 3, 1, 2, 3])
  expect(() => splitByLabels(tetra, [11, 11, 12, 12], 'auto')).toThrow(/明确/)
})

test('payload copies only the Draco byte range, keeping labels safe from worker transfer', () => {
  const source = new Uint8Array([99, 68, 82, 65, 67, 79, 88])
  const result = readPayload({ mesh: source.subarray(1, 6), seg_labels: [11, 12] }, 'mesh')
  expect(Array.from(new Uint8Array(result.buffer))).toEqual([68, 82, 65, 67, 79])
  expect(result.buffer).not.toBe(source.buffer)
  expect(() => readPayload({ mesh: source, seg_labels: [11] }, 'mesh')).toThrow(/DRACO/)
})

test('missing mesh fields report available fields rather than a binary type error', () => {
  expect(() =>
    readPayload({ compressed_mesh: new Uint8Array(8), seg_labels: [11] }, 'mesh'),
  ).toThrow(/不存在.*compressed_mesh.*seg_labels/)
})

test('wrong mesh types report their actual type and binary lengths', () => {
  expect(() => readPayload({ mesh: { data: [68, 82] } }, 'mesh')).toThrow(/object.*data/)
  expect(() => readPayload({ mesh: 'RFJBQ08=' }, 'mesh')).toThrow(/string.*8/)
  expect(() => readPayload({ mesh: new Uint8Array(2) }, 'mesh')).toThrow(/2.*DRACO/)
})

test('payload diagnostics expose nested structure without dumping model arrays or strings', () => {
  const summary = describePayload({
    data: { compressed_mesh: new Uint8Array(1000), seg_labels: [11, 12, 13] },
    metadata: 'private-value-that-must-not-appear',
  })
  expect(summary).toContain('compressed_mesh')
  expect(summary).toContain('Uint8Array(1000 bytes)')
  expect(summary).toContain('Array(3)')
  expect(summary).not.toContain('private-value-that-must-not-appear')
})

test('reads an explicitly selected jaw without mixing its labels with the other jaw', () => {
  const binary = new Uint8Array([68, 82, 65, 67, 79])
  const data = {
    lower_seg: { mesh: binary, seg_labels: [31, 32] },
    upper_seg: { mesh: binary, seg_labels: [11, 12] },
  }
  expect(readPayload(data, 'lower_seg.mesh', 'lower_seg.seg_labels').labels).toEqual([31, 32])
  expect(readPayload(data, 'upper_seg.mesh', 'upper_seg.seg_labels').labels).toEqual([11, 12])
  expect(() => readPayload(data, 'lower_seg.missing', 'lower_seg.seg_labels')).toThrow(
    /lower_seg.missing.*不存在/,
  )
})

test('supports explicit label paths for top-level Draco binaries', () => {
  const data = {
    lower_preprocess_mesh: new Uint8Array([68, 82, 65, 67, 79]),
    lower_seg: { seg_labels: [31] },
  }
  expect(readPayload(data, 'lower_preprocess_mesh', 'lower_seg.seg_labels').labels).toEqual([31])
  expect(() => readPayload(data, 'lower_preprocess_mesh', 'upper_seg.seg_labels')).toThrow(
    /upper_seg.seg_labels.*不存在/,
  )
})

test('recognizes the actual drcp jaw wrapper and chooses matching mesh and labels', () => {
  const binary = new Uint8Array([68, 82, 65, 67, 79])
  const data = {
    lower_seg: { mesh: { type: 'drcp', data: binary }, seg_labels: [31, 32] },
    upper_seg: { mesh: { type: 'drcp', data: binary }, seg_labels: [11, 12] },
  }
  expect(jawPaths(data, 'lower')).toEqual({
    mesh: 'lower_seg.mesh',
    labels: 'lower_seg.seg_labels',
  })
  expect(readPayload(data, 'lower_seg.mesh', 'lower_seg.seg_labels').labels).toEqual([31, 32])
  expect(readPayload(data, 'upper_seg.mesh', 'upper_seg.seg_labels').labels).toEqual([11, 12])
  expect(jawPaths({}, 'lower')).toBeNull()
})
