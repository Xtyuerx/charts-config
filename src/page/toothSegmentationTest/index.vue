<template>
  <main class="segmentation-page">
    <header class="toolbar">
      <div class="title-block">
        <h1>牙齿分割技术测试</h1>
        <p>当前展示数据与 allStl 页面一致，后续分割实验将在此页面独立进行。</p>
      </div>

      <div class="actions">
        <button
          type="button"
          :class="{ active: showUpper }"
          :aria-pressed="showUpper"
          @click="toggleJaw('upper')"
        >
          上颌
        </button>
        <button
          type="button"
          :class="{ active: showLower }"
          :aria-pressed="showLower"
          @click="toggleJaw('lower')"
        >
          下颌
        </button>
        <button type="button" @click="fitCameraToJaws">重置视角</button>
        <button
          type="button"
          :class="{ active: segmentationMode }"
          :aria-pressed="segmentationMode"
          @click="toggleSegmentationMode"
        >
          分牙
        </button>
        <button type="button" :disabled="!hasBoundary" @click="clearBoundary">
          清除边界
        </button>
        <button
          v-if="segmentationMode"
          type="button"
          :disabled="!canGenerateBoundary"
          @click="generateGraphCutBoundary"
        >
          生成边界
        </button>
        <label class="tooth-field">
          <span>当前牙号</span>
          <input v-model.number="selectedToothId" type="number" min="11" max="48" />
        </label>
        <button type="button" :disabled="editingToothId == null" @click="applyToothId">
          应用牙号
        </button>
        <button type="button" :disabled="!canConfirmBoundary" @click="confirmToothSegmentation">
          确认分牙
        </button>
        <label v-if="savedToothIds.length" class="tooth-field">
          <span>已保存</span>
          <select :value="editingToothId ?? ''" @change="selectSavedBoundary">
            <option value="" disabled>选择牙齿</option>
            <option v-for="toothId in savedToothIds" :key="toothId" :value="toothId">
              {{ toothId }}
            </option>
          </select>
        </label>
        <button type="button" :disabled="!hasBoundary" @click="exportBoundaryJson">
          导出 JSON
        </button>
        <button type="button" :disabled="!modelsReady" @click="openBoundaryJsonPicker">
          加载 JSON
        </button>
        <input
          ref="boundaryJsonInputRef"
          class="hidden-file-input"
          type="file"
          accept="application/json,.json"
          @change="loadBoundaryJson"
        />
      </div>

      <p class="status" role="status">{{ statusText }}</p>
    </header>

    <div ref="viewerRef" class="viewer" data-testid="tooth-segmentation-viewer">
      <span
        v-if="activeSeedPreviewVisual"
        class="visual-state-hook"
        data-testid="seed-preview"
        :data-color="activeSeedPreviewVisual.color"
      >种子面预览</span>
      <span
        v-if="activeBoundaryVisual"
        class="visual-state-hook"
        data-testid="active-boundary"
        :data-line-color="activeBoundaryVisual.lineColor"
        :data-point-color="activeBoundaryVisual.pointColor"
      >当前牙齿边界</span>
      <span
        v-for="visual in inactiveBoundaryVisuals"
        :key="visual.toothId"
        class="visual-state-hook"
        data-testid="inactive-boundary"
        :data-line-color="visual.lineColor"
        :data-point-color="visual.pointColor"
      >非当前牙齿边界</span>
      <canvas
        ref="drawingCanvasRef"
        class="drawing-canvas"
        :class="{ enabled: segmentationMode }"
        @pointerdown="startBoundaryDrawing"
        @pointermove="continueBoundaryDrawing"
        @pointerup="finishBoundaryDrawing"
        @pointercancel="cancelBoundaryDrawing"
        @pointerleave="handleBoundaryPointerLeave"
      ></canvas>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { STLLoader } from 'three-stdlib'
import {
  applySurfaceBoundaryDragFrame,
  buildSurfaceGraph,
  createClosedSurfacePath,
  createSurfaceLineGeometry,
  createSurfaceSegmentPoints,
  extractLabelBoundary,
  moveLabelBoundaryControl,
  updateSurfaceLineGeometry,
  type ClosedSurfacePath,
  type SurfaceGraph,
} from './utils/surfaceBoundaryUtils'
import {
  disposeMeshBvh,
  enableMeshBvh,
  enableNearestHit,
} from './utils/bvhRaycastUtils'
import {
  boundaryControlVectors,
  inferDominantToothId,
  moveBoundaryToothId,
  updateBoundaryControlPoint,
  type ToothBoundary,
} from './utils/toothBoundaryEditorUtils'
import {
  buildConfirmedToothGeometry,
  buildSegmentationExportPayload,
  buildToothRegionTopology,
  classifyToothRegion,
  groupConfirmedTriangles,
  prepareConfirmedToothRegion,
  type ToothRegionTopology,
} from './utils/toothRegionClassifier'
import {
  findJawForToothId,
  parseSegmentationImportPayload,
} from './utils/toothSegmentationPersistence'
import {
  createSeededState,
  markBoundaryEdited,
  markBoundaryReady,
  markConfirmed,
  type JawType,
  type ToothSegmentationState,
} from './utils/toothSegmentationState'
import {
  collectSeedFaces,
  sampleClosedScreenPolygon,
  type ScreenPoint,
} from './utils/seedSelectionUtils'
import {
  buildGraphCutProblem,
  buildToothGraphCutRoi,
  buildToothGraphTopology,
  type ToothGraphCutRoi,
  type ToothGraphTopology,
} from './utils/toothGraphCutUtils'
import { ToothGraphCutWorkerClient } from './utils/toothGraphCutWorkerClient'
import { extractToothBoundary } from './utils/toothBoundaryExtractionUtils'

type LabelPayload = {
  labels?: number[]
  faceLabels?: number[]
}

type JawConfig = {
  jaw: JawType
  stlUrl: string
  pointsUrl: string
  fallbackLabelUrl: string
}

type BoundaryControlKind = 'automatic' | 'drawn'

type BoundaryPointPick = {
  kind: BoundaryControlKind
  jaw: JawType
  mesh: THREE.Mesh
  points: THREE.Points
  pointIndex: number
}

type BoundaryDragState = BoundaryPointPick & {
  hasMoved: boolean
  pendingBoundary?: ToothBoundary
}

const jawConfigs: JawConfig[] = [
  {
    jaw: 'upper',
    stlUrl: '/models/upper.stl',
    pointsUrl: '/points/upper.json',
    fallbackLabelUrl: '/models/upper.json',
  },
  {
    jaw: 'lower',
    stlUrl: '/models/lower.stl',
    pointsUrl: '/points/lower.json',
    fallbackLabelUrl: '/models/lower.json',
  },
]

const toothColors: Record<number, number> = {
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
  38: 0xa55eea,
  41: 0xfc5c65,
  42: 0xfd9644,
  43: 0xfed330,
  44: 0x26de81,
  45: 0x20bf6b,
  46: 0x2bcbba,
  47: 0x4b7bec,
  48: 0x4b6584,
}

const viewerRef = ref<HTMLDivElement | null>(null)
const drawingCanvasRef = ref<HTMLCanvasElement | null>(null)
const boundaryJsonInputRef = ref<HTMLInputElement | null>(null)
const statusText = ref('正在加载 allStl 上下颌数据…')
const modelsReady = ref(false)
const showUpper = ref(true)
const showLower = ref(true)
const segmentationMode = ref(false)
const selectedToothId = ref<number | null>(null)
const editingToothId = ref<number | null>(null)
const toothSegmentations = shallowRef(new Map<number, ToothSegmentationState>())
const savedToothIds = computed(() =>
  Array.from(toothSegmentations.value.values())
    .filter((state) => state.boundary !== null)
    .map((state) => state.toothId)
    .sort((a, b) => a - b),
)
const activeSegmentation = computed(() => {
  const toothId = editingToothId.value
  return toothId == null ? null : toothSegmentations.value.get(toothId) ?? null
})
const generatingToothIds = shallowRef(new Set<number>())
const hasBoundary = computed(() =>
  Array.from(toothSegmentations.value.values()).some((state) => state.boundary !== null),
)
const canGenerateBoundary = computed(() => {
  const state = activeSegmentation.value
  return Boolean(
    segmentationMode.value &&
      state?.status === 'seeded' &&
      state.seedFaceIndices.length >= 3 &&
      !generatingToothIds.value.has(state.toothId),
  )
})
const canConfirmBoundary = computed(() => {
  const state = activeSegmentation.value
  return Boolean(segmentationMode.value && state?.status === 'boundary-ready' && state.boundary)
})

