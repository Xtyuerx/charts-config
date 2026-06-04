<template>
  <div class="edit-stl-page">
    <div class="toolbar">
      <button class="tool-button" :class="{ active: showUpper }" type="button" @click="toggleUpper">
        上颌
      </button>
      <button class="tool-button" :class="{ active: showLower }" type="button" @click="toggleLower">
        下颌
      </button>
      <button class="tool-button" type="button" @click="resetCamera">重置视角</button>
      <button class="tool-button" type="button" @click="triggerImportJson">Import JSON</button>
      <button class="tool-button" type="button" @click="exportJawJson('upper')">Export Upper</button>
      <button class="tool-button" type="button" @click="exportJawJson('lower')">Export Lower</button>
      <button
        class="tool-button"
        :class="{ active: showBoundaries }"
        type="button"
        @click="toggleBoundaries"
      >
        Boundary
      </button>
      <span class="status">{{ statusText }}</span>
    </div>
    <input
      ref="jsonInputRef"
      class="json-input"
      type="file"
      accept="application/json,.json"
      @change="handleImportJson"
    />
    <div ref="containerRef" class="viewer"></div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { STLLoader } from 'three-stdlib'

type JawType = 'upper' | 'lower'

type LabelPayload = {
  labels?: number[]
  faceLabels?: number[]
}

type JawConfig = {
  jaw: JawType
  name: string
  stlUrl: string
  pointsUrl: string
  fallbackLabelUrl: string
}

const containerRef = ref<HTMLDivElement | null>(null)
const jsonInputRef = ref<HTMLInputElement | null>(null)
const statusText = ref('正在准备 3D 场景...')
const showUpper = ref(true)
const showLower = ref(true)
const showBoundaries = ref(true)

const jawConfigs: JawConfig[] = [
  {
    jaw: 'upper',
    name: '上颌',
    stlUrl: '/models/upper.stl',
    pointsUrl: '/points/upper.json',
    fallbackLabelUrl: '/models/upper.json',
  },
  {
    jaw: 'lower',
    name: '下颌',
    stlUrl: '/models/lower.stl',
    pointsUrl: '/points/lower.json',
    fallbackLabelUrl: '/models/lower.json',
  },
]

const toothColorMap: Record<number, number> = {
  11: 0xe74c3c,
  12: 0xf39c12,
  13: 0xf1c40f,
  14: 0x8bc34a,
  15: 0x2ecc71,
  16: 0x00b894,
  17: 0x00cec9,
  18: 0x0984e3,
  21: 0x3498db,
  22: 0x6c5ce7,
  23: 0x9b59b6,
  24: 0xe84393,
  25: 0xfd79a8,
  26: 0xd63031,
  27: 0xe17055,
  28: 0xa29bfe,
  31: 0x1abc9c,
  32: 0x55efc4,
  33: 0x81ecec,
  34: 0x74b9ff,
  35: 0x45aaf2,
  36: 0x3867d6,
  37: 0x8854d0,
  38: 0x4b6584,
  41: 0xff7675,
  42: 0xf8a5c2,
  43: 0xf78fb3,
  44: 0xcf6a87,
  45: 0x786fa6,
  46: 0x63cdda,
  47: 0x3dc1d3,
  48: 0x596275,
}

const gumColor = new THREE.Color(0xd9b1a8)
const missingColor = new THREE.Color(0xcfd6dd)
const boundarySampleSize = 1.8
const meshes: Partial<Record<JawType, THREE.Mesh>> = {}
const labelGroups: Partial<Record<JawType, THREE.Group>> = {}
const boundaryGroups: Partial<Record<JawType, THREE.Group>> = {}
const meshLabelMap = new WeakMap<THREE.Mesh, number[]>()
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
const dragPoint = new THREE.Vector3()
const dragTarget = new THREE.Vector3()
const dragPlaneNormal = new THREE.Vector3()
const movablePointColor = new THREE.Color(0x00ff66)
const hoverPointColor = new THREE.Color(0xfff000)
const pointHitRadiusPx = 9

type BoundaryDragState = {
  points: THREE.Points
  lines?: THREE.LineSegments
  pointIndex: number
  plane: THREE.Plane
  offset: THREE.Vector3
  originalColor: THREE.Color
  originalLocalPosition: THREE.Vector3
  mesh: THREE.Mesh
  topology: MeshFaceTopology
  toothId: number
}

type BoundaryPickResult = {
  points: THREE.Points
  pointIndex: number
}

type BoundaryHoverState = BoundaryPickResult & {
  originalColor: THREE.Color
}

type FaceEdgeRef = {
  edgeKey: string
  neighbor: number | null
}

type MeshEdgeRecord = {
  edgeKey: string
  fromKey: string
  toKey: string
  faceIndices: number[]
  from: THREE.Vector3
  to: THREE.Vector3
  midpoint: THREE.Vector3
}

type MeshFaceTopology = {
  faceEdges: FaceEdgeRef[][]
  edgeRecords: MeshEdgeRecord[]
  edgeByKey: Map<string, MeshEdgeRecord>
  vertexGraph: Map<string, Array<{ vertexKey: string; edgeKey: string; weight: number }>>
  vertexPositions: Map<string, THREE.Vector3>
}

type BoundaryControlPointData = {
  edgeKey: string
  toothId: number
  loopId: number
}

type BoundaryLoopData = {
  toothId: number
  edgeKeys: string[]
  controlPointIndices: number[]
}

type ExportedBoundaryLoop = {
  toothId: number
  edgeKeys: string[]
  controlEdgeKeys: string[]
}

type ExportedJawJson = {
  version: 1
  jaw: JawType
  faceLabels: number[]
  labels: number[]
  boundary: {
    loops: ExportedBoundaryLoop[]
  }
}

let boundaryDragState: BoundaryDragState | null = null
let boundaryHoverState: BoundaryHoverState | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let renderer: THREE.WebGLRenderer | null = null
let controls: OrbitControls | null = null
let rafId = 0

