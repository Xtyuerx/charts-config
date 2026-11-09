<template>
  <main class="msgpack-page">
    <header>
      <h1>Msgpack 牙齿模型</h1>
      <span>拖动旋转 · 滚轮缩放 · 右键平移</span>
      <button :disabled="!legend.length" @click="fitCamera">重置视角</button>
      <label
        ><input
          v-model="showBoundaries"
          type="checkbox"
          @change="editor?.setEnabled(showBoundaries)"
        />显示边界</label
      >
      <button :disabled="selectedBoundary === null" @click="editor?.resetSelected()">
        重置选中边界
      </button>
      <button :disabled="loading || !hasPayload" @click="saveModel(false)">保存完整 msgpack</button>
      <button :disabled="loading || !hasPayload" @click="saveModel(true)">保存完整 hex</button>
      <label v-if="availableJaws.length"
        >查看颌位
        <select v-model="selectedJaw" :disabled="loading" @change="switchJaw">
          <option v-for="jaw in availableJaws" :key="jaw" :value="jaw">
            {{ jaw === 'lower' ? '下颌' : '上颌' }}
          </option>
        </select>
      </label>
    </header>
    <form @submit.prevent="loadModel(url)">
      <label>文件 URL <input v-model="url" required :disabled="loading" /></label>
      <label
        >Draco 字段路径 <input v-model="meshField" :disabled="loading" placeholder="手动指定时填写"
      /></label>
      <label
        >标签字段路径
        <input v-model="labelsField" :disabled="loading" placeholder="单牙模型无需标签"
      /></label>
      <label
        >标签对应
        <select v-model="labelMode" :disabled="loading">
          <option value="auto">自动判断</option>
          <option value="vertex">顶点</option>
          <option value="face">三角面</option>
        </select>
      </label>
      <button :disabled="loading || !ready">加载 URL</button>
      <button
        type="button"
        :disabled="loading || !ready || (!hasPayload && !pendingPayload)"
        @click="loadModel(undefined, true)"
      >
        应用字段路径
      </button>
      <label
        >选择本地 msgpack
        <input
          type="file"
          accept=".msgpack,.mpk,.msg,.bin,.hex,.txt"
          :disabled="loading || !ready"
          @change="loadFile"
        />
      </label>
    </form>
    <p role="status" :class="{ error: hasError }">{{ status }}</p>
    <p v-if="legend.length">
      {{
        selectedBoundary === null
          ? '按住 Ctrl 点击牙齿切换选中边界，拖动控制点调整绿线；松手后更新局部顶点标签。'
          : `已选中牙号 ${selectedBoundary}：拖动白色控制点，松手后提交局部标签`
      }}{{ boundaryNotice }}
    </p>
    <details v-if="payloadStructure" :open="hasError" class="payload-structure">
      <summary>msgpack 文件结构（字段名、类型和长度）</summary>
      <label
        >查看对象
        <select v-model="structureKey">
          <option value="">整个数据包</option>
          <option v-for="key in payloadKeys" :key="key" :value="key">{{ key }}</option>
        </select>
      </label>
      <pre>{{ payloadStructure }}</pre>
    </details>
    <div ref="viewport" class="viewport" aria-label="牙齿三维场景"></div>
    <aside aria-label="牙齿颜色图例">
      <label v-for="item in legend" :key="item.label">
        <input
          v-model="item.visible"
          type="checkbox"
          @change="setVisibility(item.label, item.visible)"
        />
        <i :style="{ background: item.color }"></i>
        {{ item.label === 0 ? '0 · 背景 / 牙龈' : `牙号 ${item.label}` }}
      </label>
    </aside>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import * as THREE from 'three'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { BoundaryEditor, ToothBoundary, boundaryPoints } from './boundaryEditor'
