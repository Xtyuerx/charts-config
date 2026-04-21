<template>
  <div class="content">
    <div class="toolbar">
      <button @click="toggleUpper">
        {{ showUpper ? '隐藏上颌' : '显示上颌' }}
      </button>
      <button @click="toggleLower">
        {{ showLower ? '隐藏下颌' : '显示下颌' }}
      </button>

      <div class="mode-group">
        <button :class="{ active: brushMode === 'tooth' }" @click="brushMode = 'tooth'">
          牙体上色
        </button>
        <button :class="{ active: brushMode === 'gingiva' }" @click="brushMode = 'gingiva'">
          牙龈上色
        </button>
      </div>

      <label class="tool-item">
        <span>当前牙号</span>
        <input
          v-model.number="selectedToothId"
          class="tooth-input"
          type="number"
          min="11"
          max="48"
          placeholder="例如 11"
        />
      </label>

      <label class="tool-item bulk-item">
        <span>批量牙号</span>
        <input
          v-model="batchToothIdsInput"
          class="bulk-input"
          type="text"
          placeholder="例如 11,12,21"
        />
      </label>
      <button @click="applyBatchTeeth">批量回填</button>

      <label class="tool-item">
        <span>笔刷半径</span>
        <input v-model.number="brushRadius" type="range" min="0.5" max="6" step="0.1" />
        <span>{{ brushRadius.toFixed(1) }}</span>
      </label>

      <button @click="resetSegmentation">重置标注</button>
      <button @click="toggleSegmentPreview">
        {{ previewSegmentResult ? '返回编辑' : '预览分割结果' }}
      </button>
      <button @click="exportUpperLabels">导出上颌 JSON</button>
      <button @click="exportLowerLabels">导出下颌 JSON</button>
    </div>

    <div class="quick-tooth-list" v-if="availableToothIds.length">
      <span class="quick-title">快速选择牙号：</span>
      <button
        v-for="toothId in availableToothIds"
        :key="toothId"
        class="quick-tooth-btn"
        :class="{ active: selectedToothId === toothId }"
        @click="selectedToothId = toothId"
      >
        {{ toothId }}
      </button>
    </div>

    <div class="tips">
      左键按住可连续涂色。牙体模式下写入牙号，牙龈模式下写入 0。上颌和下颌会分别导出独立
      JSON，后续可直接按牙号还原每颗牙齿的范围。
    </div>

    <div ref="containerRef" class="container"></div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh'
import { STLLoader, TrackballControls } from 'three-stdlib'
import { MATERIAL_CONFIG, SCENE_CONFIG } from '@/page/newAnalysis/modelAnalysis/constants'

type BrushMode = 'tooth' | 'gingiva'
type JawType = 'upper' | 'lower'

type BVHGeometry = THREE.BufferGeometry & {
  boundsTree?: {
    shapecast: (options: {
      intersectsBounds: (box: THREE.Box3) => boolean
      intersectsTriangle: (tri: THREE.Triangle, triangleIndex: number) => boolean | void
    }) => void
  }
  computeBoundsTree?: () => void
  disposeBoundsTree?: () => void
}

type LabelJson = {
  jaw?: string
  version?: number
  labels?: number[]
}

const containerRef = ref<HTMLDivElement>()

let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let renderer: THREE.WebGLRenderer | null = null
let controls: TrackballControls | null = null
let animationId: number | null = null
let resizeHandler: (() => void) | null = null
let eventCanvas: HTMLCanvasElement | null = null

let upperMesh: THREE.Mesh | null = null
let lowerMesh: THREE.Mesh | null = null
let rawUpperGeometry: THREE.BufferGeometry | null = null
let rawLowerGeometry: THREE.BufferGeometry | null = null
let previewGroup: THREE.Group | null = null
let brushIndicator: THREE.Mesh | null = null

const showUpper = ref(true)
const showLower = ref(true)
const brushRadius = ref(2)
const brushMode = ref<BrushMode>('tooth')
const selectedToothId = ref<number | null>(null)
const batchToothIdsInput = ref('')
const previewSegmentResult = ref(false)

const modelConfig = {
  upper: '/models/upper.stl',
  lower: '/models/lower.stl',
  upperJson: '/models/upper.json',
  lowerJson: '/models/lower.json',
}

