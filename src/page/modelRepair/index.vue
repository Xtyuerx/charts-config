<template>
  <main class="model-repair-page">
    <section v-if="loading" class="state-page" aria-live="polite">
      <div class="state-mark">
        <el-icon><Loading /></el-icon>
      </div>
      <h1>模型修复</h1>
      <p>{{ statusText }}</p>
    </section>

    <section v-else-if="errorText" class="state-page" aria-live="assertive">
      <div class="state-mark state-mark-error">
        <el-icon><WarningFilled /></el-icon>
      </div>
      <h1>模型修复</h1>
      <p>{{ errorText }}</p>
      <button class="state-action" type="button" @click="goBack">返回模型分割</button>
    </section>

    <div v-else class="repair-workbench">
      <section ref="viewportRef" class="model-viewport" aria-label="模型修复画布">
        <canvas ref="canvasRef" aria-label="上下颌模型"></canvas>
        <div class="viewport-status" aria-live="polite">{{ statusText }}</div>
      </section>

      <aside class="repair-panel" aria-label="模型修复控制面板">
        <header class="panel-header">
          <div>
            <p class="eyebrow">模型预处理中</p>
            <h1>模型修复</h1>
          </div>
          <button
            class="icon-button"
            type="button"
            title="返回模型分割"
            aria-label="返回模型分割"
            @click="goBack"
          >
            <el-icon><ArrowLeft /></el-icon>
          </button>
        </header>

        <section class="panel-section panel-intro">
          <div class="section-title-row">
            <h2>模型修复</h2>
            <span class="task-id">{{ taskId }}</span>
          </div>
          <p class="hint">
            <el-icon><InfoFilled /></el-icon>拖动鼠标在模型表面进行修复
          </p>
          <div class="progress-track" aria-hidden="true"><span></span></div>
        </section>

        <section class="panel-section">
          <div class="section-title-row">
            <h2>修复工具</h2>
            <span class="unit-label">毫米</span>
          </div>
          <div class="tool-grid" role="toolbar" aria-label="修复工具">
            <button
              v-for="tool in tools"
              :key="tool.value"
              class="tool-button"
              :class="{ active: activeTool === tool.value }"
              type="button"
              :aria-pressed="activeTool === tool.value"
              :aria-label="tool.label"
              @click="selectTool(tool.value)"
            >
              <el-icon><component :is="tool.icon" /></el-icon>
              <span>{{ tool.label }}</span>
            </button>
          </div>

          <div class="slider-field">
            <div class="field-label-row">
              <label for="brush-radius">范围</label>
              <output for="brush-radius">{{ brushRadius.toFixed(2) }} mm</output>
            </div>
            <div class="slider-row">
              <input
                id="brush-radius"
                v-model.number="brushRadius"
                type="range"
                min="0.1"
                max="5"
                step="0.01"
                aria-label="范围"
              />
              <input
                v-model.number="brushRadius"
                class="number-input"
                type="number"
                min="0.1"
                max="5"
                step="0.01"
                aria-label="范围数值"
              />
            </div>
          </div>

          <div class="slider-field">
            <div class="field-label-row">
              <label for="brush-strength">强度</label>
              <output for="brush-strength">{{ brushStrength.toFixed(2) }} mm</output>
            </div>
            <div class="slider-row">
              <input
                id="brush-strength"
                v-model.number="brushStrength"
                type="range"
                min="0.1"
                max="5"
                step="0.01"
                aria-label="强度"
              />
              <input
                v-model.number="brushStrength"
                class="number-input"
                type="number"
                min="0.1"
                max="5"
                step="0.01"
                aria-label="强度数值"
              />
            </div>
          </div>
        </section>

        <section class="panel-section jaw-section">
          <h2>模型显示</h2>
          <div class="jaw-toggle-row">
            <button
              class="jaw-toggle"
              :class="{ active: showUpper }"
              type="button"
              :aria-pressed="showUpper"
              @click="toggleJaw('upper')"
            >
              <span class="jaw-dot upper-dot"></span>上颌
            </button>
            <button
              class="jaw-toggle"
              :class="{ active: showLower }"
              type="button"
              :aria-pressed="showLower"
              @click="toggleJaw('lower')"
            >
              <span class="jaw-dot lower-dot"></span>下颌
            </button>
          </div>
        </section>

        <section class="panel-section history-section">
          <h2>编辑记录</h2>
          <div class="history-actions">
            <button
              class="history-button"
              type="button"
              title="撤销"
              aria-label="撤销"
              :disabled="!canUndo"
              @click="undo"
            >
              <el-icon><RefreshLeft /></el-icon><span>撤销</span>
            </button>
            <button
              class="history-button"
              type="button"
              title="重做"
              aria-label="重做"
              :disabled="!canRedo"
              @click="redo"
            >
              <el-icon><RefreshRight /></el-icon><span>重做</span>
            </button>
          </div>
        </section>

        <section class="panel-section export-section">
          <h2>导出模型</h2>
          <div class="export-grid">
            <button
              class="export-button"
              type="button"
              :disabled="!hasUpperJaw"
              @click="exportJaw('upper', 'json')"
            >
              导出上颌 JSON
            </button>
            <button
              class="export-button"
              type="button"
              :disabled="!hasUpperJaw"
              @click="exportJaw('upper', 'stl')"
            >
              导出上颌 STL
            </button>
            <button
              class="export-button"
              type="button"
              :disabled="!hasLowerJaw"
              @click="exportJaw('lower', 'json')"
            >
              导出下颌 JSON
            </button>
            <button
              class="export-button"
              type="button"
              :disabled="!hasLowerJaw"
              @click="exportJaw('lower', 'stl')"
            >
              导出下颌 STL
            </button>
          </div>
        </section>

        <footer class="panel-footer">
          <button class="secondary-action" type="button" @click="goBack">上一步</button>
          <button
            class="primary-action"
            type="button"
            :disabled="saving || !isReady"
            :title="saveButtonTitle"
            @click="saveRepair"
          >
            保存
          </button>
        </footer>
      </aside>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import {
  ArrowLeft,
  Bottom,
  InfoFilled,
  Loading,
  MagicStick,
  RefreshLeft,
  RefreshRight,
  Top,
  WarningFilled,
} from '@element-plus/icons-vue'
import { computeBoundsTree, disposeBoundsTree, type MeshBVH } from 'three-mesh-bvh'
import { STLExporter } from 'three-stdlib'