const jawMeshes: Partial<Record<JawType, THREE.Mesh>> = {}
const automaticBoundaryGroups: Partial<Record<JawType, THREE.Group>> = {}
const toothBoundaryGroups = new Map<number, { group: THREE.Group; mesh: THREE.Mesh }>()
const seedPreviewGroups = new Map<number, { group: THREE.Group; mesh: THREE.Mesh }>()
const surfaceGraphs = new WeakMap<THREE.Mesh, SurfaceGraph>()
const graphTopologies = new WeakMap<THREE.Mesh, ToothGraphTopology>()
const seedFaceNeighbors = new WeakMap<THREE.Mesh, number[][]>()
const regionTopologies = new WeakMap<THREE.Mesh, ToothRegionTopology>()
const confirmedTriangleLabels: Record<JawType, number[]> = { upper: [], lower: [] }
const confirmedRegionMeshes = new Map<string, THREE.Mesh>()
const raycaster = enableNearestHit(new THREE.Raycaster())
const pointer = new THREE.Vector2()
let pointHighlight: THREE.Points | null = null
let boundaryDragState: BoundaryDragState | null = null
let pendingDragRaycast: ((mesh: THREE.Mesh) => Pick<THREE.Intersection, 'point'> | null) | null = null
let dragUpdateFrameId = 0
let drawing = false
let drawingPoints: Array<{ x: number; y: number }> = []
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let renderer: THREE.WebGLRenderer | null = null
let controls: OrbitControls | null = null
let roundPointTexture: THREE.CanvasTexture | null = null
let animationFrameId = 0
let graphCutWorkerClient: ToothGraphCutWorkerClient | null = null
let boundaryJobSequence = 0
const latestBoundaryJobs = new Map<number, number>()

function materialColor(material: THREE.Material | THREE.Material[] | undefined) {
  const candidate = Array.isArray(material) ? material[0] : material
  if (
    !(candidate instanceof THREE.LineBasicMaterial) &&
    !(candidate instanceof THREE.PointsMaterial)
  ) return null
  return `#${candidate.color.getHexString()}`
}

function boundaryVisual(toothId: number) {
  const rendered = toothBoundaryGroups.get(toothId)
  const curve = rendered?.group.getObjectByName('boundary-curve') as THREE.LineSegments | undefined
  const points = rendered?.group.getObjectByName('boundary-points') as THREE.Points | undefined
  const lineColor = materialColor(curve?.material)
  const pointColor = materialColor(points?.material)
  return rendered && lineColor && pointColor ? { toothId, lineColor, pointColor } : null
}

function seedPreviewVisual(toothId: number) {
  const rendered = seedPreviewGroups.get(toothId)
  const preview = rendered?.group.getObjectByName('seed-faces') as THREE.Mesh | undefined
  const material = Array.isArray(preview?.material) ? preview.material[0] : preview?.material
  return rendered && material instanceof THREE.MeshBasicMaterial
    ? { toothId, color: `#${material.color.getHexString()}` }
    : null
}

const activeSeedPreviewVisual = computed(() => {
  const state = activeSegmentation.value
  return state?.status === 'seeded' ? seedPreviewVisual(state.toothId) : null
})
const activeBoundaryVisual = computed(() => {
  const state = activeSegmentation.value
  return state?.boundary ? boundaryVisual(state.toothId) : null
})
const inactiveBoundaryVisuals = computed(() => {
  const activeToothId = editingToothId.value
  return Array.from(toothSegmentations.value.values())
    .filter((state) => state.boundary && state.toothId !== activeToothId)
    .map((state) => boundaryVisual(state.toothId))
    .filter((visual): visual is NonNullable<typeof visual> => visual !== null)
})

function getColor(label: number) {
  if (!label) return new THREE.Color(0xd9b1a8)
  const configured = toothColors[label]
  if (configured != null) return new THREE.Color(configured)
  return new THREE.Color().setHSL((((label * 2654435761) >>> 0) % 360) / 360, 0.68, 0.55)
}

