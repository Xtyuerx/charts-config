<template>
  <div class="axis-page">
    <header class="page-toolbar">
      <h1>牙轴调整</h1>
      <div class="toolbar-fields">
        <label>
          <span>牙颌</span>
          <select v-model="selectedJaw" @change="loadSelectedJaw">
            <option value="upper">上颌</option>
            <option value="lower">下颌</option>
          </select>
        </label>
        <label>
          <span>牙位</span>
          <select v-model.number="selectedFdi" @change="refreshSelectedTooth">
            <option v-for="fdi in availableFdis" :key="fdi" :value="fdi">{{ fdi }}</option>
          </select>
        </label>
        <span class="status" role="status">{{ statusText }}</span>
      </div>
    </header>

    <main class="axis-workspace" data-testid="tooth-axis-workspace">
      <aside class="slice-panel" aria-label="牙齿切片视图">
        <SliceViewport
          v-for="panel in viewPanels"
          :key="panel.view"
          :title="`${panel.label}牙位 ${selectedFdi}`"
          :geometry="panel.geometry"
          :pose="panel.pose"
          :view="panel.view"
          :revision="panel.revision"
          :horizontal-color="panel.horizontalColor"
          :vertical-color="panel.verticalColor"
        />
      </aside>

      <section class="scene-panel" aria-label="牙轴三维场景">
        <div ref="sceneRef" class="axis-scene" data-testid="main-scene"></div>
        <div class="scene-badge">牙位 {{ selectedFdi }}</div>
      </section>

      <aside class="control-panel" aria-label="牙轴参数">
        <div class="control-heading">
          <div>
            <span class="eyebrow">{{ selectedJaw === 'upper' ? '上颌' : '下颌' }}</span>
            <h2>牙位 {{ selectedFdi }}</h2>
          </div>
          <span class="saved-count">已保存 {{ savedCount }}</span>
        </div>

        <section class="control-section">
          <h3>操作模式</h3>
          <div class="mode-switch" role="group" aria-label="牙轴操作模式">
            <button
              type="button"
              :aria-pressed="transformMode === 'translate'"
              :class="{ active: transformMode === 'translate' }"
              @click="setTransformMode('translate')"
            >
              移动牙轴
            </button>
            <button
              type="button"
              :aria-pressed="transformMode === 'rotate'"
              :class="{ active: transformMode === 'rotate' }"
              @click="setTransformMode('rotate')"
            >
              旋转牙轴
            </button>
          </div>
        </section>

        <section class="control-section">
          <h3>轴心位置</h3>
          <label v-for="axis in coordinateAxes" :key="`position-${axis.name}`" class="value-row">
            <span class="axis-swatch" :style="{ backgroundColor: axis.color }"></span>
            <span>{{ axis.label }}</span>
            <input
              type="number"
              step="0.1"
              :value="axisReadout.position[axis.name].toFixed(2)"
              @change="setPositionCoordinate(axis.name, $event)"
            />
            <span class="unit">mm</span>
          </label>
        </section>

        <section class="control-section">
          <h3>轴向旋转</h3>
          <label v-for="axis in coordinateAxes" :key="`rotation-${axis.name}`" class="value-row">
            <span class="axis-swatch ring" :style="{ borderColor: axis.color }"></span>
            <span>{{ axis.label }}</span>
            <input
              type="number"
              step="1"
              :value="axisReadout.rotation[axis.name].toFixed(1)"
              @change="setRotationCoordinate(axis.name, $event)"
            />
            <span class="unit">deg</span>
          </label>
        </section>

        <div class="panel-actions">
          <button type="button" class="secondary" @click="resetCurrentAxis">重置</button>
          <button type="button" class="primary" @click="saveCurrentAxis">保存牙轴</button>
        </div>
      </aside>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { STLLoader } from 'three-stdlib'