import { useModelRepairStore } from '@/stores/modelRepair'
import { createGeometryFromPayload, type MeshGeometryPayload } from '@/utils/geometryPayloadUtils'

import {
  applyHistoryCommand,
  createSculptHistory,
  type SculptHistoryCommand,
} from './utils/historyUtils'
import {
  buildLogicalMeshTopology,
  readLogicalPosition,
  type LogicalMeshTopology,
} from './utils/meshTopologyUtils'
import {
  applySculptSample,
  collectBrushGroupsFromBvh,
  enableSculptRaycast,
  type SculptTool,
} from './utils/sculptUtils'
import {
  type ModelRepairTransfer,
  type RepairJaw,
  updateTransferFromMeshes,
} from './utils/modelTransferUtils'

type RepairBufferGeometry = THREE.BufferGeometry & {
  boundsTree?: MeshBVH
  computeBoundsTree?: typeof computeBoundsTree
  disposeBoundsTree?: typeof disposeBoundsTree
}

type RepairMeshState = {
  jaw: RepairJaw
  mesh: THREE.Mesh
  topology: LogicalMeshTopology
  labels: number[]
  payload: MeshGeometryPayload
}

type ActiveStroke = {
  jaw: RepairJaw
  mesh: THREE.Mesh
  topology: LogicalMeshTopology
  pointerId: number
  before: Map<number, THREE.Vector3>
  changedGroups: Set<number>
}

type PointerPosition = { clientX: number; clientY: number }

const route = useRoute()
const router = useRouter()
const modelRepairStore = useModelRepairStore()
const taskId = typeof route.query.task === 'string' ? route.query.task : ''

const tools = [
  { value: 'raise' as const, label: '升高', icon: Top },
  { value: 'lower' as const, label: '压低', icon: Bottom },
  { value: 'smooth' as const, label: '平滑', icon: MagicStick },
]
const activeTool = ref<SculptTool>('smooth')
const brushRadius = ref(0.68)
const brushStrength = ref(2)
const showUpper = ref(true)
const showLower = ref(true)
const loading = ref(true)
const saving = ref(false)
const errorText = ref('')
const statusText = ref('正在加载模型修复数据...')
const canUndo = ref(false)
const canRedo = ref(false)
const meshCount = ref(0)
const hasUpperJaw = ref(false)
const hasLowerJaw = ref(false)
let currentTransfer: ModelRepairTransfer | null = null
const saveButtonTitle = computed(() =>
  saving.value ? '正在保存模型修复结果' : '保存当前模型修复结果',
)

const viewportRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const meshStates = new Map<RepairJaw, RepairMeshState>()
const history = createSculptHistory()

let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let renderer: THREE.WebGLRenderer | null = null
let controls: OrbitControls | null = null
let raycaster: THREE.Raycaster | null = null
let brushIndicator: THREE.LineLoop | null = null
let animationFrameId: number | null = null
let resizeObserver: ResizeObserver | null = null
let activeStroke: ActiveStroke | null = null
let pendingPointer: PointerPosition | null = null
let sculptFrameId: number | null = null