function colorForLabel(label: number): THREE.Color {
  if (!label) return gumColor
  const mapped = toothColorMap[label]
  if (mapped) return new THREE.Color(mapped)
  const hue = (((label * 2654435761) >>> 0) % 360) / 360
  return new THREE.Color().setHSL(hue, 0.64, 0.56)
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} 加载失败：HTTP ${response.status}`)
  return (await response.json()) as T
}

function labelsToVertexLabels(
  geometry: THREE.BufferGeometry,
  payload: LabelPayload,
): { labels: number[]; sourceMatched: boolean } {
  const sourceLabels = payload.faceLabels?.length ? payload.faceLabels : payload.labels
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const vertexCount = position.count
  const faceCount = vertexCount / 3

  if (!sourceLabels?.length) {
    return { labels: [], sourceMatched: false }
  }

  if (sourceLabels.length === vertexCount) {
    return { labels: sourceLabels.map(Number), sourceMatched: true }
  }

  if (sourceLabels.length === faceCount) {
    const labels = new Array<number>(vertexCount)
    for (let faceIndex = 0; faceIndex < faceCount; faceIndex++) {
      const label = Number(sourceLabels[faceIndex] ?? 0)
      const base = faceIndex * 3
      labels[base] = label
      labels[base + 1] = label
      labels[base + 2] = label
    }
    return { labels, sourceMatched: true }
  }

  return { labels: [], sourceMatched: false }
}

async function loadLabels(config: JawConfig, geometry: THREE.BufferGeometry) {
  const pointsPayload = await fetchJson<LabelPayload>(config.pointsUrl)
  const fromPoints = labelsToVertexLabels(geometry, pointsPayload)
  if (fromPoints.sourceMatched) {
    return { labels: fromPoints.labels, source: config.pointsUrl, usedFallback: false }
  }

  const fallbackPayload = await fetchJson<LabelPayload>(config.fallbackLabelUrl)
  const fromFallback = labelsToVertexLabels(geometry, fallbackPayload)
  if (fromFallback.sourceMatched) {
    return { labels: fromFallback.labels, source: config.fallbackLabelUrl, usedFallback: true }
  }

  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  throw new Error(
    `${config.name} labels 与 STL 不匹配：顶点 ${position.count}，面 ${position.count / 3}`,
  )
}

function paintGeometryByLabels(geometry: THREE.BufferGeometry, labels: number[]) {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const colors = new Float32Array(position.count * 3)

  for (let i = 0; i < position.count; i++) {
    const color = labels[i] == null ? missingColor : colorForLabel(Number(labels[i]))
    colors[i * 3] = color.r
    colors[i * 3 + 1] = color.g
    colors[i * 3 + 2] = color.b
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}

function createTextSprite(text: string, color: THREE.Color) {
  const canvas = document.createElement('canvas')
  const size = 128
  canvas.width = size
  canvas.height = size

  const context = canvas.getContext('2d')
  if (!context) return null

  context.clearRect(0, 0, size, size)
  context.beginPath()
  context.arc(size / 2, size / 2, 42, 0, Math.PI * 2)
  context.fillStyle = 'rgba(255,255,255,0.92)'
  context.fill()
  context.lineWidth = 8
  context.strokeStyle = `rgb(${Math.round(color.r * 255)},${Math.round(color.g * 255)},${Math.round(color.b * 255)})`
  context.stroke()

  context.fillStyle = '#1f2933'
  context.font = 'bold 42px Arial'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(text, size / 2, size / 2 + 2)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })

  const sprite = new THREE.Sprite(material)
  sprite.renderOrder = 20
  sprite.scale.set(4.8, 4.8, 1)
  return sprite
}

function createCirclePointTexture() {
  const canvas = document.createElement('canvas')
  const size = 64
  canvas.width = size
  canvas.height = size

  const context = canvas.getContext('2d')
  if (!context) return null

  context.clearRect(0, 0, size, size)
  context.beginPath()
  context.arc(size / 2, size / 2, size * 0.42, 0, Math.PI * 2)
  context.fillStyle = '#ffffff'
  context.fill()

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function buildToothLabelGroup(geometry: THREE.BufferGeometry, labels: number[]) {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const sums = new Map<number, { point: THREE.Vector3; count: number }>()

  for (let i = 0; i < position.count; i++) {
    const label = Number(labels[i] ?? 0)
    if (!label) continue

    let item = sums.get(label)
    if (!item) {
      item = { point: new THREE.Vector3(), count: 0 }
      sums.set(label, item)
    }

    item.point.x += position.getX(i)
    item.point.y += position.getY(i)
    item.point.z += position.getZ(i)
    item.count++
  }

  const group = new THREE.Group()
  group.name = 'fdi-labels'

  Array.from(sums.entries())
    .sort(([a], [b]) => a - b)
    .forEach(([label, item]) => {
      if (!item.count) return
      const sprite = createTextSprite(String(label), colorForLabel(label))
      if (!sprite) return
      sprite.position.copy(item.point.multiplyScalar(1 / item.count))
      group.add(sprite)
    })

  return group
}

function faceLabel(labels: number[], faceIndex: number) {
  const base = faceIndex * 3
  const a = Number(labels[base] ?? 0)
  const b = Number(labels[base + 1] ?? 0)
  const c = Number(labels[base + 2] ?? 0)

  if (a === b || a === c) return a
  if (b === c) return b
  return a || b || c || 0
}

function vertexKey(position: THREE.BufferAttribute, index: number) {
  return [
    Math.round(position.getX(index) * 10000),
    Math.round(position.getY(index) * 10000),
    Math.round(position.getZ(index) * 10000),
  ].join(',')
}

function pointSampleKey(point: THREE.Vector3, sampleSize = boundarySampleSize) {
  return [
    Math.round(point.x / sampleSize),
    Math.round(point.y / sampleSize),
    Math.round(point.z / sampleSize),
  ].join(',')
}

function addSamplePoint(
  samplePoints: Map<string, { point: THREE.Vector3; count: number; label: number }>,
  label: number,
  point: THREE.Vector3,
) {
  const key = `${label}:${pointSampleKey(point)}`
  let sample = samplePoints.get(key)
  if (!sample) {
    sample = { point: new THREE.Vector3(), count: 0, label }
    samplePoints.set(key, sample)
  }
  sample.point.add(point)
  sample.count++
  return key
}

function orderEdgeLoops(edgeKeys: string[], edgeByKey: Map<string, MeshEdgeRecord>) {
  const edgeSet = new Set(edgeKeys)
  const vertexEdges = new Map<string, string[]>()

  edgeKeys.forEach((edgeKey) => {
    const edge = edgeByKey.get(edgeKey)
    if (!edge) return
    const fromEdges = vertexEdges.get(edge.fromKey) ?? []
    const toEdges = vertexEdges.get(edge.toKey) ?? []
    fromEdges.push(edgeKey)
    toEdges.push(edgeKey)
    vertexEdges.set(edge.fromKey, fromEdges)
    vertexEdges.set(edge.toKey, toEdges)
  })

  const loops: string[][] = []
  while (edgeSet.size) {
    const firstEdgeKey = edgeSet.values().next().value as string | undefined
    const firstEdge = firstEdgeKey ? edgeByKey.get(firstEdgeKey) : undefined
    if (!firstEdgeKey || !firstEdge) break

    const component: string[] = []
    const openStart =
      Array.from(vertexEdges.entries()).find(([, edges]) =>
        edges.some((edgeKey) => edgeSet.has(edgeKey)) && edges.filter((edgeKey) => edgeSet.has(edgeKey)).length === 1,
      )?.[0] ?? firstEdge.fromKey
    let currentVertexKey = openStart
    let previousEdgeKey = ''

    while (true) {
      const nextEdgeKey = (vertexEdges.get(currentVertexKey) ?? []).find(
        (edgeKey) => edgeKey !== previousEdgeKey && edgeSet.has(edgeKey),
      )
      if (!nextEdgeKey) break

      const edge = edgeByKey.get(nextEdgeKey)
      if (!edge) break

      edgeSet.delete(nextEdgeKey)
      component.push(nextEdgeKey)
      previousEdgeKey = nextEdgeKey
      currentVertexKey = edge.fromKey === currentVertexKey ? edge.toKey : edge.fromKey
    }

    if (!component.length) {
      edgeSet.delete(firstEdgeKey)
      component.push(firstEdgeKey)
    }
    loops.push(component)
  }

  return loops
}

function chooseBoundaryControlEdges(edgeKeys: string[]) {
  if (edgeKeys.length <= 36) return edgeKeys
  const step = Math.max(1, Math.ceil(edgeKeys.length / 36))
  return edgeKeys.filter((_, index) => index % step === 0)
}

function findNearestMeshEdge(
  topology: MeshFaceTopology,
  localPoint: THREE.Vector3,
): MeshEdgeRecord | null {
  let nearest: MeshEdgeRecord | null = null
  let nearestDistanceSq = Number.POSITIVE_INFINITY

  topology.edgeRecords.forEach((edge) => {
    const distanceSq = distancePointToSegmentSq(localPoint, edge.from, edge.to)
    if (distanceSq >= nearestDistanceSq) return
    nearestDistanceSq = distanceSq
    nearest = edge
  })

  return nearest
}

function shortestEdgePath(
  topology: MeshFaceTopology,
  startVertexKey: string,
  endVertexKey: string,
) {
  if (startVertexKey === endVertexKey) return [] as string[]

  const distances = new Map<string, number>([[startVertexKey, 0]])
  const previous = new Map<string, { vertexKey: string; edgeKey: string }>()
  const visited = new Set<string>()

  while (true) {
    let currentKey = ''
    let currentDistance = Number.POSITIVE_INFINITY
    distances.forEach((distance, vertexKey) => {
      if (visited.has(vertexKey) || distance >= currentDistance) return
      currentKey = vertexKey
      currentDistance = distance
    })

    if (!currentKey || currentKey === endVertexKey) break
    visited.add(currentKey)

    for (const neighbor of topology.vertexGraph.get(currentKey) ?? []) {
      if (visited.has(neighbor.vertexKey)) continue
      const nextDistance = currentDistance + neighbor.weight
      if (nextDistance >= (distances.get(neighbor.vertexKey) ?? Number.POSITIVE_INFINITY)) continue
      distances.set(neighbor.vertexKey, nextDistance)
      previous.set(neighbor.vertexKey, { vertexKey: currentKey, edgeKey: neighbor.edgeKey })
    }
  }

  if (!previous.has(endVertexKey)) return []

  const path: string[] = []
  let currentKey = endVertexKey
  while (currentKey !== startVertexKey) {
    const prev = previous.get(currentKey)
    if (!prev) break
    path.push(prev.edgeKey)
    currentKey = prev.vertexKey
  }

  return path.reverse()
}

function shortestPathBetweenEdges(
  topology: MeshFaceTopology,
  fromEdgeKey: string,
  toEdgeKey: string,
) {
  const fromEdge = topology.edgeByKey.get(fromEdgeKey)
  const toEdge = topology.edgeByKey.get(toEdgeKey)
  if (!fromEdge || !toEdge) return [] as string[]

  const endpointPairs: Array<[string, string]> = [
    [fromEdge.fromKey, toEdge.fromKey],
    [fromEdge.fromKey, toEdge.toKey],
    [fromEdge.toKey, toEdge.fromKey],
    [fromEdge.toKey, toEdge.toKey],
  ]

  let bestPath: string[] = []
  let bestLength = Number.POSITIVE_INFINITY
  endpointPairs.forEach(([start, end]) => {
    const path = shortestEdgePath(topology, start, end)
    if (!path.length && start !== end) return
    const length = path.reduce((sum, edgeKey) => {
      const edge = topology.edgeByKey.get(edgeKey)
      return sum + (edge ? edge.from.distanceTo(edge.to) : 0)
    }, 0)
    if (length >= bestLength) return
    bestLength = length
    bestPath = path
  })

  return Array.from(new Set([fromEdgeKey, ...bestPath, toEdgeKey]))
}

function updateBoundaryLinesFromLoops(
  lines: THREE.LineSegments | undefined,
  loops: BoundaryLoopData[],
  topology: MeshFaceTopology,
) {
  if (!lines) return

  const linePositions: number[] = []
  const lineColors: number[] = []
  const boundaryEdgeKeys: string[] = []

  loops.forEach((loop) => {
    const color = colorForLabel(loop.toothId)
    loop.edgeKeys.forEach((edgeKey) => {
      const edge = topology.edgeByKey.get(edgeKey)
      if (!edge) return
      boundaryEdgeKeys.push(edgeKey)
      linePositions.push(edge.from.x, edge.from.y, edge.from.z, edge.to.x, edge.to.y, edge.to.z)
      lineColors.push(color.r, color.g, color.b, color.r, color.g, color.b)
    })
  })

  lines.geometry.dispose()
  const lineGeometry = new THREE.BufferGeometry()
  lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3))
  lineGeometry.setAttribute('color', new THREE.Float32BufferAttribute(lineColors, 3))
  lines.geometry = lineGeometry
  lines.userData.boundaryEdgeKeys = boundaryEdgeKeys
}

function rebuildBoundaryLoopsFromControlPoints(points: THREE.Points, topology: MeshFaceTopology) {
  const controls = points.userData.boundaryControlPoints as BoundaryControlPointData[] | undefined
  const lines = points.userData.boundaryLines as THREE.LineSegments | undefined
  if (!controls?.length) return [] as BoundaryLoopData[]

  const loopsById = new Map<number, BoundaryLoopData>()
  controls.forEach((control, pointIndex) => {
    let loop = loopsById.get(control.loopId)
    if (!loop) {
      loop = { toothId: control.toothId, edgeKeys: [], controlPointIndices: [] }
      loopsById.set(control.loopId, loop)
    }
    loop.controlPointIndices.push(pointIndex)
  })

  const loops = Array.from(loopsById.entries())
    .sort(([a], [b]) => a - b)
    .map(([, loop]) => {
      const edgeKeys: string[] = []
      const pointIndices = loop.controlPointIndices
      pointIndices.forEach((pointIndex, index) => {
        const current = controls[pointIndex]
        const nextPointIndex = pointIndices[(index + 1) % pointIndices.length]
        if (nextPointIndex == null) return
        const next = controls[nextPointIndex]
        if (!current || !next) return
        if (pointIndices.length === 1) {
          edgeKeys.push(current.edgeKey)
          return
        }
        edgeKeys.push(...shortestPathBetweenEdges(topology, current.edgeKey, next.edgeKey))
      })

      return {
        ...loop,
        edgeKeys: Array.from(new Set(edgeKeys)),
      }
    })

  const position = points.geometry.getAttribute('position') as THREE.BufferAttribute
  controls.forEach((control, pointIndex) => {
    const edge = topology.edgeByKey.get(control.edgeKey)
    if (!edge) return
    position.setXYZ(pointIndex, edge.midpoint.x, edge.midpoint.y, edge.midpoint.z)
  })
  position.needsUpdate = true
  points.geometry.computeBoundingSphere()

  points.userData.boundaryLoops = loops
  if (points.parent) points.parent.userData.boundaryLoops = loops
  updateBoundaryLinesFromLoops(lines, loops, topology)
  return loops
}

function buildBoundaryGroup(geometry: THREE.BufferGeometry, labels: number[]) {
  const topology = buildMeshFaceTopology(geometry)
  const faceLabels = vertexLabelsToFaceLabels(labels)
  const boundaryByTooth = new Map<number, string[]>()

  topology.edgeRecords.forEach((edge) => {
    const edgeLabels = Array.from(
      new Set(edge.faceIndices.map((faceIndex) => faceLabels[faceIndex] ?? 0)),
    )
    const nonZeroLabels = edgeLabels.filter(Boolean)
    if (!nonZeroLabels.length || edgeLabels.length < 2) return

    nonZeroLabels.forEach((toothId) => {
      const edgeKeys = boundaryByTooth.get(toothId) ?? []
      edgeKeys.push(edge.edgeKey)
      boundaryByTooth.set(toothId, edgeKeys)
    })
  })

  const linePositions: number[] = []
  const lineColors: number[] = []
  const pointPositions: number[] = []
  const pointColors: number[] = []
  const pointLabels: number[] = []
  const controlPoints: BoundaryControlPointData[] = []
  const boundaryLoops: BoundaryLoopData[] = []
  const boundaryEdgeKeys: string[] = []
  let loopId = 0

  Array.from(boundaryByTooth.entries())
    .sort(([a], [b]) => a - b)
    .forEach(([toothId, edgeKeys]) => {
      const orderedLoops = orderEdgeLoops(Array.from(new Set(edgeKeys)), topology.edgeByKey)
      orderedLoops.forEach((loopEdgeKeys) => {
        const controlPointIndices: number[] = []
        const color = colorForLabel(toothId)

        loopEdgeKeys.forEach((edgeKey) => {
          const edge = topology.edgeByKey.get(edgeKey)
          if (!edge) return
          boundaryEdgeKeys.push(edgeKey)
          linePositions.push(edge.from.x, edge.from.y, edge.from.z, edge.to.x, edge.to.y, edge.to.z)
          lineColors.push(color.r, color.g, color.b, color.r, color.g, color.b)
        })

        chooseBoundaryControlEdges(loopEdgeKeys).forEach((edgeKey) => {
          const edge = topology.edgeByKey.get(edgeKey)
          if (!edge) return
          controlPointIndices.push(pointPositions.length / 3)
          pointPositions.push(edge.midpoint.x, edge.midpoint.y, edge.midpoint.z)
          pointColors.push(color.r, color.g, color.b)
          pointLabels.push(toothId)
          controlPoints.push({ edgeKey, toothId, loopId })
        })

        boundaryLoops.push({ toothId, edgeKeys: loopEdgeKeys, controlPointIndices })
        loopId += 1
      })
    })

  const group = new THREE.Group()
  group.name = 'tooth-boundaries'

  if (linePositions.length) {
    const lineGeometry = new THREE.BufferGeometry()
    lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3))
    lineGeometry.setAttribute('color', new THREE.Float32BufferAttribute(lineColors, 3))

    const lineMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      depthTest: false,
      depthWrite: false,
    })

    const lines = new THREE.LineSegments(lineGeometry, lineMaterial)
    lines.name = 'tooth-boundary-lines'
    lines.renderOrder = 14
    lines.userData.boundaryEdgeKeys = boundaryEdgeKeys
    group.add(lines)
  }

  if (pointPositions.length) {
    const pointGeometry = new THREE.BufferGeometry()
    pointGeometry.setAttribute('position', new THREE.Float32BufferAttribute(pointPositions, 3))
    pointGeometry.setAttribute('color', new THREE.Float32BufferAttribute(pointColors, 3))

    const pointMaterial = new THREE.PointsMaterial({
      size: 1,
      map: createCirclePointTexture() ?? undefined,
      alphaTest: 0.35,
      vertexColors: true,
      transparent: true,
      opacity: 0.96,
      depthTest: false,
      depthWrite: false,
    })

    const points = new THREE.Points(pointGeometry, pointMaterial)
    points.name = 'tooth-boundary-points'
    points.renderOrder = 15
    points.userData.boundaryLines = group.getObjectByName('tooth-boundary-lines')
    points.userData.boundaryControlPoints = controlPoints
    points.userData.boundaryLoops = boundaryLoops
    points.userData.boundaryPointLabels = pointLabels
    group.add(points)
  }

  group.userData.boundaryLoops = boundaryLoops
  group.userData.boundarySegmentCount = linePositions.length / 6
  group.userData.boundaryPointCount = pointPositions.length / 3
  return group
}

function buildBoundaryGroupFromExportedLoops(
  geometry: THREE.BufferGeometry,
  exportedLoops: ExportedBoundaryLoop[],
) {
  const topology = buildMeshFaceTopology(geometry)
  const linePositions: number[] = []
  const lineColors: number[] = []
  const pointPositions: number[] = []
  const pointColors: number[] = []
  const pointLabels: number[] = []
  const controlPoints: BoundaryControlPointData[] = []
  const boundaryLoops: BoundaryLoopData[] = []
  const boundaryEdgeKeys: string[] = []

  exportedLoops.forEach((exportedLoop, loopId) => {
    const color = colorForLabel(exportedLoop.toothId)
    const edgeKeys = exportedLoop.edgeKeys.filter((edgeKey) => topology.edgeByKey.has(edgeKey))
    const controlEdgeKeys = (
      exportedLoop.controlEdgeKeys?.length ? exportedLoop.controlEdgeKeys : chooseBoundaryControlEdges(edgeKeys)
    ).filter((edgeKey) => topology.edgeByKey.has(edgeKey))
    const controlPointIndices: number[] = []

    edgeKeys.forEach((edgeKey) => {
      const edge = topology.edgeByKey.get(edgeKey)
      if (!edge) return
      boundaryEdgeKeys.push(edgeKey)
      linePositions.push(edge.from.x, edge.from.y, edge.from.z, edge.to.x, edge.to.y, edge.to.z)
      lineColors.push(color.r, color.g, color.b, color.r, color.g, color.b)
    })

    controlEdgeKeys.forEach((edgeKey) => {
      const edge = topology.edgeByKey.get(edgeKey)
      if (!edge) return
      controlPointIndices.push(pointPositions.length / 3)
      pointPositions.push(edge.midpoint.x, edge.midpoint.y, edge.midpoint.z)
      pointColors.push(color.r, color.g, color.b)
      pointLabels.push(exportedLoop.toothId)
      controlPoints.push({ edgeKey, toothId: exportedLoop.toothId, loopId })
    })

    boundaryLoops.push({
      toothId: exportedLoop.toothId,
      edgeKeys,
      controlPointIndices,
    })
  })

  const group = new THREE.Group()
  group.name = 'tooth-boundaries'

  if (linePositions.length) {
    const lineGeometry = new THREE.BufferGeometry()
    lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3))
    lineGeometry.setAttribute('color', new THREE.Float32BufferAttribute(lineColors, 3))
    const lineMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      depthTest: false,
      depthWrite: false,
    })
    const lines = new THREE.LineSegments(lineGeometry, lineMaterial)
    lines.name = 'tooth-boundary-lines'
    lines.renderOrder = 14
    lines.userData.boundaryEdgeKeys = boundaryEdgeKeys
    group.add(lines)
  }

  if (pointPositions.length) {
    const pointGeometry = new THREE.BufferGeometry()
    pointGeometry.setAttribute('position', new THREE.Float32BufferAttribute(pointPositions, 3))
    pointGeometry.setAttribute('color', new THREE.Float32BufferAttribute(pointColors, 3))
    const pointMaterial = new THREE.PointsMaterial({
      size: 1,
      map: createCirclePointTexture() ?? undefined,
      alphaTest: 0.35,
      vertexColors: true,
      transparent: true,
      opacity: 0.96,
      depthTest: false,
      depthWrite: false,
    })
    const points = new THREE.Points(pointGeometry, pointMaterial)
    points.name = 'tooth-boundary-points'
    points.renderOrder = 15
    points.userData.boundaryLines = group.getObjectByName('tooth-boundary-lines')
    points.userData.boundaryControlPoints = controlPoints
    points.userData.boundaryLoops = boundaryLoops
    points.userData.boundaryPointLabels = pointLabels
    group.add(points)
  }

  group.userData.boundaryLoops = boundaryLoops
  group.userData.boundarySegmentCount = linePositions.length / 6
  group.userData.boundaryPointCount = pointPositions.length / 3
  return group
}

function loadSTL(url: string) {
  const loader = new STLLoader()
  return new Promise<THREE.BufferGeometry>((resolve, reject) => {
    loader.load(url, resolve, undefined, reject)
  })
}

async function createJawMesh(config: JawConfig) {
  const geometry = await loadSTL(config.stlUrl)
  geometry.computeVertexNormals()

  const labelResult = await loadLabels(config, geometry)
  paintGeometryByLabels(geometry, labelResult.labels)

  const material = new THREE.MeshPhongMaterial({
    color: 0xffffff,
    vertexColors: true,
    shininess: 58,
    specular: 0x555555,
    side: THREE.DoubleSide,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = `${config.jaw}-jaw`
  mesh.userData.labelSource = labelResult.source
  mesh.userData.usedFallback = labelResult.usedFallback
  mesh.userData.jaw = config.jaw
  meshLabelMap.set(mesh, labelResult.labels)

  const labelGroup = buildToothLabelGroup(geometry, labelResult.labels)
  mesh.add(labelGroup)
  labelGroups[config.jaw] = labelGroup

  const boundaryGroup = buildBoundaryGroup(geometry, labelResult.labels)
  mesh.add(boundaryGroup)
  boundaryGroups[config.jaw] = boundaryGroup
  mesh.userData.boundarySegmentCount = boundaryGroup.userData.boundarySegmentCount

  return mesh
}

function fitCameraToMeshes() {
  if (!camera || !controls) return
  const visibleMeshes = Object.values(meshes).filter(Boolean) as THREE.Mesh[]
  if (!visibleMeshes.length) return

  const box = new THREE.Box3()
  visibleMeshes.forEach((mesh) => box.expandByObject(mesh))

  const center = new THREE.Vector3()
  const size = new THREE.Vector3()
  box.getCenter(center)
  box.getSize(size)

  const maxDim = Math.max(size.x, size.y, size.z) || 1
  const distance = maxDim / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))
  camera.position
    .copy(center)
    .add(new THREE.Vector3(distance * 1.18, -distance * 1.25, distance * 0.9))
  camera.near = Math.max(maxDim / 100, 0.01)
  camera.far = maxDim * 100
  camera.updateProjectionMatrix()

  controls.target.copy(center)
  controls.update()
}

function syncVisibility() {
  if (meshes.upper) meshes.upper.visible = showUpper.value
  if (meshes.lower) meshes.lower.visible = showLower.value
  if (labelGroups.upper) labelGroups.upper.visible = showUpper.value
  if (labelGroups.lower) labelGroups.lower.visible = showLower.value
  if (boundaryGroups.upper) boundaryGroups.upper.visible = showUpper.value && showBoundaries.value
  if (boundaryGroups.lower) boundaryGroups.lower.visible = showLower.value && showBoundaries.value
}

function toggleUpper() {
  showUpper.value = !showUpper.value
  syncVisibility()
}

function toggleLower() {
  showLower.value = !showLower.value
  syncVisibility()
}

function toggleBoundaries() {
  showBoundaries.value = !showBoundaries.value
  syncVisibility()
}

function resetCamera() {
  fitCameraToMeshes()
}

function triggerImportJson() {
  if (!jsonInputRef.value) return
  jsonInputRef.value.value = ''
  jsonInputRef.value.click()
}

function getExportedBoundaryLoops(jaw: JawType) {
  const group = boundaryGroups[jaw]
  const loops = (group?.userData.boundaryLoops as BoundaryLoopData[] | undefined) ?? []
  const points = group?.getObjectByName('tooth-boundary-points') as THREE.Points | undefined
  const controls = points?.userData.boundaryControlPoints as BoundaryControlPointData[] | undefined

  return loops.map((loop): ExportedBoundaryLoop => {
    const controlEdgeKeys = loop.controlPointIndices
      .map((pointIndex) => controls?.[pointIndex]?.edgeKey)
      .filter((edgeKey): edgeKey is string => !!edgeKey)
    return {
      toothId: loop.toothId,
      edgeKeys: loop.edgeKeys,
      controlEdgeKeys,
    }
  })
}

function exportJawJson(jaw: JawType) {
  const mesh = meshes[jaw]
  const labels = mesh ? meshLabelMap.get(mesh) : undefined
  if (!mesh || !labels?.length) {
    statusText.value = `Cannot export ${jaw}: mesh labels are not ready.`
    return
  }

  const payload: ExportedJawJson = {
    version: 1,
    jaw,
    faceLabels: vertexLabelsToFaceLabels(labels),
    labels: [...labels],
    boundary: {
      loops: getExportedBoundaryLoops(jaw),
    },
  }

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${jaw}-tooth-boundary-labels.json`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
  statusText.value = `Exported ${jaw} JSON.`
}