import { prepareBoundaryEdit, readBoundaryEdit } from './boundaryPersistence'
import { BoundaryRegionColors, renderBoundaryOverlay } from './boundaryRegionColors'
import { modelMaterial } from './modelMaterial'
import { createPreviewSurfaceFit, type SurfacePreview, type PreviewFit } from './previewSurface'
import {
  SegmentationSession,
  decodeModelBytes,
  encodeFullModel,
  sampleClosedLoop,
  writeLabels,
} from './segmentation'
import type { ClosedSurfacePath } from '../toothSegmentationTest/utils/surfaceBoundaryUtils'
import {
  describePayload,
  jawPaths,
  jawSource,
  readJawParts,
  readPayload,
  splitByLabels,
  type LabelMode,
} from './geometry'

const viewport = ref<HTMLDivElement>()
const url = ref(`${import.meta.env.BASE_URL}models/jaw.msgpack`)
const meshField = ref('mesh')
const labelsField = ref('seg_labels')
const labelMode = ref<LabelMode>('auto')
const loading = ref(false)
const ready = ref(false)
const hasError = ref(false)
const cachedPayload = shallowRef<unknown>()
const pendingPayload = shallowRef<unknown>()
const inspectedPayload = computed(() => pendingPayload.value ?? cachedPayload.value)
const hasPayload = ref(false)
const selectedJaw = ref<'lower' | 'upper'>('lower')
const availableJaws = computed(() =>
  (['lower', 'upper'] as const).filter((jaw) => jawSource(cachedPayload.value, jaw)),
)
const structureKey = ref('')
const payloadKeys = computed(() =>
  inspectedPayload.value && typeof inspectedPayload.value === 'object'
    ? Object.keys(inspectedPayload.value)
    : [],
)
const payloadStructure = computed(() => {
  if (!inspectedPayload.value) return ''
  const value =
    structureKey.value && inspectedPayload.value && typeof inspectedPayload.value === 'object'
      ? (inspectedPayload.value as Record<string, unknown>)[structureKey.value]
      : inspectedPayload.value
  return `${structureKey.value ? `选中对象：${structureKey.value}\n` : ''}${describePayload(value)}`
})
const status = ref('输入资源 URL 或选择本地 msgpack 文件，自动识别整颌分割数据或独立单牙模型。')
const legend = ref<{ label: number; color: string; visible: boolean }[]>([])
const showBoundaries = ref(true)
const selectedBoundary = ref<number | null>(null)
const boundaryNotice = ref('')
let editor: BoundaryEditor | undefined
let regionColors: BoundaryRegionColors | undefined
let previewReference: PreviewFit | undefined
let segmentation: SegmentationSession | undefined
let activeLabelsPath = ''
let fittedPaths = new Map<number, ClosedSurfacePath>()
const sessions = new Map<string, SegmentationSession>()
const savedControls = new Map<string, Map<number, THREE.Vector3[]>>()
let activeSessionKey = ''
let activeBoundaryScope = ''
let baseBoundaryPoints = new Map<number, THREE.Vector3[]>()
let downloadName = 'teeth'
type ToothMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
const meshes = new Map<number, ToothMesh>()
const scene = new THREE.Scene()
const boundaryScene = new THREE.Scene()
const group = new THREE.Group()
const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 10000)
const draco = new DRACOLoader()
  .setDecoderPath(`${import.meta.env.BASE_URL}draco/`)
  .setWorkerLimit(1)
let renderer: THREE.WebGLRenderer | undefined
let controls: OrbitControls | undefined
let observer: ResizeObserver | undefined
let request: AbortController | undefined
let disposed = false

function clearModel() {
  regionColors?.dispose()
  regionColors = undefined
  segmentation = undefined
  activeLabelsPath = ''
  fittedPaths.clear()
  editor?.clear()
  previewReference?.dispose()
  previewReference = undefined
  boundaryNotice.value = ''
  for (const mesh of meshes.values()) {
    mesh.geometry.dispose()
    mesh.material.dispose()
  }
  meshes.clear()
  group.clear()
}