const isReady = computed(() => !loading.value && !errorText.value && meshCount.value > 0)

function refreshHistoryState() {
  canUndo.value = history.canUndo()
  canRedo.value = history.canRedo()
}

function clampInput(value: number, minimum: number, maximum: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback
  return THREE.MathUtils.clamp(value, minimum, maximum)
}

watch(brushRadius, (value) => {
  brushRadius.value = clampInput(Number(value), 0.1, 5, 0.68)
  updateBrushIndicatorSize()
})

watch(brushStrength, (value) => {
  brushStrength.value = clampInput(Number(value), 0.1, 5, 2)
})

watch([showUpper, showLower], () => {
  const visibility: Record<RepairJaw, boolean> = { upper: showUpper.value, lower: showLower.value }
  meshStates.forEach((state) => {
    state.mesh.visible = visibility[state.jaw]
  })
  if (activeStroke && !visibility[activeStroke.jaw]) finishStroke()
})

function selectTool(tool: SculptTool) {
  finishStroke()
  activeTool.value = tool
}

function toggleJaw(jaw: RepairJaw) {
  finishStroke()
  if (jaw === 'upper') showUpper.value = !showUpper.value
  else showLower.value = !showLower.value
}

async function goBack() {
  finishStroke()
  await router.push('/allStl')
}

function setupBoundsTree(geometry: THREE.BufferGeometry) {
  const repairGeometry = geometry as RepairBufferGeometry
  repairGeometry.computeBoundsTree ??= computeBoundsTree
  repairGeometry.disposeBoundsTree ??= disposeBoundsTree
  repairGeometry.computeBoundsTree()
}

function rebuildBoundsTree(state: RepairMeshState) {
  const geometry = state.mesh.geometry as RepairBufferGeometry
  geometry.disposeBoundsTree?.call(geometry)
  setupBoundsTree(geometry)
}

function refreshGeometryAfterEdit(state: RepairMeshState, refitBoundsTree = false) {
  const geometry = state.mesh.geometry as RepairBufferGeometry
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()

  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined
  if (position) position.needsUpdate = true
  if (normal) normal.needsUpdate = true
  if (refitBoundsTree) geometry.boundsTree?.refit()
}

function refreshAllGeometry() {
  meshStates.forEach((state) => refreshGeometryAfterEdit(state, true))
}

function getCurrentMeshMap() {
  const meshes: Partial<Record<RepairJaw, THREE.Mesh>> = {}
  meshStates.forEach((state) => {
    meshes[state.jaw] = state.mesh
  })
  return meshes
}

function getCurrentTransferSnapshot() {
  if (!currentTransfer) throw new Error('当前没有可保存的模型修复数据。')
  finishStroke()
  refreshAllGeometry()
  return updateTransferFromMeshes(currentTransfer, getCurrentMeshMap())
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

async function saveRepair() {
  if (saving.value || !isReady.value) return

  saving.value = true
  statusText.value = '正在保存模型修复结果...'
  try {
    const savedTransfer = getCurrentTransferSnapshot()
    await modelRepairStore.setTransfer(savedTransfer)
    currentTransfer = savedTransfer
    history.clear()
    refreshHistoryState()
    statusText.value = '模型修复结果已保存'
  } catch (error) {
    statusText.value = `模型修复结果保存失败：${error instanceof Error ? error.message : String(error)}`
  } finally {
    saving.value = false
  }
}

function exportJaw(jaw: RepairJaw, format: 'json' | 'stl') {
  try {
    const snapshot = getCurrentTransferSnapshot()
    const state = meshStates.get(jaw)
    const geometry = snapshot.jaws[jaw]
    if (!state || !geometry) throw new Error(`${jaw === 'upper' ? '上颌' : '下颌'}模型不可用。`)

    if (format === 'json') {
      const payload = {
        jaw,
        labels: geometry.labels,
        geometry,
        instances: [],
        metadata: { source: 'modelRepair', taskId: snapshot.id },
      }
      downloadBlob(
        `${jaw}-repaired.json`,
        new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
      )
      statusText.value = `${jaw === 'upper' ? '上颌' : '下颌'} JSON 已导出。`
      return
    }

    state.mesh.updateMatrixWorld(true)
    const data = new STLExporter().parse(state.mesh, { binary: true })
    const stlBytes = new Uint8Array(data.byteLength)
    stlBytes.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
    downloadBlob(`${jaw}-repaired.stl`, new Blob([stlBytes], { type: 'model/stl' }))
    statusText.value = `${jaw === 'upper' ? '上颌' : '下颌'} STL 已导出。`
  } catch (error) {
    statusText.value = `导出失败：${error instanceof Error ? error.message : String(error)}`
  }
}

function createBrushIndicator() {
  const points: THREE.Vector3[] = []
  for (let index = 0; index < 64; index += 1) {
    const angle = (index / 64) * Math.PI * 2
    points.push(new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0))
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points)
  const material = new THREE.LineBasicMaterial({
    color: 0x2f8cff,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
  })
  const line = new THREE.LineLoop(geometry, material)
  line.renderOrder = 20
  line.visible = false
  scene?.add(line)
  return line
}