const toothColor = new THREE.Color(0xffffff)
const gingivaColor = new THREE.Color(0xc97f88)

const availableToothIdSet = ref(new Set<number>())
const availableToothIds = computed(() => Array.from(availableToothIdSet.value).sort((a, b) => a - b))

const faceLabelMap = new WeakMap<THREE.Mesh, Uint16Array>()
const baselineMap = new WeakMap<THREE.Mesh, Uint16Array>()
const preparedMeshSet = new WeakSet<THREE.Mesh>()

const raycaster = new THREE.Raycaster()
const mouse = new THREE.Vector2()
const brushSphere = new THREE.Sphere()
const tempTriangleCenter = new THREE.Vector3()

let targets: THREE.Mesh[] = []
let activeTarget: THREE.Mesh | null = null
let isPainting = false

function getAllMeshes() {
  return [upperMesh, lowerMesh].filter(Boolean) as THREE.Mesh[]
}

function loadSTL(url: string): Promise<THREE.BufferGeometry> {
  const loader = new STLLoader()
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject)
  })
}

function normalizeLabel(value: number): number {
  return Math.max(0, Math.floor(Number(value) || 0))
}

function majorityFdiTri(a: number, b: number, c: number): number {
  const x = normalizeLabel(a)
  const y = normalizeLabel(b)
  const z = normalizeLabel(c)
  if (x === y || x === z) return x
  if (y === z) return y
  return Math.max(x, y, z)
}

function buildTriangleLabels(geometry: THREE.BufferGeometry, labels: number[]): Uint16Array {
  const position = geometry.attributes.position as THREE.BufferAttribute | undefined
  if (!position) throw new Error('geometry 缺少 position')

  const vertexCount = position.count
  const triCount = geometry.index ? geometry.index.count / 3 : Math.floor(vertexCount / 3)
  const output = new Uint16Array(triCount)

  if (labels.length === triCount) {
    for (let tri = 0; tri < triCount; tri++) {
      output[tri] = normalizeLabel(labels[tri] ?? 0)
    }
    return output
  }

  if (labels.length === vertexCount) {
    for (let tri = 0; tri < triCount; tri++) {
      const ia = geometry.index ? geometry.index.getX(tri * 3) : tri * 3
      const ib = geometry.index ? geometry.index.getX(tri * 3 + 1) : tri * 3 + 1
      const ic = geometry.index ? geometry.index.getX(tri * 3 + 2) : tri * 3 + 2
      output[tri] = majorityFdiTri(labels[ia] ?? 0, labels[ib] ?? 0, labels[ic] ?? 0)
    }
    return output
  }

  throw new Error(`labels 与网格不匹配：labels=${labels.length}, 顶点=${vertexCount}, 三角面=${triCount}`)
}

function toPaintGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const nextGeometry = geometry.index ? geometry.toNonIndexed() : geometry.clone()
  if (nextGeometry.getAttribute('color')) {
    nextGeometry.deleteAttribute('color')
  }
  nextGeometry.computeVertexNormals()
  return nextGeometry
}

function colorForLabel(label: number): THREE.Color {
  if (!label) return gingivaColor
  const h = (((label * 2654435761) >>> 0) % 360) / 360
  return new THREE.Color().setHSL(h, 0.65, 0.55)
}

function collectToothIds(labels: Uint16Array) {
  const nextSet = new Set(availableToothIdSet.value)
  for (const label of labels) {
    if (label > 0) nextSet.add(label)
  }
  availableToothIdSet.value = nextSet
}

async function loadBaseline(url: string, mesh: THREE.Mesh, jaw: JawType) {
  const sourceGeometry = jaw === 'upper' ? rawUpperGeometry : rawLowerGeometry
  if (!sourceGeometry) return

  const response = await fetch(url)
  if (!response.ok) return
  const data = (await response.json()) as LabelJson
  if (!data.labels?.length) return

  const baseline = buildTriangleLabels(sourceGeometry, data.labels)
  baselineMap.set(mesh, baseline)
  collectToothIds(baseline)
}

