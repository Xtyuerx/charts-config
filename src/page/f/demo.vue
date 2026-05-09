<template>
  <div class="page">
    <div class="toolbar">
      <div class="toolbar-title">牙齿 JSON 复原</div>
      <div class="toolbar-desc">
        上传 STL 后先显示粉色牙龈模型，再导入 JSON，按标签给每颗牙齿着不同颜色。
      </div>

      <div class="toolbar-actions">
        <button type="button" @click="openStlFileDialog">上传 STL</button>
        <button type="button" @click="openJsonFileDialog">导入 JSON</button>
      </div>

      <div class="source-line">当前 STL：{{ stlFileName }}</div>
      <div class="source-line">当前 JSON：{{ jsonFileName }}</div>
      <div v-if="statusMessage" class="source-line source-line--hint">
        {{ statusMessage }}
      </div>
    </div>

    <input
      ref="stlFileInputRef"
      class="hidden-file-input"
      type="file"
      accept=".stl,model/stl,application/sla"
      @change="onStlFileChange"
    />

    <input
      ref="jsonFileInputRef"
      class="hidden-file-input"
      type="file"
      accept=".json,application/json"
      @change="onJsonFileChange"
    />

    <div ref="containerRef" class="viewer"></div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import * as THREE from 'three'
import { STLLoader, TrackballControls } from 'three-stdlib'

type LabelJson = {
  jaw?: 'upper' | 'lower'
  toothId?: number
  labels?: number[]
  faceLabels?: number[]
  vertexLabels?: number[]
  data?: unknown
}

const containerRef = ref<HTMLDivElement | null>(null)
const stlFileInputRef = ref<HTMLInputElement | null>(null)
const jsonFileInputRef = ref<HTMLInputElement | null>(null)
const stlFileName = ref('\u672a\u4e0a\u4f20 STL')
const jsonFileName = ref('\u672a\u5bfc\u5165 JSON')
const statusMessage = ref('\u8bf7\u5148\u4e0a\u4f20 STL\uff0c\u518d\u5bfc\u5165 JSON')

let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let renderer: THREE.WebGLRenderer | null = null
let controls: TrackballControls | null = null
let animationId: number | null = null
let resizeHandler: (() => void) | null = null
let activeMesh: THREE.Mesh | null = null
let stlGeometry: THREE.BufferGeometry | null = null
let importedPayload: LabelJson | null = null

const gingivaColor = new THREE.Color(0xc97f88)

function colorForLabel(label: number): THREE.Color {
  if (!label) return gingivaColor
  const hue = (((label * 2654435761) >>> 0) % 360) / 360
  return new THREE.Color().setHSL(hue, 0.68, 0.56)
}

function normalizeLabel(value: number): number {
  return Math.max(0, Math.floor(Number(value) || 0))
}

function openStlFileDialog() {
  stlFileInputRef.value?.click()
}

function openJsonFileDialog() {
  jsonFileInputRef.value?.click()
}

function normalizeImportedPayload(raw: unknown): LabelJson {
  if (Array.isArray(raw)) {
    return { labels: raw }
  }

  if (!raw || typeof raw !== 'object') {
    throw new Error('\u65e0\u6cd5\u8bc6\u522b JSON \u9876\u5c42\u7ed3\u6784')
  }

  const candidate = raw as Record<string, unknown>
  const nestedData = candidate.data

  if (
    nestedData &&
    typeof nestedData === 'object' &&
    !Array.isArray(nestedData) &&
    !Array.isArray(candidate.labels) &&
    !Array.isArray(candidate.faceLabels) &&
    !Array.isArray(candidate.vertexLabels)
  ) {
    return {
      ...(candidate as LabelJson),
      ...(nestedData as LabelJson),
    }
  }

  return candidate as LabelJson
}

function resolveLabels(payload: LabelJson): number[] {
  if (Array.isArray(payload.faceLabels) && payload.faceLabels.length) {
    return payload.faceLabels.map((value) => normalizeLabel(value))
  }
  if (Array.isArray(payload.vertexLabels) && payload.vertexLabels.length) {
    return payload.vertexLabels.map((value) => normalizeLabel(value))
  }
  if (Array.isArray(payload.labels) && payload.labels.length) {
    return payload.labels.map((value) => normalizeLabel(value))
  }
  return []
}