function replaceBoundaryGroup(mesh: THREE.Mesh, jaw: JawType, nextGroup: THREE.Group) {
  const oldGroup = boundaryGroups[jaw]
  if (oldGroup) {
    mesh.remove(oldGroup)
    disposeObject(oldGroup)
  }
  mesh.add(nextGroup)
  boundaryGroups[jaw] = nextGroup
  mesh.userData.boundarySegmentCount = nextGroup.userData.boundarySegmentCount
  syncVisibility()
}

function applyImportedJawJson(payload: ExportedJawJson) {
  const mesh = meshes[payload.jaw]
  if (!mesh) throw new Error(`Mesh ${payload.jaw} is not loaded.`)

  const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute
  const faceCount = Math.floor(position.count / 3)
  const vertexCount = position.count
  const importedLabels =
    payload.faceLabels?.length === faceCount
      ? faceLabelsToVertexLabels(payload.faceLabels.map(Number))
      : payload.labels?.length === vertexCount
        ? payload.labels.map(Number)
        : null

  if (!importedLabels) {
    throw new Error(
      `JSON labels do not match ${payload.jaw}: expected ${faceCount} face labels or ${vertexCount} vertex labels.`,
    )
  }

  meshLabelMap.set(mesh, importedLabels)
  refreshMeshLabels(mesh)

  const boundaryLoops = payload.boundary?.loops ?? []
  const boundaryGroup = boundaryLoops.length
    ? buildBoundaryGroupFromExportedLoops(mesh.geometry, boundaryLoops)
    : buildBoundaryGroup(mesh.geometry, importedLabels)
  replaceBoundaryGroup(mesh, payload.jaw, boundaryGroup)
  statusText.value = `Imported ${payload.jaw} JSON.`
}