function createJawMesh(geometry: THREE.BufferGeometry, jaw: JawType): THREE.Mesh {
  const isUpper = jaw === 'upper'
  const material = new THREE.MeshPhongMaterial({
    color: MATERIAL_CONFIG.jaw.color,
    specular: MATERIAL_CONFIG.jaw.specular,
    shininess: MATERIAL_CONFIG.jaw.shininess,
    reflectivity: MATERIAL_CONFIG.jaw.reflectivity,
    side: MATERIAL_CONFIG.jaw.side,
    ...(isUpper
      ? {}
      : {
          emissive: MATERIAL_CONFIG.lowerJaw.emissive,
          emissiveIntensity: MATERIAL_CONFIG.lowerJaw.emissiveIntensity,
        }),
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.scale.set(SCENE_CONFIG.modelScale, SCENE_CONFIG.modelScale, SCENE_CONFIG.modelScale)
  mesh.name = jaw
  return mesh
}

function ensureFaceLabels(mesh: THREE.Mesh) {
  if (faceLabelMap.has(mesh)) return
  const position = mesh.geometry.attributes.position as THREE.BufferAttribute | undefined
  if (!position) return
  const triCount = mesh.geometry.index ? mesh.geometry.index.count / 3 : position.count / 3
  faceLabelMap.set(mesh, new Uint16Array(triCount))
}

function enableVertexColors(mesh: THREE.Mesh) {
  const apply = (material: THREE.Material) => {
    if (material instanceof THREE.MeshPhongMaterial || material instanceof THREE.MeshStandardMaterial) {
      material.vertexColors = true
      material.needsUpdate = true
    }
  }

  if (Array.isArray(mesh.material)) {
    mesh.material.forEach(apply)
  } else {
    apply(mesh.material)
  }
}

function repaintMesh(mesh: THREE.Mesh) {
  const colorAttr = mesh.geometry.getAttribute('color') as THREE.BufferAttribute | undefined
  const labels = faceLabelMap.get(mesh)
  if (!colorAttr || !labels) return

  const paintTriangle = (tri: number, a: number, b: number, c: number) => {
    const color = colorForLabel(labels[tri] ?? 0)
    colorAttr.setXYZ(a, color.r, color.g, color.b)
    colorAttr.setXYZ(b, color.r, color.g, color.b)
    colorAttr.setXYZ(c, color.r, color.g, color.b)
  }

  if (mesh.geometry.index) {
    const index = mesh.geometry.index
    for (let tri = 0; tri < labels.length; tri++) {
      paintTriangle(tri, index.getX(tri * 3), index.getX(tri * 3 + 1), index.getX(tri * 3 + 2))
    }
  } else {
    for (let tri = 0; tri < labels.length; tri++) {
      paintTriangle(tri, tri * 3, tri * 3 + 1, tri * 3 + 2)
    }
  }

  colorAttr.needsUpdate = true
}

function preparePaintMesh(mesh: THREE.Mesh) {
  if (preparedMeshSet.has(mesh)) return

  const position = mesh.geometry.attributes.position as THREE.BufferAttribute | undefined
  if (!position) return

  if (!mesh.geometry.attributes.color) {
    const colors = new Float32Array(position.count * 3)
    for (let i = 0; i < position.count; i++) {
      colors[i * 3] = gingivaColor.r
      colors[i * 3 + 1] = gingivaColor.g
      colors[i * 3 + 2] = gingivaColor.b
    }
    mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  }

  ensureFaceLabels(mesh)

  const geometry = mesh.geometry as BVHGeometry
  if (!geometry.computeBoundsTree) geometry.computeBoundsTree = computeBoundsTree
  if (!geometry.disposeBoundsTree) geometry.disposeBoundsTree = disposeBoundsTree
  if (!geometry.boundsTree) geometry.computeBoundsTree?.()
  mesh.raycast = acceleratedRaycast

  enableVertexColors(mesh)
  repaintMesh(mesh)
  preparedMeshSet.add(mesh)
}

function initScene(container: HTMLDivElement) {
  scene = new THREE.Scene()
  scene.background = new THREE.Color(SCENE_CONFIG.background)

  camera = new THREE.PerspectiveCamera(
    SCENE_CONFIG.cameraFov,
    container.clientWidth / container.clientHeight,
    SCENE_CONFIG.cameraNear,
    SCENE_CONFIG.cameraFar,
  )
  camera.position.set(
    SCENE_CONFIG.cameraPosition.x,
    SCENE_CONFIG.cameraPosition.y,
    SCENE_CONFIG.cameraPosition.z,
  )
  camera.up.set(SCENE_CONFIG.cameraUp.x, SCENE_CONFIG.cameraUp.y, SCENE_CONFIG.cameraUp.z)

  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(container.clientWidth, container.clientHeight)
  renderer.setPixelRatio(window.devicePixelRatio)
  container.appendChild(renderer.domElement)

  scene.add(new THREE.AmbientLight(0xffffff, 0.8))

  const light1 = new THREE.DirectionalLight(0xffffff, 1.2)
  light1.position.set(100, 100, 100)
  scene.add(light1)

  const light2 = new THREE.DirectionalLight(0xffffff, 0.6)
  light2.position.set(-1, 0.5, -1)
  scene.add(light2)

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
}

async function loadMeshes() {
  if (!scene) return

  const [upperSource, lowerSource] = await Promise.all([
    loadSTL(modelConfig.upper),
    loadSTL(modelConfig.lower),
  ])

  rawUpperGeometry = upperSource
  rawLowerGeometry = lowerSource

  upperMesh = createJawMesh(toPaintGeometry(upperSource), 'upper')
  lowerMesh = createJawMesh(toPaintGeometry(lowerSource), 'lower')

  await Promise.all([
    loadBaseline(modelConfig.upperJson, upperMesh, 'upper'),
    loadBaseline(modelConfig.lowerJson, lowerMesh, 'lower'),
  ])

  if (selectedToothId.value == null && availableToothIds.value.length) {
    selectedToothId.value = availableToothIds.value[0] ?? null
  }

  scene.add(upperMesh)
  scene.add(lowerMesh)

  targets = [upperMesh, lowerMesh]
  targets.forEach(preparePaintMesh)
}

function fitCamera() {
  if (!camera || !controls || !upperMesh || !lowerMesh) return

  const box = new THREE.Box3()
  box.setFromObject(upperMesh)
  box.expandByObject(lowerMesh)

  const center = new THREE.Vector3()
  const size = new THREE.Vector3()
  box.getCenter(center)
  box.getSize(size)

  const distance = Math.max(size.x, size.y, size.z) * 1.8
  controls.target.copy(center)
  camera.position.copy(center.clone().add(new THREE.Vector3(0, distance, 0)))
  camera.lookAt(center)
  controls.update()
}

function applyJawVisible() {
  if (upperMesh) upperMesh.visible = showUpper.value
  if (lowerMesh) lowerMesh.visible = showLower.value
}

function toggleUpper() {
  showUpper.value = !showUpper.value
  applyJawVisible()
}

function toggleLower() {
  showLower.value = !showLower.value
  applyJawVisible()
}

function getBrushLabel(): number | null {
  if (brushMode.value === 'gingiva') return 0
  return normalizeLabel(selectedToothId.value ?? 0) || null
}

function getBrushPreviewColor() {
  if (brushMode.value === 'gingiva') return gingivaColor
  const toothId = normalizeLabel(selectedToothId.value ?? 0)
  return toothId > 0 ? colorForLabel(toothId) : toothColor
}

function updateBrushIndicator() {
  if (!brushIndicator) return
  brushIndicator.scale.setScalar(brushRadius.value)
  if (brushIndicator.material instanceof THREE.MeshBasicMaterial) {
    brushIndicator.material.color.copy(getBrushPreviewColor())
  }
}

function createBrushIndicator() {
  if (!scene) return
  brushIndicator = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 32),
    new THREE.MeshBasicMaterial({
      color: getBrushPreviewColor(),
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  )
  brushIndicator.visible = false
  brushIndicator.renderOrder = 999
  brushIndicator.scale.setScalar(brushRadius.value)
  scene.add(brushIndicator)
}

function getInteractableTargets() {
  return targets.filter((mesh) => mesh.visible)
}

function raycastToTarget(event: PointerEvent): THREE.Intersection | null {
  if (!renderer || !camera) return null
  const interactableTargets = getInteractableTargets()
  if (!interactableTargets.length) return null

  const rect = renderer.domElement.getBoundingClientRect()
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

  raycaster.setFromCamera(mouse, camera)
  const hit = raycaster.intersectObjects(interactableTargets, false)[0] ?? null
  activeTarget = hit ? (hit.object as THREE.Mesh) : null
  return hit
}

function updateHover(event: PointerEvent) {
  if (!brushIndicator) return null
  const hit = raycastToTarget(event)
  if (hit) {
    brushIndicator.visible = true
    brushIndicator.position.copy(hit.point)
  } else {
    brushIndicator.visible = false
  }
  return hit
}

function paintMesh(mesh: THREE.Mesh, localPoint: THREE.Vector3) {
  const geometry = mesh.geometry as BVHGeometry
  const labels = faceLabelMap.get(mesh)
  if (!geometry.boundsTree || !labels) return

  const nextLabel = getBrushLabel()
  if (nextLabel == null) {
    window.alert('请先选择牙号，再进行牙体上色')
    return
  }

  brushSphere.set(localPoint, brushRadius.value)
  const hitTriangles: number[] = []

  geometry.boundsTree.shapecast({
    intersectsBounds: (box: THREE.Box3) => box.intersectsSphere(brushSphere),
    intersectsTriangle: (tri: THREE.Triangle, triangleIndex: number) => {
      tempTriangleCenter.copy(tri.a).add(tri.b).add(tri.c).multiplyScalar(1 / 3)
      if (tempTriangleCenter.distanceTo(localPoint) <= brushRadius.value) {
        hitTriangles.push(triangleIndex)
      }
      return false
    },
  })

  for (const triangleIndex of hitTriangles) {
    labels[triangleIndex] = nextLabel
  }

  repaintMesh(mesh)
}

function paintAtIntersect(intersect: THREE.Intersection) {
  if (!activeTarget) return
  const localPoint = activeTarget.worldToLocal(intersect.point.clone())
  paintMesh(activeTarget, localPoint)
}

function onPointerDown(event: PointerEvent) {
  if (previewSegmentResult.value || event.button !== 0) return

  const hit = updateHover(event)
  if (!hit) {
    if (controls) controls.enabled = true
    return
  }

  isPainting = true
  if (controls) controls.enabled = false
  paintAtIntersect(hit)
  event.preventDefault()
  event.stopPropagation()

  const currentTarget = event.currentTarget as HTMLElement | null
  currentTarget?.setPointerCapture?.(event.pointerId)
}

function onPointerMove(event: PointerEvent) {
  const hit = updateHover(event)
  if (!isPainting || !hit) return
  paintAtIntersect(hit)
  event.preventDefault()
}

function endPainting() {
  isPainting = false
  if (controls) controls.enabled = true
}

function onPointerUp() {
  endPainting()
}

function onPointerLeave() {
  if (brushIndicator) brushIndicator.visible = false
  endPainting()
}

function bindPointerEvents() {
  if (!renderer) return
  eventCanvas = renderer.domElement
  eventCanvas.addEventListener('pointerdown', onPointerDown, {
    capture: true,
    passive: false,
  })
  eventCanvas.addEventListener('pointermove', onPointerMove, { passive: false })
  eventCanvas.addEventListener('pointerup', onPointerUp)
  eventCanvas.addEventListener('pointerleave', onPointerLeave)
  window.addEventListener('pointerup', onPointerUp)
}

function unbindPointerEvents() {
  if (eventCanvas) {
    eventCanvas.removeEventListener('pointerdown', onPointerDown, true)
    eventCanvas.removeEventListener('pointermove', onPointerMove)
    eventCanvas.removeEventListener('pointerup', onPointerUp)
    eventCanvas.removeEventListener('pointerleave', onPointerLeave)
  }
  window.removeEventListener('pointerup', onPointerUp)
  eventCanvas = null
}

function resetSegmentation() {
  targets.forEach((mesh) => {
    const labels = faceLabelMap.get(mesh)
    if (!labels) return
    labels.fill(0)
    repaintMesh(mesh)
  })
}

function parseBatchToothIds(input: string) {
  return Array.from(
    new Set(
      input
        .split(/[\s,，、]+/)
        .map((item) => normalizeLabel(Number(item)))
        .filter((value) => value > 0),
    ),
  )
}

function applyBatchTeeth() {
  const toothIds = parseBatchToothIds(batchToothIdsInput.value)
  if (!toothIds.length) {
    window.alert('请输入至少一个有效牙号，例如 11,12,21')
    return
  }

  targets.forEach((mesh) => {
    const labels = faceLabelMap.get(mesh)
    const baseline = baselineMap.get(mesh)
    if (!labels || !baseline || baseline.length !== labels.length) return

    for (let i = 0; i < labels.length; i++) {
      const baselineLabel = baseline[i] ?? 0
      if (toothIds.includes(baselineLabel)) {
        labels[i] = baselineLabel
      }
    }

    repaintMesh(mesh)
  })

  if (selectedToothId.value == null) {
    selectedToothId.value = toothIds[0] ?? null
  }
}

function getExportLabels(mesh: THREE.Mesh | null) {
  if (!mesh) return []
  const labels = faceLabelMap.get(mesh)
  return labels ? Array.from(labels) : []
}

function downloadJson(filename: string, payload: Record<string, unknown>) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function exportJawLabels(jaw: JawType) {
  const mesh = jaw === 'upper' ? upperMesh : lowerMesh
  downloadJson(`${jaw}-labels.json`, {
    jaw,
    version: 1,
    labels: getExportLabels(mesh),
  })
}

function exportUpperLabels() {
  exportJawLabels('upper')
}

function exportLowerLabels() {
  exportJawLabels('lower')
}

function buildSegmentedGeometry(mesh: THREE.Mesh, isTooth: boolean) {
  const labels = faceLabelMap.get(mesh)
  const positions = mesh.geometry.attributes.position as THREE.BufferAttribute | undefined
  const normals = mesh.geometry.attributes.normal as THREE.BufferAttribute | undefined
  const index = mesh.geometry.index
  if (!labels || !positions) return null

  const nextPositions: number[] = []
  const nextNormals: number[] = []

  const pushVertex = (vertexIndex: number) => {
    nextPositions.push(
      positions.getX(vertexIndex),
      positions.getY(vertexIndex),
      positions.getZ(vertexIndex),
    )
    if (normals) {
      nextNormals.push(
        normals.getX(vertexIndex),
        normals.getY(vertexIndex),
        normals.getZ(vertexIndex),
      )
    }
  }

  for (let tri = 0; tri < labels.length; tri++) {
    const isFaceTooth = (labels[tri] ?? 0) > 0
    if (isFaceTooth !== isTooth) continue
    if (index) {
      pushVertex(index.getX(tri * 3))
      pushVertex(index.getX(tri * 3 + 1))
      pushVertex(index.getX(tri * 3 + 2))
    } else {
      pushVertex(tri * 3)
      pushVertex(tri * 3 + 1)
      pushVertex(tri * 3 + 2)
    }
  }

  if (!nextPositions.length) return null

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(nextPositions, 3))
  if (nextNormals.length) {
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nextNormals, 3))
  } else {
    geometry.computeVertexNormals()
  }
  geometry.computeBoundingSphere()
  geometry.computeBoundingBox()
  return geometry
}