function updateBrushIndicatorSize() {
  if (brushIndicator) brushIndicator.scale.setScalar(brushRadius.value)
}

function createRepairMesh(jaw: RepairJaw, payload: MeshGeometryPayload) {
  const restored = createGeometryFromPayload(payload)
  restored.geometry.computeBoundingBox()
  restored.geometry.computeBoundingSphere()
  setupBoundsTree(restored.geometry)

  const material = new THREE.MeshStandardMaterial({
    color: 0xcaa8a3,
    roughness: 0.76,
    metalness: 0.04,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(restored.geometry, material)
  mesh.userData.jaw = jaw
  mesh.userData.labels = restored.labels
  mesh.userData.gumRemoved = payload.gumRemoved
  mesh.userData.removedFaceCount = payload.removedFaceCount
  mesh.userData.sourceFaceCount = payload.sourceFaceCount
  enableSculptRaycast(mesh)
  scene?.add(mesh)

  const state: RepairMeshState = {
    jaw,
    mesh,
    topology: buildLogicalMeshTopology(restored.geometry),
    labels: restored.labels,
    payload,
  }
  meshStates.set(jaw, state)
  meshCount.value = meshStates.size
  if (jaw === 'upper') hasUpperJaw.value = true
  else hasLowerJaw.value = true
  return state
}

function resizeRenderer() {
  if (!renderer || !camera || !viewportRef.value) return
  const width = Math.max(1, viewportRef.value.clientWidth)
  const height = Math.max(1, viewportRef.value.clientHeight)
  renderer.setSize(width, height, false)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  camera.aspect = width / height
  camera.updateProjectionMatrix()
}

function fitCamera() {
  if (!camera || !controls || meshStates.size === 0) return
  const bounds = new THREE.Box3()
  meshStates.forEach((state) => bounds.expandByObject(state.mesh))
  if (bounds.isEmpty()) return

  const size = bounds.getSize(new THREE.Vector3())
  const center = bounds.getCenter(new THREE.Vector3())
  const maxDimension = Math.max(size.x, size.y, size.z, 0.1)
  const distance = (maxDimension / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))) * 1.55
  camera.position.copy(center).add(new THREE.Vector3(0, 0, distance))
  camera.near = Math.max(maxDimension / 1000, 0.001)
  camera.far = Math.max(maxDimension * 40, 100)
  camera.lookAt(center)
  controls.target.copy(center)
  controls.update()
}

function setupScene() {
  const canvas = canvasRef.value
  if (!canvas) throw new Error('模型画布未准备完成。')

  scene = new THREE.Scene()
  scene.background = new THREE.Color(0xf3f5f7)
  camera = new THREE.PerspectiveCamera(34, 1, 0.001, 1000)
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.setClearColor(0xf3f5f7, 1)
  raycaster = new THREE.Raycaster()

  scene.add(new THREE.HemisphereLight(0xffffff, 0x6d7680, 2.2))
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.1)
  keyLight.position.set(2, 3, 5)
  scene.add(keyLight)
  const fillLight = new THREE.DirectionalLight(0xb8d8ff, 1.1)
  fillLight.position.set(-3, -1, 2)
  scene.add(fillLight)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enablePan = false
  controls.mouseButtons.LEFT = THREE.MOUSE.PAN
  controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY
  controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE
  controls.enableDamping = true

  brushIndicator = createBrushIndicator()
  updateBrushIndicatorSize()
  meshStates.forEach((state) => {
    state.mesh.visible = state.jaw === 'upper' ? showUpper.value : showLower.value
  })
  fitCamera()
  resizeRenderer()
  attachCanvasListeners(renderer.domElement)

  const render = () => {
    if (!renderer || !scene || !camera) return
    controls?.update()
    renderer.render(scene, camera)
    animationFrameId = window.requestAnimationFrame(render)
  }
  animationFrameId = window.requestAnimationFrame(render)
  resizeObserver = new ResizeObserver(resizeRenderer)
  if (viewportRef.value) resizeObserver.observe(viewportRef.value)
}

function getPointerNdc(position: PointerPosition) {
  const canvas = renderer?.domElement
  if (!canvas) return null
  const bounds = canvas.getBoundingClientRect()
  if (bounds.width <= 0 || bounds.height <= 0) return null
  return new THREE.Vector2(
    ((position.clientX - bounds.left) / bounds.width) * 2 - 1,
    -((position.clientY - bounds.top) / bounds.height) * 2 + 1,
  )
}