function disposeSessions() {
  for (const session of sessions.values()) session.geometry.dispose()
  sessions.clear()
  savedControls.clear()
}

function reportEditError(error: unknown) {
  hasError.value = true
  status.value = error instanceof Error ? error.message : String(error)
}

function replaceParts(parts: ReturnType<typeof splitByLabels>['parts']) {
  const style = new Map(legend.value.map((item) => [item.label, item]))
  for (const mesh of meshes.values()) {
    mesh.geometry.dispose()
    mesh.material.dispose()
  }
  meshes.clear()
  group.clear()
  legend.value = parts.map(({ label, geometry }, i) => {
    const previous = style.get(label)
    const color = previous
      ? new THREE.Color(previous.color)
      : label === 0
        ? new THREE.Color('#d391a0')
        : new THREE.Color().setHSL((i * 0.61803398875) % 1, 0.62, 0.58)
    const mesh = new THREE.Mesh(geometry, modelMaterial(color, label))
    mesh.name = `tooth-${label}`
    mesh.userData.segLabel = label
    mesh.visible = previous?.visible ?? true
    meshes.set(label, mesh)
    group.add(mesh)
    return { label, color: `#${color.getHexString()}`, visible: mesh.visible }
  })
  for (const label of editor?.boundaries.keys() ?? []) editor?.syncVisibility(label)
}

function commitBoundary(boundary: ToothBoundary, reset: boolean) {
  const persist = prepareBoundaryEdit(
    cachedPayload.value,
    activeBoundaryScope,
    boundary.label,
    reset
      ? undefined
      : {
          kind: segmentation ? 'vertex' : 'preview',
          points: baseBoundaryPoints.get(boundary.label)!,
          controls: boundary.handles.map((h) => h.position.clone()),
        },
  )
  if (!segmentation) {
    persist()
    hasError.value = false
    status.value = `${reset ? '已重置' : '已保存'}牙号 ${boundary.label} 的边界点位；重新加载可恢复；此模型无顶点标签，未修改 seg_labels`
    return
  }
  const result = reset
    ? { labels: segmentation.resetLabels(boundary.label), changed: [] as number[] }
    : segmentation.rasterize(boundary.label, boundary.points(), fittedPaths.get(boundary.label))
  const changed = result.labels.reduce(
    (sum, n, i) => sum + Number(n !== segmentation!.labels[i]),
    0,
  )
  // Prepare display geometry before committing the payload; failed classification is atomic.
  const parts = splitByLabels(segmentation.geometry, result.labels, 'vertex').parts
  try {
    writeLabels(cachedPayload.value, activeLabelsPath, result.labels)
  } catch (error) {
    parts.forEach((p) => p.geometry.dispose())
    throw error
  }
  segmentation.commit(result.labels, boundary.label, reset)
  persist()
  const state = savedControls.get(activeSessionKey) ?? new Map<number, THREE.Vector3[]>()
  state.set(
    boundary.label,
    boundary.handles.map((h) => h.position.clone()),
  )
  savedControls.set(activeSessionKey, state)
  replaceParts(parts)
  hasError.value = false
  status.value = `${reset ? '已重置' : '已更新'}牙号 ${boundary.label}；${changed} 个局部顶点标签变化；mesh.data 未修改`
}

function saveModel(hex: boolean) {
  try {
    const bytes = encodeFullModel(cachedPayload.value)
    const content = hex
      ? Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
      : new Uint8Array(bytes).buffer
    const blob = new Blob([content], {
      type: hex ? 'text/plain;charset=utf-8' : 'application/msgpack',
    })
    const link = document.createElement('a'),
      objectUrl = URL.createObjectURL(blob)
    link.href = objectUrl
    link.download = `${downloadName}-edited.${hex ? 'hex' : 'msgpack'}`
    link.click()
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
    const changed = [...sessions.values()].reduce(
      (total, session) => total + session.changedVertexCount,
      0,
    )
    hasError.value = false
    status.value = `已导出完整数据包；${changed} 个顶点标签与加载时不同；mesh.data 保留原始字节${
      segmentation
        ? '；重新渲染请读取 seg_labels，独立单牙网格未重新生成'
        : '；边界点位已包含在文件中，可在本页恢复；此模型无可编辑顶点标签'
    }`
  } catch (error) {
    reportEditError(error)
  }
}

