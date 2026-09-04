import { expect, test } from '@playwright/test'
import * as THREE from 'three'

import {
  buildSurfaceGraph,
  createClosedSurfaceSegments,
  createClosedSurfacePath,
  createSurfaceSegmentPoints,
  extractLabelBoundary,
  moveClosedSurfacePathAnchor,
  moveLabelBoundaryControl,
  updateSurfaceLineGeometry,
} from '../src/page/toothSegmentationTest/utils/surfaceBoundaryUtils'

test('builds and preserves one shortest-surface segment for every closed control edge', () => {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0], 3),
  )
  const graph = buildSurfaceGraph(geometry)
  const controls = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0),
  ]

  const segments = createClosedSurfaceSegments(graph, controls)

  expect(segments).toHaveLength(3)
  expect(segments[0]?.[0]?.toArray()).toEqual([0, 0, 0])
  expect(segments[0]?.at(-1)?.toArray()).toEqual([1, 0, 0])
  expect(segments[2]?.[0]?.toArray()).toEqual([0, 1, 0])
  expect(segments[2]?.at(-1)?.toArray()).toEqual([0, 0, 0])
})

test('rejects closed surface segments with duplicate snapped anchors', () => {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
  )
  const graph = buildSurfaceGraph(geometry)

  expect(() =>
    createClosedSurfaceSegments(graph, [
      new THREE.Vector3(0.01, 0, 0),
      new THREE.Vector3(0.02, 0, 0),
      new THREE.Vector3(1, 0, 0),
    ]),
  ).toThrow('至少需要 3 个不同的 Boundary Points')
})

test('routes a changed boundary segment through STL surface edges', () => {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0], 3),
  )
  const graph = buildSurfaceGraph(geometry)

  const points = createSurfaceSegmentPoints(
    graph,
    new THREE.Vector3(0.1, 0.9, 0),
    new THREE.Vector3(1, 0, 0),
  )

  expect(points[0]?.toArray()).toEqual([0.1, 0.9, 0])
  expect(points.at(-1)?.toArray()).toEqual([1, 0, 0])
  expect(points.length).toBeGreaterThanOrEqual(3)
})

test('connects boundary anchors along mesh edges and closes the path', () => {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0], 3),
  )

  const graph = buildSurfaceGraph(geometry)
  const path = createClosedSurfacePath(graph, [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(1, 1, 0),
    new THREE.Vector3(0, 1, 0),
  ])

  expect(path.anchorPoints).toHaveLength(4)
  expect(path.curvePoints.map((point) => point.toArray())).toEqual([
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 0],
  ])
})

test('drops repeated anchors after snapping them to the mesh', () => {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
  )

  const graph = buildSurfaceGraph(geometry)
  const path = createClosedSurfacePath(graph, [
    new THREE.Vector3(0.01, 0, 0),
    new THREE.Vector3(0.02, 0, 0),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0),
  ])

  expect(path.anchorPoints).toHaveLength(3)
  expect(path.curvePoints.at(-1)?.equals(path.curvePoints[0]!)).toBe(true)
})

test('extracts the shared mesh edge between two tooth labels as an automatic boundary', () => {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0], 3),
  )

  const boundary = extractLabelBoundary(geometry, [11, 11, 11, 12, 12, 12], 0.1)

  expect(boundary.linePoints.map((point) => point.toArray())).toEqual([
    [1, 1, 0],
    [0, 0, 0],
  ])
  expect(boundary.pointPositions).toHaveLength(2)
  expect(boundary.pointLineIndices).toEqual([[0], [1]])
})

test('keeps nearby STL boundary vertices as separate white controls', () => {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [0, 0, 0, 0.5, 0, 0, 0, 0.5, 0, 0.5, 0, 0, 0, 0, 0, 0.5, -0.5, 0],
      3,
    ),
  )

  const boundary = extractLabelBoundary(geometry, [11, 11, 11, 12, 12, 12])

  expect(boundary.pointPositions.map((point) => point.toArray())).toEqual([
    [0, 0, 0],
    [0.5, 0, 0],
  ])
  expect(boundary.pointLineIndices).toEqual([[0], [1]])
})