function disposePreviewGroup() {
  if (!previewGroup || !scene) return
  scene.remove(previewGroup)
  previewGroup.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    child.geometry.dispose()
    if (Array.isArray(child.material)) {
      child.material.forEach((material) => material.dispose())
    } else {
      child.material.dispose()
    }
  })
  previewGroup = null
}

function buildPreview() {
  if (!scene) return
  disposePreviewGroup()
  previewGroup = new THREE.Group()

  targets.forEach((mesh) => {
    const toothGeometry = buildSegmentedGeometry(mesh, true)
    const gingivaGeometry = buildSegmentedGeometry(mesh, false)

    if (toothGeometry) {
      const toothMesh = new THREE.Mesh(
        toothGeometry,
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          side: THREE.DoubleSide,
          metalness: 0.05,
          roughness: 0.85,
        }),
      )
      toothMesh.position.copy(mesh.position)
      toothMesh.rotation.copy(mesh.rotation)
      toothMesh.scale.copy(mesh.scale)
      previewGroup!.add(toothMesh)
    }

    if (gingivaGeometry) {
      const gingivaMesh = new THREE.Mesh(
        gingivaGeometry,
        new THREE.MeshStandardMaterial({
          color: 0xc97f88,
          side: THREE.DoubleSide,
          metalness: 0.05,
          roughness: 0.9,
        }),
      )
      gingivaMesh.position.copy(mesh.position)
      gingivaMesh.rotation.copy(mesh.rotation)
      gingivaMesh.scale.copy(mesh.scale)
      previewGroup!.add(gingivaMesh)
    }
  })

  if (!previewGroup.children.length) {
    previewGroup = null
    return
  }

  scene.add(previewGroup)
}

