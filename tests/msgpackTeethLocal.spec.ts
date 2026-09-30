import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { decode } from '@msgpack/msgpack'
import { BufferGeometry, Float32BufferAttribute, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { BoundaryRegionColors } from '../src/page/msgpackTeeth/boundaryRegionColors'
import { boundaryPoints, ToothBoundary } from '../src/page/msgpackTeeth/boundaryEditor'
import {
  jawPaths,
  jawSource,
  readJawParts,
  readPayload,
  splitByLabels,
} from '../src/page/msgpackTeeth/geometry'

test('decodes and segments both jaws from an optional local msgpack sample', async () => {
  test.skip(!process.env.MSGPACK_SAMPLE, 'Set MSGPACK_SAMPLE to a local dental msgpack file')
  const value = decode(readFileSync(process.env.MSGPACK_SAMPLE!))
  const context = { console, setTimeout, clearTimeout } as Record<string, any>
  runInNewContext(
    readFileSync('node_modules/three/examples/jsm/libs/draco/draco_decoder.js', 'utf8'),
    context,
  )
  const draco = await context.DracoDecoderModule({})
  for (const jaw of ['lower', 'upper'] as const) {
    const paths = jawPaths(value, jaw)!
    expect(paths).not.toBeNull()
    const payload = readPayload(value, paths.mesh, paths.labels)
    const decoder = new draco.Decoder()
    const buffer = new draco.DecoderBuffer()
    const mesh = new draco.Mesh()
    const positions = new draco.DracoFloat32Array()
    const face = new draco.DracoInt32Array()
    const geometry = new BufferGeometry()
    try {
      buffer.Init(new Int8Array(payload.buffer), payload.buffer.byteLength)
      const status = decoder.DecodeBufferToMesh(buffer, mesh)
      expect(status.ok(), status.error_msg()).toBe(true)
      const attribute = decoder.GetAttribute(mesh, decoder.GetAttributeId(mesh, draco.POSITION))
      expect(decoder.GetAttributeFloatForAllPoints(mesh, attribute, positions)).toBe(true)
      geometry.setAttribute(
        'position',
        new Float32BufferAttribute(
          Array.from({ length: positions.size() }, (_, i) => positions.GetValue(i)),
          3,
        ),
      )
      const indices: number[] = []
      for (let i = 0; i < mesh.num_faces(); i++) {
        decoder.GetFaceFromMesh(mesh, i, face)
        indices.push(face.GetValue(0), face.GetValue(1), face.GetValue(2))
      }
      geometry.setIndex(indices)
      const result = splitByLabels(geometry, payload.labels, 'auto')
      expect(result.parts.length).toBeGreaterThan(1)
      expect(
        result.parts.reduce(
          (sum, part) => sum + part.geometry.getAttribute('position').count / 3,
          0,
        ),
      ).toBe(mesh.num_faces())
      const models = new Map(
        result.parts.map((part) => [
          part.label,
          new Mesh(
            part.geometry,
            new MeshStandardMaterial({ color: part.label === 0 ? 0x00ff00 : 0xff0000 }),
          ),
        ]),
      )
      const loops = new Map(
        result.parts
          .filter((part) => part.label > 0)
          .map((part) => [part.label, boundaryPoints(value, jaw, part.label, part.geometry)])
          .filter(
            (entry): entry is [number, Vector3[]] =>
              Array.isArray(entry[1]) && entry[1].length >= 3,
          ),
      )
      const colors = new BoundaryRegionColors(models, loops)
      const [tooth, loop] = loops.entries().next().value!
      const center = loop
        .reduce((sum, p) => sum.add(p), new Vector3())
        .multiplyScalar(1 / loop.length)
      colors.update(
        tooth,
        loop.map((p) => p.clone().lerp(center, 0.3)),
      )
      colors.update(tooth, loop)
      colors.dispose()
      models.forEach((model) => {
        model.geometry.dispose()
        model.material.dispose()
      })
      console.log(
        JSON.stringify({
          jaw,
          vertices: mesh.num_points(),
          faces: mesh.num_faces(),
          labels: payload.labels.length,
          partitions: result.parts.map((p) => p.label),
        }),
      )
      result.parts.forEach((part) => part.geometry.dispose())
      draco.destroy(status)
    } finally {
      geometry.dispose()
      for (const object of [face, positions, mesh, buffer, decoder]) draco.destroy(object)
    }
  }
})

test('decodes every tooth and gum from local presegmented samples without seg_labels', async () => {
  test.skip(!process.env.MSGPACK_TEETH_SAMPLES, 'Set MSGPACK_TEETH_SAMPLES to paths separated by |')
  const context = { console, setTimeout, clearTimeout } as Record<string, any>
  runInNewContext(
    readFileSync('node_modules/three/examples/jsm/libs/draco/draco_decoder.js', 'utf8'),
    context,
  )
  const draco = await context.DracoDecoderModule({})
  for (const path of process.env.MSGPACK_TEETH_SAMPLES!.split('|')) {
    const value = decode(readFileSync(path)) as Record<string, Record<string, unknown>>
    for (const jaw of ['lower', 'upper'] as const) {
      expect(jawSource(value, jaw)).toBe('teeth')
      const parts = readJawParts(value, jaw)
      expect(parts.map((part) => part.label)).toEqual([
        0,
        ...Object.keys(value[`${jaw}_teeth`]!)
          .map(Number)
          .sort((a, b) => a - b),
      ])
      let faceCount = 0
      for (const part of parts) {
        if (part.label > 0) {
          const points = boundaryPoints(value, jaw, part.label, new BufferGeometry())
          expect(points.length, `${jaw} ${part.label} boundary`).toBeGreaterThan(2)
          const boundary = new ToothBoundary(part.label, points, 0.1)
          expect(boundary.handles.length).toBeLessThanOrEqual(20)
          boundary.move(0, points[0]!.clone().addScalar(0.1))
          expect(boundary.line.geometry.getAttribute('position').getX(0)).toBeCloseTo(
            points[0]!.x + 0.1,
            4,
          )
          boundary.dispose()
        }
        const decoder = new draco.Decoder()
        const buffer = new draco.DecoderBuffer()
        const mesh = new draco.Mesh()
        try {
          buffer.Init(new Int8Array(part.buffer), part.buffer.byteLength)
          const status = decoder.DecodeBufferToMesh(buffer, mesh)
          expect(status.ok(), `${path}, ${jaw}, ${part.label}: ${status.error_msg()}`).toBe(true)
          expect(mesh.num_points()).toBeGreaterThan(0)
          expect(mesh.num_faces()).toBeGreaterThan(0)
          faceCount += mesh.num_faces()
          draco.destroy(status)
        } finally {
          for (const object of [mesh, buffer, decoder]) draco.destroy(object)
        }
      }
      console.log(JSON.stringify({ path, jaw, partitions: parts.length, faceCount }))
    }
  }
})