function getVisibleMeshes() {
  return [...meshStates.values()].filter((state) => state.mesh.visible).map((state) => state.mesh)
}

function getStateForMesh(mesh: THREE.Object3D) {
  return [...meshStates.values()].find((state) => state.mesh === mesh) ?? null
}

function raycastAt(position: PointerPosition, targetMesh?: THREE.Mesh) {
  if (!raycaster || !camera) return null
  const ndc = getPointerNdc(position)
  if (!ndc) return null
  raycaster.setFromCamera(ndc, camera)
  const targets = targetMesh ? [targetMesh] : getVisibleMeshes()
  const hit = raycaster.intersectObjects(targets, false)[0]
  return hit ?? null
}

function getWorldNormal(hit: THREE.Intersection) {
  const normal = hit.face?.normal?.clone() ?? new THREE.Vector3(0, 0, 1)
  const object = hit.object as THREE.Mesh
  return normal.transformDirection(object.matrixWorld).normalize()
}

function updateBrushIndicator(hit: THREE.Intersection | null) {
  if (!brushIndicator) return
  if (!hit) {
    brushIndicator.visible = false
    return
  }
  const normal = getWorldNormal(hit)
  brushIndicator.position.copy(hit.point).addScaledVector(normal, 0.02)
  brushIndicator.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal)
  brushIndicator.visible = true
  updateBrushIndicatorSize()
}

function captureBeforeGroups(stroke: ActiveStroke, groupIndices: number[]) {
  for (const groupIndex of groupIndices) {
    if (!stroke.before.has(groupIndex)) {
      stroke.before.set(
        groupIndex,
        readLogicalPosition(stroke.mesh.geometry, stroke.topology, groupIndex),
      )
    }
  }
}

function applyPointerSample(position: PointerPosition, stroke: ActiveStroke) {
  const hit = raycastAt(position, stroke.mesh)
  updateBrushIndicator(hit)
  if (!hit) return

  const localCenter = stroke.mesh.worldToLocal(hit.point.clone())
  const groups = collectBrushGroupsFromBvh(
    stroke.mesh.geometry as RepairBufferGeometry,
    stroke.topology,
    localCenter,
    brushRadius.value,
  )
  captureBeforeGroups(stroke, groups)
  const changed = applySculptSample({
    geometry: stroke.mesh.geometry,
    topology: stroke.topology,
    groupIndices: groups,
    center: localCenter,
    radius: brushRadius.value,
    strength: brushStrength.value,
    tool: activeTool.value,
  })
  changed.forEach((groupIndex) => stroke.changedGroups.add(groupIndex))
  if (changed.size > 0) {
    const state = meshStates.get(stroke.jaw)
    if (state) refreshGeometryAfterEdit(state, true)
  }
}

function scheduleSculptSample(position: PointerPosition) {
  pendingPointer = position
  if (sculptFrameId !== null) return
  sculptFrameId = window.requestAnimationFrame(() => {
    sculptFrameId = null
    const nextPosition = pendingPointer
    pendingPointer = null
    if (nextPosition && activeStroke) applyPointerSample(nextPosition, activeStroke)
  })
}

function buildHistoryCommand(stroke: ActiveStroke): SculptHistoryCommand | null {
  const groupIndices = [...stroke.changedGroups]
    .filter((groupIndex) => stroke.before.has(groupIndex))
    .sort((left, right) => left - right)
  if (groupIndices.length === 0) return null

  const before = new Float32Array(groupIndices.length * 3)
  const after = new Float32Array(groupIndices.length * 3)
  let changed = false
  groupIndices.forEach((groupIndex, index) => {
    const beforePosition = stroke.before.get(groupIndex)
    if (!beforePosition) return
    const afterPosition = readLogicalPosition(stroke.mesh.geometry, stroke.topology, groupIndex)
    beforePosition.toArray(before, index * 3)
    afterPosition.toArray(after, index * 3)
    if (beforePosition.distanceToSquared(afterPosition) > 1e-12) changed = true
  })
  if (!changed) return null

  return {
    jaw: stroke.jaw,
    logicalGroupIndices: Uint32Array.from(groupIndices),
    before,
    after,
    byteLength:
      before.byteLength + after.byteLength + groupIndices.length * Uint32Array.BYTES_PER_ELEMENT,
  }
}

function flushPendingSample() {
  if (sculptFrameId !== null) {
    window.cancelAnimationFrame(sculptFrameId)
    sculptFrameId = null
  }
  const nextPosition = pendingPointer
  pendingPointer = null
  if (nextPosition && activeStroke) applyPointerSample(nextPosition, activeStroke)
}