function toggleSegmentPreview() {
  previewSegmentResult.value = !previewSegmentResult.value
  if (previewSegmentResult.value) {
    getAllMeshes().forEach((mesh) => {
      mesh.visible = false
    })
    buildPreview()
  } else {
    disposePreviewGroup()
    applyJawVisible()
  }
}

function animate() {
  if (!scene || !camera || !renderer || !controls) return
  animationId = requestAnimationFrame(animate)
  controls.update()
  renderer.render(scene, camera)
}

function disposeScene() {
  if (animationId != null) {
    cancelAnimationFrame(animationId)
    animationId = null
  }

  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler)
    resizeHandler = null
  }

  unbindPointerEvents()
  disposePreviewGroup()

  if (brushIndicator && scene) {
    scene.remove(brushIndicator)
    brushIndicator.geometry.dispose()
    if (brushIndicator.material instanceof THREE.Material) {
      brushIndicator.material.dispose()
    }
    brushIndicator = null
  }

  targets.forEach((mesh) => {
    const geometry = mesh.geometry as BVHGeometry
    geometry.disposeBoundsTree?.()
  })

  if (scene) {
    scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return
      obj.geometry?.dispose()
      if (Array.isArray(obj.material)) {
        obj.material.forEach((material) => material.dispose())
      } else {
        obj.material?.dispose()
      }
    })
    scene.clear()
  }

  controls?.dispose()
  controls = null
  scene = null

  if (renderer) {
    renderer.dispose()
    renderer.domElement.remove()
  }
  renderer = null
  camera = null

  rawUpperGeometry?.dispose()
  rawLowerGeometry?.dispose()
  rawUpperGeometry = null
  rawLowerGeometry = null
  upperMesh = null
  lowerMesh = null
  targets = []
}