async function fetchLabels(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} 请求失败（${response.status}）`)
  return (await response.json()) as LabelPayload
}

function normalizeLabels(geometry: THREE.BufferGeometry, payload: LabelPayload) {
  const position = geometry.getAttribute('position')
  const source = payload.faceLabels?.length ? payload.faceLabels : payload.labels
  if (!source?.length) return null
  if (source.length === position.count) return source.map(Number)

  const faceCount = Math.floor(position.count / 3)
  if (source.length !== faceCount) return null

  const labels = new Array<number>(position.count)
  for (let faceIndex = 0; faceIndex < faceCount; faceIndex += 1) {
    const label = Number(source[faceIndex] ?? 0)
    const offset = faceIndex * 3
    labels[offset] = label
    labels[offset + 1] = label
    labels[offset + 2] = label
  }
  return labels
}

function applyLabelColors(geometry: THREE.BufferGeometry, labels: number[]) {
  const position = geometry.getAttribute('position')
  const colors = new Float32Array(position.count * 3)
  for (let index = 0; index < position.count; index += 1) {
    const color = getColor(Number(labels[index] ?? 0))
    colors[index * 3] = color.r
    colors[index * 3 + 1] = color.g
    colors[index * 3 + 2] = color.b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}

function loadStl(url: string) {
  const loader = new STLLoader()
  return new Promise<THREE.BufferGeometry>((resolve, reject) => {
    loader.load(url, resolve, undefined, reject)
  })
}

async function createJawMesh(config: JawConfig) {
  const geometry = await loadStl(config.stlUrl)
  geometry.computeVertexNormals()

  const pointsPayload = await fetchLabels(config.pointsUrl)
  let labels = normalizeLabels(geometry, pointsPayload)
  if (!labels) {
    labels = normalizeLabels(geometry, await fetchLabels(config.fallbackLabelUrl))
  }
  if (!labels) throw new Error(`${config.jaw} 的标签数量与 STL 顶点数量不匹配`)

  applyLabelColors(geometry, labels)
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshPhongMaterial({
      color: 0xffffff,
      vertexColors: true,
      shininess: 58,
      specular: 0x555555,
      side: THREE.DoubleSide,
    }),
  )
  mesh.name = `${config.jaw}-jaw`
  mesh.userData.jaw = config.jaw
  mesh.userData.labels = labels
  confirmedTriangleLabels[config.jaw] = new Array(
    Math.floor(geometry.getAttribute('position').count / 3),
  ).fill(0)
  enableMeshBvh(mesh)
  surfaceGraphs.set(mesh, buildSurfaceGraph(geometry))
  const graphTopology = buildToothGraphTopology(geometry)
  graphTopologies.set(mesh, graphTopology)
  seedFaceNeighbors.set(mesh, topologyFaceNeighbors(graphTopology))
  return mesh
}

function syncJawVisibility() {
  if (jawMeshes.upper) jawMeshes.upper.visible = showUpper.value
  if (jawMeshes.lower) jawMeshes.lower.visible = showLower.value
}

function getRoundPointTexture() {
  if (roundPointTexture) return roundPointTexture
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建圆形边界点纹理')
  context.clearRect(0, 0, 64, 64)
  context.beginPath()
  context.arc(32, 32, 29, 0, Math.PI * 2)
  context.fillStyle = '#ffffff'
  context.fill()
  roundPointTexture = new THREE.CanvasTexture(canvas)
  roundPointTexture.colorSpace = THREE.SRGBColorSpace
  return roundPointTexture
}

function createAutomaticBoundaryGroup(mesh: THREE.Mesh) {
  const labels = mesh.userData.labels as number[] | undefined
  if (!labels) throw new Error(`${mesh.name} 缺少牙位标签，无法生成边界`)
  const boundary = extractLabelBoundary(mesh.geometry, labels)
  const graph = surfaceGraphs.get(mesh)
  if (!graph) throw new Error(`${mesh.name} 的 STL 表面拓扑尚未建立`)
  const group = new THREE.Group()
  group.name = 'automatic-tooth-boundary'

  const segmentPoints = Array.from({ length: boundary.linePoints.length / 2 }, (_, segmentIndex) => [
    boundary.linePoints[segmentIndex * 2]!.clone(),
    boundary.linePoints[segmentIndex * 2 + 1]!.clone(),
  ])
  const lineGeometry = createSurfaceLineGeometry(segmentPoints, graph.vertices.size * 2)
  const lines = new THREE.LineSegments(
    lineGeometry,
    new THREE.LineBasicMaterial({ color: 0x303942, depthTest: false }),
  )
  lines.name = 'automatic-boundary-curves'
  lines.renderOrder = 20
  group.add(lines)

  const pointGeometry = new THREE.BufferGeometry().setFromPoints(boundary.pointPositions)
  const points = new THREE.Points(
    pointGeometry,
    new THREE.PointsMaterial({
      color: 0xffffff,
      map: getRoundPointTexture(),
      alphaTest: 0.5,
      transparent: true,
      size: 4,
      sizeAttenuation: false,
      depthTest: false,
    }),
  )
  points.name = 'automatic-boundary-points'
  points.renderOrder = 21
  points.userData.controlKind = 'automatic' satisfies BoundaryControlKind
  points.userData.mesh = mesh
  points.userData.lineGeometry = lineGeometry
  points.userData.pointLineIndices = boundary.pointLineIndices
  points.userData.linePoints = boundary.linePoints
  points.userData.controlPoints = boundary.pointPositions
  points.userData.boundaryLines = lines
  points.userData.segmentPoints = segmentPoints
  group.add(points)
  group.userData.segmentCount = boundary.linePoints.length / 2
  group.userData.pointCount = boundary.pointPositions.length
  mesh.add(group)
  return group
}

function setMeshColorMode(mesh: THREE.Mesh, showLabels: boolean) {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  materials.forEach((material) => {
    if (!(material instanceof THREE.MeshPhongMaterial)) return
    material.vertexColors = showLabels
    material.color.set(showLabels ? 0xffffff : 0x9aa1a8)
    material.needsUpdate = true
  })
}

function applySegmentationDisplayMode() {
  let totalSegments = 0
  let totalPoints = 0
  Object.entries(jawMeshes).forEach(([jaw, mesh]) => {
    if (!mesh) return
    setMeshColorMode(mesh, !segmentationMode.value)
    let group = automaticBoundaryGroups[jaw as JawType]
    if (segmentationMode.value && !group) {
      group = createAutomaticBoundaryGroup(mesh)
      automaticBoundaryGroups[jaw as JawType] = group
    }
    if (!group) return
    group.visible = segmentationMode.value
    totalSegments += Number(group.userData.segmentCount ?? 0)
    totalPoints += Number(group.userData.pointCount ?? 0)
  })
  confirmedRegionMeshes.forEach((mesh) => {
    mesh.visible = segmentationMode.value
  })
  seedPreviewGroups.forEach(({ group }) => {
    group.visible = segmentationMode.value
  })
  toothBoundaryGroups.forEach(({ group }) => {
    group.visible = segmentationMode.value
  })
  return { totalSegments, totalPoints }
}

function toggleJaw(jaw: JawType) {
  if (jaw === 'upper') showUpper.value = !showUpper.value
  else showLower.value = !showLower.value
  syncJawVisibility()
}

function toggleSegmentationMode() {
  segmentationMode.value = !segmentationMode.value
  cancelBoundaryDrawing()
  try {
    const boundary = applySegmentationDisplayMode()
    statusText.value = segmentationMode.value
      ? `分牙模式：已显示 ${boundary.totalSegments} 段牙齿边界和 ${boundary.totalPoints} 个圆形点位，可继续闭合圈画。`
      : '已退出分牙模式，已恢复牙位颜色。'
  } catch (error) {
    segmentationMode.value = false
    applySegmentationDisplayMode()
    statusText.value = error instanceof Error ? error.message : String(error)
  }
}

function resizeDrawingCanvas() {
  const canvas = drawingCanvasRef.value
  const viewer = viewerRef.value
  if (!canvas || !viewer) return
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
  const width = viewer.clientWidth
  const height = viewer.clientHeight || 600
  canvas.width = Math.max(1, Math.floor(width * pixelRatio))
  canvas.height = Math.max(1, Math.floor(height * pixelRatio))
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  canvas.getContext('2d')?.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
}

function clearDrawingCanvas() {
  const canvas = drawingCanvasRef.value
  const context = canvas?.getContext('2d')
  if (!canvas || !context) return
  context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight)
}

function drawBoundaryStroke(closed = false) {
  const canvas = drawingCanvasRef.value
  const context = canvas?.getContext('2d')
  if (!canvas || !context) return
  clearDrawingCanvas()
  if (drawingPoints.length < 2) return

  context.beginPath()
  context.moveTo(drawingPoints[0]!.x, drawingPoints[0]!.y)
  drawingPoints.slice(1).forEach((point) => context.lineTo(point.x, point.y))
  if (closed) context.closePath()
  context.lineWidth = 2
  context.strokeStyle = '#7c3aed'
  context.fillStyle = 'rgba(124, 58, 237, 0.08)'
  if (closed) context.fill()
  context.stroke()
}

function canvasPoint(event: PointerEvent) {
  const rect = drawingCanvasRef.value?.getBoundingClientRect()
  if (!rect) return null
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

function startBoundaryDrawing(event: PointerEvent) {
  if (!segmentationMode.value || event.button !== 0) return
  const controlPoint = pickBoundaryPoint(event)
  if (controlPoint) {
    startBoundaryPointDrag(controlPoint, event)
    return
  }
  const point = canvasPoint(event)
  if (!point) return
  drawing = true
  drawingPoints = [point]
  if (controls) controls.enabled = false
  drawingCanvasRef.value?.setPointerCapture(event.pointerId)
  clearDrawingCanvas()
  event.preventDefault()
}

function continueBoundaryDrawing(event: PointerEvent) {
  if (boundaryDragState) {
    updateBoundaryPointDrag(event)
    return
  }
  if (!drawing) {
    const controlPoint = pickBoundaryPoint(event)
    setPointHighlight(controlPoint)
    if (drawingCanvasRef.value) {
      drawingCanvasRef.value.style.cursor = controlPoint ? 'grab' : 'crosshair'
    }
    return
  }
  const point = canvasPoint(event)
  const previous = drawingPoints[drawingPoints.length - 1]
  if (!point || (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 3)) return
  drawingPoints.push(point)
  drawBoundaryStroke()
  event.preventDefault()
}

function handleBoundaryPointerLeave() {
  if (boundaryDragState || drawing) return
  setPointHighlight(null)
  if (drawingCanvasRef.value) drawingCanvasRef.value.style.cursor = 'crosshair'
}

function cancelBoundaryDrawing(event?: PointerEvent) {
  if (boundaryDragState) finishBoundaryPointDrag(event)
  drawing = false
  drawingPoints = []
  if (controls) controls.enabled = true
  if (event && drawingCanvasRef.value?.hasPointerCapture(event.pointerId)) {
    drawingCanvasRef.value.releasePointerCapture(event.pointerId)
  }
  clearDrawingCanvas()
}

function draggableBoundaryPoints() {
  const controls: THREE.Points[] = []
  Object.values(automaticBoundaryGroups).forEach((group) => {
    const points = group?.getObjectByName('automatic-boundary-points')
    const mesh = points?.userData.mesh as THREE.Mesh | undefined
    if (
      points instanceof THREE.Points &&
      points.visible &&
      points.parent?.visible &&
      mesh?.visible
    ) {
      controls.push(points)
    }
  })
  toothBoundaryGroups.forEach(({ group, mesh }) => {
    const points = group.getObjectByName('boundary-points')
    if (points instanceof THREE.Points && points.visible && mesh.visible) controls.push(points)
  })
  return controls
}

function updateRaycasterFromEvent(event: PointerEvent) {
  if (!camera || !drawingCanvasRef.value) return false
  const point = canvasPoint(event)
  if (!point) return false
  const width = drawingCanvasRef.value.clientWidth
  const height = drawingCanvasRef.value.clientHeight
  pointer.set((point.x / width) * 2 - 1, -(point.y / height) * 2 + 1)
  raycaster.setFromCamera(pointer, camera)
  return true
}

function pickBoundaryPoint(event: PointerEvent): BoundaryPointPick | null {
  if (!updateRaycasterFromEvent(event)) return null
  raycaster.params.Points = { threshold: 1.2 }
  const hit = raycaster.intersectObjects(draggableBoundaryPoints(), false)[0]
  if (!hit || !(hit.object instanceof THREE.Points) || hit.index == null) return null
  const mesh = hit.object.userData.mesh as THREE.Mesh | undefined
  const kind = hit.object.userData.controlKind as BoundaryControlKind | undefined
  const jaw = mesh?.userData.jaw as JawType | undefined
  if (!mesh || !kind || !jaw) return null
  return { kind, jaw, mesh, points: hit.object, pointIndex: hit.index }
}

function setPointHighlight(pick: BoundaryPointPick | null, color = 0x00e676) {
  if (!pick) {
    pointHighlight?.parent?.remove(pointHighlight)
    return
  }
  const position = pick.points.geometry.getAttribute('position') as
    | THREE.BufferAttribute
    | undefined
  if (!position) return
  const point = new THREE.Vector3(
    position.getX(pick.pointIndex),
    position.getY(pick.pointIndex),
    position.getZ(pick.pointIndex),
  )
  if (!pointHighlight) {
    pointHighlight = new THREE.Points(
      new THREE.BufferGeometry().setFromPoints([point]),
      new THREE.PointsMaterial({
        color,
        map: getRoundPointTexture(),
        alphaTest: 0.5,
        transparent: true,
        size: 11,
        sizeAttenuation: false,
        depthTest: false,
      }),
    )
    pointHighlight.name = 'boundary-point-highlight'
    pointHighlight.renderOrder = 50
  } else {
    const highlightPosition = pointHighlight.geometry.getAttribute('position') as THREE.BufferAttribute
    highlightPosition.setXYZ(0, point.x, point.y, point.z)
    highlightPosition.needsUpdate = true
    pointHighlight.geometry.computeBoundingSphere()
    ;(pointHighlight.material as THREE.PointsMaterial).color.set(color)
  }
  if (pointHighlight.parent !== pick.mesh) {
    pointHighlight.parent?.remove(pointHighlight)
    pick.mesh.add(pointHighlight)
  }
}

function startBoundaryPointDrag(pick: BoundaryPointPick, event: PointerEvent) {
  boundaryDragState = { ...pick, hasMoved: false }
  if (pick.kind === 'drawn') {
    const toothId = Number(pick.points.userData.toothId)
    if (toothSegmentations.value.has(toothId)) {
      editingToothId.value = toothId
      selectedToothId.value = toothId
      updateBoundaryStyles()
    }
  }
  pendingDragRaycast = null
  if (controls) controls.enabled = false
  drawingCanvasRef.value?.setPointerCapture(event.pointerId)
  if (drawingCanvasRef.value) drawingCanvasRef.value.style.cursor = 'grabbing'
  setPointHighlight(pick, 0xff7a00)
  statusText.value = pick.kind === 'automatic' ? '正在拖动白色边界点…' : '正在拖动绿色 Boundary Point…'
  event.preventDefault()
}

function raycastMeshSurface(event: PointerEvent, mesh: THREE.Mesh) {
  if (!updateRaycasterFromEvent(event)) return null
  const hit = raycaster.intersectObject(mesh, false)[0]
  if (!hit) return null
  return hit
}

function updateAutomaticBoundaryPoint(state: BoundaryDragState, nextPoint: THREE.Vector3) {
  const linePoints = state.points.userData.linePoints as THREE.Vector3[]
  const controlPoints = state.points.userData.controlPoints as THREE.Vector3[]
  const pointLineIndices = state.points.userData.pointLineIndices as number[][]
  const changedIndices = moveLabelBoundaryControl(
    linePoints,
    controlPoints,
    pointLineIndices,
    state.pointIndex,
    nextPoint,
  )
  const pointPosition = state.points.geometry.getAttribute('position') as THREE.BufferAttribute
  const movedControl = controlPoints[state.pointIndex]!
  pointPosition.setXYZ(
    state.pointIndex,
    movedControl.x,
    movedControl.y,
    movedControl.z,
  )
  pointPosition.needsUpdate = true
  state.points.geometry.computeBoundingSphere()

  const mesh = jawMeshes[state.jaw]
  const graph = mesh ? surfaceGraphs.get(mesh) : undefined
  if (!graph) throw new Error(`${state.mesh.name} 的 STL 表面拓扑尚未建立`)
  const segmentPoints = state.points.userData.segmentPoints as THREE.Vector3[][]
  const changedSegments = new Set(changedIndices.map((lineIndex) => Math.floor(lineIndex / 2)))
  changedSegments.forEach((segmentIndex) => {
    segmentPoints[segmentIndex] = createSurfaceSegmentPoints(
      graph,
      linePoints[segmentIndex * 2]!,
      linePoints[segmentIndex * 2 + 1]!,
    )
  })
  const boundaryLines = state.points.userData.boundaryLines as THREE.LineSegments
  updateSurfaceLineGeometry(boundaryLines.geometry, segmentPoints)
}

function updateDrawnBoundaryPoint(
  state: BoundaryDragState,
  raycastSurface: (mesh: THREE.Mesh) => Pick<THREE.Intersection, 'point'> | null,
) {
  const toothId = Number(state.points.userData.toothId)
  const segmentation = toothSegmentations.value.get(toothId)
  if (!segmentation?.boundary) throw new Error(`未找到牙号 ${toothId} 的边界`)
  const editableBoundary: ToothBoundary = state.pendingBoundary ?? {
    toothId,
    boundary: segmentation.boundary.boundary.map((point) => ({
      type: 'control',
      position: [...point.position],
    })),
  }
  const nextBoundaries = new Map([[toothId, editableBoundary]])
  const mesh = jawMeshes[state.jaw]
  const graph = mesh ? surfaceGraphs.get(mesh) : undefined
  const currentSurfacePath = state.points.userData.surfacePath as
    | ClosedSurfacePath
    | undefined
  if (!mesh || !graph || !currentSurfacePath) {
    throw new Error(`${state.mesh.name} 的边界表面路径尚未建立`)
  }
  const curve = state.points.userData.boundaryCurve as THREE.LineSegments
  const pointPosition = state.points.geometry.getAttribute('position') as THREE.BufferAttribute
  const result = applySurfaceBoundaryDragFrame({
    sourceMesh: mesh,
    graph,
    currentPath: currentSurfacePath,
    controlIndex: state.pointIndex,
    raycastSurface,
    updateControlPoint: (point) => {
      pointPosition.setXYZ(state.pointIndex, point.x, point.y, point.z)
      pointPosition.needsUpdate = true
      state.points.geometry.computeBoundingSphere()
    },
    updateOverlay: (segmentPoints) => updateSurfaceLineGeometry(curve.geometry, segmentPoints),
  })
  if (!result) return
  const boundary = updateBoundaryControlPoint(
    nextBoundaries,
    toothId,
    state.pointIndex,
    result.point,
  )
  state.points.userData.surfacePath = result.path
  state.pendingBoundary = boundary
  state.hasMoved = true
}

function flushBoundaryPointDrag() {
  dragUpdateFrameId = 0
  const state = boundaryDragState
  const raycastSurface = pendingDragRaycast
  pendingDragRaycast = null
  if (!state || !raycastSurface) return
  try {
    if (state.kind === 'automatic') {
      const mesh = jawMeshes[state.jaw]
      const hit = mesh ? raycastSurface(mesh) : null
      if (!hit) return
      updateAutomaticBoundaryPoint(state, hit.point.clone())
    } else updateDrawnBoundaryPoint(state, raycastSurface)
    setPointHighlight(state, 0xff7a00)
  } catch (error) {
    statusText.value = error instanceof Error ? error.message : String(error)
  }
}

function updateBoundaryPointDrag(event: PointerEvent) {
  const state = boundaryDragState
  if (!state || !jawMeshes[state.jaw]) return
  pendingDragRaycast = (mesh) => raycastMeshSurface(event, mesh)
  if (!dragUpdateFrameId) dragUpdateFrameId = requestAnimationFrame(flushBoundaryPointDrag)
  event.preventDefault()
}

function commitDrawnBoundaryEdit(state: BoundaryDragState) {
  if (!state.hasMoved || !state.pendingBoundary) return false
  const toothId = Number(state.points.userData.toothId)
  const segmentation = toothSegmentations.value.get(toothId)
  if (!segmentation?.boundary) return false
  const nextStates = new Map(toothSegmentations.value)
  nextStates.set(toothId, markBoundaryEdited(segmentation, state.pendingBoundary))
  toothSegmentations.value = nextStates
  return invalidateConfirmedTooth(toothId)
}

function finishBoundaryPointDrag(event?: PointerEvent) {
  if (!boundaryDragState) return
  if (dragUpdateFrameId) {
    cancelAnimationFrame(dragUpdateFrameId)
    flushBoundaryPointDrag()
  }
  if (controls) controls.enabled = true
  if (event && drawingCanvasRef.value?.hasPointerCapture(event.pointerId)) {
    drawingCanvasRef.value.releasePointerCapture(event.pointerId)
  }
  const finishedState = boundaryDragState
  const kind = finishedState.kind
  const invalidated = kind === 'drawn' ? commitDrawnBoundaryEdit(finishedState) : false
  boundaryDragState = null
  pendingDragRaycast = null
  setPointHighlight(null)
  if (drawingCanvasRef.value) drawingCanvasRef.value.style.cursor = 'crosshair'
  statusText.value =
    kind === 'automatic'
      ? '白色控制点和对应牙齿边界线已更新。'
      : invalidated
        ? '绿色 Boundary Point 和白色表面边界已更新，原确认结果已失效，请重新确认分牙。'
        : '绿色 Boundary Point 和白色表面边界已更新。'
}

function visibleJawMeshes() {
  return Object.values(jawMeshes).filter((mesh) => mesh?.visible) as THREE.Mesh[]
}

function meshFaceLabel(mesh: THREE.Mesh, faceIndex: number) {
  const labels = mesh.userData.labels as number[] | undefined
  if (!labels) return 0
  const offset = faceIndex * 3
  const faceLabels = [
    Number(labels[offset] ?? 0),
    Number(labels[offset + 1] ?? 0),
    Number(labels[offset + 2] ?? 0),
  ]
  return inferDominantToothId(faceLabels) ?? 0
}

function raycastBoundaryPoint(point: { x: number; y: number }, targetMesh?: THREE.Mesh) {
  if (!camera || !drawingCanvasRef.value) return null
  const width = drawingCanvasRef.value.clientWidth
  const height = drawingCanvasRef.value.clientHeight
  pointer.set((point.x / width) * 2 - 1, -(point.y / height) * 2 + 1)
  raycaster.setFromCamera(pointer, camera)
  const hit = targetMesh
    ? raycaster.intersectObject(targetMesh, false)[0]
    : raycaster.intersectObjects(visibleJawMeshes(), false)[0]
  if (!hit || !(hit.object instanceof THREE.Mesh) || hit.faceIndex == null) return null

  const mesh = hit.object
  const localHit = mesh.worldToLocal(hit.point.clone())
  return {
    mesh,
    point: localHit,
    faceIndex: hit.faceIndex,
    toothId: meshFaceLabel(mesh, hit.faceIndex),
  }
}

function topologyFaceNeighbors(topology: ToothGraphTopology) {
  const count = topology.neighborOffsets.length - 1
  return Array.from({ length: count }, (_, face) =>
    Array.from(
      topology.neighborFaces.slice(
        topology.neighborOffsets[face],
        topology.neighborOffsets[face + 1],
      ),
    ),
  )
}

function createSeedSelection() {
  const samples = sampleClosedScreenPolygon(drawingPoints, 6)
  if (samples.length < 3) throw new Error('圈画范围太小，请重新绘制')

  const firstHit = samples.map((point) => raycastBoundaryPoint(point)).find(Boolean)
  if (!firstHit) throw new Error('圈画区域没有命中模型')
  const topology = graphTopologies.get(firstHit.mesh)
  const faceNeighbors = seedFaceNeighbors.get(firstHit.mesh)
  if (!topology || !faceNeighbors) {
    throw new Error(`${firstHit.mesh.name} 的 Graph Cut 拓扑尚未建立`)
  }
  const jaw = firstHit.mesh.userData.jaw as JawType
  const selected = collectSeedFaces(
    samples,
    (point) => {
      const hit = raycastBoundaryPoint(point, firstHit.mesh)
      return hit ? { jaw, faceIndex: hit.faceIndex } : null
    },
    faceNeighbors,
  )
  if (!selected || selected.faceIndices.length < 3) {
    throw new Error('前景种子至少需要 3 个连通三角面')
  }

  const inferredToothId = inferDominantToothId(
    selected.faceIndices.map((faceIndex) => meshFaceLabel(firstHit.mesh, faceIndex)),
  )
  const toothId = inferredToothId ?? Number(selectedToothId.value)
  if (!Number.isInteger(toothId) || toothId <= 0) {
    throw new Error('无法自动识别牙号，请在工具栏输入牙号后重新圈画')
  }

  const state = createSeededState(toothId, jaw, selected.faceIndices)
  const nextStates = new Map(toothSegmentations.value)
  nextStates.set(toothId, state)
  invalidateConfirmedTooth(toothId)
  disposeToothBoundaryGroup(toothId)
  disposeSeedPreview(toothId)
  latestBoundaryJobs.set(toothId, ++boundaryJobSequence)
  const nextGenerating = new Set(generatingToothIds.value)
  nextGenerating.delete(toothId)
  generatingToothIds.value = nextGenerating
  toothSegmentations.value = nextStates
  renderSeedPreview(firstHit.mesh, toothId, state.seedFaceIndices)
  editingToothId.value = toothId
  selectedToothId.value = toothId
  updateBoundaryStyles()
  statusText.value = `已识别牙号 ${toothId}，选取 ${state.seedFaceIndices.length} 个种子面，可生成边界。`
}

function disposeToothBoundaryGroup(toothId: number) {
  const rendered = toothBoundaryGroups.get(toothId)
  if (!rendered) return
  rendered.group.parent?.remove(rendered.group)
  disposeObject(rendered.group)
  toothBoundaryGroups.delete(toothId)
}

function confirmedRegionKey(jaw: JawType, toothId: number) {
  return `${jaw}:${toothId}`
}

function removeConfirmedRegionMesh(jaw: JawType, toothId: number) {
  const key = confirmedRegionKey(jaw, toothId)
  const regionMesh = confirmedRegionMeshes.get(key)
  if (!regionMesh) return
  regionMesh.parent?.remove(regionMesh)
  disposeObject(regionMesh)
  confirmedRegionMeshes.delete(key)
}

function clearConfirmedRegionMeshes() {
  confirmedRegionMeshes.forEach((regionMesh) => {
    regionMesh.parent?.remove(regionMesh)
    disposeObject(regionMesh)
  })
  confirmedRegionMeshes.clear()
}

function invalidateConfirmedTooth(toothId: number) {
  let changedAny = false
  const jaws: JawType[] = ['upper', 'lower']
  jaws.forEach((jaw) => {
    const labels = confirmedTriangleLabels[jaw]
    let changed = false
    confirmedTriangleLabels[jaw] = labels.map((label) => {
      if (label !== toothId) return label
      changed = true
      return 0
    })
    if (changed) {
      changedAny = true
      removeConfirmedRegionMesh(jaw, toothId)
    }
  })
  return changedAny
}

function buildTriangleSubsetGeometry(
  sourceGeometry: THREE.BufferGeometry,
  triangleIndices: number[],
) {
  const source = sourceGeometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!source) throw new Error('STL geometry 缺少 position 属性')
  const positions = new Float32Array(triangleIndices.length * 9)
  triangleIndices.forEach((faceIndex, outputFaceIndex) => {
    const sourceOffset = faceIndex * 3
    const outputOffset = outputFaceIndex * 9
    for (let vertex = 0; vertex < 3; vertex += 1) {
      positions[outputOffset + vertex * 3] = source.getX(sourceOffset + vertex)
      positions[outputOffset + vertex * 3 + 1] = source.getY(sourceOffset + vertex)
      positions[outputOffset + vertex * 3 + 2] = source.getZ(sourceOffset + vertex)
    }
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return geometry
}

function disposeSeedPreview(toothId: number) {
  const rendered = seedPreviewGroups.get(toothId)
  if (!rendered) return
  rendered.group.parent?.remove(rendered.group)
  disposeObject(rendered.group)
  seedPreviewGroups.delete(toothId)
}

function renderSeedPreview(mesh: THREE.Mesh, toothId: number, faceIndices: number[]) {
  disposeSeedPreview(toothId)
  const group = new THREE.Group()
  group.name = `seed-preview-${toothId}`
  const preview = new THREE.Mesh(
    buildTriangleSubsetGeometry(mesh.geometry, faceIndices),
    new THREE.MeshBasicMaterial({
      color: 0xef6f91,
      opacity: 0.78,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
      side: THREE.DoubleSide,
    }),
  )
  preview.name = 'seed-faces'
  preview.renderOrder = 18
  group.add(preview)
  mesh.add(group)
  seedPreviewGroups.set(toothId, { group, mesh })
}

function sampleBackgroundRing(polygon: ScreenPoint[], spacing = 6) {
  if (!drawingCanvasRef.value || polygon.length < 3) return []
  const xs = polygon.map((point) => point.x)
  const ys = polygon.map((point) => point.y)
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2
  const halfWidth = Math.max((Math.max(...xs) - Math.min(...xs)) / 2, spacing)
  const halfHeight = Math.max((Math.max(...ys) - Math.min(...ys)) / 2, spacing)
  const innerWidth = halfWidth * 1.25
  const innerHeight = halfHeight * 1.25
  const outerWidth = halfWidth * 1.65
  const outerHeight = halfHeight * 1.65
  const samples: ScreenPoint[] = []
  const minX = Math.max(0, centerX - outerWidth)
  const maxX = Math.min(drawingCanvasRef.value.clientWidth, centerX + outerWidth)
  const minY = Math.max(0, centerY - outerHeight)
  const maxY = Math.min(drawingCanvasRef.value.clientHeight, centerY + outerHeight)
  for (let x = minX; x <= maxX; x += spacing) {
    for (let y = minY; y <= maxY; y += spacing) {
      if (Math.abs(x - centerX) < innerWidth && Math.abs(y - centerY) < innerHeight) continue
      samples.push({ x, y })
    }
  }
  return samples
}

function projectSeedFootprint(
  state: ToothSegmentationState,
  mesh: THREE.Mesh,
  topology: ToothGraphTopology,
) {
  if (!camera || !drawingCanvasRef.value) return []
  mesh.updateWorldMatrix(true, false)
  camera.updateMatrixWorld()
  const width = drawingCanvasRef.value.clientWidth
  const height = drawingCanvasRef.value.clientHeight
  return state.seedFaceIndices
    .map((face) => {
      const offset = face * 3
      const projected = mesh.localToWorld(
        new THREE.Vector3(
          topology.faceCenters[offset] ?? Number.NaN,
          topology.faceCenters[offset + 1] ?? Number.NaN,
          topology.faceCenters[offset + 2] ?? Number.NaN,
        ),
      ).project(camera!)
      return { x: (projected.x + 1) * width / 2, y: (1 - projected.y) * height / 2 }
    })
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
}

function roiOuterBoundaryFaces(topology: ToothGraphTopology, roi: ToothGraphCutRoi) {
  const roiFaces = new Set<number>(roi.faceIndices)
  return Array.from(roi.faceIndices).filter((face) => {
    const start = topology.neighborOffsets[face] ?? 0
    const end = topology.neighborOffsets[face + 1] ?? start
    for (let offset = start; offset < end; offset += 1) {
      if (!roiFaces.has(topology.neighborFaces[offset]!)) return true
    }
    return false
  })
}

async function generateGraphCutBoundary() {
  const state = activeSegmentation.value
  if (!state || state.status !== 'seeded' || generatingToothIds.value.has(state.toothId)) return
  const mesh = jawMeshes[state.jaw]
  const topology = mesh ? graphTopologies.get(mesh) : undefined
  if (!mesh || !topology) {
    statusText.value = '生成失败：种子的模型拓扑已丢失。'
    return
  }
  const seedFootprint = projectSeedFootprint(state, mesh, topology)
  if (seedFootprint.length < 3) {
    statusText.value = '生成失败：种子面无法投影到当前屏幕。'
    return
  }

  const jobId = ++boundaryJobSequence
  latestBoundaryJobs.set(state.toothId, jobId)
  generatingToothIds.value = new Set(generatingToothIds.value).add(state.toothId)
  statusText.value = `牙号 ${state.toothId} 生成边界中…`
  let preparedBoundaryGroup: THREE.Group | null = null

  try {
    const foreground = new Set(state.seedFaceIndices)
    const ringFaces = new Set<number>()
    sampleBackgroundRing(seedFootprint).forEach((point) => {
      const hit = raycastBoundaryPoint(point, mesh)
      if (hit && !foreground.has(hit.faceIndex)) ringFaces.add(hit.faceIndex)
    })
    if (ringFaces.size < 3) throw new Error('背景环命中的有效三角面少于 3 个')

    const initialRoi = buildToothGraphCutRoi(topology, state.seedFaceIndices, [...ringFaces])
    roiOuterBoundaryFaces(topology, initialRoi).forEach((face) => {
      if (!foreground.has(face)) ringFaces.add(face)
    })
    const roi = buildToothGraphCutRoi(topology, state.seedFaceIndices, [...ringFaces])
    if (Array.from(roi.backgroundMask).filter(Boolean).length < 3) {
      throw new Error('Graph Cut 背景种子至少需要 3 个有效面')
    }

    graphCutWorkerClient ??= new ToothGraphCutWorkerClient()
    const result = await graphCutWorkerClient.run(buildGraphCutProblem(topology, roi))
    if (
      result.stale ||
      latestBoundaryJobs.get(state.toothId) !== jobId ||
      toothSegmentations.value.get(state.toothId) !== state
    ) {
      return
    }

    const extracted = extractToothBoundary(
      mesh.geometry,
      topology,
      roi,
      result.foregroundMask,
      state.toothId,
    )
    const boundaryReady = markBoundaryReady(state, extracted.boundary)
    preparedBoundaryGroup = createToothBoundaryGroup(mesh, extracted.boundary)
    const nextStates = new Map(toothSegmentations.value)
    nextStates.set(state.toothId, boundaryReady)
    replaceToothBoundaryGroup(mesh, extracted.boundary, preparedBoundaryGroup)
    preparedBoundaryGroup = null
    toothSegmentations.value = nextStates
    disposeSeedPreview(state.toothId)
    updateBoundaryStyles()
    statusText.value = `牙号 ${state.toothId} 边界已生成，共 ${extracted.boundary.boundary.length} 个控制点。`
  } catch (error) {
    disposeObject(preparedBoundaryGroup ?? undefined)
    if (latestBoundaryJobs.get(state.toothId) === jobId) {
      statusText.value = `生成失败：${error instanceof Error ? error.message : String(error)}`
    }
  } finally {
    if (latestBoundaryJobs.get(state.toothId) === jobId) {
      const nextGenerating = new Set(generatingToothIds.value)
      nextGenerating.delete(state.toothId)
      generatingToothIds.value = nextGenerating
    }
  }
}

function createConfirmedRegionMesh(geometry: THREE.BufferGeometry, toothId: number) {
  const regionMesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: 0x35d07f,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    }),
  )
  regionMesh.name = `confirmed-tooth-region-${toothId}`
  regionMesh.renderOrder = 15
  return regionMesh
}

function commitConfirmedRegionMesh(mesh: THREE.Mesh, toothId: number, regionMesh: THREE.Mesh) {
  const jaw = mesh.userData.jaw as JawType
  const key = confirmedRegionKey(jaw, toothId)
  const previousRegionMesh = confirmedRegionMeshes.get(key)
  mesh.add(regionMesh)
  confirmedRegionMeshes.set(key, regionMesh)
  if (!previousRegionMesh) return
  previousRegionMesh.parent?.remove(previousRegionMesh)
  disposeObject(previousRegionMesh)
}

function renderConfirmedRegion(mesh: THREE.Mesh, toothId: number, triangleIndices: number[]) {
  const geometry = buildConfirmedToothGeometry(mesh.geometry, triangleIndices)
  const regionMesh = createConfirmedRegionMesh(geometry, toothId)
  commitConfirmedRegionMesh(mesh, toothId, regionMesh)
}

function confirmToothSegmentation() {
  const toothId = editingToothId.value
  if (toothId == null) return
  const state = toothSegmentations.value.get(toothId)
  const rendered = toothBoundaryGroups.get(toothId)
  if (!state?.boundary || state.status !== 'boundary-ready' || !rendered) {
    statusText.value = '当前牙齿尚无可确认的边界。'
    return
  }

  let preparedGeometry: THREE.BufferGeometry | null = null
  let preparedRegionMesh: THREE.Mesh | null = null
  try {
    let topology = regionTopologies.get(rendered.mesh)
    if (!topology) {
      topology = buildToothRegionTopology(rendered.mesh.geometry)
      regionTopologies.set(rendered.mesh, topology)
    }
    const region = classifyToothRegion(topology, state.boundary)
    const triangleIndices = region.triangleIndices
    const jaw = rendered.mesh.userData.jaw as JawType
    const nextLabels = prepareConfirmedToothRegion(
      confirmedTriangleLabels[jaw],
      toothId,
      triangleIndices,
    )
    const confirmedState = markConfirmed(state, triangleIndices)
    preparedGeometry = buildConfirmedToothGeometry(rendered.mesh.geometry, triangleIndices)
    preparedRegionMesh = createConfirmedRegionMesh(preparedGeometry, toothId)
    const nextStates = new Map(toothSegmentations.value)
    nextStates.set(toothId, confirmedState)

    commitConfirmedRegionMesh(rendered.mesh, toothId, preparedRegionMesh)
    preparedRegionMesh = null
    preparedGeometry = null
    confirmedTriangleLabels[jaw] = nextLabels
    toothSegmentations.value = nextStates
    statusText.value = `牙号 ${toothId} 已确认分牙，共分类 ${triangleIndices.length} 个三角形。`
  } catch (error) {
    preparedRegionMesh?.parent?.remove(preparedRegionMesh)
    disposeObject(preparedRegionMesh ?? undefined)
    if (!preparedRegionMesh) preparedGeometry?.dispose()
    statusText.value = `确认失败：${error instanceof Error ? error.message : String(error)}`
  }
}

function clearBoundary() {
  const toothId = editingToothId.value
  if (toothId == null) return
  invalidateConfirmedTooth(toothId)
  disposeToothBoundaryGroup(toothId)
  disposeSeedPreview(toothId)
  latestBoundaryJobs.set(toothId, ++boundaryJobSequence)
  const nextStates = new Map(toothSegmentations.value)
  nextStates.delete(toothId)
  toothSegmentations.value = nextStates
  const nextToothId = Array.from(nextStates.keys()).sort((a, b) => a - b)[0] ?? null
  editingToothId.value = nextToothId
  selectedToothId.value = nextToothId
  updateBoundaryStyles()
  statusText.value = `牙号 ${toothId} 的边界已清除。`
}

function createToothBoundaryGroup(mesh: THREE.Mesh, boundary: ToothBoundary) {
  const controlPoints = boundaryControlVectors(boundary)
  const graph = surfaceGraphs.get(mesh)
  if (!graph) throw new Error(`${mesh.name} 的 STL 表面拓扑尚未建立`)
  const surfacePath = createClosedSurfacePath(graph, controlPoints)
  if (surfacePath.anchorPoints.length !== controlPoints.length) {
    throw new Error(`牙号 ${boundary.toothId} 存在吸附到同一位置的重复 Boundary Points`)
  }
  const group = new THREE.Group()
  group.name = `tooth-boundary-${boundary.toothId}`
  group.userData.toothId = boundary.toothId

  const pointGeometry = new THREE.BufferGeometry().setFromPoints(controlPoints)
  const points = new THREE.Points(
    pointGeometry,
    new THREE.PointsMaterial({
      color: 0xffd400,
      map: getRoundPointTexture(),
      alphaTest: 0.5,
      transparent: true,
      size: 7,
      sizeAttenuation: false,
      depthTest: false,
    }),
  )
  points.name = 'boundary-points'
  points.renderOrder = 30
  points.userData.controlKind = 'drawn' satisfies BoundaryControlKind
  points.userData.mesh = mesh
  points.userData.toothId = boundary.toothId
  points.userData.surfacePath = surfacePath
  group.add(points)

  const curveGeometry = createSurfaceLineGeometry(
    surfacePath.segmentPoints,
    graph.vertices.size * 2,
  )
  const curve = new THREE.LineSegments(
    curveGeometry,
    new THREE.LineBasicMaterial({ color: 0x35d07f, depthTest: false }),
  )
  curve.name = 'boundary-curve'
  curve.renderOrder = 29
  group.add(curve)
  points.userData.boundaryCurve = curve

  return group
}

function replaceToothBoundaryGroup(
  mesh: THREE.Mesh,
  boundary: ToothBoundary,
  group: THREE.Group,
) {
  disposeToothBoundaryGroup(boundary.toothId)
  mesh.add(group)
  toothBoundaryGroups.set(boundary.toothId, { group, mesh })
  updateBoundaryStyles()
}

function renderToothBoundary(mesh: THREE.Mesh, boundary: ToothBoundary) {
  const group = createToothBoundaryGroup(mesh, boundary)
  replaceToothBoundaryGroup(mesh, boundary, group)
}

function updateBoundaryStyles() {
  toothBoundaryGroups.forEach(({ group }, toothId) => {
    const active = toothId === editingToothId.value
    const curve = group.getObjectByName('boundary-curve') as THREE.LineSegments | undefined
    const points = group.getObjectByName('boundary-points') as THREE.Points | undefined
    if (curve?.material instanceof THREE.LineBasicMaterial) {
      curve.material.color.set(active ? 0xffffff : 0x35d07f)
    }
    if (points?.material instanceof THREE.PointsMaterial) {
      points.material.color.set(active ? 0x00e676 : 0x2474e8)
    }
  })
}

function selectSavedBoundary(event: Event) {
  const toothId = Number((event.target as HTMLSelectElement).value)
  if (!toothSegmentations.value.has(toothId)) return
  editingToothId.value = toothId
  selectedToothId.value = toothId
  updateBoundaryStyles()
  statusText.value = `当前正在编辑牙号 ${toothId}。`
}

function applyToothId() {
  const sourceToothId = editingToothId.value
  const targetToothId = Number(selectedToothId.value)
  if (sourceToothId == null || !Number.isInteger(targetToothId) || targetToothId <= 0) {
    statusText.value = '请输入有效的牙号。'
    return
  }
  if (sourceToothId === targetToothId) {
    statusText.value = `当前边界牙号已经是 ${targetToothId}。`
    return
  }
  const state = toothSegmentations.value.get(sourceToothId)
  const mesh = state ? jawMeshes[state.jaw] : undefined
  if (!state || !mesh) return
  let movedState = createSeededState(targetToothId, state.jaw, state.seedFaceIndices)
  let movedBoundary: ToothBoundary | null = null
  if (state.boundary) {
    movedBoundary = moveBoundaryToothId(
      new Map([[sourceToothId, state.boundary]]),
      sourceToothId,
      targetToothId,
    )
    movedState = markBoundaryReady(movedState, movedBoundary)
  }
  invalidateConfirmedTooth(sourceToothId)
  invalidateConfirmedTooth(targetToothId)
  disposeToothBoundaryGroup(targetToothId)
  disposeToothBoundaryGroup(sourceToothId)
  disposeSeedPreview(targetToothId)
  disposeSeedPreview(sourceToothId)
  const nextStates = new Map(toothSegmentations.value)
  nextStates.delete(sourceToothId)
  nextStates.set(targetToothId, movedState)
  toothSegmentations.value = nextStates
  if (movedBoundary) renderToothBoundary(mesh, movedBoundary)
  else renderSeedPreview(mesh, targetToothId, movedState.seedFaceIndices)
  editingToothId.value = targetToothId
  selectedToothId.value = targetToothId
  updateBoundaryStyles()
  statusText.value = `边界牙号已从 ${sourceToothId} 修改为 ${targetToothId}。`
}

function exportBoundaryJson() {
  const boundaries = new Map<number, ToothBoundary>()
  toothSegmentations.value.forEach((state) => {
    if (state.boundary) boundaries.set(state.toothId, state.boundary)
  })
  if (!boundaries.size) return
  const payload = buildSegmentationExportPayload(boundaries, {
    upper: confirmedTriangleLabels.upper,
    lower: confirmedTriangleLabels.lower,
  })
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'tooth-segmentation.json'
  link.click()
  URL.revokeObjectURL(url)
  statusText.value = `已导出 ${boundaries.size} 颗牙齿的 Boundary 和确认分类结果。`
}

function openBoundaryJsonPicker() {
  boundaryJsonInputRef.value?.click()
}

async function loadBoundaryJson(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  try {
    const imported = parseSegmentationImportPayload(await file.text(), {
      upper: confirmedTriangleLabels.upper.length,
      lower: confirmedTriangleLabels.lower.length,
    })
    const originalLabels: Record<JawType, number[]> = {
      upper: (jawMeshes.upper?.userData.labels as number[] | undefined) ?? [],
      lower: (jawMeshes.lower?.userData.labels as number[] | undefined) ?? [],
    }
    const renderTargets = new Map<number, THREE.Mesh>()
    imported.boundaries.forEach((boundary) => {
      const jaw = findJawForToothId(originalLabels, boundary.toothId)
      const mesh = jaw ? jawMeshes[jaw] : undefined
      if (!mesh) {
        throw new Error(`当前 STL 原始标签中找不到牙号 ${boundary.toothId}`)
      }
      renderTargets.set(boundary.toothId, mesh)
    })

    cancelBoundaryDrawing()
    Array.from(toothBoundaryGroups.keys()).forEach(disposeToothBoundaryGroup)
    Array.from(seedPreviewGroups.keys()).forEach(disposeSeedPreview)
    clearConfirmedRegionMeshes()
    confirmedTriangleLabels.upper = imported.jaws.upper
    confirmedTriangleLabels.lower = imported.jaws.lower
    const importedStates = new Map<number, ToothSegmentationState>()
    imported.boundaries.forEach((boundary) => {
      const mesh = renderTargets.get(boundary.toothId)!
      const jaw = mesh.userData.jaw as JawType
      const confirmed = groupConfirmedTriangles(confirmedTriangleLabels[jaw]).get(boundary.toothId) ?? []
      let state = markBoundaryReady(createSeededState(boundary.toothId, jaw, []), boundary)
      if (confirmed.length) state = markConfirmed(state, confirmed)
      importedStates.set(boundary.toothId, state)
    })
    toothSegmentations.value = importedStates
    segmentationMode.value = true
    applySegmentationDisplayMode()

    imported.boundaries.forEach((boundary) => {
      renderToothBoundary(renderTargets.get(boundary.toothId)!, boundary)
    })
    const jaws: JawType[] = ['upper', 'lower']
    jaws.forEach((jaw) => {
      const mesh = jawMeshes[jaw]
      if (!mesh) return
      groupConfirmedTriangles(confirmedTriangleLabels[jaw]).forEach(
        (triangleIndices, toothId) => {
          renderConfirmedRegion(mesh, toothId, triangleIndices)
        },
      )
    })

    const firstToothId = Array.from(imported.boundaries.keys()).sort((a, b) => a - b)[0] ?? null
    editingToothId.value = firstToothId
    selectedToothId.value = firstToothId
    updateBoundaryStyles()
    statusText.value = `已从 ${file.name} 恢复 ${imported.boundaries.size} 颗牙齿的边界编辑状态。`
  } catch (error) {
    statusText.value = `加载失败：${error instanceof Error ? error.message : String(error)}`
  } finally {
    input.value = ''
  }
}

function finishBoundaryDrawing(event: PointerEvent) {
  if (boundaryDragState) {
    finishBoundaryPointDrag(event)
    return
  }
  if (!drawing) return
  drawing = false
  if (controls) controls.enabled = true
  if (drawingCanvasRef.value?.hasPointerCapture(event.pointerId)) {
    drawingCanvasRef.value.releasePointerCapture(event.pointerId)
  }
  drawBoundaryStroke(true)
  try {
    createSeedSelection()
  } catch (error) {
    statusText.value = error instanceof Error ? error.message : String(error)
  } finally {
    drawingPoints = []
    window.setTimeout(clearDrawingCanvas, 180)
  }
  event.preventDefault()
}

function fitCameraToJaws() {
  if (!camera || !controls) return
  const visibleMeshes = Object.values(jawMeshes).filter((mesh) => mesh?.visible) as THREE.Mesh[]
  const targetMeshes = visibleMeshes.length
    ? visibleMeshes
    : (Object.values(jawMeshes).filter(Boolean) as THREE.Mesh[])
  if (!targetMeshes.length) return

  const bounds = new THREE.Box3()
  targetMeshes.forEach((mesh) => bounds.expandByObject(mesh))
  const center = bounds.getCenter(new THREE.Vector3())
  const size = bounds.getSize(new THREE.Vector3())
  const maxDimension = Math.max(size.x, size.y, size.z) || 1
  const distance = maxDimension / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))

  camera.position.copy(center).add(new THREE.Vector3(distance * 1.18, -distance * 1.25, distance * 0.9))
  camera.near = Math.max(maxDimension / 100, 0.01)
  camera.far = maxDimension * 100
  camera.updateProjectionMatrix()
  controls.target.copy(center)
  controls.update()
}

function resizeViewer() {
  if (!viewerRef.value || !renderer || !camera) return
  const width = viewerRef.value.clientWidth
  const height = viewerRef.value.clientHeight || 600
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderer.setSize(width, height)
  resizeDrawingCanvas()
}

function animate() {
  animationFrameId = requestAnimationFrame(animate)
  controls?.update()
  if (renderer && scene && camera) renderer.render(scene, camera)
}

async function initializeViewer() {
  const viewer = viewerRef.value
  if (!viewer) return

  scene = new THREE.Scene()
  scene.background = new THREE.Color(0xf4f6f8)
  camera = new THREE.PerspectiveCamera(42, viewer.clientWidth / (viewer.clientHeight || 600), 0.1, 3000)
  camera.up.set(0, 0, 1)

  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(viewer.clientWidth, viewer.clientHeight || 600)
  viewer.appendChild(renderer.domElement)
  resizeDrawingCanvas()

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
  window.addEventListener('resize', resizeViewer)
  animate()

  const meshes = await Promise.all(jawConfigs.map(createJawMesh))
  meshes.forEach((mesh) => {
    const jaw = mesh.userData.jaw as JawType
    jawMeshes[jaw] = mesh
    scene?.add(mesh)
  })
  syncJawVisibility()
  applySegmentationDisplayMode()
  fitCameraToJaws()
  modelsReady.value = true
  statusText.value = '已加载上颌和下颌，可旋转、缩放查看模型。'
}

function disposeObject(object: THREE.Object3D | undefined) {
  object?.traverse((child) => {
    const mesh = child as THREE.Mesh
    mesh.geometry?.dispose()
    const material = mesh.material
    if (Array.isArray(material)) material.forEach((item) => item.dispose())
    else material?.dispose()
  })
}

onMounted(() => {
  void initializeViewer().catch((error) => {
    console.error(error)
    statusText.value = `模型加载失败：${error instanceof Error ? error.message : String(error)}`
  })
})

onUnmounted(() => {
  window.removeEventListener('resize', resizeViewer)
  cancelAnimationFrame(animationFrameId)
  controls?.dispose()
  graphCutWorkerClient?.destroy()
  toothBoundaryGroups.forEach(({ group }) => {
    group.parent?.remove(group)
    disposeObject(group)
  })
  toothBoundaryGroups.clear()
  seedPreviewGroups.forEach(({ group }) => {
    group.parent?.remove(group)
    disposeObject(group)
  })
  seedPreviewGroups.clear()
  confirmedRegionMeshes.clear()
  pointHighlight?.parent?.remove(pointHighlight)
  disposeObject(pointHighlight ?? undefined)
  if (jawMeshes.upper) disposeMeshBvh(jawMeshes.upper)
  if (jawMeshes.lower) disposeMeshBvh(jawMeshes.lower)
  disposeObject(jawMeshes.upper)
  disposeObject(jawMeshes.lower)
  renderer?.dispose()
  roundPointTexture?.dispose()
  renderer?.domElement.remove()
  scene = null
  camera = null
  renderer = null
  controls = null
  graphCutWorkerClient = null
  pointHighlight = null
  roundPointTexture = null
})
</script>

<style scoped>
.segmentation-page {
  min-height: 100vh;
  display: grid;
  grid-template-rows: auto 1fr;
  background: #eef2f6;
  color: #27313d;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 14px 18px;
  background: #ffffff;
  border-bottom: 1px solid #d8e0ea;
}

.title-block {
  min-width: 280px;
}

h1 {
  margin: 0;
  font-size: 20px;
}

.title-block p,
.status {
  margin: 4px 0 0;
  color: #657080;
  font-size: 13px;
}

.actions {
  display: flex;
  gap: 8px;
}

button {
  padding: 7px 14px;
  border: 1px solid #c7d0dc;
  border-radius: 6px;
  background: #ffffff;
  color: #27313d;
  cursor: pointer;
}

button.active {
  border-color: #2474e8;
  background: #2474e8;
  color: #ffffff;
}

.status {
  margin-left: auto;
  text-align: right;
}

.viewer {
  position: relative;
  min-height: 620px;
  overflow: hidden;
}

.viewer :deep(canvas) {
  display: block;
}

.drawing-canvas {
  position: absolute;
  inset: 0;
  z-index: 5;
  pointer-events: none;
  touch-action: none;
}

.drawing-canvas.enabled {
  pointer-events: auto;
  cursor: crosshair;
}

.hidden-file-input {
  display: none;
}

.visual-state-hook {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.tooth-field {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #4c5868;
  font-size: 13px;
}

.tooth-field input,
.tooth-field select {
  width: 74px;
  padding: 6px 8px;
  border: 1px solid #c7d0dc;
  border-radius: 6px;
  background: #ffffff;
  color: #27313d;
}

@media (max-width: 820px) {
  .toolbar {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .status {
    width: 100%;
    margin-left: 0;
    text-align: left;
  }
}
</style>