function finishStroke() {
  flushPendingSample()
  releaseActivePointerCapture()
  const stroke = activeStroke
  activeStroke = null
  if (controls) controls.enabled = true
  if (brushIndicator) brushIndicator.visible = false
  if (!stroke) return

  const command = buildHistoryCommand(stroke)
  if (command) {
    history.push(command)
    refreshHistoryState()
    const state = meshStates.get(stroke.jaw)
    if (state) rebuildBoundsTree(state)
    statusText.value = '修复已记录，可撤销或重做。'
  }
}

function beginStroke(event: PointerEvent) {
  if (event.button !== 0 || !event.isPrimary || activeStroke || !isReady.value) return
  const hit = raycastAt({ clientX: event.clientX, clientY: event.clientY })
  const state = hit ? getStateForMesh(hit.object) : null
  if (!hit || !state) return

  activeStroke = {
    jaw: state.jaw,
    mesh: state.mesh,
    topology: state.topology,
    pointerId: event.pointerId,
    before: new Map(),
    changedGroups: new Set(),
  }
  if (controls) controls.enabled = false
  updateBrushIndicator(hit)
  applyPointerSample({ clientX: event.clientX, clientY: event.clientY }, activeStroke)
  renderer?.domElement.setPointerCapture(event.pointerId)
  event.preventDefault()
}

function movePointer(event: PointerEvent) {
  const position = { clientX: event.clientX, clientY: event.clientY }
  if (activeStroke) {
    if (event.pointerId !== activeStroke.pointerId) return
    scheduleSculptSample(position)
    return
  }
  updateBrushIndicator(raycastAt(position))
}

function endPointer(event: PointerEvent) {
  if (!activeStroke || event.pointerId !== activeStroke.pointerId) return

  event.preventDefault()
  flushPendingSample()
  finishStroke()
}

function releaseActivePointerCapture() {
  const pointerId = activeStroke?.pointerId
  if (pointerId === undefined) return

  try {
    renderer?.domElement.releasePointerCapture(pointerId)
  } catch {
    // Pointer capture may already have been released by the browser.
  }
}

function leaveCanvas(event?: PointerEvent) {
  if (
    activeStroke &&
    event?.pointerId !== undefined &&
    event.pointerId !== activeStroke.pointerId
  ) {
    return
  }
  if (activeStroke) {
    releaseActivePointerCapture()
    finishStroke()
  } else if (brushIndicator) brushIndicator.visible = false
}

function preventContextMenu(event: MouseEvent) {
  event.preventDefault()
}

function attachCanvasListeners(canvas: HTMLCanvasElement) {
  canvas.addEventListener('pointerdown', beginStroke)
  canvas.addEventListener('pointermove', movePointer)
  canvas.addEventListener('pointerup', endPointer)
  canvas.addEventListener('pointercancel', endPointer)
  canvas.addEventListener('pointerleave', leaveCanvas)
  canvas.addEventListener('lostpointercapture', leaveCanvas)
  canvas.addEventListener('contextmenu', preventContextMenu)
}

function detachCanvasListeners(canvas: HTMLCanvasElement) {
  canvas.removeEventListener('pointerdown', beginStroke)
  canvas.removeEventListener('pointermove', movePointer)
  canvas.removeEventListener('pointerup', endPointer)
  canvas.removeEventListener('pointercancel', endPointer)
  canvas.removeEventListener('pointerleave', leaveCanvas)
  canvas.removeEventListener('lostpointercapture', leaveCanvas)
  canvas.removeEventListener('contextmenu', preventContextMenu)
}

function undo() {
  finishStroke()
  const command = history.undo()
  if (!command) return
  const state = meshStates.get(command.jaw)
  if (!state) return
  applyHistoryCommand(state.mesh.geometry, state.topology, command, 'before')
  refreshGeometryAfterEdit(state)
  rebuildBoundsTree(state)
  refreshHistoryState()
  statusText.value = '已撤销上一次修复。'
}

function redo() {
  finishStroke()
  const command = history.redo()
  if (!command) return
  const state = meshStates.get(command.jaw)
  if (!state) return
  applyHistoryCommand(state.mesh.geometry, state.topology, command, 'after')
  refreshGeometryAfterEdit(state)
  rebuildBoundsTree(state)
  refreshHistoryState()
  statusText.value = '已重做上一次修复。'
}

