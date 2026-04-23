<template>
  <div class="page">
    <div class="toolbar">
      <div class="toolbar-title">STL 复原 JSON 验证</div>
      <div class="toolbar-desc">
        默认显示上颌。你也可以加载刚导出的 JSON，页面会自动根据 `jaw` 选择上颌或下颌 STL 来渲染。
      </div>

      <div class="toolbar-actions">
        <button @click="loadDefaultUpper">恢复默认上颌</button>
        <label class="file-button">
          <input type="file" accept=".json,application/json" @change="onJsonFileChange" />
          加载导出的 JSON
        </label>
      </div>

      <div class="tooth-list" v-if="toothIds.length">
        <span class="tooth-label">牙号：</span>
        <span
          v-for="toothId in toothIds"
          :key="toothId"
          class="tooth-chip"
          :style="{ backgroundColor: colorStyleMap[toothId] }"
        >
          {{ toothId }}
        </span>
      </div>

      <div class="source-line">
        当前来源：{{ sourceLabel }}
      </div>
    </div>

    <div ref="containerRef" class="viewer"></div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import * as THREE from 'three'
import { STLLoader, TrackballControls } from 'three-stdlib'
import { MATERIAL_CONFIG, SCENE_CONFIG } from '@/page/newAnalysis/modelAnalysis/constants'

type JawType = 'upper' | 'lower'

type LabelJson = {
  format?: string
  jaw?: JawType
  version?: number
  toothId?: number
  labels?: number[]
  faceLabels?: number[]
  triangleCount?: number
  vertexCount?: number
  region?: ToothRegionRecord
  teeth?: ToothRegionRecord[]
}

type Point3 = [number, number, number]

type ToothRegionRecord = {
  toothId: number
  contourLoops?: Point3[][]
  rawContourLoops?: Point3[][]
}

const containerRef = ref<HTMLDivElement | null>(null)
const toothIds = ref<number[]>([])
const sourceLabel = ref('默认上颌')
const colorStyleMap = computed<Record<number, string>>(() => {
  const map: Record<number, string> = {}
  toothIds.value.forEach((toothId) => {
    map[toothId] = `#${colorForLabel(toothId).getHexString()}`
  })
  return map
})

let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let renderer: THREE.WebGLRenderer | null = null
let controls: TrackballControls | null = null
let animationId: number | null = null
let resizeHandler: (() => void) | null = null
let activeMesh: THREE.Mesh | null = null
let activeOverlay: THREE.Group | null = null

const upperStlUrl = '/models/upper.stl'
const lowerStlUrl = '/models/lower.stl'
const upperJsonUrl = '/models/upper.json'
const gingivaColor = new THREE.Color(0xc97f88)
const contourColor = new THREE.Color(0xfde68a)

function colorForLabel(label: number): THREE.Color {
  if (!label) return gingivaColor
  const h = (((label * 2654435761) >>> 0) % 360) / 360
  return new THREE.Color().setHSL(h, 0.65, 0.55)
}

function normalizeLabel(value: number): number {
  return Math.max(0, Math.floor(Number(value) || 0))
}

function majorityLabel(a: number, b: number, c: number): number {
  if (a === b || a === c) return a
  if (b === c) return b
  return Math.max(a, b, c)
}

function buildTriangleLabels(geometry: THREE.BufferGeometry, labels: number[]): Uint16Array {
  const position = geometry.attributes.position as THREE.BufferAttribute | undefined
  if (!position) throw new Error('geometry 缺少 position')

  const vertexCount = position.count
  const triCount = geometry.index ? geometry.index.count / 3 : Math.floor(vertexCount / 3)
  const triangleLabels = new Uint16Array(triCount)

  if (labels.length === triCount) {
    for (let tri = 0; tri < triCount; tri++) {
      triangleLabels[tri] = normalizeLabel(labels[tri] ?? 0)
    }
    return triangleLabels
  }

  if (labels.length === vertexCount) {
    for (let tri = 0; tri < triCount; tri++) {
      const ia = geometry.index ? geometry.index.getX(tri * 3) : tri * 3
      const ib = geometry.index ? geometry.index.getX(tri * 3 + 1) : tri * 3 + 1
      const ic = geometry.index ? geometry.index.getX(tri * 3 + 2) : tri * 3 + 2
      triangleLabels[tri] = majorityLabel(
        normalizeLabel(labels[ia] ?? 0),
        normalizeLabel(labels[ib] ?? 0),
        normalizeLabel(labels[ic] ?? 0),
      )
    }
    return triangleLabels
  }

  throw new Error(`labels 与网格不匹配：labels=${labels.length}, 顶点=${vertexCount}, 三角面=${triCount}`)
}