import SliceViewport from './components/SliceViewport.vue'
import { type SliceView, type ToothAxisPose } from './utils/toothSliceUtils'
import {
  computeAutomaticToothAxis,
  extractToothMeshGeometry,
} from '../directionStl/utils/toothAxisUtils'

type JawName = 'upper' | 'lower'
type TransformMode = 'translate' | 'rotate'
type CoordinateAxis = 'x' | 'y' | 'z'
type LabelData = { labels?: number[] }
type JawConfig = { stlUrl: string; labelsUrl: string; color: number; defaultFdi: number }
type StoredPose = {
  origin: [number, number, number]
  quaternion: [number, number, number, number]
}

const jawConfigs: Record<JawName, JawConfig> = {
  upper: {
    stlUrl: '/models/upper.stl',
    labelsUrl: '/models/upper.json',
    color: 0xd8ddd5,
    defaultFdi: 11,
  },
  lower: {
    stlUrl: '/models/lower.stl',
    labelsUrl: '/models/lower.json',
    color: 0xd2dce5,
    defaultFdi: 31,
  },
}

const panelDefinitions: Array<{
  view: SliceView
  label: string
  horizontalColor: string
  verticalColor: string
}> = [
  { view: 'front', label: '前视图', horizontalColor: '#d85353', verticalColor: '#4096ff' },
  { view: 'side', label: '侧视图', horizontalColor: '#52a447', verticalColor: '#4096ff' },
  { view: 'top', label: '顶视图', horizontalColor: '#d85353', verticalColor: '#52a447' },
]

const coordinateAxes: Array<{ name: CoordinateAxis; label: string; color: string }> = [
  { name: 'x', label: 'X', color: '#d85353' },
  { name: 'y', label: 'Y', color: '#52a447' },
  { name: 'z', label: 'Z', color: '#4096ff' },
]

const sceneRef = ref<HTMLDivElement | null>(null)
const selectedJaw = ref<JawName>('upper')
const selectedFdi = ref(11)
const availableFdis = ref<number[]>([])
const transformMode = ref<TransformMode>('translate')
const statusText = ref('准备就绪')
const poseRevision = ref(0)
const savedCount = ref(0)

let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let renderer: THREE.WebGLRenderer | null = null
let orbitControls: OrbitControls | null = null
let transformControls: TransformControls | null = null
let transformHelper: THREE.Object3D | null = null
let resizeObserver: ResizeObserver | null = null
let animationFrame = 0
let loadToken = 0
let currentGeometry: THREE.BufferGeometry | null = null
let currentLabels: number[] = []
let jawMesh: THREE.Mesh | null = null
let toothGeometry: THREE.BufferGeometry | null = null
let toothMesh: THREE.Mesh | null = null
let axisPivot: THREE.Group | null = null
const poseRecords: Record<string, StoredPose> = {}
const savedKeys = new Set<string>()

const axisReadout = computed(() => {
  void poseRevision.value
  const position = axisPivot?.position ?? new THREE.Vector3()
  const euler = axisPivot
    ? new THREE.Euler().setFromQuaternion(axisPivot.quaternion, 'XYZ')
    : new THREE.Euler()
  return {
    position: { x: position.x, y: position.y, z: position.z },
    rotation: {
      x: THREE.MathUtils.radToDeg(euler.x),
      y: THREE.MathUtils.radToDeg(euler.y),
      z: THREE.MathUtils.radToDeg(euler.z),
    },
  }
})

const viewPanels = computed(() => {
  void poseRevision.value
  const pose: ToothAxisPose | null = axisPivot
    ? {
        origin: axisPivot.position.clone(),
        quaternion: axisPivot.quaternion.clone(),
      }
    : null

  return panelDefinitions.map((definition) => ({
    ...definition,
    geometry: toothGeometry,
    pose,
    revision: poseRevision.value,
  }))
})

function poseKey() {
  return `${selectedJaw.value}-${selectedFdi.value}`
}