function disposeScene() {
  const canvas = renderer?.domElement
  if (canvas) detachCanvasListeners(canvas)
  finishStroke()
  if (animationFrameId !== null) window.cancelAnimationFrame(animationFrameId)
  if (sculptFrameId !== null) window.cancelAnimationFrame(sculptFrameId)
  resizeObserver?.disconnect()
  resizeObserver = null

  meshStates.forEach((state) => {
    const geometry = state.mesh.geometry as RepairBufferGeometry
    geometry.disposeBoundsTree?.call(geometry)
    geometry.dispose()
    const material = state.mesh.material
    if (Array.isArray(material)) material.forEach((item) => item.dispose())
    else material.dispose()
  })
  meshStates.clear()
  meshCount.value = 0
  hasUpperJaw.value = false
  hasLowerJaw.value = false
  brushIndicator?.geometry.dispose()
  if (brushIndicator?.material) {
    const material = brushIndicator.material
    if (Array.isArray(material)) material.forEach((item) => item.dispose())
    else material.dispose()
  }
  controls?.dispose()
  renderer?.dispose()
  scene = null
  camera = null
  renderer = null
  controls = null
  raycaster = null
  brushIndicator = null
}

onMounted(async () => {
  if (!taskId) {
    loading.value = false
    errorText.value = '未找到可修复的模型数据'
    statusText.value = errorText.value
    return
  }

  try {
    const transfer = await modelRepairStore.restoreTransfer(taskId)
    if (!transfer) {
      loading.value = false
      errorText.value = '未找到可修复的模型数据'
      statusText.value = errorText.value
      return
    }
    currentTransfer = transfer
    loading.value = false
    await nextTick()
    setupScene()
    if (transfer.jaws.upper) createRepairMesh('upper', transfer.jaws.upper)
    if (transfer.jaws.lower) createRepairMesh('lower', transfer.jaws.lower)
    if (meshStates.size === 0) throw new Error('当前没有可修复的模型。')
    fitCamera()
    statusText.value = '模型已加载，默认工具为平滑。'
  } catch (error) {
    disposeScene()
    loading.value = false
    errorText.value =
      error instanceof Error ? `模型修复数据加载失败：${error.message}` : '模型修复数据加载失败。'
    statusText.value = errorText.value
  }
})

onBeforeUnmount(() => {
  disposeScene()
})
</script>

<style scoped>
:global(*) {
  box-sizing: border-box;
}
:global(body) {
  margin: 0;
  background: #f3f5f7;
  color: #26313d;
  font-family: Inter, 'Microsoft YaHei', sans-serif;
}

.model-repair-page {
  min-height: 100vh;
  background: #f3f5f7;
}
.repair-workbench {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 324px;
  min-height: 100vh;
}
.model-viewport {
  position: relative;
  min-width: 0;
  min-height: 100vh;
  overflow: hidden;
  background: #f3f5f7;
}
.model-viewport canvas {
  display: block;
  width: 100%;
  height: 100%;
  min-height: 100vh;
  cursor: crosshair;
  touch-action: none;
}
.viewport-status {
  position: absolute;
  left: 24px;
  bottom: 20px;
  max-width: calc(100% - 48px);
  padding: 7px 10px;
  color: #647282;
  background: rgba(255, 255, 255, 0.88);
  border: 1px solid #e1e6eb;
  border-radius: 6px;
  font-size: 12px;
  pointer-events: none;
}