test('moves one boundary anchor and rebuilds a closed surface path', () => {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0], 3),
  )
  const graph = buildSurfaceGraph(geometry)
  const original = createClosedSurfacePath(graph, [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(1, 1, 0),
  ])

  const moved = moveClosedSurfacePathAnchor(graph, original, 1, new THREE.Vector3(0, 1, 0))

  expect(moved.anchorPoints[1]?.toArray()).toEqual([0, 1, 0])
  expect(moved.curvePoints.some((point) => point.equals(moved.anchorPoints[1]!))).toBe(true)
  expect(moved.curvePoints.at(-1)?.equals(moved.curvePoints[0]!)).toBe(true)
})

test('keeps the exact STL intersection and only rebuilds adjacent surface segments', () => {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0], 3),
  )
  const graph = buildSurfaceGraph(geometry)
  const original = createClosedSurfacePath(graph, [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(1, 1, 0),
    new THREE.Vector3(0, 1, 0),
  ])
  const oppositeSegment = original.segmentPoints[2]!

  const moved = moveClosedSurfacePathAnchor(graph, original, 1, new THREE.Vector3(0.75, 0.25, 0))

  expect(moved.anchorPoints[1]?.toArray()).toEqual([0.75, 0.25, 0])
  expect(moved.segmentPoints[2]).toBe(oppositeSegment)
  expect(moved.curvePoints.some((point) => point.equals(moved.anchorPoints[1]!))).toBe(true)
})

test('replaces exactly the two neighboring cached segments without translating the full path', () => {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0], 3),
  )
  const graph = buildSurfaceGraph(geometry)
  const original = createClosedSurfacePath(graph, [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(1, 1, 0),
    new THREE.Vector3(0, 1, 0),
  ])
  const originalSegments = [...original.segmentPoints]
  const originalAnchors = original.anchorPoints.map((point) => point.clone())

  const intersectionPoint = new THREE.Vector3(0.75, 0.25, 0)
  const moved = moveClosedSurfacePathAnchor(graph, original, 1, intersectionPoint)

  expect(moved.anchorPoints[1]).not.toBe(intersectionPoint)
  expect(moved.anchorPoints[1]?.toArray()).toEqual(intersectionPoint.toArray())
  expect(moved.segmentPoints[0]).not.toBe(originalSegments[0])
  expect(moved.segmentPoints[1]).not.toBe(originalSegments[1])
  expect(moved.segmentPoints[2]).toBe(originalSegments[2])
  expect(moved.segmentPoints[3]).toBe(originalSegments[3])
  expect(moved.anchorPoints[0]?.toArray()).toEqual(originalAnchors[0]?.toArray())
  expect(moved.anchorPoints[2]?.toArray()).toEqual(originalAnchors[2]?.toArray())
  expect(moved.anchorPoints[3]?.toArray()).toEqual(originalAnchors[3]?.toArray())
})

test('updates a cached boundary line position attribute in place after a local anchor move', () => {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0], 3),
  )
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const initialVersion = position.version
  const originalSetAttribute = geometry.setAttribute.bind(geometry)
  let setAttributeCalls = 0
  geometry.setAttribute = ((...args) => {
    setAttributeCalls += 1
    return originalSetAttribute(...args)
  }) as typeof geometry.setAttribute
  const segmentPoints = [
    [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.75, 0.25, 0)],
    [new THREE.Vector3(0.75, 0.25, 0), new THREE.Vector3(1, 1, 0)],
  ]

  updateSurfaceLineGeometry(geometry, segmentPoints)

  expect(geometry.getAttribute('position')).toBe(position)
  expect(Array.from(position.array)).toEqual([0, 0, 0, 0.75, 0.25, 0, 0.75, 0.25, 0, 1, 1, 0])
  expect(position.version).toBeGreaterThan(initialVersion)
  expect(setAttributeCalls).toBe(0)
})

test('sets linked white endpoints to the STL hit instead of applying a delta translation', () => {
  const linePoints = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.5, 0.25, 0),
    new THREE.Vector3(3, 0, 0),
  ]
  const controlPoints = [new THREE.Vector3(0, 0, 0)]

  const changedIndices = moveLabelBoundaryControl(
    linePoints,
    controlPoints,
    [[0, 1]],
    0,
    new THREE.Vector3(2, 1, 0),
  )

  expect(changedIndices).toEqual([0, 1])
  expect(controlPoints[0]?.toArray()).toEqual([2, 1, 0])
  expect(linePoints.map((point) => point.toArray())).toEqual([
    [2, 1, 0],
    [2, 1, 0],
    [3, 0, 0],
  ])
})