function storeCurrentPose() {
  if (!axisPivot) return
  poseRecords[poseKey()] = {
    origin: axisPivot.position.toArray(),
    quaternion: axisPivot.quaternion.toArray(),
  }
}

function notifyPoseChanged() {
  axisPivot?.updateMatrixWorld(true)
  storeCurrentPose()
  poseRevision.value += 1
}

function removeMesh(mesh: THREE.Mesh | null, disposeGeometry: boolean) {
  if (!mesh || !scene) return
  scene.remove(mesh)
  if (disposeGeometry) mesh.geometry.dispose()
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  materials.forEach((material) => material.dispose())
}

function disposeGroup(group: THREE.Group | null) {
  if (!group || !scene) return
  scene.remove(group)
  group.traverse((child) => {
    const renderable = child as THREE.Mesh
    renderable.geometry?.dispose?.()
    const material = renderable.material
    if (Array.isArray(material)) material.forEach((item) => item.dispose())
    else material?.dispose?.()
  })
}

function clearSelectedTooth() {
  transformControls?.detach()
  removeMesh(toothMesh, true)
  disposeGroup(axisPivot)
  toothMesh = null
  toothGeometry = null
  axisPivot = null
  poseRevision.value += 1
}

function clearJaw() {
  clearSelectedTooth()
  removeMesh(jawMesh, true)
  jawMesh = null
  currentGeometry = null
  currentLabels = []
}

function createAutomaticPose(geometry: THREE.BufferGeometry): ToothAxisPose {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const points: THREE.Vector3[] = []
  for (let index = 0; index < position.count; index += 1) {
    points.push(new THREE.Vector3().fromBufferAttribute(position, index))
  }

  const axis = computeAutomaticToothAxis(points)
  const matrix = new THREE.Matrix4().makeBasis(
    axis.axes.x.direction,
    axis.axes.y.direction,
    axis.axes.z.direction,
  )
  return {
    origin: axis.origin.clone(),
    quaternion: new THREE.Quaternion().setFromRotationMatrix(matrix).normalize(),
  }
}

function getPoseForCurrentTooth(geometry: THREE.BufferGeometry): ToothAxisPose {
  const stored = poseRecords[poseKey()]
  if (!stored) return createAutomaticPose(geometry)
  return {
    origin: new THREE.Vector3().fromArray(stored.origin),
    quaternion: new THREE.Quaternion().fromArray(stored.quaternion),
  }
}

function createAxisVisual(axisLength: number) {
  const group = new THREE.Group()
  const headLength = Math.max(axisLength * 0.18, 0.6)
  const headWidth = Math.max(axisLength * 0.09, 0.3)
  group.add(
    new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), axisLength, 0xd85353, headLength, headWidth),
    new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), axisLength, 0x52a447, headLength, headWidth),
    new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), axisLength, 0x4096ff, headLength, headWidth),
  )
  const center = new THREE.Mesh(
    new THREE.SphereGeometry(Math.max(axisLength * 0.045, 0.18), 18, 12),
    new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }),
  )
  center.renderOrder = 20
  group.add(center)
  return group
}

