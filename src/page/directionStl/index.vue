<template>
  <div class="direction-stl-page">
    <div class="toolbar">
      <div class="toolbar-title">Single Tooth Viewer</div>
      <div class="toolbar-actions">
        <select v-model="selectedJaw" @change="loadSelectedJaw">
          <option value="upper">Upper</option>
          <option value="lower">Lower</option>
        </select>
        <select v-model.number="selectedFdi" @change="refreshSelectedTooth">
          <option v-for="fdi in availableFdis" :key="fdi" :value="fdi">FDI {{ fdi }}</option>
        </select>
        <label class="toggle"
          ><input v-model="showJaw" type="checkbox" @change="syncVisibility" />Jaw</label
        >
        <label class="toggle"
          ><input v-model="showToothMesh" type="checkbox" @change="syncVisibility" />Tooth</label
        >
        <button @click="resetTargetTransform">Reset Target</button>
        <button @click="saveTargetTransform">Save Target</button>
        <button @click="exportModifiedJson">导出修改后的 JSON</button>
        <span class="status">{{ statusText }}</span>
      </div>
    </div>
    <div class="viewer-shell">
      <div ref="viewerRef" class="viewer"></div>
      <section class="quick-target-panel" aria-label="Quick target preferences">
        <h2>快速目标位偏好设置</h2>
        <div class="preference-group">
          <div class="preference-title">上颌去釉</div>
          <label><input v-model="quickTargetPreferences.upperIpr" type="radio" value="allowed" />允许去釉</label>
          <label
            ><input v-model="quickTargetPreferences.upperIpr" type="radio" value="notAllowed" />不可去釉</label
          >
        </div>
        <div class="preference-group">
          <div class="preference-title">下颌去釉</div>
          <label><input v-model="quickTargetPreferences.lowerIpr" type="radio" value="allowed" />允许去釉</label>
          <label
            ><input v-model="quickTargetPreferences.lowerIpr" type="radio" value="notAllowed" />不可去釉</label
          >
        </div>
        <div class="preference-group">
          <div class="preference-title">拔牙</div>
          <label
            ><input v-model="quickTargetPreferences.extraction" type="radio" value="notRequired" />暂不需要</label
          >
          <label><input v-model="quickTargetPreferences.extraction" type="radio" value="required" />拔牙</label>
        </div>
        <div class="preference-group">
          <div class="preference-title">预留</div>
          <label
            ><input v-model="quickTargetPreferences.spacing" type="radio" value="notRequired" />暂不需要</label
          >
          <label
            ><input v-model="quickTargetPreferences.spacing" type="radio" value="reserved" />预留间隙</label
          >
        </div>
        <button class="preference-save-button" @click="saveQuickTargetPreferences">
          保存偏好设置
        </button>
        <div v-if="quickTargetFeedback" class="preference-feedback">
          {{ quickTargetFeedback }}
        </div>
      </section>
      <pre class="target-panel">{{ targetPayloadText }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { STLLoader } from 'three-stdlib'
import { extractToothMeshGeometry } from './utils/toothAxisUtils'
import {
  createToothTargetTransform,
  defaultQuickTargetPreferences,
  serializeToothTargetTransforms,
  targetKey,
  upsertToothTargetTransform,
  type QuickTargetPreferences,
  type ToothTargetTransform,
} from './utils/toothTargetUtils'

type JawName = 'upper' | 'lower'
type LabelData = { labels?: number[] }
type JawConfig = { stlUrl: string; labelsUrl: string; color: number; defaultFdi: number }

const jawConfigs: Record<JawName, JawConfig> = {
  upper: {
    stlUrl: '/models/upper.stl',
    labelsUrl: '/models/upper.json',
    color: 0xd8dce6,
    defaultFdi: 11,
  },
  lower: {
    stlUrl: '/models/lower.stl',
    labelsUrl: '/models/lower.json',
    color: 0xc8d5e8,
    defaultFdi: 31,
  },
}

const viewerRef = ref<HTMLDivElement | null>(null)
const selectedJaw = ref<JawName>('upper')
const selectedFdi = ref(11)
const availableFdis = ref<number[]>([])
const statusText = ref('Ready')
const showJaw = ref(true)
const showToothMesh = ref(true)
const quickTargetPreferences = ref<QuickTargetPreferences>({ ...defaultQuickTargetPreferences })
const quickTargetFeedback = ref('')
const targetTransforms = ref<Record<string, ToothTargetTransform>>({})
const targetPayloadText = ref('No saved target transforms.')

let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let renderer: THREE.WebGLRenderer | null = null
let controls: OrbitControls | null = null
let resizeObserver: ResizeObserver | null = null
let raf = 0
let loadToken = 0
let jawMesh: THREE.Mesh | null = null
let toothTargetGroup: THREE.Group | null = null
let toothMesh: THREE.Mesh | null = null
let currentGeometry: THREE.BufferGeometry | null = null
let currentLabels: number[] = []

function disposeObject(object: THREE.Object3D | null) {
  object?.traverse((child) => {
    const mesh = child as THREE.Mesh
    mesh.geometry?.dispose?.()
    const material = mesh.material
    Array.isArray(material) ? material.forEach((item) => item.dispose()) : material?.dispose?.()
  })
}

function clearObject(object: THREE.Object3D | null) {
  if (!scene || !object) return
  scene.remove(object)
  disposeObject(object)
}

function clearTargetObjects() {
  clearObject(toothTargetGroup)
  toothTargetGroup = null
  toothMesh = null
}

function clearSceneObjects() {
  clearObject(jawMesh)
  clearTargetObjects()
  jawMesh = null
  currentGeometry = null
  currentLabels = []
}

function syncVisibility() {
  if (jawMesh) jawMesh.visible = showJaw.value
  if (toothTargetGroup) toothTargetGroup.visible = showToothMesh.value
}

function createToothMesh(geometry: THREE.BufferGeometry) {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffd166,
    roughness: 0.58,
    metalness: 0.04,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'selected-tooth-mesh'
  mesh.visible = showToothMesh.value
  return mesh
}

function applyTargetTransform(group: THREE.Group, transform: ToothTargetTransform) {
  group.position.fromArray(transform.position)
  group.quaternion.fromArray(transform.quaternion)
  group.scale.fromArray(transform.scale)
}

function updateTargetPayloadText() {
  const payload = serializeToothTargetTransforms(targetTransforms.value, quickTargetPreferences.value)
  targetPayloadText.value = JSON.stringify(payload, null, 2)
}

watch(quickTargetPreferences, updateTargetPayloadText, { deep: true })

function saveQuickTargetPreferences() {
  updateTargetPayloadText()
  quickTargetFeedback.value = '快速目标位偏好已保存'
  statusText.value = '快速目标位偏好已保存'
}

function saveTargetTransform() {
  if (!toothTargetGroup) return
  const transform = createToothTargetTransform(selectedJaw.value, selectedFdi.value, toothTargetGroup)
  targetTransforms.value = upsertToothTargetTransform(targetTransforms.value, transform)
  updateTargetPayloadText()
  statusText.value = `Saved target for FDI ${selectedFdi.value}`
}

function resetTargetTransform() {
  if (!toothTargetGroup) return
  toothTargetGroup.position.set(0, 0, 0)
  toothTargetGroup.quaternion.identity()
  toothTargetGroup.scale.set(1, 1, 1)
  const records = { ...targetTransforms.value }
  delete records[targetKey(selectedJaw.value, selectedFdi.value)]
  targetTransforms.value = records
  updateTargetPayloadText()
  statusText.value = `Reset target for FDI ${selectedFdi.value}`
}

async function exportModifiedJson() {
  const payloadText = JSON.stringify(
    serializeToothTargetTransforms(targetTransforms.value, quickTargetPreferences.value),
    null,
    2,
  )
  targetPayloadText.value = payloadText
  downloadModifiedJson(payloadText)
  await navigator.clipboard?.writeText(payloadText).catch(() => undefined)
  quickTargetFeedback.value = '修改后的 JSON 已导出'
  statusText.value = '修改后的 JSON 已导出'
}

function downloadModifiedJson(payloadText: string) {
  const blob = new Blob([payloadText], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'quick-target-modified.json'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function fitCameraToBox(box: THREE.Box3) {
  if (!camera || !controls) return

  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z, 1)
  const distance = maxDim * 2

  camera.up.set(0, 0, 1)
  camera.position.set(center.x + distance, center.y - distance, center.z + distance * 0.7)
  camera.near = Math.max(distance / 100, 0.1)
  camera.far = distance * 100
  camera.lookAt(center)
  camera.updateProjectionMatrix()

  controls.target.copy(center)
  controls.minDistance = maxDim * 0.04
  controls.maxDistance = maxDim * 24
  controls.update()
}

function refreshSelectedTooth() {
  if (!scene || !currentGeometry) return
  clearTargetObjects()

  const geometry = extractToothMeshGeometry(currentGeometry, currentLabels, selectedFdi.value)
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!position || position.count === 0) {
    geometry.dispose()
    statusText.value = `No complete labeled triangles found for FDI ${selectedFdi.value}`
    return
  }

  toothTargetGroup = new THREE.Group()
  toothTargetGroup.name = `target-${selectedJaw.value}-${selectedFdi.value}`
  toothTargetGroup.visible = showToothMesh.value
  toothMesh = createToothMesh(geometry)
  toothTargetGroup.add(toothMesh)
  const savedTransform = targetTransforms.value[targetKey(selectedJaw.value, selectedFdi.value)]
  if (savedTransform) applyTargetTransform(toothTargetGroup, savedTransform)
  scene.add(toothTargetGroup)
  statusText.value = `FDI ${selectedFdi.value}: ${Math.floor(position.count / 3)} faces`
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`)
  return (await response.json()) as T
}

function loadSTL(url: string): Promise<THREE.BufferGeometry> {
  const loader = new STLLoader()
  return new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject))
}

function setAvailableFdis(labels: number[], defaultFdi: number) {
  availableFdis.value = [
    ...new Set(labels.filter((label) => Number.isFinite(label) && label > 0)),
  ].sort((a, b) => a - b)
  selectedFdi.value = availableFdis.value.includes(defaultFdi)
    ? defaultFdi
    : (availableFdis.value[0] ?? defaultFdi)
}

async function loadSelectedJaw() {
  if (!scene) return
  const token = ++loadToken
  const config = jawConfigs[selectedJaw.value]
  statusText.value = `Loading ${selectedJaw.value} jaw...`
  clearSceneObjects()

  try {
    const [geometry, labelData] = await Promise.all([
      loadSTL(config.stlUrl),
      fetchJson<LabelData>(config.labelsUrl),
    ])
    if (token !== loadToken) {
      geometry.dispose()
      return
    }

    geometry.computeVertexNormals()
    geometry.computeBoundingBox()
    currentGeometry = geometry
    currentLabels = labelData.labels ?? []
    setAvailableFdis(currentLabels, config.defaultFdi)

    const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    if (position && currentLabels.length !== position.count) {
      statusText.value = `Label count ${currentLabels.length} does not match STL vertices ${position.count}`
      return
    }

    jawMesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: config.color,
        roughness: 0.72,
        metalness: 0.05,
        transparent: true,
        opacity: 0.34,
        side: THREE.DoubleSide,
      }),
    )
    jawMesh.visible = showJaw.value
    scene.add(jawMesh)

    const box = geometry.boundingBox?.clone() ?? new THREE.Box3().setFromObject(jawMesh)
    fitCameraToBox(box)
    refreshSelectedTooth()
  } catch (error) {
    console.error(error)
    statusText.value = `Failed to load ${selectedJaw.value} jaw`
  }
}

function render() {
  if (!renderer || !scene || !camera) return
  controls?.update()
  renderer.render(scene, camera)
  raf = window.requestAnimationFrame(render)
}

function resizeRenderer() {
  if (!viewerRef.value || !renderer || !camera) return
  const { clientWidth, clientHeight } = viewerRef.value
  if (!clientWidth || !clientHeight) return
  camera.aspect = clientWidth / clientHeight
  camera.updateProjectionMatrix()
  renderer.setSize(clientWidth, clientHeight, false)
}

function initScene() {
  if (!viewerRef.value) return
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x111318)
  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000)
  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  viewerRef.value.appendChild(renderer.domElement)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true

  scene.add(new THREE.AmbientLight(0xffffff, 0.72))
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.25)
  keyLight.position.set(80, -120, 160)
  scene.add(keyLight)
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.5)
  fillLight.position.set(-120, 80, 80)
  scene.add(fillLight)

  resizeObserver = new ResizeObserver(resizeRenderer)
  resizeObserver.observe(viewerRef.value)
  resizeRenderer()
  render()
}

onMounted(async () => {
  await nextTick()
  initScene()
  updateTargetPayloadText()
  await loadSelectedJaw()
})

onUnmounted(() => {
  window.cancelAnimationFrame(raf)
  resizeObserver?.disconnect()
  controls?.dispose()
  clearSceneObjects()
  renderer?.dispose()
  renderer?.domElement.remove()
  scene = null
  camera = null
  renderer = null
  controls = null
})
</script>

<style scoped>
.direction-stl-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100vh;
  min-height: 0;
  color: #f4f6fb;
  background: #111318;
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 56px;
  padding: 10px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: #191c23;
}
.toolbar-title {
  flex: 0 0 auto;
  font-size: 16px;
  font-weight: 700;
}
.toolbar-actions {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  min-width: 0;
}
.toolbar select {
  height: 34px;
  padding: 0 10px;
  color: #f4f6fb;
  background: #252a33;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 6px;
  outline: none;
}
.toolbar button {
  height: 34px;
  padding: 0 10px;
  color: #f4f6fb;
  background: #252a33;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
}
.toolbar button.active {
  color: #111318;
  background: #ffd166;
  border-color: #ffd166;
}
.toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #cfd5e3;
  font-size: 14px;
  white-space: nowrap;
}
.status {
  min-width: 220px;
  color: #9ea7b8;
  font-size: 13px;
  text-align: right;
  white-space: nowrap;
}
.viewer-shell {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}
.viewer {
  width: 100%;
  height: 100%;
}
.viewer :deep(canvas) {
  display: block;
  width: 100%;
  height: 100%;
}
.quick-target-panel {
  position: absolute;
  top: 16px;
  left: 16px;
  width: min(360px, calc(100% - 32px));
  padding: 18px 24px 22px;
  color: #101828;
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid rgba(16, 24, 40, 0.08);
  border-radius: 8px;
  box-shadow: 0 18px 45px rgba(0, 0, 0, 0.18);
}
.quick-target-panel h2 {
  margin: 0 0 18px;
  padding-bottom: 18px;
  font-size: 16px;
  font-weight: 700;
  border-bottom: 1px solid #edf0f5;
}
.preference-group {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 18px;
  margin-top: 22px;
}
.preference-title {
  grid-column: 1 / -1;
  font-size: 14px;
  font-weight: 700;
}
.preference-group label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: #101828;
  font-size: 14px;
  white-space: nowrap;
}
.preference-group input {
  flex: 0 0 auto;
  margin: 0;
}
.preference-save-button {
  width: 100%;
  height: 36px;
  margin-top: 24px;
  color: #ffffff;
  font-size: 14px;
  font-weight: 700;
  background: #1677ff;
  border: 1px solid #1677ff;
  border-radius: 6px;
  cursor: pointer;
}
.preference-save-button:hover {
  background: #0958d9;
  border-color: #0958d9;
}
.preference-feedback {
  margin-top: 12px;
  padding: 8px 10px;
  color: #0958d9;
  font-size: 13px;
  font-weight: 700;
  background: #e6f4ff;
  border: 1px solid #91caff;
  border-radius: 6px;
}
.target-panel {
  position: absolute;
  right: 16px;
  bottom: 16px;
  width: min(360px, calc(100% - 32px));
  max-height: 240px;
  margin: 0;
  padding: 12px;
  overflow: auto;
  color: #d7deed;
  font-size: 12px;
  line-height: 1.45;
  background: rgba(17, 19, 24, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
}
@media (max-width: 900px) {
  .toolbar {
    align-items: flex-start;
    flex-direction: column;
  }
  .toolbar-actions {
    flex-wrap: wrap;
    justify-content: flex-start;
  }
  .status {
    width: 100%;
    min-width: 0;
    text-align: left;
  }
  .quick-target-panel {
    position: static;
    width: auto;
    margin: 12px;
  }
}
</style>
