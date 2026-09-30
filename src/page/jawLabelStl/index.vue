<template>
  <main class="jaw-label-page">
    <header class="toolbar">
      <h1>上下颌牙号着色</h1>
      <label><input v-model="showUpper" type="checkbox" @change="syncVisibility" />显示上颌</label>
      <label><input v-model="showLower" type="checkbox" @change="syncVisibility" />显示下颌</label>
      <button type="button" @click="resetView">重置视角</button>
      <span class="help">拖动旋转 · 滚轮缩放 · 右键平移</span>
    </header>
    <form class="local-import" @submit.prevent="importLocalJaw">
      <strong>导入本地数据</strong>
      <label
        >导入位置
        <select v-model="localJaw" :disabled="loading">
          <option value="upper">上颌</option>
          <option value="lower">下颌</option>
        </select>
      </label>
      <label
        >STL 文件<input
          type="file"
          accept=".stl"
          :disabled="loading"
          @change="selectFile('stl', $event)"
      /></label>
      <label
        >JSON 文件<input
          type="file"
          accept=".json"
          :disabled="loading"
          @change="selectFile('json', $event)"
      /></label>
      <button type="submit" :disabled="loading || !ready || !localStl || !localJson">
        {{ loading ? '加载中…' : '加载本地数据' }}
      </button>
      <span class="help">JSON 需包含与 STL 顶点逐一对应的 labels 数组；文件仅在本地读取。</span>
    </form>
    <p role="status" :class="{ error: hasError }">{{ status }}</p>
    <div ref="viewport" class="viewport" aria-label="上下颌三维模型"></div>
    <aside class="legend" aria-label="牙号颜色图例">
      <span v-for="item in legend" :key="item.label" class="legend-item">
        <i :style="{ backgroundColor: item.color }"></i>
        {{ item.label === 0 ? '0 · 牙龈' : `牙号 ${item.label}` }}
      </span>
    </aside>
  </main>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import * as THREE from 'three'
import { OrbitControls, STLLoader } from 'three-stdlib'

type Jaw = 'upper' | 'lower'
type JawMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>

const viewport = ref<HTMLDivElement | null>(null)
const showUpper = ref(true)
const showLower = ref(true)
const status = ref('正在加载上下颌 STL 和牙号数据…')
const hasError = ref(false)
const legend = ref<{ label: number; color: string }[]>([])
const localJaw = ref<Jaw>('upper')
const localStl = ref<File | null>(null)
const localJson = ref<File | null>(null)
const loading = ref(true)
const ready = ref(false)
const meshLabels: Partial<Record<Jaw, Set<number>>> = {}
const meshes: Partial<Record<Jaw, JawMesh>> = {}
const colors = new Map<number, THREE.Color>()
const abortController = new AbortController()
const modelBounds = new THREE.Box3()
let renderer: THREE.WebGLRenderer | undefined
let scene: THREE.Scene | undefined
let camera: THREE.PerspectiveCamera | undefined
let controls: OrbitControls | undefined
let resizeObserver: ResizeObserver | undefined
let disposed = false

function colorForLabel(label: number): THREE.Color {
  let color = colors.get(label)
  if (!color) {
    // 固定牙号对应固定颜色，上下颌共享映射；0 专用于牙龈。
    color =
      label === 0
        ? new THREE.Color('#ce8795')
        : new THREE.Color().setHSL((label * 0.618033988749895) % 1, 0.7, 0.52)
    colors.set(label, color)
  }
  return color
}

async function loadJaw(jaw: Jaw): Promise<JawMesh> {
  const base = `${import.meta.env.BASE_URL}models/${jaw}`
  const [stlResponse, jsonResponse] = await Promise.all([
    fetch(`${base}.stl`, { signal: abortController.signal }),
    fetch(`${base}.json`, { signal: abortController.signal }),
  ])
  if (!stlResponse.ok || !jsonResponse.ok) {
    throw new Error(
      `${jaw === 'upper' ? '上颌' : '下颌'}文件加载失败（STL ${stlResponse.status} / JSON ${jsonResponse.status}）`,
    )
  }
  const [buffer, payload] = await Promise.all([stlResponse.arrayBuffer(), jsonResponse.json()])
  return createJawMesh(jaw, buffer, payload)
}