async function handleImportJson(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  try {
    const payload = JSON.parse(await file.text()) as ExportedJawJson
    if (payload.version !== 1 || (payload.jaw !== 'upper' && payload.jaw !== 'lower')) {
      throw new Error('Unsupported JSON payload.')
    }
    applyImportedJawJson(payload)
  } catch (error) {
    console.error(error)
    statusText.value = error instanceof Error ? error.message : String(error)
  } finally {
    input.value = ''
  }
}

function getVisibleBoundaryPoints() {
  const groups = Object.values(boundaryGroups).filter(Boolean) as THREE.Group[]
  return groups
    .filter((group) => group.visible)
    .map((group) => group.getObjectByName('tooth-boundary-points'))
    .filter(Boolean) as THREE.Points[]
}

function updatePointer(event: PointerEvent) {
  if (!renderer) return false
  const rect = renderer.domElement.getBoundingClientRect()
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1)
  return true
}

function getCanvasPoint(event: PointerEvent) {
  if (!renderer) return null
  const rect = renderer.domElement.getBoundingClientRect()
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    width: rect.width,
    height: rect.height,
  }
}

function getPointWorldPosition(points: THREE.Points, pointIndex: number, target: THREE.Vector3) {
  const position = points.geometry.getAttribute('position') as THREE.BufferAttribute
  target.set(position.getX(pointIndex), position.getY(pointIndex), position.getZ(pointIndex))
  return points.localToWorld(target)
}