function setVisibility(label: number, visible: boolean) {
  const mesh = meshes.get(label)
  if (mesh) mesh.visible = visible
  editor?.syncVisibility(label)
}

function selectJawPaths() {
  const paths = jawPaths(cachedPayload.value, selectedJaw.value)
  if (!paths) {
    meshField.value = ''
    labelsField.value = ''
    structureKey.value = `${selectedJaw.value}_teeth`
    return
  }
  meshField.value = paths.mesh
  labelsField.value = paths.labels
  structureKey.value = `${selectedJaw.value}_seg`
}

async function switchJaw() {
  selectJawPaths()
  await loadModel()
}

function fitCamera() {
  if (!meshes.size || !controls) return
  const bounds = new THREE.Box3().setFromObject(group)
  const sphere = bounds.getBoundingSphere(new THREE.Sphere())
  const radius = Math.max(sphere.radius, 0.01)
  const verticalFov = THREE.MathUtils.degToRad(camera.fov / 2)
  const horizontalFov = Math.atan(Math.tan(verticalFov) * camera.aspect)
  const distance = (radius / Math.sin(Math.min(verticalFov, horizontalFov))) * 1.2
  camera.position
    .copy(sphere.center)
    .add(new THREE.Vector3(0, -0.65, 1).normalize().multiplyScalar(distance))
  camera.near = radius / 1000
  camera.far = distance + radius * 100
  camera.updateProjectionMatrix()
  controls.target.copy(sphere.center)
  controls.minDistance = radius * 0.05
  controls.maxDistance = radius * 40
  controls.update()
}

