import { expect, test } from '@playwright/test'
import * as THREE from 'three'

import {
  buildGraphCutProblem,
  buildToothGraphCutRoi,
  buildToothGraphTopology,
  graphCutWeights,
  robustMad,
  robustMedian,
  robustNormalize,
  type ToothGraphTopology,
} from '../src/page/toothSegmentationTest/utils/toothGraphCutUtils'

function createFoldedFanGeometry() {
  const geometry = new THREE.BufferGeometry()
  const ring = Array.from({ length: 8 }, (_, index) => {
    const angle = (index / 8) * Math.PI * 2
    return new THREE.Vector3(Math.cos(angle), Math.sin(angle), index % 2 ? 0.25 : 0)
  })
  const positions: number[] = []
  for (let index = 0; index < ring.length; index += 1) {
    const next = ring[(index + 1) % ring.length]!
    positions.push(0, 0, 0, ring[index]!.x, ring[index]!.y, ring[index]!.z, next.x, next.y, next.z)
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return geometry
}

function oversizedTopology(faceCount: number): ToothGraphTopology {
  return {
    faceCenters: new Float32Array(faceCount * 3),
    faceNormals: new Float32Array(faceCount * 3),
    faceAreas: new Float32Array(faceCount),
    neighborOffsets: new Uint32Array(faceCount + 1),
    neighborFaces: new Uint32Array(),
    sharedEdgeLengths: new Float32Array(),
    signedDihedrals: new Float32Array(),
    curvatureDiffs: new Float32Array(),
  }
}

test('builds finite bidirectional folded-face topology and an ROI bounded by seed geodesics', () => {
  const topology = buildToothGraphTopology(createFoldedFanGeometry())

  expect(Array.from(topology.neighborOffsets)).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16])
  for (let face = 0; face < 8; face += 1) {
    const neighbors = Array.from(
      topology.neighborFaces.slice(topology.neighborOffsets[face]!, topology.neighborOffsets[face + 1]!),
    )
    expect(neighbors).toHaveLength(2)
    neighbors.forEach((neighbor) => {
      const reverse = Array.from(
        topology.neighborFaces.slice(
          topology.neighborOffsets[neighbor]!,
          topology.neighborOffsets[neighbor + 1]!,
        ),
      )
      expect(reverse).toContain(face)
    })
  }
  ;[
    topology.faceCenters,
    topology.faceNormals,
    topology.faceAreas,
    topology.sharedEdgeLengths,
    topology.signedDihedrals,
    topology.curvatureDiffs,
  ].forEach((values) => Array.from(values).forEach((value) => expect(Number.isFinite(value)).toBe(true)))

  const roi = buildToothGraphCutRoi(topology, [2, 0, 1], [7, 5, 6])
  expect(Array.from(roi.faceIndices)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  expect(roi.seedDiameter).toBeGreaterThan(0)
  expect(Array.from(roi.foregroundMask)).toEqual([1, 1, 1, 0, 0, 0, 0, 0])
  expect(Array.from(roi.backgroundMask)).toEqual([0, 0, 0, 0, 0, 1, 1, 1])
})

test('rejects an ROI whose source mesh exceeds the hard face limit instead of truncating it', () => {
  expect(() => buildToothGraphCutRoi(oversizedTopology(40_001), [0, 1, 2], [3, 4, 5])).toThrow(
    'Graph Cut 面数超过 40000',
  )
})

test('does not allow maxFaces to raise the fixed 40,000-face safety limit', () => {
  expect(() =>
    buildToothGraphCutRoi(oversizedTopology(40_001), [0, 1, 2], [3, 4, 5], { maxFaces: 50_000 }),
  ).toThrow('Graph Cut 面数超过 40000')
})

test('uses MAD with a unit fallback and builds deterministic finite non-negative capacities', () => {
  expect(robustMedian([9, 1, 3])).toBe(3)
  expect(robustMad([1, 3, 9], 3)).toBe(2)
  expect(robustNormalize([4, 4, 4])).toEqual([0, 0, 0])
  expect(graphCutWeights).toEqual({
    normalAngle: 2.5,
    concavity: 3.0,
    curvature: 1.5,
    geodesic: 2.0,
    foregroundNormal: 1.0,
    relativeHeight: 0.75,
  })

  const topology = buildToothGraphTopology(createFoldedFanGeometry())
  const first = buildGraphCutProblem(
    topology,
    buildToothGraphCutRoi(topology, [2, 0, 1], [7, 5, 6]),
  )
  const second = buildGraphCutProblem(
    topology,
    buildToothGraphCutRoi(topology, [1, 2, 0], [6, 7, 5]),
  )

  expect(Array.from(first.roiFaceIndices)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  expect(Array.from(first.edgeFrom)).toEqual(Array.from(second.edgeFrom))
  expect(Array.from(first.edgeTo)).toEqual(Array.from(second.edgeTo))
  expect(Array.from(first.edgeCapacity)).toEqual(Array.from(second.edgeCapacity))
  expect(Array.from(first.sourceCapacity)).toEqual(Array.from(second.sourceCapacity))
  expect(Array.from(first.sinkCapacity)).toEqual(Array.from(second.sinkCapacity))
  ;[first.edgeCapacity, first.sourceCapacity, first.sinkCapacity].forEach((capacities) =>
    Array.from(capacities).forEach((capacity) => {
      expect(Number.isFinite(capacity)).toBe(true)
      expect(capacity).toBeGreaterThanOrEqual(0)
    }),
  )
})
