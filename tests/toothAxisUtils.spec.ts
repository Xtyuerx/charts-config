import { expect, test } from '@playwright/test'
import * as THREE from 'three'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  computeAutomaticToothAxis,
  createToothAxes,
  createToothAxesGroup,
  extractToothMeshGeometry,
  extractToothPoints,
} from '../src/page/directionStl/utils/toothAxisUtils'
import {
  createToothTargetTransform,
  serializeToothTargetTransforms,
  targetKey,
  upsertToothTargetTransform,
} from '../src/page/directionStl/utils/toothTargetUtils'

test('creates axis data for each tooth center', () => {
  const axes = createToothAxes([
    { fdi: 11, point: [1, 2, 3] },
    { fdi: 12, point: [4, 5, 6] },
  ])

  expect(axes).toHaveLength(2)
  expect(axes[0].fdi).toBe(11)
  expect(axes[0].origin.toArray()).toEqual([1, 2, 3])
  expect(axes[0].axes.x.end.toArray()).toEqual([6, 2, 3])
  expect(axes[0].axes.y.end.toArray()).toEqual([1, 7, 3])
  expect(axes[0].axes.z.end.toArray()).toEqual([1, 2, 8])
})

test('creates a three group containing one line object per tooth axis set', () => {
  const group = createToothAxesGroup([{ fdi: 31, point: new THREE.Vector3(0, 0, 0) }], {
    axisLength: 2,
  })

  expect(group.name).toBe('tooth-axes')
  expect(group.children).toHaveLength(1)
  expect(group.children[0].name).toBe('tooth-axes-31')
})

test('direction STL page keeps only single tooth selection and display workflow', () => {
  const pageSource = readFileSync(resolve('src/page/directionStl/index.vue'), 'utf-8')

  expect(pageSource).toContain('selectedFdi')
  expect(pageSource).toContain('refreshSelectedTooth')
  expect(pageSource).toContain('extractToothMeshGeometry')
  expect(pageSource).toContain('createCenteredGlobalAxisObject')
  expect(pageSource).toContain('toothAxisObject')
  expect(pageSource).toContain("labelsUrl: '/models/upper.json'")
  expect(pageSource).toContain("labelsUrl: '/models/lower.json'")
  expect(pageSource).not.toContain("labelsUrl: '/points/upper.json'")
  expect(pageSource).not.toContain("labelsUrl: '/points/lower.json'")
  expect(pageSource).not.toContain('extractToothPoints')
  expect(pageSource).not.toContain('computeAutomaticToothAxis')
  expect(pageSource).not.toContain('recalculateAutomaticAxis')
  expect(pageSource).not.toContain('resetToAutomaticAxis')
  expect(pageSource).not.toContain('copyAxisPayload')
  expect(pageSource).not.toContain('flipAxis')
  expect(pageSource).not.toContain('axisPayloadText')
  expect(pageSource).not.toContain('axisMode')

  const refreshSelectedToothSource = pageSource.slice(
    pageSource.indexOf('function refreshSelectedTooth'),
    pageSource.indexOf('async function fetchJson'),
  )
  expect(refreshSelectedToothSource).not.toContain('fitCameraToBox')
})

test('direction STL page exposes first-stage target position editing workflow', () => {
  const pageSource = readFileSync(resolve('src/page/directionStl/index.vue'), 'utf-8')

  expect(pageSource).toContain('TransformControls')
  expect(pageSource).toContain('toothTargetGroup')
  expect(pageSource).toContain('targetTransforms')
  expect(pageSource).toContain('setTransformMode')
  expect(pageSource).toContain('saveTargetTransform')
  expect(pageSource).toContain('exportTargetTransforms')
  expect(pageSource).toContain('targetPayloadText')
})

test('serializes saved target transforms by tooth key', () => {
  const object = new THREE.Object3D()
  object.position.set(1, 2, 3)
  object.quaternion.set(0.1, 0.2, 0.3, 0.9).normalize()
  object.scale.set(1, 1.1, 0.95)

  const target = createToothTargetTransform('upper', 11, object)
  const records = upsertToothTargetTransform({}, target)
  const payload = serializeToothTargetTransforms(records)

  expect(targetKey('upper', 11)).toBe('upper-11')
  expect(records['upper-11']).toEqual(target)
  expect(payload.version).toBe(1)
  expect(payload.targets).toEqual([target])
  expect(target.position).toEqual([1, 2, 3])
  expect(target.scale).toEqual([1, 1.1, 0.95])
  expect(target.quaternion[3]).toBeCloseTo(0.92338, 5)
})

test('extracts a single tooth mesh from expanded STL triangles and labels', () => {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1], 3),
  )
  const labels = [11, 11, 11, 11, 12, 11]

  const toothGeometry = extractToothMeshGeometry(geometry, labels, 11)
  const positions = Array.from(toothGeometry.getAttribute('position').array)

  expect(toothGeometry.getAttribute('position').count).toBe(3)
  expect(positions).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0])
})

test('extracts one tooth point cloud from expanded STL vertices and labels', () => {
  const positions = new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0, 9, 9, 9])
  const labels = [11, 11, 12, 11]

  const points = extractToothPoints(positions, labels, 11)

  expect(points.map((point) => point.toArray())).toEqual([
    [0, 0, 0],
    [2, 0, 0],
    [9, 9, 9],
  ])
})

test('computes a finite orthonormal automatic tooth coordinate system', () => {
  const points = [
    new THREE.Vector3(-1, -0.2, -4),
    new THREE.Vector3(1, -0.2, -4),
    new THREE.Vector3(-1, 0.2, 4),
    new THREE.Vector3(1, 0.2, 4),
    new THREE.Vector3(0, 0, 0),
  ]

  const axis = computeAutomaticToothAxis(points, { axisLength: 6 })

  expect(axis.origin.toArray().map((value) => Number(value.toFixed(6)))).toEqual([0, 0, 0])
  expect(axis.axes.z.direction.length()).toBeCloseTo(1, 6)
  expect(Math.abs(axis.axes.z.direction.z)).toBeGreaterThan(0.95)
  expect(axis.axes.x.direction.dot(axis.axes.y.direction)).toBeCloseTo(0, 6)
  expect(axis.axes.x.direction.dot(axis.axes.z.direction)).toBeCloseTo(0, 6)
  expect(axis.axes.y.direction.dot(axis.axes.z.direction)).toBeCloseTo(0, 6)
  expect(axis.axes.z.end.distanceTo(axis.origin)).toBeCloseTo(6, 6)
})