async function loadModel(source?: string, manual = false) {
  if (loading.value || !ready.value) return
  loading.value = true
  hasError.value = false
  request = new AbortController()
  let decoded: THREE.BufferGeometry | undefined
  let parts: ReturnType<typeof splitByLabels>['parts'] | undefined
  let nextSegmentation: SegmentationSession | undefined
  let workingPayload = manual ? (pendingPayload.value ?? cachedPayload.value) : cachedPayload.value
  const preparedBoundaries: ToothBoundary[] = []
  const preparedPaths = new Map<number, ClosedSurfacePath>()
  let reusedSession = false
  let installed = false
  let nextPreviewReference: PreviewFit | undefined
  let nextRegionColors: BoundaryRegionColors | undefined
  const preparedMeshes = new Map<number, ToothMesh>()
  try {
    if (source !== undefined) {
      status.value = '正在 fetch 下载 msgpack…'
      const response = await fetch(source.trim(), { signal: request.signal })
      if (!response.ok) throw new Error(`文件下载失败：HTTP ${response.status}`)
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (disposed) return
      const nextPayload = decodeModelBytes(bytes)
      workingPayload = nextPayload
      pendingPayload.value = nextPayload
      structureKey.value = ''
      meshField.value = ''
      labelsField.value = ''
      labelMode.value = 'auto'
      const jaws = (['lower', 'upper'] as const).filter((jaw) => jawSource(workingPayload, jaw))
      if (jaws.length) {
        if (!jaws.includes(selectedJaw.value)) selectedJaw.value = jaws[0]!
        const paths = jawPaths(workingPayload, selectedJaw.value)
        meshField.value = paths?.mesh ?? ''
        labelsField.value = paths?.labels ?? ''
        structureKey.value = `${selectedJaw.value}_${paths ? 'seg' : 'teeth'}`
      } else if (
        workingPayload &&
        typeof workingPayload === 'object' &&
        Object.prototype.hasOwnProperty.call(workingPayload, 'mesh') &&
        Object.prototype.hasOwnProperty.call(workingPayload, 'seg_labels')
      ) {
        meshField.value = 'mesh'
        labelsField.value = 'seg_labels'
      }
    }
    if (!workingPayload) throw new Error('请先加载 msgpack 文件')
    status.value = '正在 msgpack.decode 解析和 Draco 解压…'
    let faceCount = 0
    let boundaryFaces = 0
    const individualTeeth = !manual && jawSource(workingPayload, selectedJaw.value) === 'teeth'
    if (individualTeeth) {
      const inputs = readJawParts(workingPayload, selectedJaw.value)
      parts = []
      for (const input of inputs) {
        decoded = await new Promise<THREE.BufferGeometry>((resolve, reject) =>
          draco.parse(input.buffer, resolve, reject),
        )
        if (disposed) return
        const position = decoded.getAttribute('position')
        const index = decoded.getIndex()
        if (!position || !position.count || !index || !index.count || index.count % 3)
          throw new Error(`牙号 ${input.label} 不是三角网格`)
        if (!decoded.getAttribute('normal')) decoded.computeVertexNormals()
        faceCount += index.count / 3
        parts.push({ label: input.label, geometry: decoded })
        decoded = undefined
      }
    } else {
      if (!meshField.value || !labelsField.value)
        throw new Error(
          '此文件未包含可识别的整颌分割数据或单牙模型。请查看文件结构；附件/填充数据包不能作为牙颌模型加载。',
        )
      const payload = readPayload(workingPayload, meshField.value.trim(), labelsField.value.trim())
      const key = `${meshField.value.trim()}|${labelsField.value.trim()}`
      nextSegmentation =
        workingPayload === cachedPayload.value && labelMode.value !== 'face'
          ? sessions.get(key)
          : undefined
      reusedSession = !!nextSegmentation
      decoded =
        nextSegmentation?.geometry ??
        (await new Promise<THREE.BufferGeometry>((resolve, reject) => {
          draco.parse(payload.buffer, resolve, reject)
        }))
      if (disposed) return
      const result = splitByLabels(
        decoded,
        nextSegmentation?.labels ?? payload.labels,
        labelMode.value,
      )
      parts = result.parts
      faceCount = result.faceCount
      boundaryFaces = result.boundaryFaces
      if (
        labelMode.value !== 'face' &&
        payload.labels.length === decoded.getAttribute('position').count
      ) {
        nextSegmentation ??= new SegmentationSession(decoded, payload.labels)
        decoded = undefined // Retained in original Draco vertex order for label writes.
      }
    }
    const key = `${meshField.value.trim()}|${labelsField.value.trim()}`
    const candidate = nextSegmentation
    const bounds = new THREE.Box3()
    parts.forEach((p) => {
      p.geometry.computeBoundingBox()
      bounds.union(p.geometry.boundingBox!)
    })
    const size = bounds.getSize(new THREE.Vector3()).length()
    const missing: number[] = []
    const scope = `${selectedJaw.value}:${key}`
    const preparedBasePoints = new Map<number, THREE.Vector3[]>()
    if (!candidate)
      nextPreviewReference = createPreviewSurfaceFit([
        ...parts.filter((p) => p.label !== 0).map((p) => p.geometry),
        ...parts.filter((p) => p.label === 0).map((p) => p.geometry),
      ])
    // Prepare all curves before releasing the current model or its editing history.
    for (const { label, geometry } of parts) {
      if (label <= 0) continue
      const saved = readBoundaryEdit(workingPayload, scope, label)
      const points =
        candidate?.boundaries.get(label) ??
        (candidate
          ? []
          : saved?.kind === 'preview'
            ? saved.points
            : boundaryPoints(manual ? null : workingPayload, selectedJaw.value, label, geometry))
      if (points.length < 3) {
        missing.push(label)
        continue
      }
      preparedBasePoints.set(
        label,
        points.map((p) => p.clone()),
      )
      const fitCurve = candidate?.createCurveFitter()
      const boundary = new ToothBoundary(
        label,
        points,
        Math.max(size * 0.003, 0.01),
        (_updated, preview) => {
          if (!candidate && installed && preview) regionColors?.update(label, preview)
        },
        candidate
          ? {
              controls:
                !reusedSession && saved?.kind === 'vertex'
                  ? saved.controls
                  : sampleClosedLoop(points, Math.min(20, points.length)),
              fit: (controls) => {
                const path = fitCurve!(controls)
                preparedPaths.set(label, path)
                return path.curvePoints.slice(0, -1)
              },
            }
          : undefined,
        candidate
          ? undefined
          : createPreviewSurfaceFit(
              [geometry, ...parts.filter((p) => p.label === 0).map((p) => p.geometry)],
              nextPreviewReference?.surface,
            ),
      )
      if (!candidate) preparedBasePoints.set(label, boundary.points())
      preparedBoundaries.push(boundary)
      const controls = reusedSession
        ? savedControls.get(key)?.get(label)
        : saved?.kind === 'preview'
          ? saved.controls
          : undefined
      if (controls) boundary.restoreControls(controls)
    }
    const preparedLegend = parts.map(({ label, geometry }, i) => {
      const color =
        label === 0
          ? new THREE.Color('#d391a0')
          : new THREE.Color().setHSL((i * 0.61803398875) % 1, 0.62, 0.58)
      color.setHex(color.getHex())
      const mesh = new THREE.Mesh(geometry, modelMaterial(color, label))
      mesh.name = `tooth-${label}`
      mesh.userData.segLabel = label
      preparedMeshes.set(label, mesh)
      return { label, color: `#${color.getHexString()}`, visible: true }
    })
    if (!candidate) {
      const previews = new Map<number, SurfacePreview>()
      for (const boundary of preparedBoundaries) {
        const preview = boundary.surfacePreview()
        if (preview) previews.set(boundary.label, preview)
      }
      // Validation must succeed before discarding the currently usable model.
      nextRegionColors = new BoundaryRegionColors(preparedMeshes, preparedBasePoints, previews)
    }
    clearModel()
    previewReference = nextPreviewReference
    nextPreviewReference = undefined
    if (workingPayload !== cachedPayload.value) disposeSessions()
    cachedPayload.value = workingPayload
    if (workingPayload === pendingPayload.value) pendingPayload.value = undefined
    hasPayload.value = true
    segmentation = nextSegmentation
    if (segmentation) sessions.set(key, segmentation)
    activeSessionKey = key
    activeBoundaryScope = scope
    baseBoundaryPoints = preparedBasePoints
    fittedPaths = preparedPaths
    nextSegmentation = undefined
    activeLabelsPath = labelsField.value.trim()
    legend.value = preparedLegend
    for (const [label, mesh] of preparedMeshes) {
      meshes.set(label, mesh)
      group.add(mesh)
    }
    regionColors = nextRegionColors
    nextRegionColors = undefined
    parts = undefined // The scene now owns these geometries.
    installed = true
    if (editor) {
      for (const boundary of preparedBoundaries) {
        editor.boundaries.set(boundary.label, boundary)
        boundaryScene.add(boundary.group)
      }
      editor.setEnabled(showBoundaries.value)
      boundaryNotice.value = missing.length ? `；牙号 ${missing.join('、')} 缺少可用闭合边界` : ''
      if (!segmentation)
        boundaryNotice.value += '；此数据无可编辑的原始顶点标签，保存边界点位并恢复预览'
      else boundaryNotice.value += '；编辑范围为原边界周围 4 圈相邻面片，超出范围会回退'
    }
    fitCamera()
    const boundary = boundaryFaces
      ? `；${boundaryFaces} 个跨标签面已按多数标签归属（平票取首顶点）`
      : ''
    status.value = `已加载 ${meshes.size} 个分区，${faceCount} 个三角面${individualTeeth ? '；按独立单牙模型加载' : ''}${boundary}`
  } catch (error) {
    if (!disposed) {
      hasError.value = true
      status.value = error instanceof Error ? error.message : String(error)
    }
  } finally {
    decoded?.dispose()
    if (!reusedSession) nextSegmentation?.geometry.dispose()
    nextRegionColors?.dispose()
    if (!installed) for (const mesh of preparedMeshes.values()) mesh.material.dispose()
    if (!installed) preparedBoundaries.forEach((b) => b.dispose())
    nextPreviewReference?.dispose()
    parts?.forEach((part) => part.geometry.dispose())
    loading.value = false
    request = undefined
    if (disposed) draco.dispose()
  }
}

