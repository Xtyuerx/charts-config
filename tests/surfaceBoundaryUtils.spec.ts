import { expect, test } from '@playwright/test'
import * as THREE from 'three'

import {
  buildSurfaceGraph,
  createClosedSurfacePath,
  createSurfaceSegmentPoints,
  extractLabelBoundary,
  moveClosedSurfacePathAnchor,
  moveLabelBoundaryControl,
} from '../src/page/toothSegmentationTest/utils/surfaceBoundaryUtils'

test('routes a changed boundary segment through STL surface edges', () => {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        0, 0, 0,
        1, 0, 0,
        1, 1, 0,
        0, 0, 0,
        1, 1, 0,
        0, 1, 0,
      ],
      3,
    ),
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
    new THREE.Float32BufferAttribute(
      [
        0, 0, 0,
        1, 0, 0,
        1, 1, 0,
        0, 0, 0,
        1, 1, 0,
        0, 1, 0,
      ],
      3,
    ),
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
    new THREE.Float32BufferAttribute(
      [
        0, 0, 0,
        1, 0, 0,
        1, 1, 0,
        0, 0, 0,
        1, 1, 0,
        0, 1, 0,
      ],
      3,
    ),
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
      [
        0, 0, 0,
        0.5, 0, 0,
        0, 0.5, 0,
        0.5, 0, 0,
        0, 0, 0,
        0.5, -0.5, 0,
      ],
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
    new THREE.Float32BufferAttribute(
      [
        0, 0, 0,
        1, 0, 0,
        1, 1, 0,
        0, 0, 0,
        1, 1, 0,
        0, 1, 0,
      ],
      3,
    ),
  )
  const graph = buildSurfaceGraph(geometry)
  const original = createClosedSurfacePath(graph, [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(1, 1, 0),
  ])

  const moved = moveClosedSurfacePathAnchor(
    graph,
    original.anchorPoints,
    1,
    new THREE.Vector3(0, 1, 0),
  )

  expect(moved.anchorPoints[1]?.toArray()).toEqual([0, 1, 0])
  expect(
    moved.curvePoints.some((point) => point.equals(moved.anchorPoints[1]!)),
  ).toBe(true)
  expect(moved.curvePoints.at(-1)?.equals(moved.curvePoints[0]!)).toBe(true)
})

test('keeps the exact STL intersection and only rebuilds adjacent surface segments', () => {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        0, 0, 0,
        1, 0, 0,
        1, 1, 0,
        0, 0, 0,
        1, 1, 0,
        0, 1, 0,
      ],
      3,
    ),
  )
  const graph = buildSurfaceGraph(geometry)
  const original = createClosedSurfacePath(graph, [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(1, 1, 0),
    new THREE.Vector3(0, 1, 0),
  ])
  const oppositeSegment = original.segmentPoints[2]!.map((point) => point.toArray())

  const moved = moveClosedSurfacePathAnchor(
    graph,
    original,
    1,
    new THREE.Vector3(0.75, 0.25, 0),
  )

  expect(moved.anchorPoints[1]?.toArray()).toEqual([0.75, 0.25, 0])
  expect(moved.segmentPoints[2]?.map((point) => point.toArray())).toEqual(oppositeSegment)
  expect(moved.curvePoints.some((point) => point.equals(moved.anchorPoints[1]!))).toBe(true)
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