function setPointLocalPosition(
  points: THREE.Points,
  pointIndex: number,
  worldPosition: THREE.Vector3,
) {
  const position = points.geometry.getAttribute('position') as THREE.BufferAttribute
  const localPosition = points.worldToLocal(worldPosition.clone())
  position.setXYZ(pointIndex, localPosition.x, localPosition.y, localPosition.z)
  position.needsUpdate = true
  points.geometry.computeBoundingSphere()
  return localPosition
}

function syncBoundaryLines(
  lines: THREE.LineSegments | undefined,
  movedPointIndex: number,
  localPosition: THREE.Vector3,
) {
  if (!lines) return
  const edges = lines.userData.boundaryEdges as [number, number][] | undefined
  const linePosition = lines.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!edges || !linePosition) return

  edges.forEach(([fromIndex, toIndex], edgeIndex) => {
    if (fromIndex !== movedPointIndex && toIndex !== movedPointIndex) return
    const vertexIndex = edgeIndex * 2 + (fromIndex === movedPointIndex ? 0 : 1)
    linePosition.setXYZ(vertexIndex, localPosition.x, localPosition.y, localPosition.z)
  })

  linePosition.needsUpdate = true
  lines.geometry.computeBoundingSphere()
}

function getMeshFromBoundaryPoints(points: THREE.Points) {
  const maybeMesh = points.parent?.parent
  return maybeMesh instanceof THREE.Mesh ? maybeMesh : null
}

function getTriangleCenter(
  geometry: THREE.BufferGeometry,
  faceIndex: number,
  target = new THREE.Vector3(),
) {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const base = faceIndex * 3
  target.set(
    (position.getX(base) + position.getX(base + 1) + position.getX(base + 2)) / 3,
    (position.getY(base) + position.getY(base + 1) + position.getY(base + 2)) / 3,
    (position.getZ(base) + position.getZ(base + 1) + position.getZ(base + 2)) / 3,
  )
  return target
}