async function loadFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  downloadName = file.name.replace(/\.[^.]+$/, '') || 'teeth'
  // Blob URLs let selected local files use exactly the same fetch pipeline.
  const objectUrl = URL.createObjectURL(file)
  try {
    await loadModel(objectUrl)
  } finally {
    URL.revokeObjectURL(objectUrl)
    input.value = ''
  }
}

onMounted(() => {
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    viewport.value!.appendChild(renderer.domElement)
    scene.background = new THREE.Color('#edf1f7')
    scene.add(group, new THREE.HemisphereLight(0xffffff, 0x718099, 2.4))
    const light = new THREE.DirectionalLight(0xffffff, 3)
    light.position.set(1, -2, 4)
    scene.add(light)
    camera.position.set(0, -70, 110)
    controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = false
    editor = new BoundaryEditor(
      renderer.domElement,
      camera,
      controls,
      meshes,
      (label) => {
        selectedBoundary.value = label
      },
      commitBoundary,
      reportEditError,
    )
    observer = new ResizeObserver(() => {
      if (!viewport.value || !renderer) return
      const width = Math.max(viewport.value.clientWidth, 1)
      const height = Math.max(viewport.value.clientHeight, 1)
      renderer.setSize(width, height)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    })
    observer.observe(viewport.value!)
    renderer.setAnimationLoop(() => {
      editor?.update()
      controls?.update()
      if (renderer) renderBoundaryOverlay(renderer, scene, boundaryScene, camera)
    })
    ready.value = true
  } catch (error) {
    hasError.value = true
    status.value = `三维场景初始化失败：${String(error)}`
  }
})