function createJawMesh(jaw: Jaw, buffer: ArrayBuffer, payload: unknown): JawMesh {
  const geometry = new STLLoader().parse(buffer)
  try {
    const positions = geometry.getAttribute('position')
    const vertexCount = positions?.count ?? 0
    if (!vertexCount || vertexCount % 3 !== 0 || !positions.array.every(Number.isFinite)) {
      throw new Error('STL 文件没有有效的三角形顶点数据')
    }
    const labels: unknown =
      payload && typeof payload === 'object' && 'labels' in payload ? payload.labels : undefined
    // 对应文件中的 labels 已展开为 STL 的独立三角形顶点，不能焊接或重排顶点。
    if (!Array.isArray(labels) || labels.length !== vertexCount) {
      throw new Error(
        `${jaw} JSON labels 与 STL 顶点数量不匹配：${Array.isArray(labels) ? labels.length : 0} / ${vertexCount}`,
      )
    }
    const vertexColors = new Float32Array(vertexCount * 3)
    for (let index = 0; index < vertexCount; index++) {
      const label: unknown = labels[index]
      if (typeof label !== 'number' || !Number.isInteger(label) || label < 0) {
        throw new Error(`${jaw} JSON 第 ${index} 个牙号无效`)
      }
      colorForLabel(label).toArray(vertexColors, index * 3)
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(vertexColors, 3))
    geometry.computeBoundingBox()
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.65,
        metalness: 0,
        side: THREE.DoubleSide,
      }),
    )
    mesh.userData.labels = new Set(labels as number[])
    return mesh
  } catch (error) {
    geometry.dispose()
    throw error
  }
}

function selectFile(kind: 'stl' | 'json', event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0] ?? null
  if (kind === 'stl') localStl.value = file
  else localJson.value = file
}

function refreshModels() {
  modelBounds.makeEmpty()
  const activeLabels = new Set<number>()
  for (const jaw of ['upper', 'lower'] as const) {
    const mesh = meshes[jaw]
    if (!mesh) continue
    modelBounds.union(mesh.geometry.boundingBox!)
    for (const label of meshLabels[jaw] ?? []) activeLabels.add(label)
  }
  legend.value = [...activeLabels]
    .sort((a, b) => a - b)
    .map((label) => ({ label, color: `#${colorForLabel(label).getHexString()}` }))
  syncVisibility()
  resetView()
}

async function importLocalJaw() {
  if (loading.value || !ready.value || !scene || !localStl.value || !localJson.value) return
  const jaw = localJaw.value
  const stl = localStl.value
  const json = localJson.value
  loading.value = true
  hasError.value = false
  status.value = '正在读取本地 STL 和 JSON…'
  try {
    if (!/\.stl$/i.test(stl.name) || !/\.json$/i.test(json.name)) {
      throw new Error('请选择配套的 .stl 和 .json 文件')
    }
    const [buffer, jsonText] = await Promise.all([stl.arrayBuffer(), json.text()])
    if (disposed) return
    let payload: unknown
    try {
      payload = JSON.parse(jsonText.replace(/^\uFEFF/, ''))
    } catch {
      throw new Error('JSON 文件格式无效，请检查文件内容')
    }
    const mesh = createJawMesh(jaw, buffer, payload)
    const previous = meshes[jaw]
    meshes[jaw] = mesh
    meshLabels[jaw] = mesh.userData.labels as Set<number>
    scene.add(mesh)
    if (previous) {
      scene.remove(previous)
      disposeMesh(previous)
    }
    if (jaw === 'upper') showUpper.value = true
    else showLower.value = true
    refreshModels()
    status.value = `已加载本地${jaw === 'upper' ? '上颌' : '下颌'} · ${stl.name} / ${json.name} · 0 为牙龈`
  } catch (error) {
    if (disposed) return
    hasError.value = true
    status.value = error instanceof Error ? error.message : '本地文件加载失败'
  } finally {
    if (!disposed) loading.value = false
  }
}

function syncVisibility() {
  if (meshes.upper) meshes.upper.visible = showUpper.value
  if (meshes.lower) meshes.lower.visible = showLower.value
}

function resetView() {
  if (!camera || !controls || modelBounds.isEmpty()) return
  const center = modelBounds.getCenter(new THREE.Vector3())
  const radius = modelBounds.getSize(new THREE.Vector3()).length() / 2
  const halfFov = THREE.MathUtils.degToRad(camera.fov / 2)
  const limitingFov = Math.min(halfFov, Math.atan(Math.tan(halfFov) * camera.aspect))
  const distance = (radius / Math.sin(limitingFov)) * 1.15
  camera.up.set(0, 0, 1)
  camera.position
    .copy(center)
    .add(new THREE.Vector3(0, 1, 0.3).normalize().multiplyScalar(distance))
  camera.near = Math.max(radius / 1000, 0.01)
  camera.far = distance + radius * 20
  camera.updateProjectionMatrix()
  controls.target.copy(center)
  controls.minDistance = radius * 0.2
  controls.maxDistance = distance * 5
  controls.update()
}