function toRenderGeometry(sourceGeometry: THREE.BufferGeometry) {
  const geometry = sourceGeometry.index ? sourceGeometry.toNonIndexed() : sourceGeometry.clone()
  if (geometry.getAttribute('color')) {
    geometry.deleteAttribute('color')
  }
  geometry.computeVertexNormals()
  return geometry
}

function resolveLabels(payload: LabelJson) {
  if (payload.faceLabels?.length) {
    return payload.faceLabels
  }
  return payload.labels ?? []
}

function loadSTL(url: string): Promise<THREE.BufferGeometry> {
  const loader = new STLLoader()
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject)
  })
}

async function loadLabelJson(url: string): Promise<LabelJson> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`加载 JSON 失败：${response.status}`)
  }
  return (await response.json()) as LabelJson
}

function createPaintGeometry(sourceGeometry: THREE.BufferGeometry, triangleLabels: Uint16Array) {
  const paintGeometry = toRenderGeometry(sourceGeometry)
  const position = paintGeometry.attributes.position as THREE.BufferAttribute | undefined
  if (!position) throw new Error('paint geometry 缺少 position')

  const colors = new Float32Array(position.count * 3)
  for (let tri = 0; tri < triangleLabels.length; tri++) {
    const color = colorForLabel(triangleLabels[tri] ?? 0)
    const base = tri * 9
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

  paintGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return paintGeometry
}

function createMesh(geometry: THREE.BufferGeometry) {
  const material = new THREE.MeshBasicMaterial({
    side: MATERIAL_CONFIG.jaw.side,
    vertexColors: true,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.scale.set(SCENE_CONFIG.modelScale, SCENE_CONFIG.modelScale, SCENE_CONFIG.modelScale)
  return mesh
}

function fitCameraToMesh(mesh: THREE.Mesh) {
  if (!camera || !controls) return

  const box = new THREE.Box3().setFromObject(mesh)
  const center = new THREE.Vector3()
  const size = new THREE.Vector3()
  box.getCenter(center)
  box.getSize(size)

  const distance = Math.max(size.x, size.y, size.z) * 1.8
  controls.target.copy(center)
  camera.position.copy(center.clone().add(new THREE.Vector3(0, distance, 0)))
  camera.up.set(SCENE_CONFIG.cameraUp.x, SCENE_CONFIG.cameraUp.y, SCENE_CONFIG.cameraUp.z)
  camera.lookAt(center)
  controls.update()
}

function clearCurrentMesh() {
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

function clearOverlay() {
  if (!scene || !activeOverlay) return
  scene.remove(activeOverlay)
  activeOverlay.traverse((child) => {
    if (!(child instanceof THREE.Line)) return
    child.geometry.dispose()
    if (Array.isArray(child.material)) {
      child.material.forEach((material) => material.dispose())
    } else {
      child.material.dispose()
    }
  })
  activeOverlay = null
}

function collectContourLoops(payload?: LabelJson) {
  if (!payload) return []
  const regions = payload.region ? [payload.region] : payload.teeth ?? []
  return regions.flatMap((region) => region.contourLoops ?? [])
}

function createContourOverlay(payload?: LabelJson) {
  const loops = collectContourLoops(payload)
  if (!loops.length) return null

  const group = new THREE.Group()
  loops.forEach((loop) => {
    if (loop.length < 2) return
    const points = loop.map(([x, y, z]) => new THREE.Vector3(x, y, z))
    const geometry = new THREE.BufferGeometry().setFromPoints(points)
    const line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({
        color: contourColor,
        transparent: true,
        opacity: 0.95,
      }),
    )
    line.scale.set(SCENE_CONFIG.modelScale, SCENE_CONFIG.modelScale, SCENE_CONFIG.modelScale)
    group.add(line)
  })

  return group.children.length ? group : null
}

async function renderDataset(jaw: JawType, labels: number[], sourceName: string, payload?: LabelJson) {
  if (!scene) return

  clearCurrentMesh()
  clearOverlay()

  const stlUrl = jaw === 'upper' ? upperStlUrl : lowerStlUrl
  const sourceGeometry = await loadSTL(stlUrl)
  const normalizedGeometry = toRenderGeometry(sourceGeometry)
  sourceGeometry.dispose()

  const triangleLabels = buildTriangleLabels(normalizedGeometry, labels)
  const paintGeometry = createPaintGeometry(normalizedGeometry, triangleLabels)
  normalizedGeometry.dispose()
  const mesh = createMesh(paintGeometry)

  toothIds.value = Array.from(new Set(Array.from(triangleLabels).filter((label) => label > 0))).sort(
    (a, b) => a - b,
  )
  sourceLabel.value = sourceName

  scene.add(mesh)
  activeMesh = mesh

  const overlay = createContourOverlay(payload)
  if (overlay) {
    scene.add(overlay)
    activeOverlay = overlay
  }

  fitCameraToMesh(mesh)
}

async function loadDefaultUpper() {
  const data = await loadLabelJson(upperJsonUrl)
  const labels = resolveLabels(data)
  await renderDataset('upper', labels, '默认上颌', data)
}

async function loadJsonPayload(payload: LabelJson, fileName: string) {
  const jaw: JawType = payload.jaw === 'lower' ? 'lower' : 'upper'
  const labels = resolveLabels(payload)
  if (!labels.length) {
    throw new Error('JSON 中没有可用的 labels 或 faceLabels')
  }
  const sourceName = `${fileName}${payload.toothId ? ` / 牙号 ${payload.toothId}` : ''}`
  await renderDataset(jaw, labels, sourceName, payload)
}

async function onJsonFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  try {
    const text = await file.text()
    const payload = JSON.parse(text) as LabelJson
    await loadJsonPayload(payload, file.name)
  } catch (error) {
    window.alert(error instanceof Error ? error.message : 'JSON 读取失败')
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

onMounted(async () => {
  if (!containerRef.value) return

  const container = containerRef.value
  scene = new THREE.Scene()
  scene.background = new THREE.Color(SCENE_CONFIG.background)

  camera = new THREE.PerspectiveCamera(
    SCENE_CONFIG.cameraFov,
    container.clientWidth / container.clientHeight,
    SCENE_CONFIG.cameraNear,
    SCENE_CONFIG.cameraFar,
  )

  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(container.clientWidth, container.clientHeight)
  renderer.setPixelRatio(window.devicePixelRatio)
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

  await loadDefaultUpper()
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

  clearCurrentMesh()
  clearOverlay()

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
})
</script>

<style scoped lang="scss">
.page {
  position: relative;
  height: 90vh;
  background: linear-gradient(180deg, #f8fafc 0%, #eef3f7 100%);
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
  max-width: min(960px, calc(100% - 24px));
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.94);
  border-radius: 12px;
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08);
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

.file-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 12px;
  height: 34px;
  border-radius: 8px;
  background: #f1f5f9;
  color: #0f172a;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid #cbd5e1;
}

.file-button input {
  display: none;
}

.tooth-list {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 10px;
}

.tooth-label {
  font-size: 13px;
  color: #334155;
}

.tooth-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 40px;
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  border-radius: 999px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.2);
}

.source-line {
  margin-top: 8px;
  font-size: 12px;
  color: #64748b;
}
</style>