function buildMeshFaceTopology(geometry: THREE.BufferGeometry): MeshFaceTopology {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const faceCount = Math.floor(position.count / 3)
  const faceEdges = Array.from({ length: faceCount }, () => [] as FaceEdgeRef[])
  const edgeMap = new Map<string, MeshEdgeRecord>()
  const vertexGraph = new Map<
    string,
    Array<{ vertexKey: string; edgeKey: string; weight: number }>
  >()
  const vertexPositions = new Map<string, THREE.Vector3>()

  const addEdge = (faceIndex: number, fromIndex: number, toIndex: number) => {
    const fromKey = vertexKey(position, fromIndex)
    const toKey = vertexKey(position, toIndex)
    const edgeKey = fromKey < toKey ? `${fromKey}|${toKey}` : `${toKey}|${fromKey}`
    let edge = edgeMap.get(edgeKey)

    if (!edge) {
      const from = new THREE.Vector3(
        position.getX(fromIndex),
        position.getY(fromIndex),
        position.getZ(fromIndex),
      )
      const to = new THREE.Vector3(
        position.getX(toIndex),
        position.getY(toIndex),
        position.getZ(toIndex),
      )
      vertexPositions.set(fromKey, from.clone())
      vertexPositions.set(toKey, to.clone())
      edge = {
        edgeKey,
        fromKey,
        toKey,
        faceIndices: [],
        from,
        to,
        midpoint: from.clone().add(to).multiplyScalar(0.5),
      }
      edgeMap.set(edgeKey, edge)

      const weight = from.distanceTo(to)
      const fromNeighbors = vertexGraph.get(fromKey) ?? []
      const toNeighbors = vertexGraph.get(toKey) ?? []
      fromNeighbors.push({ vertexKey: toKey, edgeKey, weight })
      toNeighbors.push({ vertexKey: fromKey, edgeKey, weight })
      vertexGraph.set(fromKey, fromNeighbors)
      vertexGraph.set(toKey, toNeighbors)
    }

    edge.faceIndices.push(faceIndex)
    faceEdges[faceIndex]?.push({ edgeKey, neighbor: null })
  }

  for (let faceIndex = 0; faceIndex < faceCount; faceIndex++) {
    const base = faceIndex * 3
    addEdge(faceIndex, base, base + 1)
    addEdge(faceIndex, base + 1, base + 2)
    addEdge(faceIndex, base + 2, base)
  }

  edgeMap.forEach((edge) => {
    if (edge.faceIndices.length < 2) return
    edge.faceIndices.forEach((faceIndex) => {
      const edgeRef = faceEdges[faceIndex]?.find((item) => item.edgeKey === edge.edgeKey)
      if (edgeRef) edgeRef.neighbor = edge.faceIndices.find((item) => item !== faceIndex) ?? null
    })
  })

  return {
    faceEdges,
    edgeRecords: Array.from(edgeMap.values()),
    edgeByKey: edgeMap,
    vertexGraph,
    vertexPositions,
  }
}

function setFaceLabel(labels: number[], faceIndex: number, label: number) {
  const base = faceIndex * 3
  labels[base] = label
  labels[base + 1] = label
  labels[base + 2] = label
}

function vertexLabelsToFaceLabels(labels: number[]) {
  const faceCount = Math.floor(labels.length / 3)
  const faceLabels = new Array<number>(faceCount)
  for (let faceIndex = 0; faceIndex < faceCount; faceIndex++) {
    faceLabels[faceIndex] = faceLabel(labels, faceIndex)
  }
  return faceLabels
}

function faceLabelsToVertexLabels(faceLabels: number[]) {
  const labels = new Array<number>(faceLabels.length * 3)
  faceLabels.forEach((label, faceIndex) => setFaceLabel(labels, faceIndex, label))
  return labels
}

function distancePointToSegmentSq(point: THREE.Vector3, from: THREE.Vector3, to: THREE.Vector3) {
  const segment = to.clone().sub(from)
  const lengthSq = segment.lengthSq()
  if (!lengthSq) return point.distanceToSquared(from)

  const t = THREE.MathUtils.clamp(point.clone().sub(from).dot(segment) / lengthSq, 0, 1)
  return point.distanceToSquared(from.clone().add(segment.multiplyScalar(t)))
}

function getBoundarySegmentsFromMesh(mesh: THREE.Mesh) {
  const jaw = mesh.userData.jaw as JawType | undefined
  const lines = jaw
    ? (boundaryGroups[jaw]?.getObjectByName('tooth-boundary-lines') as
        | THREE.LineSegments
        | undefined)
    : undefined
  const position = lines?.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!position) return [] as Array<{ from: THREE.Vector3; to: THREE.Vector3 }>

  const segments: Array<{ from: THREE.Vector3; to: THREE.Vector3 }> = []
  for (let index = 0; index + 1 < position.count; index += 2) {
    segments.push({
      from: new THREE.Vector3(position.getX(index), position.getY(index), position.getZ(index)),
      to: new THREE.Vector3(
        position.getX(index + 1),
        position.getY(index + 1),
        position.getZ(index + 1),
      ),
    })
  }
  return segments
}

function boundarySegmentsToBlockedEdges(
  topology: MeshFaceTopology,
  segments: Array<{ from: THREE.Vector3; to: THREE.Vector3 }>,
) {
  const blockedEdges = new Set<string>()
  const averageEdgeLength =
    topology.edgeRecords.reduce((sum, edge) => sum + edge.from.distanceTo(edge.to), 0) /
    Math.max(topology.edgeRecords.length, 1)
  const threshold = Math.max(averageEdgeLength * 0.9, boundarySampleSize * 0.25)
  const thresholdSq = threshold * threshold
  const segmentHitCounts: number[] = []

  segments.forEach((segment) => {
    let nearestEdgeKey = ''
    let nearestDistanceSq = Number.POSITIVE_INFINITY
    let hitCount = 0

    topology.edgeRecords.forEach((edge) => {
      const distanceSq = distancePointToSegmentSq(edge.midpoint, segment.from, segment.to)
      if (distanceSq <= thresholdSq) {
        blockedEdges.add(edge.edgeKey)
        hitCount += 1
      }
      if (distanceSq < nearestDistanceSq) {
        nearestDistanceSq = distanceSq
        nearestEdgeKey = edge.edgeKey
      }
    })

    if (nearestEdgeKey) {
      blockedEdges.add(nearestEdgeKey)
      if (!hitCount) hitCount = 1
    }
    segmentHitCounts.push(hitCount)
  })

  return { blockedEdges, threshold, segmentHitCounts }
}

function getBoundaryLoopsFromMesh(mesh: THREE.Mesh) {
  const jaw = mesh.userData.jaw as JawType | undefined
  if (!jaw) return [] as BoundaryLoopData[]
  return (boundaryGroups[jaw]?.userData.boundaryLoops as BoundaryLoopData[] | undefined) ?? []
}

function getBlockedEdgesFromBoundaryLoops(mesh: THREE.Mesh) {
  const loops = getBoundaryLoopsFromMesh(mesh)
  const blockedEdges = new Set<string>()
  loops.forEach((loop) => loop.edgeKeys.forEach((edgeKey) => blockedEdges.add(edgeKey)))
  return { loops, blockedEdges }
}

function getToothSeedFaces(geometry: THREE.BufferGeometry, faceLabels: number[]) {
  const sums = new Map<number, { center: THREE.Vector3; count: number }>()
  const center = new THREE.Vector3()

  faceLabels.forEach((label, faceIndex) => {
    if (label < 0) return
    let sum = sums.get(label)
    if (!sum) {
      sum = { center: new THREE.Vector3(), count: 0 }
      sums.set(label, sum)
    }
    getTriangleCenter(geometry, faceIndex, center)
    sum.center.add(center)
    sum.count += 1
  })

  const seeds = new Map<number, number>()
  sums.forEach((sum, toothId) => {
    const targetCenter = sum.center.multiplyScalar(1 / Math.max(sum.count, 1))
    let bestFaceIndex = -1
    let bestDistanceSq = Number.POSITIVE_INFINITY
    faceLabels.forEach((label, faceIndex) => {
      if (label !== toothId) return
      getTriangleCenter(geometry, faceIndex, center)
      const distanceSq = center.distanceToSquared(targetCenter)
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq
        bestFaceIndex = faceIndex
      }
    })
    if (bestFaceIndex >= 0) seeds.set(toothId, bestFaceIndex)
  })

  return seeds
}