function toRenderGeometry(sourceGeometry: THREE.BufferGeometry) {
  const geometry = sourceGeometry.index ? sourceGeometry.toNonIndexed() : sourceGeometry.clone()
  if (geometry.getAttribute('color')) {
    geometry.deleteAttribute('color')
  }
  return geometry
}

function buildTriangleLabels(geometry: THREE.BufferGeometry, labels: number[]) {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!position) {
    throw new Error('STL missing position attribute')
  }

  const vertexCount = position.count
  const triangleCount = Math.floor(vertexCount / 3)
  const triangleLabels = new Uint16Array(triangleCount)

  if (labels.length === triangleCount) {
    for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
      triangleLabels[triangleIndex] = normalizeLabel(labels[triangleIndex] ?? 0)
    }
    return triangleLabels
  }

  if (labels.length === vertexCount) {
    for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
      const base = triangleIndex * 3
      const a = normalizeLabel(labels[base] ?? 0)
      const b = normalizeLabel(labels[base + 1] ?? 0)
      const c = normalizeLabel(labels[base + 2] ?? 0)
      triangleLabels[triangleIndex] = a === b || a === c ? a : b === c ? b : Math.max(a, b, c)
    }
    return triangleLabels
  }

  const triangleDistance = Math.abs(labels.length - triangleCount)
  const vertexDistance = Math.abs(labels.length - vertexCount)

  if (vertexDistance <= triangleDistance && labels.length >= 3) {
    const usableTriangleCount = Math.min(Math.floor(labels.length / 3), triangleCount)
    for (let triangleIndex = 0; triangleIndex < usableTriangleCount; triangleIndex += 1) {
      const base = triangleIndex * 3
      const a = normalizeLabel(labels[base] ?? 0)
      const b = normalizeLabel(labels[base + 1] ?? 0)
      const c = normalizeLabel(labels[base + 2] ?? 0)
      triangleLabels[triangleIndex] = a === b || a === c ? a : b === c ? b : Math.max(a, b, c)
    }
    return triangleLabels
  }

  const usableTriangleCount = Math.min(labels.length, triangleCount)
  for (let triangleIndex = 0; triangleIndex < usableTriangleCount; triangleIndex += 1) {
    triangleLabels[triangleIndex] = normalizeLabel(labels[triangleIndex] ?? 0)
  }

  return triangleLabels
}

function createColoredGeometry(sourceGeometry: THREE.BufferGeometry, labels: number[] = []) {
  const geometry = toRenderGeometry(sourceGeometry)
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!position) {
    throw new Error('STL missing position attribute')
  }

  const triangleLabels = labels.length ? buildTriangleLabels(geometry, labels) : null
  const colors = new Float32Array(position.count * 3)
  const triangleCount = Math.floor(position.count / 3)

  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
    const color = colorForLabel(triangleLabels?.[triangleIndex] ?? 0)
    const base = triangleIndex * 9

    colors[base] = color.r
    colors[base + 1] = color.g
    colors[base + 2] = color.b
    colors[base + 3] = color.r
    colors[base + 4] = color.g
    colors[base + 5] = color.b
    colors[base + 6] = color.r
    colors[base + 7] = color.g
    colors[base + 8] = color.b
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}

function createMesh(geometry: THREE.BufferGeometry) {
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.scale.setScalar(1)
  return mesh
}

function disposeActiveMesh() {
  if (!scene || !activeMesh) return

  scene.remove(activeMesh)
  activeMesh.geometry.dispose()

  if (Array.isArray(activeMesh.material)) {
    activeMesh.material.forEach((material) => material.dispose())
  } else {
    activeMesh.material.dispose()
  }

  activeMesh = null
}

function fitCameraToObject(object: THREE.Object3D) {
  if (!camera || !controls) return

  const box = new THREE.Box3().setFromObject(object)
  const center = new THREE.Vector3()
  const size = new THREE.Vector3()
  box.getCenter(center)
  box.getSize(size)

  const distance = Math.max(size.x, size.y, size.z, 1) * 1.8
  controls.target.copy(center)
  camera.position.copy(center.clone().add(new THREE.Vector3(0, distance, 0)))
  camera.up.set(0, 0, -1)
  camera.lookAt(center)
  controls.update()
}

async function loadSTLFromFile(file: File) {
  const loader = new STLLoader()
  return loader.parse(await file.arrayBuffer())
}