function disposeMesh(mesh: JawMesh) {
  mesh.geometry.dispose()
  mesh.material.dispose()
}

onMounted(async () => {
  if (!viewport.value) return
  try {
    scene = new THREE.Scene()
    scene.background = new THREE.Color('#edf1f6')
    camera = new THREE.PerspectiveCamera(45, 1, 0.01, 2000)
    renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    viewport.value.appendChild(renderer.domElement)
    controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8d96a6, 2))
    const light = new THREE.DirectionalLight(0xffffff, 2)
    light.position.set(0, 100, 150)
    scene.add(light)
    const fill = new THREE.DirectionalLight(0xffffff, 1)
    fill.position.set(0, -100, -80)
    scene.add(fill)
    resizeObserver = new ResizeObserver(() => {
      if (!viewport.value || !camera || !renderer) return
      const width = Math.max(viewport.value.clientWidth, 1)
      const height = Math.max(viewport.value.clientHeight, 1)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
    })
    resizeObserver.observe(viewport.value)
    renderer.setAnimationLoop(() => {
      controls?.update()
      if (scene && camera) renderer?.render(scene, camera)
    })
    ready.value = true

    // 等两个加载都结束后统一释放或加入场景，避免部分失败时遗留 GPU 资源。
    const results = await Promise.allSettled([loadJaw('upper'), loadJaw('lower')])
    if (disposed || results.some((result) => result.status === 'rejected')) {
      for (const result of results) {
        if (result.status === 'fulfilled') disposeMesh(result.value)
      }
      if (disposed) return
      const failure = results.find((result) => result.status === 'rejected')
      throw failure?.status === 'rejected' ? failure.reason : new Error('模型加载失败')
    }
    for (const [index, result] of results.entries()) {
      if (result.status !== 'fulfilled') continue
      const jaw = index === 0 ? 'upper' : 'lower'
      meshes[jaw] = result.value
      meshLabels[jaw] = result.value.userData.labels as Set<number>
      scene.add(result.value)
      // 使用联合包围盒设置相机，不改变上下颌的相对位置。
      modelBounds.union(result.value.geometry.boundingBox!)
    }
    refreshModels()
    status.value = `已加载上下颌 · ${legend.value.filter((item) => item.label !== 0).length} 个牙号 · 0 为牙龈`
  } catch (error) {
    if (disposed) return
    hasError.value = true
    status.value = error instanceof Error ? error.message : '模型加载失败'
  } finally {
    if (!disposed) loading.value = false
  }
})

onBeforeUnmount(() => {
  disposed = true
  abortController.abort()
  resizeObserver?.disconnect()
  renderer?.setAnimationLoop(null)
  controls?.dispose()
  for (const mesh of Object.values(meshes)) disposeMesh(mesh)
  scene?.clear()
  renderer?.dispose()
  renderer?.domElement.remove()
})
</script>

<style scoped>
.jaw-label-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  background: #edf1f6;
  color: #253047;
}
.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  padding: 14px 20px;
  background: white;
  border-bottom: 1px solid #dce2eb;
}
.local-import {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px 16px;
  padding: 12px 20px;
  background: white;
  border-bottom: 1px solid #dce2eb;
  font-size: 13px;
}
.local-import input[type='file'] {
  width: 220px;
  max-width: 100%;
}
.local-import select {
  padding: 6px;
  border: 1px solid #ccd5e2;
  border-radius: 6px;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
h1 {
  margin: 0 12px 0 0;
  font-size: 18px;
}
label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
button {
  padding: 7px 14px;
  border: 1px solid #ccd5e2;
  border-radius: 6px;
  background: white;
  color: inherit;
  cursor: pointer;
}
button:hover {
  background: #edf1f6;
}
.help {
  font-size: 13px;
  color: #64748b;
}
p {
  margin: 0;
  padding: 10px 20px;
  font-size: 13px;
}
.error {
  color: #b42318;
}
.viewport {
  flex: 1;
  min-height: 180px;
  overflow: hidden;
}
.viewport :deep(canvas) {
  display: block;
  touch-action: none;
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 18px;
  padding: 14px 20px;
  background: white;
  max-height: 25vh;
  overflow: auto;
}
.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}
.legend-item i {
  width: 14px;
  height: 14px;
  border-radius: 4px;
}
</style>