function recomputeAllToothLabels(mesh: THREE.Mesh) {
  const labels = meshLabelMap.get(mesh)
  const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!labels || !position) return false

  const topology = buildMeshFaceTopology(mesh.geometry)
  const { loops: boundaryLoops, blockedEdges } = getBlockedEdgesFromBoundaryLoops(mesh)
  const previousFaceLabels = vertexLabelsToFaceLabels(labels)
  const nextFaceLabels = new Array<number>(previousFaceLabels.length).fill(-1)
  const seeds = getToothSeedFaces(mesh.geometry, previousFaceLabels)
  const queue: Array<{ faceIndex: number; toothId: number }> = []
  const floodFillCounts = new Map<number, number>()

  Array.from(seeds.entries())
    .sort(([a], [b]) => (a === 0 ? 1 : b === 0 ? -1 : a - b))
    .forEach(([toothId, seedFaceIndex]) => {
      nextFaceLabels[seedFaceIndex] = toothId
      queue.push({ faceIndex: seedFaceIndex, toothId })
      floodFillCounts.set(toothId, 1)
    })

  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor]
    if (!current) continue

    for (const edgeRef of topology.faceEdges[current.faceIndex] ?? []) {
      if (blockedEdges.has(edgeRef.edgeKey)) continue
      const neighbor = edgeRef.neighbor
      if (neighbor == null || nextFaceLabels[neighbor] !== -1) continue
      nextFaceLabels[neighbor] = current.toothId
      floodFillCounts.set(current.toothId, (floodFillCounts.get(current.toothId) ?? 0) + 1)
      queue.push({ faceIndex: neighbor, toothId: current.toothId })
    }
  }

  nextFaceLabels.forEach((label, faceIndex) => {
    if (label !== -1) return
    nextFaceLabels[faceIndex] = 0
  })

  const nextVertexLabels = faceLabelsToVertexLabels(nextFaceLabels)
  let changed = false
  for (let index = 0; index < Math.min(labels.length, nextVertexLabels.length); index++) {
    const nextLabel = nextVertexLabels[index] ?? 0
    if (labels[index] === nextLabel) continue
    labels[index] = nextLabel
    changed = true
  }

  const toothFaceCounts = new Map<number, number>()
  nextFaceLabels.forEach((label) => {
    if (!label || label < 0) return
    toothFaceCounts.set(label, (toothFaceCounts.get(label) ?? 0) + 1)
  })

  console.info('[editStl] recomputeAllToothLabels', {
    boundaryLoopCount: boundaryLoops.length,
    boundaryEdgeCount: boundaryLoops.reduce((sum, loop) => sum + loop.edgeKeys.length, 0),
    blockedEdgeCount: blockedEdges.size,
    floodFillFaceCount: Array.from(floodFillCounts.entries()).reduce(
      (sum, [, count]) => sum + count,
      0,
    ),
    floodFillCounts: Object.fromEntries(floodFillCounts),
    toothFaceCount: Object.fromEntries(toothFaceCounts),
  })

  if (changed) refreshMeshLabels(mesh)
  return changed
}

function getDominantReplacementLabel(labels: number[], toothId: number, faceIndices: number[]) {
  const counts = new Map<number, number>()
  faceIndices.forEach((faceIndex) => {
    const label = faceLabel(labels, faceIndex)
    if (!label || label === toothId) return
    counts.set(label, (counts.get(label) ?? 0) + 1)
  })
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0
}

function refreshMeshLabels(mesh: THREE.Mesh) {
  const labels = meshLabelMap.get(mesh)
  const jaw = mesh.userData.jaw as JawType | undefined
  if (!labels || !jaw) return

  paintGeometryByLabels(mesh.geometry, labels)
  const colors = mesh.geometry.getAttribute('color') as THREE.BufferAttribute | undefined
  if (colors) colors.needsUpdate = true

  const oldLabelGroup = labelGroups[jaw]
  if (oldLabelGroup) {
    mesh.remove(oldLabelGroup)
    disposeObject(oldLabelGroup)
  }

  const labelGroup = buildToothLabelGroup(mesh.geometry, labels)
  mesh.add(labelGroup)
  labelGroups[jaw] = labelGroup
  syncVisibility()
}

function writeDraggedBoundaryToFaceLabels(state: BoundaryDragState) {
  const labels = meshLabelMap.get(state.mesh)
  const position = state.mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  const pointPosition = state.points.geometry.getAttribute('position') as
    | THREE.BufferAttribute
    | undefined
  if (!labels || !position || !pointPosition || !state.toothId) return false

  const nextLocalPosition = new THREE.Vector3(
    pointPosition.getX(state.pointIndex),
    pointPosition.getY(state.pointIndex),
    pointPosition.getZ(state.pointIndex),
  )
  const faceCount = Math.floor(position.count / 3)
  const center = new THREE.Vector3()
  const radius = boundarySampleSize * 3.2
  const radiusSq = radius * radius
  const newFaceIndices: number[] = []
  const oldFaceIndices: number[] = []

  for (let faceIndex = 0; faceIndex < faceCount; faceIndex++) {
    getTriangleCenter(state.mesh.geometry, faceIndex, center)
    if (center.distanceToSquared(nextLocalPosition) <= radiusSq) newFaceIndices.push(faceIndex)
    if (center.distanceToSquared(state.originalLocalPosition) <= radiusSq)
      oldFaceIndices.push(faceIndex)
  }

  const replacementLabel = getDominantReplacementLabel(labels, state.toothId, oldFaceIndices)
  let changed = false

  oldFaceIndices.forEach((faceIndex) => {
    getTriangleCenter(state.mesh.geometry, faceIndex, center)
    if (center.distanceToSquared(nextLocalPosition) <= radiusSq * 0.45) return
    if (faceLabel(labels, faceIndex) !== state.toothId) return
    setFaceLabel(labels, faceIndex, replacementLabel)
    changed = true
  })

  newFaceIndices.forEach((faceIndex) => {
    if (faceLabel(labels, faceIndex) === state.toothId) return
    setFaceLabel(labels, faceIndex, state.toothId)
    changed = true
  })

  if (changed) refreshMeshLabels(state.mesh)
  return changed
}

function setBoundaryPointColor(points: THREE.Points, pointIndex: number, color: THREE.Color) {
  const colors = points.geometry.getAttribute('color') as THREE.BufferAttribute | undefined
  if (!colors) return
  colors.setXYZ(pointIndex, color.r, color.g, color.b)
  colors.needsUpdate = true
}

function getBoundaryPointColor(points: THREE.Points, pointIndex: number) {
  const colors = points.geometry.getAttribute('color') as THREE.BufferAttribute | undefined
  if (!colors) return new THREE.Color()
  return new THREE.Color(colors.getX(pointIndex), colors.getY(pointIndex), colors.getZ(pointIndex))
}

function sameBoundaryPoint(a: BoundaryPickResult | null, b: BoundaryPickResult | null) {
  return !!a && !!b && a.points === b.points && a.pointIndex === b.pointIndex
}

function clearBoundaryHover() {
  if (!boundaryHoverState) return
  if (!sameBoundaryPoint(boundaryHoverState, boundaryDragState)) {
    setBoundaryPointColor(
      boundaryHoverState.points,
      boundaryHoverState.pointIndex,
      boundaryHoverState.originalColor,
    )
  }
  boundaryHoverState = null
}

function setBoundaryHover(pick: BoundaryPickResult | null) {
  if (boundaryDragState || sameBoundaryPoint(boundaryHoverState, pick)) return
  clearBoundaryHover()
  if (!pick) return

  boundaryHoverState = {
    ...pick,
    originalColor: getBoundaryPointColor(pick.points, pick.pointIndex),
  }
  setBoundaryPointColor(pick.points, pick.pointIndex, hoverPointColor)
}

function pickNearestBoundaryPoint(event: PointerEvent): BoundaryPickResult | null {
  const activeCamera = camera
  if (!activeCamera) return null
  const canvasPoint = getCanvasPoint(event)
  if (!canvasPoint) return null

  let closest: BoundaryPickResult | null = null
  let closestDistanceSq = pointHitRadiusPx * pointHitRadiusPx
  const projected = new THREE.Vector3()

  getVisibleBoundaryPoints().forEach((points) => {
    const position = points.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!position) return

    for (let index = 0; index < position.count; index++) {
      projected.set(position.getX(index), position.getY(index), position.getZ(index))
      points.localToWorld(projected)
      projected.project(activeCamera)

      if (projected.z < -1 || projected.z > 1) continue

      const x = (projected.x * 0.5 + 0.5) * canvasPoint.width
      const y = (-projected.y * 0.5 + 0.5) * canvasPoint.height
      const distanceSq = (x - canvasPoint.x) ** 2 + (y - canvasPoint.y) ** 2

      if (distanceSq < closestDistanceSq) {
        closestDistanceSq = distanceSq
        closest = { points, pointIndex: index }
      }
    }
  })

  return closest
}

