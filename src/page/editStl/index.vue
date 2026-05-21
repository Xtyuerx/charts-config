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
      <button class="tool-button" :class="{ active: showBoundaries }" type="button" @click="toggleBoundaries">
        Boundary
      </button>
      <span class="status">{{ statusText }}</span>
    </div>
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
}

type BoundaryPickResult = {
  points: THREE.Points
  pointIndex: number
}

type BoundaryHoverState = BoundaryPickResult & {
  originalColor: THREE.Color
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

function buildBoundaryGroup(geometry: THREE.BufferGeometry, labels: number[]) {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const faceCount = position.count / 3
  const edgeMap = new Map<
    string,
    {
      from: THREE.Vector3
      to: THREE.Vector3
      labels: Set<number>
    }
  >()

  const addEdge = (fromIndex: number, toIndex: number, label: number) => {
    const fromKey = vertexKey(position, fromIndex)
    const toKey = vertexKey(position, toIndex)
    const edgeKey = fromKey < toKey ? `${fromKey}|${toKey}` : `${toKey}|${fromKey}`
    let edge = edgeMap.get(edgeKey)

    if (!edge) {
      edge = {
        from: new THREE.Vector3(
          position.getX(fromIndex),
          position.getY(fromIndex),
          position.getZ(fromIndex),
        ),
        to: new THREE.Vector3(position.getX(toIndex), position.getY(toIndex), position.getZ(toIndex)),
        labels: new Set<number>(),
      }
      edgeMap.set(edgeKey, edge)
    }

    edge.labels.add(label)
  }

  for (let faceIndex = 0; faceIndex < faceCount; faceIndex++) {
    const label = faceLabel(labels, faceIndex)
    const base = faceIndex * 3
    addEdge(base, base + 1, label)
    addEdge(base + 1, base + 2, label)
    addEdge(base + 2, base, label)
  }

  const linePositions: number[] = []
  const lineColors: number[] = []
  const pointPositions: number[] = []
  const pointColors: number[] = []
  const samplePoints = new Map<string, { point: THREE.Vector3; count: number; label: number }>()
  const sampledEdges = new Set<string>()
  const pointIndexes = new Map<string, number>()
  const boundaryEdges: [number, number][] = []

  edgeMap.forEach((edge) => {
    const nonZeroLabels = Array.from(edge.labels).filter(Boolean)
    if (!nonZeroLabels.length || edge.labels.size < 2) return

    const label = nonZeroLabels[0] ?? 0
    const fromKey = addSamplePoint(samplePoints, label, edge.from)
    const toKey = addSamplePoint(samplePoints, label, edge.to)

    if (fromKey === toKey) return
    sampledEdges.add(fromKey < toKey ? `${fromKey}|${toKey}` : `${toKey}|${fromKey}`)
  })

  samplePoints.forEach((sample, key) => {
    sample.point.multiplyScalar(1 / sample.count)
    const color = colorForLabel(sample.label)
    pointIndexes.set(key, pointPositions.length / 3)
    pointPositions.push(sample.point.x, sample.point.y, sample.point.z)
    pointColors.push(color.r, color.g, color.b)
  })

  sampledEdges.forEach((edgeKey) => {
    const [fromKey, toKey] = edgeKey.split('|')
    if (!fromKey || !toKey) return

    const from = samplePoints.get(fromKey)
    const to = samplePoints.get(toKey)
    const fromIndex = pointIndexes.get(fromKey)
    const toIndex = pointIndexes.get(toKey)
    if (!from || !to || fromIndex == null || toIndex == null) return

    const color = colorForLabel(from.label)
    boundaryEdges.push([fromIndex, toIndex])
    linePositions.push(from.point.x, from.point.y, from.point.z, to.point.x, to.point.y, to.point.z)
    lineColors.push(color.r, color.g, color.b, color.r, color.g, color.b)
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
    lines.userData.boundaryEdges = boundaryEdges
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
    group.add(points)
  }

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
  camera.position.copy(center).add(new THREE.Vector3(distance * 1.18, -distance * 1.25, distance * 0.9))
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

function setPointLocalPosition(points: THREE.Points, pointIndex: number, worldPosition: THREE.Vector3) {
  const position = points.geometry.getAttribute('position') as THREE.BufferAttribute
  const localPosition = points.worldToLocal(worldPosition.clone())
  position.setXYZ(pointIndex, localPosition.x, localPosition.y, localPosition.z)
  position.needsUpdate = true
  points.geometry.computeBoundingSphere()
  return localPosition
}

function syncBoundaryLines(lines: THREE.LineSegments | undefined, movedPointIndex: number, localPosition: THREE.Vector3) {
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

function pickNearestBoundaryPoint(event: PointerEvent) {
  if (!camera) return null
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
      projected.project(camera)

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

  const { points, pointIndex } = hit
  const originalColor = sameBoundaryPoint(boundaryHoverState, hit)
    ? boundaryHoverState.originalColor
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
  if (!planeHit) return

  const nextWorldPosition = dragTarget.add(boundaryDragState.offset)
  const nextLocalPosition = setPointLocalPosition(
    boundaryDragState.points,
    boundaryDragState.pointIndex,
    nextWorldPosition,
  )
  syncBoundaryLines(boundaryDragState.lines, boundaryDragState.pointIndex, nextLocalPosition)
  event.preventDefault()
}

function endBoundaryDrag(event?: PointerEvent) {
  if (!boundaryDragState) return
  setBoundaryPointColor(
    boundaryDragState.points,
    boundaryDragState.pointIndex,
    boundaryDragState.originalColor,
  )
  if (controls) controls.enabled = true
  if (renderer) {
    renderer.domElement.classList.remove('dragging-boundary-point')
    if (event && renderer.domElement.hasPointerCapture(event.pointerId)) {
      renderer.domElement.releasePointerCapture(event.pointerId)
    }
  }
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
