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

function createLinearTopology(faceCount = 8, extreme = false): ToothGraphTopology {
  const centers = new Float32Array(faceCount * 3)
  const normals = new Float32Array(faceCount * 3)
  const areas = new Float32Array(faceCount)
  const offsets = new Uint32Array(faceCount + 1)
  const neighbors: number[] = []
  const lengths: number[] = []
  const dihedrals: number[] = []
  const curvature: number[] = []
  for (let face = 0; face < faceCount; face += 1) {
    centers[face * 3] = extreme ? face * 1e30 : face
    normals[face * 3 + (face === 6 ? 0 : 2)] = 1
    areas[face] = 1
    if (face > 0) {
      neighbors.push(face - 1)
      lengths.push(extreme ? 1e30 : 1)
      dihedrals.push(face === 6 ? Math.PI / 2 : 0)
      curvature.push(extreme ? 1e30 : face === 6 ? 10 : 0)
    }
    if (face + 1 < faceCount) {
      neighbors.push(face + 1)
      lengths.push(extreme ? 1e30 : 1)
      dihedrals.push(face === 5 ? Math.PI / 2 : 0)
      curvature.push(extreme ? 1e30 : face === 5 ? 10 : 0)
    }
    offsets[face + 1] = neighbors.length
  }
  return {
    faceCenters: centers,
    faceNormals: normals,
    faceAreas: areas,
    neighborOffsets: offsets,
    neighborFaces: Uint32Array.from(neighbors),
    sharedEdgeLengths: Float32Array.from(lengths),
    signedDihedrals: Float32Array.from(dihedrals),
    curvatureDiffs: Float32Array.from(curvature),
  }
}

function edgeCapacity(problem: ReturnType<typeof buildGraphCutProblem>, from: number, to: number) {
  const index = Array.from(problem.edgeFrom).findIndex(
    (edgeFrom, edge) => edgeFrom === from && problem.edgeTo[edge] === to,
  )
  return problem.edgeCapacity[index]!
}

function createTwoFaceFoldGeometry(reversed = false) {
  const faces = [
    [0, 0, 0, 1, 0, 0, 0, 1, 0],
    [1, 0, 0, 0, 0, 0, 0, 0, 1],
  ]
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(reversed ? faces[1]!.concat(faces[0]!) : faces.flat(), 3),
  )
  return geometry
}

function createUnevenFoldGeometry() {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        0, 0, 0, 2, 0, 0, 0, 1, 0,
        2, 0, 0, 0, 0, 0, 0, 0, 2,
      ],
      3,
    ),
  )
  return geometry
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
  expect(() => buildToothGraphCutRoi(createLinearTopology(40_001), [0, 1, 2], [5, 6, 7], {
    radiusScale: 100_000,
  })).toThrow(
    'Graph Cut 面数超过 40000',
  )
})

test('does not allow maxFaces to raise the fixed 40,000-face safety limit', () => {
  expect(() =>
    buildToothGraphCutRoi(createLinearTopology(40_001), [0, 1, 2], [5, 6, 7], {
      radiusScale: 100_000,
      maxFaces: 50_000,
    }),
  ).toThrow('Graph Cut 面数超过 40000')
})

test('keeps ROI membership geodesic-limited, while only in-ROI supplied backgrounds become masks', () => {
  const topology = createLinearTopology()
  const roi = buildToothGraphCutRoi(topology, [0, 1, 2], [5, 6, 7], { radiusScale: 1 })

  expect(Array.from(roi.faceIndices)).toEqual([0, 1, 2, 3, 4])
  expect(Array.from(roi.backgroundMask)).toEqual([0, 0, 0, 0, 0])

  const disconnected = buildToothGraphCutRoi(oversizedTopology(8), [0, 1, 2], [5, 6, 7])
  expect(Array.from(disconnected.faceIndices)).toEqual([0, 1, 2])
  expect(Array.from(disconnected.backgroundMask)).toEqual([0, 0, 0])
})

test('rejects a finite seed diameter and finite radius scale whose product overflows', () => {
  const topology = createLinearTopology(8, true)
  expect(() =>
    buildToothGraphCutRoi(topology, [0, 1, 2], [5, 6, 7], { radiusScale: Number.MAX_VALUE }),
  ).toThrow('Graph Cut ROI 半径必须为有限数')
})