function onPointerDown(event: PointerEvent) {
  if (!camera || !controls || !renderer || !updatePointer(event)) return

  raycaster.setFromCamera(pointer, camera)

  const hit = pickNearestBoundaryPoint(event)
  if (!hit) return

  const points = hit.points
  const pointIndex = hit.pointIndex
  const mesh = getMeshFromBoundaryPoints(points)
  const pointLabels = points.userData.boundaryPointLabels as number[] | undefined
  const toothId = Number(pointLabels?.[pointIndex] ?? 0)
  if (!mesh || !toothId) return
  const topology = buildMeshFaceTopology(mesh.geometry)
  const hoverState = boundaryHoverState
  const originalColor =
    hoverState && sameBoundaryPoint(hoverState, hit)
      ? hoverState.originalColor
      : getBoundaryPointColor(points, pointIndex)
  clearBoundaryHover()
  getPointWorldPosition(points, pointIndex, dragPoint)
  camera.getWorldDirection(dragPlaneNormal)

  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(dragPlaneNormal, dragPoint)
  const planeHit = raycaster.ray.intersectPlane(plane, dragTarget)

  boundaryDragState = {
    points,
    lines: points.userData.boundaryLines as THREE.LineSegments | undefined,
    pointIndex,
    plane,
    offset: planeHit ? dragPoint.clone().sub(planeHit) : new THREE.Vector3(),
    originalColor,
    originalLocalPosition: points.worldToLocal(dragPoint.clone()),
    mesh,
    topology,
    toothId,
  }

  setBoundaryPointColor(points, pointIndex, movablePointColor)
  controls.enabled = false
  renderer.domElement.setPointerCapture(event.pointerId)
  renderer.domElement.classList.add('dragging-boundary-point')
  event.preventDefault()
}

function onPointerMove(event: PointerEvent) {
  if (!camera || !renderer || !updatePointer(event)) return

  if (!boundaryDragState) {
    setBoundaryHover(pickNearestBoundaryPoint(event))
    return
  }

  raycaster.setFromCamera(pointer, camera)
  const planeHit = raycaster.ray.intersectPlane(boundaryDragState.plane, dragTarget)
  const meshHit = raycaster.intersectObject(boundaryDragState.mesh, false)[0]
  if (!planeHit && !meshHit) return

  const nextWorldPosition = meshHit ? meshHit.point : dragTarget.add(boundaryDragState.offset)
  const nextLocalOnMesh = boundaryDragState.mesh.worldToLocal(nextWorldPosition.clone())
  const nearestEdge = findNearestMeshEdge(boundaryDragState.topology, nextLocalOnMesh)
  if (!nearestEdge) return

  const controls = boundaryDragState.points.userData.boundaryControlPoints as
    | BoundaryControlPointData[]
    | undefined
  const controlPoint = controls?.[boundaryDragState.pointIndex]
  if (!controlPoint) return

  controlPoint.edgeKey = nearestEdge.edgeKey
  const snappedWorldPosition = boundaryDragState.mesh.localToWorld(nearestEdge.midpoint.clone())
  setPointLocalPosition(
    boundaryDragState.points,
    boundaryDragState.pointIndex,
    snappedWorldPosition,
  )
  rebuildBoundaryLoopsFromControlPoints(boundaryDragState.points, boundaryDragState.topology)
  event.preventDefault()
}

function endBoundaryDrag(event?: PointerEvent) {
  if (!boundaryDragState) return
  const dragState = boundaryDragState
  setBoundaryPointColor(dragState.points, dragState.pointIndex, dragState.originalColor)
  if (controls) controls.enabled = true
  if (renderer) {
    renderer.domElement.classList.remove('dragging-boundary-point')
    if (event && renderer.domElement.hasPointerCapture(event.pointerId)) {
      renderer.domElement.releasePointerCapture(event.pointerId)
    }
  }
  recomputeAllToothLabels(dragState.mesh)
  boundaryDragState = null
  if (event) setBoundaryHover(pickNearestBoundaryPoint(event))
}

function onPointerLeave() {
  if (!boundaryDragState) clearBoundaryHover()
}

function onResize() {
  if (!containerRef.value || !renderer || !camera) return
  const width = containerRef.value.clientWidth
  const height = containerRef.value.clientHeight || 600
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderer.setSize(width, height)
}

function animate() {
  rafId = requestAnimationFrame(animate)
  controls?.update()
  if (renderer && scene && camera) renderer.render(scene, camera)
}

async function init() {
  const container = containerRef.value
  if (!container) return

  const width = container.clientWidth
  const height = container.clientHeight || 600

  scene = new THREE.Scene()
  scene.background = new THREE.Color(0xf4f6f8)

  camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 3000)
  camera.up.set(0, 0, 1)

  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(width, height)
  container.appendChild(renderer.domElement)
  renderer.domElement.addEventListener('pointerdown', onPointerDown)
  renderer.domElement.addEventListener('pointermove', onPointerMove)
  renderer.domElement.addEventListener('pointerup', endBoundaryDrag)
  renderer.domElement.addEventListener('pointercancel', endBoundaryDrag)
  renderer.domElement.addEventListener('pointerleave', onPointerLeave)

  scene.add(new THREE.HemisphereLight(0xffffff, 0x76808f, 1.4))

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.8)
  keyLight.position.set(80, -120, 150)
  scene.add(keyLight)

  const fillLight = new THREE.DirectionalLight(0xffffff, 0.8)
  fillLight.position.set(-80, 90, 100)
  scene.add(fillLight)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08

  window.addEventListener('resize', onResize)
  animate()

  statusText.value = '正在加载上下颌 STL 和牙位颜色...'
  const loadedMeshes = await Promise.all(jawConfigs.map(createJawMesh))

  loadedMeshes.forEach((mesh) => {
    meshes[mesh.name.startsWith('upper') ? 'upper' : 'lower'] = mesh
    scene?.add(mesh)
  })

  syncVisibility()
  fitCameraToMeshes()

  const fallbackNames = jawConfigs
    .filter((config) => meshes[config.jaw]?.userData.usedFallback)
    .map((config) => config.name)

  statusText.value = fallbackNames.length
    ? `已加载。${fallbackNames.join('、')} 的 points labels 与 STL 不匹配，已使用 models 中的对应 labels 着色。`
    : '已加载。颜色来自 public/points 的 upper.json 和 lower.json。'
}

function disposeObject(object: THREE.Object3D | undefined) {
  if (!object) return
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    mesh.geometry?.dispose()
    const material = mesh.material
    if (Array.isArray(material)) {
      material.forEach((item) => item.dispose())
    } else {
      material?.dispose()
    }
  })
}

onMounted(() => {
  void init().catch((error) => {
    console.error(error)
    statusText.value = error instanceof Error ? error.message : String(error)
  })
})

onUnmounted(() => {
  window.removeEventListener('resize', onResize)
  cancelAnimationFrame(rafId)
  renderer?.domElement.removeEventListener('pointerdown', onPointerDown)
  renderer?.domElement.removeEventListener('pointermove', onPointerMove)
  renderer?.domElement.removeEventListener('pointerup', endBoundaryDrag)
  renderer?.domElement.removeEventListener('pointercancel', endBoundaryDrag)
  renderer?.domElement.removeEventListener('pointerleave', onPointerLeave)
  controls?.dispose()
  disposeObject(meshes.upper)
  disposeObject(meshes.lower)
  renderer?.dispose()
  renderer?.domElement.parentElement?.removeChild(renderer.domElement)
  scene = null
  camera = null
  renderer = null
  controls = null
})
</script>

<style scoped>
.edit-stl-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100vh;
  min-height: 640px;
  overflow: hidden;
  background: #f4f6f8;
}

.toolbar {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 10px;
  min-height: 52px;
  padding: 8px 14px;
  background: #ffffff;
  border-bottom: 1px solid #dfe5ec;
}

.tool-button {
  height: 34px;
  padding: 0 14px;
  color: #27313d;
  cursor: pointer;
  background: #ffffff;
  border: 1px solid #cfd8e3;
  border-radius: 6px;
}

.tool-button:hover {
  border-color: #409eff;
}

.tool-button.active {
  color: #ffffff;
  background: #2474e8;
  border-color: #2474e8;
}

.status {
  min-width: 0;
  margin-left: 6px;
  overflow: hidden;
  color: #5f6b7a;
  font-size: 13px;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.json-input {
  display: none;
}

.viewer {
  flex: 1;
  min-height: 0;
}

.viewer :deep(canvas) {
  cursor: grab;
}

.viewer :deep(canvas.dragging-boundary-point) {
  cursor: grabbing;
}
</style>