.repair-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: #ffffff;
  border-left: 1px solid #e2e7ec;
  box-shadow: -8px 0 24px rgba(33, 48, 66, 0.04);
}
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 24px 22px 18px;
  border-bottom: 1px solid #e7ebef;
}
.eyebrow {
  margin: 0 0 4px;
  color: #8b96a2;
  font-size: 12px;
}
.panel-header h1 {
  margin: 0;
  font-size: 21px;
  line-height: 1.3;
  font-weight: 700;
}
.icon-button,
.history-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #dbe2e8;
  background: #fff;
  color: #67727e;
  cursor: pointer;
}
.icon-button {
  width: 34px;
  height: 34px;
  border-radius: 6px;
}
.icon-button:hover,
.history-button:not(:disabled):hover {
  color: #2f8cff;
  border-color: #9dc8ff;
}
.panel-section {
  padding: 18px 22px;
  border-bottom: 1px solid #e7ebef;
}
.panel-intro {
  padding-top: 16px;
}
.section-title-row,
.field-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.section-title-row h2,
.panel-section h2 {
  margin: 0;
  color: #303b47;
  font-size: 14px;
  font-weight: 700;
}
.task-id,
.unit-label {
  max-width: 160px;
  overflow: hidden;
  color: #9aa4af;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hint {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 14px 0 12px;
  padding: 8px 9px;
  color: #4b91dd;
  background: #eff7ff;
  border-radius: 5px;
  font-size: 11px;
  line-height: 1.4;
}
.progress-track {
  height: 4px;
  overflow: hidden;
  background: #e6ebef;
  border-radius: 4px;
}
.progress-track span {
  display: block;
  width: 62%;
  height: 100%;
  background: #4c9cff;
  border-radius: inherit;
}
.tool-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-top: 14px;
}
.tool-button {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 72px;
  padding: 9px 4px;
  border: 1px solid #e2e7ec;
  border-radius: 6px;
  background: #fff;
  color: #697581;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.tool-button:hover {
  border-color: #9dc8ff;
  color: #318cf2;
}
.tool-button.active {
  border-color: #3d95ff;
  background: #f1f8ff;
  color: #328ff4;
  box-shadow: inset 0 0 0 1px #3d95ff;
}
.tool-button .el-icon {
  font-size: 22px;
}
.slider-field {
  margin-top: 18px;
}
.field-label-row label {
  color: #53606d;
  font-size: 12px;
}
.field-label-row output {
  color: #788490;
  font-size: 11px;
}
.slider-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 72px;
  align-items: center;
  gap: 10px;
  margin-top: 9px;
}
input[type='range'] {
  width: 100%;
  accent-color: #3f97ff;
}
.number-input {
  width: 100%;
  height: 29px;
  padding: 0 7px;
  border: 1px solid #dfe5ea;
  border-radius: 5px;
  color: #3d4853;
  background: #fff;
  font: inherit;
  font-size: 12px;
}
.number-input:focus {
  outline: 2px solid rgba(63, 151, 255, 0.18);
  border-color: #75b5ff;
}
.jaw-section {
  padding-bottom: 17px;
}
.jaw-toggle-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 12px;
}
.jaw-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: 34px;
  border: 1px solid #e0e6eb;
  border-radius: 6px;
  background: #fff;
  color: #68747f;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.jaw-toggle.active {
  border-color: #8fc1f3;
  color: #3e8ed9;
  background: #f5faff;
}
.jaw-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.upper-dot {
  background: #d39f98;
}
.lower-dot {
  background: #77abd6;
}
.history-section {
  padding-bottom: 20px;
}
.history-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 12px;
}
.history-button {
  gap: 7px;
  height: 34px;
  border-radius: 5px;
  font: inherit;
  font-size: 12px;
}
.history-button:disabled {
  color: #b3bdc6;
  background: #f8f9fa;
  border-color: #e8edf1;
  cursor: not-allowed;
}
.export-section {
  padding-bottom: 16px;
}
.export-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 12px;
}
.export-button {
  min-width: 0;
  height: 32px;
  padding: 0 6px;
  overflow: hidden;
  border: 1px solid #dbe2e8;
  border-radius: 5px;
  background: #fff;
  color: #67727e;
  font: inherit;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.export-button:not(:disabled):hover {
  border-color: #9dc8ff;
  color: #2f8cff;
}
.export-button:disabled {
  color: #b3bdc6;
  background: #f8f9fa;
  border-color: #e8edf1;
  cursor: not-allowed;
}
.panel-footer {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 9px;
  margin-top: auto;
  padding: 18px 22px 22px;
}
.secondary-action,
.primary-action,
.state-action {
  height: 36px;
  border-radius: 6px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.secondary-action {
  border: 1px solid #dce3e9;
  background: #fff;
  color: #5f6c78;
}
.secondary-action:hover {
  border-color: #a8cafa;
  color: #318cf2;
}
.primary-action {
  border: 1px solid #3f98ff;
  background: #3f98ff;
  color: #fff;
}
.primary-action:disabled {
  opacity: 0.62;
  cursor: not-allowed;
}

.state-page {
  display: flex;
  min-height: 100vh;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px;
  color: #5d6976;
  text-align: center;
}
.state-page h1 {
  margin: 15px 0 6px;
  color: #2d3843;
  font-size: 22px;
}
.state-page p {
  margin: 0;
  font-size: 14px;
}
.state-mark {
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  border-radius: 50%;
  color: #3f98ff;
  background: #eaf4ff;
  font-size: 22px;
}
.state-mark-error {
  color: #d98257;
  background: #fff2ea;
}
.state-action {
  margin-top: 22px;
  padding: 0 18px;
  border: 1px solid #5da6f3;
  background: #fff;
  color: #328cf0;
}
.state-action:hover {
  background: #f1f8ff;
}

@media (max-width: 760px) {
  .repair-workbench {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(390px, 1fr) auto;
  }
  .model-viewport {
    min-height: 390px;
  }
  .model-viewport canvas {
    min-height: 390px;
  }
  .repair-panel {
    border-top: 1px solid #e2e7ec;
    border-left: 0;
    box-shadow: 0 -6px 18px rgba(33, 48, 66, 0.04);
  }
  .panel-header {
    padding: 16px 18px 13px;
  }
  .panel-section {
    padding: 14px 18px;
  }
  .panel-footer {
    padding: 14px 18px 18px;
  }
}
</style>