onBeforeUnmount(() => {
  disposed = true
  request?.abort()
  observer?.disconnect()
  renderer?.setAnimationLoop(null)
  editor?.dispose()
  controls?.dispose()
  // Allow an active decode to resolve so its geometry can be disposed in finally.
  if (!loading.value) draco.dispose()
  clearModel()
  disposeSessions()
  renderer?.dispose()
  renderer?.domElement.remove()
})
</script>

<style scoped>
.msgpack-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #edf1f7;
  color: #25334a;
}
header,
form,
aside {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 12px 20px;
  background: white;
}
h1 {
  font-size: 19px;
  margin: 0;
}
header span {
  flex: 1;
  font-size: 13px;
  color: #68758a;
}
form {
  border-top: 1px solid #e4e8ef;
}
label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}
input,
select,
button {
  padding: 6px;
}
input[type='file'] {
  max-width: 220px;
}
button {
  cursor: pointer;
}
button:disabled {
  cursor: default;
}
p {
  padding: 8px 20px;
  margin: 0;
  font-size: 13px;
}
.error {
  color: #bd2638;
}
.payload-structure {
  padding: 8px 20px;
  background: #fff;
  font-size: 13px;
}
.payload-structure pre {
  max-height: 180px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.viewport {
  flex: 1;
  min-height: 260px;
  overflow: hidden;
}
.viewport :deep(canvas) {
  display: block;
}
aside {
  max-height: 140px;
  overflow: auto;
}
i {
  width: 13px;
  height: 13px;
  border-radius: 50%;
}
</style>