test('allows a large source topology when its selected ROI fits the cap, but validates and enforces the selected ROI cap', () => {
  expect(() =>
    buildToothGraphCutRoi(createLinearTopology(40_001), [0, 1, 2], [5, 6, 7], { radiusScale: 0 }),
  ).not.toThrow()
  expect(() =>
    buildToothGraphCutRoi(createLinearTopology(), [0, 1, 2], [5, 6, 7], { maxFaces: 3 }),
  ).toThrow('Graph Cut 面数超过 3')
  expect(() =>
    buildToothGraphCutRoi(createLinearTopology(), [0, 1, 2], [5, 6, 7], { maxFaces: Number.NaN }),
  ).toThrow('maxFaces 必须是正整数')
})

test('caches topology per geometry and keeps signed dihedral stable when face insertion order changes', () => {
  const geometry = createTwoFaceFoldGeometry()
  expect(buildToothGraphTopology(geometry)).toBe(buildToothGraphTopology(geometry))

  const first = buildToothGraphTopology(geometry)
  const reversed = buildToothGraphTopology(createTwoFaceFoldGeometry(true))
  expect(first.signedDihedrals[0]).toBeCloseTo(reversed.signedDihedrals[0]!, 6)
  expect(first.signedDihedrals[1]).toBeCloseTo(reversed.signedDihedrals[1]!, 6)
})

test('uses length-weighted integrated dihedral curvature normalized by face area', () => {
  const topology = buildToothGraphTopology(createUnevenFoldGeometry())
  expect(topology.curvatureDiffs[0]).toBeCloseTo(0.5, 5)
  expect(topology.curvatureDiffs[1]).toBeCloseTo(0.5, 5)
})

test('assigns higher pairwise capacity to smooth edges and keeps unary distance costs monotonic', () => {
  const topology = createLinearTopology()
  const problem = buildGraphCutProblem(
    topology,
    buildToothGraphCutRoi(topology, [0, 1, 2], [5, 6, 7]),
  )

  expect(edgeCapacity(problem, 0, 1)).toBeGreaterThan(edgeCapacity(problem, 5, 6))
  expect(problem.sourceCapacity[3]).toBeGreaterThan(problem.sourceCapacity[4]!)
  expect(problem.sinkCapacity[4]).toBeGreaterThan(problem.sinkCapacity[3]!)
})

test('uses coordinate-wise foreground median normals and validates public ROI data', () => {
  const topology = createLinearTopology()
  topology.faceNormals.set([1, 0, 0], 0)
  topology.faceNormals.set([0, 0, 1], 3)
  topology.faceNormals.set([0, 0, 1], 6)
  topology.faceNormals.set([0, 0, 1], 9)
  topology.faceNormals.set([1, 0, 0], 12)
  const roi = buildToothGraphCutRoi(topology, [0, 1, 2], [5, 6, 7])
  const problem = buildGraphCutProblem(topology, roi)
  expect(problem.sinkCapacity[4]).toBeGreaterThan(2)
  expect(() => buildGraphCutProblem(topology, { ...roi, foregroundMask: new Uint8Array(1) })).toThrow(
    'ROI 掩码长度与面索引不一致',
  )
  expect(() => buildGraphCutProblem(topology, { ...roi, backgroundMask: Uint8Array.from(roi.foregroundMask) })).toThrow(
    'ROI 前景和背景种子不能重叠',
  )
  expect(() => buildGraphCutProblem(topology, { ...roi, backgroundMask: new Uint8Array(roi.faceIndices.length) })).toThrow(
    'ROI 背景种子至少需要 3 个有效面',
  )
})

test('keeps stored Float32 capacities finite for extreme geometry', () => {
  const topology = createLinearTopology(8, true)
  topology.sharedEdgeLengths[0] = 3e38
  topology.faceNormals.set([1, 0, 0], 3)
  const problem = buildGraphCutProblem(
    topology,
    buildToothGraphCutRoi(topology, [0, 1, 2], [5, 6, 7], { radiusScale: 10 }),
  )
  ;[problem.edgeCapacity, problem.sourceCapacity, problem.sinkCapacity].forEach((capacities) =>
    Array.from(capacities).forEach((capacity) => expect(Number.isFinite(capacity)).toBe(true)),
  )
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