function renderCurrentModel() {
  if (!scene || !stlGeometry) return

  disposeActiveMesh()

  const labels = importedPayload ? resolveLabels(importedPayload) : []
  const renderGeometry = createColoredGeometry(stlGeometry, labels)
  const mesh = createMesh(renderGeometry)

  scene.add(mesh)
  activeMesh = mesh
  fitCameraToObject(mesh)

  if (labels.length) {
    statusMessage.value = `${jsonFileName.value} \u5df2\u5b8c\u6210\u590d\u539f\u7740\u8272`
  } else {
    statusMessage.value = 'STL \u5df2\u52a0\u8f7d\uff0c\u5f53\u524d\u663e\u793a\u7c89\u8272\u7259\u9f88\u9884\u89c8'
  }
}

async function onStlFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  try {
    stlGeometry?.dispose()
    stlGeometry = await loadSTLFromFile(file)
    stlFileName.value = file.name
    renderCurrentModel()
  } catch (error) {
    window.alert(error instanceof Error ? error.message : 'STL load failed')
    statusMessage.value = 'STL \u8bfb\u53d6\u5931\u8d25'
  } finally {
    input.value = ''
  }
}

async function onJsonFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  try {
    const text = await file.text()
    importedPayload = normalizeImportedPayload(JSON.parse(text))
    jsonFileName.value = file.name

    if (!stlGeometry) {
      statusMessage.value = 'JSON \u5df2\u8bfb\u53d6\uff0c\u8bf7\u5148\u4e0a\u4f20\u5bf9\u5e94 STL'
      return
    }

    renderCurrentModel()
  } catch (error) {
    window.alert(error instanceof Error ? error.message : 'JSON load failed')
    statusMessage.value = 'JSON \u5bfc\u5165\u5931\u8d25'
  } finally {
    input.value = ''
  }
}

function startRenderLoop() {
  if (!scene || !camera || !renderer || !controls) return

  const renderFrame = () => {
    if (!scene || !camera || !renderer || !controls) return
    animationId = requestAnimationFrame(renderFrame)
    controls.update()
    renderer.render(scene, camera)
  }

  renderFrame()
}

function stopRenderLoop() {
  if (animationId != null) {
    cancelAnimationFrame(animationId)
    animationId = null
  }
}

onMounted(() => {
  if (!containerRef.value) return

  const container = containerRef.value

  scene = new THREE.Scene()
  scene.background = new THREE.Color(0xf5f5f4)

  camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 5000)

  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(container.clientWidth, container.clientHeight)
  container.appendChild(renderer.domElement)

  controls = new TrackballControls(camera, renderer.domElement)
  controls.rotateSpeed = 4
  controls.zoomSpeed = 1.2
  controls.panSpeed = 0.8
  controls.staticMoving = true
  controls.dynamicDampingFactor = 0.15

  resizeHandler = () => {
    if (!camera || !renderer) return
    const width = container.clientWidth
    const height = container.clientHeight
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    renderer.setSize(width, height)
  }

  window.addEventListener('resize', resizeHandler)
  startRenderLoop()
})

onUnmounted(() => {
  stopRenderLoop()

  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler)
    resizeHandler = null
  }

  controls?.dispose()
  controls = null

  disposeActiveMesh()
  stlGeometry?.dispose()
  stlGeometry = null

  if (scene) {
    scene.clear()
  }

  if (renderer) {
    renderer.dispose()
    renderer.domElement.remove()
  }

  renderer = null
  camera = null
  scene = null
  importedPayload = null
})
</script>

<style scoped lang="scss">
.page {
  position: relative;
  height: 90vh;
  background: linear-gradient(180deg, #fafaf9 0%, #f1f5f9 100%);
}

.viewer {
  width: 100%;
  height: 100%;
}

.toolbar {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 10;
  max-width: min(520px, calc(100% - 24px));
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
}

.toolbar-title {
  font-size: 16px;
  font-weight: 600;
  color: #0f172a;
}

.toolbar-desc {
  margin-top: 6px;
  font-size: 13px;
  line-height: 1.5;
  color: #475569;
}

.toolbar-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 10px;
}

.toolbar-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 34px;
  padding: 0 12px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #f8fafc;
  color: #0f172a;
  font-size: 13px;
  cursor: pointer;
  appearance: none;
}

.toolbar-actions button:hover {
  background: #f1f5f9;
}

.hidden-file-input {
  display: none;
}

.source-line {
  margin-top: 8px;
  font-size: 12px;
  color: #64748b;
}

.source-line--hint {
  color: #0f766e;
}
</style>