watch(brushRadius, updateBrushIndicator)
watch([brushMode, selectedToothId], updateBrushIndicator)

onMounted(async () => {
  if (!containerRef.value) return
  initScene(containerRef.value)
  await loadMeshes()
  fitCamera()
  applyJawVisible()
  createBrushIndicator()
  bindPointerEvents()
  animate()
})

onUnmounted(() => {
  disposeScene()
})
</script>

<style scoped lang="scss">
.content {
  position: relative;
  height: 90vh;
  background: #f5f7fa;
}

.container {
  width: 100%;
  height: 100%;
}

.toolbar {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  max-width: calc(100% - 24px);
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.94);
  border-radius: 10px;
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08);
}

.mode-group {
  display: flex;
  gap: 8px;
}

.tool-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
}

.tooth-input,
.bulk-input {
  height: 30px;
  padding: 0 8px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  outline: none;
}

.tooth-input {
  width: 84px;
}

.bulk-item {
  min-width: 230px;
}

.bulk-input {
  width: 150px;
}

.quick-tooth-list {
  position: absolute;
  top: 78px;
  left: 12px;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  max-width: calc(100% - 24px);
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.94);
  border-radius: 10px;
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08);
}

.quick-title {
  font-size: 13px;
  color: #475569;
}

.quick-tooth-btn {
  min-width: 42px;
}

.tips {
  position: absolute;
  top: 126px;
  left: 12px;
  z-index: 10;
  max-width: min(900px, calc(100% - 24px));
  padding: 8px 12px;
  font-size: 13px;
  line-height: 1.5;
  color: #334155;
  background: rgba(255, 255, 255, 0.94);
  border-radius: 10px;
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08);
}

button.active {
  color: #fff;
  background: #409eff;
  border-color: #409eff;
}
</style>