function refreshSelectedTooth() {
  if (!scene || !currentGeometry) return
  clearSelectedTooth()

  toothGeometry = extractToothMeshGeometry(currentGeometry, currentLabels, selectedFdi.value)
  const position = toothGeometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!position || position.count === 0) {
    toothGeometry.dispose()
    toothGeometry = null
    statusText.value = `牙位 ${selectedFdi.value} 没有可用网格`
    return
  }

  toothMesh = new THREE.Mesh(
    toothGeometry,
    new THREE.MeshStandardMaterial({
      color: 0xffd166,
      roughness: 0.62,
      metalness: 0.02,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    }),
  )
  scene.add(toothMesh)

  const pose = getPoseForCurrentTooth(toothGeometry)
  const box = toothGeometry.boundingBox ?? new THREE.Box3().setFromBufferAttribute(position)
  const size = box.getSize(new THREE.Vector3())
  const axisLength = Math.max(size.x, size.y, size.z) * 0.72
  axisPivot = new THREE.Group()
  axisPivot.name = `tooth-axis-${selectedJaw.value}-${selectedFdi.value}`
  axisPivot.position.copy(pose.origin)
  axisPivot.quaternion.copy(pose.quaternion)
  axisPivot.add(createAxisVisual(axisLength))
  scene.add(axisPivot)
  transformControls?.attach(axisPivot)
  notifyPoseChanged()
  statusText.value = `牙位 ${selectedFdi.value} · ${Math.floor(position.count / 3)} 个三角面`
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`)
  return (await response.json()) as T
}

function loadStl(url: string): Promise<THREE.BufferGeometry> {
  const loader = new STLLoader()
  return new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject))
}

function fitCamera(box: THREE.Box3) {
  if (!camera || !orbitControls) return
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  const maxDimension = Math.max(size.x, size.y, size.z, 1)
  const distance = maxDimension * 1.65
  camera.up.set(0, 0, 1)
  camera.position.set(center.x, center.y - distance, center.z + distance * 0.28)
  camera.near = Math.max(distance / 200, 0.05)
  camera.far = distance * 50
  camera.lookAt(center)
  camera.updateProjectionMatrix()
  orbitControls.target.copy(center)
  orbitControls.update()
}

async function loadSelectedJaw() {
  if (!scene) return
  const token = ++loadToken
  const config = jawConfigs[selectedJaw.value]
  statusText.value = '正在加载牙颌模型…'
  clearJaw()

  try {
    const [geometry, labelData] = await Promise.all([
      loadStl(config.stlUrl),
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
    availableFdis.value = [
      ...new Set(currentLabels.filter((label) => Number.isFinite(label) && label > 0)),
    ].sort((first, second) => first - second)
    selectedFdi.value = availableFdis.value.includes(config.defaultFdi)
      ? config.defaultFdi
      : (availableFdis.value[0] ?? config.defaultFdi)

    jawMesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: config.color,
        roughness: 0.78,
        metalness: 0.02,
        transparent: true,
        opacity: 0.54,
        side: THREE.DoubleSide,
      }),
    )
    scene.add(jawMesh)
    fitCamera(geometry.boundingBox ?? new THREE.Box3().setFromObject(jawMesh))
    refreshSelectedTooth()
  } catch (error) {
    console.error(error)
    statusText.value = '牙颌模型加载失败'
  }
}

function setTransformMode(mode: TransformMode) {
  transformMode.value = mode
  transformControls?.setMode(mode)
  transformControls?.setSpace('local')
}

function resetCurrentAxis() {
  if (!axisPivot || !toothGeometry) return
  const pose = createAutomaticPose(toothGeometry)
  axisPivot.position.copy(pose.origin)
  axisPivot.quaternion.copy(pose.quaternion)
  notifyPoseChanged()
  statusText.value = `牙位 ${selectedFdi.value} 已重置`
}

function saveCurrentAxis() {
  if (!axisPivot) return
  storeCurrentPose()
  savedKeys.add(poseKey())
  savedCount.value = savedKeys.size
  statusText.value = `牙位 ${selectedFdi.value} 牙轴已保存`
}

function readNumber(event: Event) {
  return Number((event.target as HTMLInputElement).value)
}

function setPositionCoordinate(axis: CoordinateAxis, event: Event) {
  if (!axisPivot) return
  const value = readNumber(event)
  if (!Number.isFinite(value)) return
  axisPivot.position[axis] = value
  notifyPoseChanged()
}

function setRotationCoordinate(axis: CoordinateAxis, event: Event) {
  if (!axisPivot) return
  const value = readNumber(event)
  if (!Number.isFinite(value)) return
  const euler = new THREE.Euler().setFromQuaternion(axisPivot.quaternion, 'XYZ')
  euler[axis] = THREE.MathUtils.degToRad(value)
  axisPivot.quaternion.setFromEuler(euler)
  notifyPoseChanged()
}

function resizeScene() {
  if (!sceneRef.value || !renderer || !camera) return
  const width = sceneRef.value.clientWidth
  const height = sceneRef.value.clientHeight
  if (!width || !height) return
  renderer.setSize(width, height, false)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
}

function render() {
  if (!renderer || !scene || !camera) return
  orbitControls?.update()
  renderer.render(scene, camera)
  animationFrame = window.requestAnimationFrame(render)
}

function initScene() {
  if (!sceneRef.value) return
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0xf4f6f8)
  camera = new THREE.PerspectiveCamera(38, 1, 0.1, 10000)
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  sceneRef.value.appendChild(renderer.domElement)

  orbitControls = new OrbitControls(camera, renderer.domElement)
  orbitControls.enableDamping = true
  orbitControls.dampingFactor = 0.08

  transformControls = new TransformControls(camera, renderer.domElement)
  transformControls.setMode(transformMode.value)
  transformControls.setSpace('local')
  transformControls.setSize(0.82)
  transformControls.addEventListener('dragging-changed', (event) => {
    if (orbitControls) orbitControls.enabled = !event.value
  })
  transformControls.addEventListener('objectChange', notifyPoseChanged)
  transformHelper = transformControls.getHelper()
  scene.add(transformHelper)

  scene.add(new THREE.HemisphereLight(0xffffff, 0x9ba5b4, 2.25))
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.1)
  keyLight.position.set(70, -100, 140)
  scene.add(keyLight)
  const fillLight = new THREE.DirectionalLight(0xdde8ff, 1.1)
  fillLight.position.set(-100, 60, 80)
  scene.add(fillLight)

  resizeObserver = new ResizeObserver(resizeScene)
  resizeObserver.observe(sceneRef.value)
  resizeScene()
  render()
}

onMounted(async () => {
  await nextTick()
  initScene()
  await loadSelectedJaw()
})

onUnmounted(() => {
  window.cancelAnimationFrame(animationFrame)
  resizeObserver?.disconnect()
  transformControls?.detach()
  transformControls?.dispose()
  if (scene && transformHelper) scene.remove(transformHelper)
  orbitControls?.dispose()
  clearJaw()
  renderer?.dispose()
  renderer?.domElement.remove()
  scene = null
  camera = null
  renderer = null
  orbitControls = null
  transformControls = null
  transformHelper = null
})
</script>

<style scoped>
.axis-page {
  display: grid;
  grid-template-rows: 64px minmax(0, 1fr);
  width: 100%;
  height: 100vh;
  min-height: 0;
  color: #242830;
  background: #eef1f5;
}

.page-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 0 20px;
  background: #ffffff;
  border-bottom: 1px solid #dfe3ea;
}

.page-toolbar h1 {
  margin: 0;
  font-size: 20px;
  line-height: 1;
  letter-spacing: 0;
}

.toolbar-fields {
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
}

.toolbar-fields label {
  display: flex;
  align-items: center;
  gap: 7px;
  color: #5c6470;
  font-size: 13px;
}

.toolbar-fields select {
  min-width: 90px;
  height: 34px;
  padding: 0 28px 0 10px;
  color: #242830;
  background: #ffffff;
  border: 1px solid #cfd5de;
  border-radius: 5px;
}

.status {
  width: 240px;
  overflow: hidden;
  color: #69717d;
  font-size: 12px;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.axis-workspace {
  display: grid;
  grid-template-columns: 226px minmax(0, 1fr) 300px;
  min-height: 0;
  overflow: hidden;
}

.slice-panel {
  display: grid;
  grid-template-rows: repeat(3, minmax(0, 1fr));
  gap: 12px;
  min-height: 0;
  padding: 14px;
  background: #f7f8fa;
  border-right: 1px solid #dfe3ea;
}

.scene-panel {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.axis-scene,
.axis-scene :deep(canvas) {
  display: block;
  width: 100%;
  height: 100%;
}

.scene-badge {
  position: absolute;
  top: 14px;
  left: 14px;
  padding: 6px 9px;
  color: #3d4652;
  font-size: 12px;
  font-weight: 600;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(207, 213, 222, 0.92);
  border-radius: 5px;
  pointer-events: none;
}

.control-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  background: #ffffff;
  border-left: 1px solid #dfe3ea;
}

.control-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 20px;
  border-bottom: 1px solid #e8ebf0;
}

.eyebrow {
  display: block;
  margin-bottom: 4px;
  color: #7b8491;
  font-size: 12px;
}

.control-heading h2 {
  margin: 0;
  font-size: 18px;
  letter-spacing: 0;
}

.saved-count {
  color: #1677ff;
  font-size: 12px;
  white-space: nowrap;
}

.control-section {
  padding: 18px 20px;
  border-bottom: 1px solid #edf0f4;
}

.control-section h3 {
  margin: 0 0 14px;
  color: #3c424b;
  font-size: 13px;
  letter-spacing: 0;
}

.mode-switch {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  padding: 3px;
  background: #eef1f5;
  border-radius: 6px;
}

.mode-switch button {
  height: 34px;
  color: #646d79;
  font-size: 13px;
  background: transparent;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
}

.mode-switch button.active {
  color: #1668dc;
  font-weight: 600;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(30, 42, 60, 0.12);
}

.value-row {
  display: grid;
  grid-template-columns: 12px 18px minmax(0, 1fr) 32px;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  color: #535b67;
  font-size: 12px;
}

.axis-swatch {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.axis-swatch.ring {
  background: transparent;
  border: 2px solid;
}

.value-row input {
  width: 100%;
  min-width: 0;
  height: 30px;
  padding: 0 8px;
  color: #2d333b;
  font-variant-numeric: tabular-nums;
  text-align: right;
  background: #fafbfc;
  border: 1px solid #d7dce4;
  border-radius: 4px;
  box-sizing: border-box;
}

.unit {
  color: #939aa5;
  text-align: left;
}

.panel-actions {
  display: grid;
  grid-template-columns: 1fr 1.35fr;
  gap: 10px;
  margin-top: auto;
  padding: 18px 20px;
  border-top: 1px solid #e8ebf0;
}

.panel-actions button {
  height: 38px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 5px;
  cursor: pointer;
}

.panel-actions .secondary {
  color: #4d5561;
  background: #ffffff;
  border: 1px solid #cfd5de;
}

.panel-actions .primary {
  color: #ffffff;
  background: #1677ff;
  border: 1px solid #1677ff;
}

@media (max-width: 980px) {
  .axis-workspace {
    grid-template-columns: 190px minmax(0, 1fr) 260px;
  }

  .status {
    display: none;
  }
}

@media (max-width: 760px) {
  .axis-page {
    display: block;
    height: auto;
    min-height: 100vh;
    grid-template-rows: auto minmax(0, 1fr);
  }

  .page-toolbar {
    align-items: flex-start;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
  }

  .toolbar-fields {
    width: 100%;
    flex-wrap: wrap;
  }

  .axis-workspace {
    grid-template-columns: 128px minmax(0, 1fr);
    grid-template-rows: minmax(620px, calc(100vh - 112px)) auto;
    overflow: visible;
  }

  .control-panel {
    grid-column: 1 / -1;
    grid-row: 2;
    max-height: none;
    overflow: visible;
    border-top: 1px solid #dfe3ea;
    border-left: 0;
  }

  .slice-panel {
    gap: 8px;
    padding: 8px;
  }
}
</style>
