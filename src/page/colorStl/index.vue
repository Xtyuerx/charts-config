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

      <label class="tool-item">
        <span>笔刷半径</span>
        <input v-model.number="brushRadius" type="range" min="0.5" max="12" step="0.1" />
        <span>{{ brushRadius.toFixed(1) }}</span>
      </label>

      <button @click="resetSegmentation">重置标注</button>
      <button @click="toggleSegmentPreview">
        {{ previewSegmentResult ? '返回编辑' : '预览分割结果' }}
      </button>
      <button @click="exportSelectedToothRegion">导出当前牙号 JSON</button>
      <button @click="exportUpperLabels">导出上颌 JSON</button>
      <button @click="exportLowerLabels">导出下颌 JSON</button>
    </div>

    <div class="quick-tooth-list">
      <span class="quick-title">快速选择牙号：</span>
      <button
        v-for="toothId in toothOptions"
        :key="toothId"
        class="quick-tooth-btn"
        :class="{ active: selectedToothId === toothId }"
        @click="selectedToothId = toothId"
      >
        {{ toothId }}
      </button>
    </div>

    <div class="tips">
      这里只加载 STL，本次涂色结果直接写在三角面标签上。一个牙号对应一种颜色，导出 JSON 后可按
      `faceLabels` 或 `labels` 直接还原每颗牙齿的范围。
    </div>

    <div ref="containerRef" class="container"></div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh'
import { STLLoader, TrackballControls } from 'three-stdlib'
import { MATERIAL_CONFIG, SCENE_CONFIG } from '@/page/newAnalysis/modelAnalysis/constants'

type BrushMode = 'tooth' | 'gingiva'
type JawType = 'upper' | 'lower'

type BVHGeometry = THREE.BufferGeometry & {
  boundsTree?: {
    closestPointToPoint?: (
      point: THREE.Vector3,
      target?: { faceIndex?: number | null; distance?: number; point?: THREE.Vector3 },
      minThreshold?: number,
      maxThreshold?: number,
    ) => number
    shapecast: (options: {
      intersectsBounds: (box: THREE.Box3) => boolean
      intersectsTriangle: (tri: THREE.Triangle, triangleIndex: number) => boolean | void
    }) => void
  }
  computeBoundsTree?: () => void
  disposeBoundsTree?: () => void
}

type Point3 = [number, number, number]

type ToothTriangleRecord = {
  triangleIndex: number
  centroid: Point3
  vertices: [Point3, Point3, Point3]
}

type ToothRegionRecord = {
  toothId: number
  jaw: JawType
  triangleCount: number
  area: number
  centroid: Point3
  bounds: {
    min: Point3
      max: Point3
      size: Point3
  }
  rawContourLoops: Point3[][]
  contourLoops: Point3[][]
  triangleIndices: number[]
  triangles: ToothTriangleRecord[]
}

type JawLabelExport = {
  format: 'stl-labels'
  version: 3
  jaw: JawType
  triangleCount: number
  vertexCount: number
  labeledTriangleCount: number
  toothIds: number[]
  labels: number[]
  faceLabels: number[]
  teeth: ToothRegionRecord[]
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
const brushRadius = ref(4)
const brushMode = ref<BrushMode>('tooth')
const toothOptions = [11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 26, 27, 28, 31, 32, 33, 34, 35, 36, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48]
const selectedToothId = ref<number | null>(toothOptions[0] ?? null)
const previewSegmentResult = ref(false)

const modelConfig = {
  upper: '/models/upper.stl',
  lower: '/models/lower.stl',
}

const toothColor = new THREE.Color(0xffffff)
const gingivaColor = new THREE.Color(0xc97f88)

const faceLabelMap = new WeakMap<THREE.Mesh, Uint16Array>()
const triangleAdjacencyMap = new WeakMap<THREE.Mesh, number[][]>()
const triangleCenterMap = new WeakMap<THREE.Mesh, Float32Array>()
const toothAnchorTriangleMap = new WeakMap<THREE.Mesh, Map<number, number>>()
const preparedMeshSet = new WeakSet<THREE.Mesh>()

const raycaster = new THREE.Raycaster()
const mouse = new THREE.Vector2()

let targets: THREE.Mesh[] = []
let isPainting = false
let didDragPaint = false
let lastStrokeMesh: THREE.Mesh | null = null
let lastStrokeTriangleIndex: number | null = null

const BRUSH_PAINT_FACTOR = 2.8
const STROKE_LINK_FACTOR = 8
const TOOTH_EXPORT_RADIUS_FACTOR = 0.065
const TOOTH_EXPORT_RADIUS_MIN = 2.8
const TOOTH_EXPORT_RADIUS_MAX = 5.2

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

function toPoint3(vector: THREE.Vector3): Point3 {
  return [vector.x, vector.y, vector.z]
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

function ensureGeometryBoundsTree(geometry: THREE.BufferGeometry) {
  const bvhGeometry = geometry as BVHGeometry
  if (!bvhGeometry.computeBoundsTree) bvhGeometry.computeBoundsTree = computeBoundsTree
  if (!bvhGeometry.disposeBoundsTree) bvhGeometry.disposeBoundsTree = disposeBoundsTree
  if (!bvhGeometry.boundsTree) bvhGeometry.computeBoundsTree?.()
  return bvhGeometry
}

function getTriangleCenter(
  geometry: THREE.BufferGeometry,
  triangleIndex: number,
  target: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
) {
  const position = geometry.attributes.position as THREE.BufferAttribute | undefined
  if (!position) return target.set(0, 0, 0)

  a.fromBufferAttribute(position, triangleIndex * 3)
  b.fromBufferAttribute(position, triangleIndex * 3 + 1)
  c.fromBufferAttribute(position, triangleIndex * 3 + 2)

  return target.copy(a).add(b).add(c).multiplyScalar(1 / 3)
}

function buildTriangleAdjacency(geometry: THREE.BufferGeometry) {
  const position = geometry.attributes.position as THREE.BufferAttribute | undefined
  if (!position) return []

  const triCount = geometry.index ? geometry.index.count / 3 : Math.floor(position.count / 3)
  const adjacency = Array.from({ length: triCount }, () => [] as number[])
  const edgeMap = new Map<string, number[]>()
  const tempA = new THREE.Vector3()
  const tempB = new THREE.Vector3()

  const getVertexIndex = (triangleIndex: number, vertexOffset: number) =>
    geometry.index ? geometry.index.getX(triangleIndex * 3 + vertexOffset) : triangleIndex * 3 + vertexOffset

  const toKey = (vertex: THREE.Vector3) =>
    `${(vertex.x * 1e5).toFixed(0)},${(vertex.y * 1e5).toFixed(0)},${(vertex.z * 1e5).toFixed(0)}`

  const getEdgeKey = (firstVertexIndex: number, secondVertexIndex: number) => {
    tempA.fromBufferAttribute(position, firstVertexIndex)
    tempB.fromBufferAttribute(position, secondVertexIndex)
    const keyA = toKey(tempA)
    const keyB = toKey(tempB)
    return keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`
  }

  for (let triangleIndex = 0; triangleIndex < triCount; triangleIndex++) {
    const vertexIndices = [
      getVertexIndex(triangleIndex, 0),
      getVertexIndex(triangleIndex, 1),
      getVertexIndex(triangleIndex, 2),
    ]

    for (const [from, to] of [
      [vertexIndices[0], vertexIndices[1]],
      [vertexIndices[1], vertexIndices[2]],
      [vertexIndices[2], vertexIndices[0]],
    ] as const) {
      if (from == null || to == null) continue
      const edgeKey = getEdgeKey(from, to)
      const triangles = edgeMap.get(edgeKey)
      if (triangles) {
        triangles.push(triangleIndex)
      } else {
        edgeMap.set(edgeKey, [triangleIndex])
      }
    }
  }

  for (const triangles of edgeMap.values()) {
    const uniqueTriangles = Array.from(new Set(triangles))
    for (let i = 0; i < uniqueTriangles.length; i++) {
      for (let j = i + 1; j < uniqueTriangles.length; j++) {
        const current = uniqueTriangles[i]
        const neighbor = uniqueTriangles[j]
        if (current == null || neighbor == null) continue
        adjacency[current]?.push(neighbor)
        adjacency[neighbor]?.push(current)
      }
    }
  }

  return adjacency
}

function buildTriangleCenters(geometry: THREE.BufferGeometry) {
  const position = geometry.attributes.position as THREE.BufferAttribute | undefined
  if (!position) return new Float32Array()

  const triCount = geometry.index ? geometry.index.count / 3 : Math.floor(position.count / 3)
  const centers = new Float32Array(triCount * 3)
  const center = new THREE.Vector3()
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()

  for (let triangleIndex = 0; triangleIndex < triCount; triangleIndex++) {
    getTriangleCenter(geometry, triangleIndex, center, a, b, c)
    const base = triangleIndex * 3
    centers[base] = center.x
    centers[base + 1] = center.y
    centers[base + 2] = center.z
  }

  return centers
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

  ensureGeometryBoundsTree(mesh.geometry)
  mesh.raycast = acceleratedRaycast
  triangleAdjacencyMap.set(mesh, buildTriangleAdjacency(mesh.geometry))
  triangleCenterMap.set(mesh, buildTriangleCenters(mesh.geometry))

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
  const toothId = normalizeLabel(selectedToothId.value ?? 0)
  if (!toothId) return null
  if (brushMode.value === 'gingiva') return 0
  return toothId
}

function getLocalBrushRadius(mesh: THREE.Mesh) {
  const scaleX = Math.abs(mesh.scale.x) || 1
  const scaleY = Math.abs(mesh.scale.y) || 1
  const scaleZ = Math.abs(mesh.scale.z) || 1
  const averageScale = (scaleX + scaleY + scaleZ) / 3
  return brushRadius.value / averageScale
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
  return raycaster.intersectObjects(interactableTargets, false)[0] ?? null
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

function getTriangleCenterDistance(centers: Float32Array, fromTriangleIndex: number, toTriangleIndex: number) {
  const fromBase = fromTriangleIndex * 3
  const toBase = toTriangleIndex * 3
  const dx = (centers[fromBase] ?? 0) - (centers[toBase] ?? 0)
  const dy = (centers[fromBase + 1] ?? 0) - (centers[toBase + 1] ?? 0)
  const dz = (centers[fromBase + 2] ?? 0) - (centers[toBase + 2] ?? 0)
  return Math.hypot(dx, dy, dz)
}

function ensureMeshTopology(mesh: THREE.Mesh) {
  let adjacency = triangleAdjacencyMap.get(mesh)
  if (!adjacency?.length) {
    adjacency = buildTriangleAdjacency(mesh.geometry)
    triangleAdjacencyMap.set(mesh, adjacency)
  }

  let centers = triangleCenterMap.get(mesh)
  if (!centers?.length) {
    centers = buildTriangleCenters(mesh.geometry)
    triangleCenterMap.set(mesh, centers)
  }

  return { adjacency, centers }
}

function buildSurfacePath(
  adjacency: number[][],
  centers: Float32Array,
  fromTriangleIndex: number,
  toTriangleIndex: number,
  maxDistance: number,
) {
  if (fromTriangleIndex === toTriangleIndex) return [toTriangleIndex]

  const queue = [fromTriangleIndex]
  const bestDistanceMap = new Map<number, number>([[fromTriangleIndex, 0]])
  const previousMap = new Map<number, number>()

  while (queue.length) {
    let bestIndex = 0
    let bestDistance = Infinity
    for (let i = 0; i < queue.length; i++) {
      const triangleIndex = queue[i]
      if (triangleIndex == null) continue
      const distance = bestDistanceMap.get(triangleIndex) ?? Infinity
      if (distance < bestDistance) {
        bestDistance = distance
        bestIndex = i
      }
    }

    const triangleIndex = queue.splice(bestIndex, 1)[0]
    if (triangleIndex == null) continue

    const currentDistance = bestDistanceMap.get(triangleIndex) ?? Infinity
    if (currentDistance > maxDistance) continue
    if (triangleIndex === toTriangleIndex) {
      const path = [triangleIndex]
      let cursor = triangleIndex
      while (previousMap.has(cursor)) {
        cursor = previousMap.get(cursor)!
        path.push(cursor)
      }
      path.reverse()
      return path
    }

    for (const neighborTriangleIndex of adjacency[triangleIndex] ?? []) {
      const nextDistance =
        currentDistance + getTriangleCenterDistance(centers, triangleIndex, neighborTriangleIndex)
      const previousDistance = bestDistanceMap.get(neighborTriangleIndex)
      if (nextDistance <= maxDistance && (previousDistance == null || nextDistance < previousDistance)) {
        bestDistanceMap.set(neighborTriangleIndex, nextDistance)
        previousMap.set(neighborTriangleIndex, triangleIndex)
        queue.push(neighborTriangleIndex)
      }
    }
  }

  return null
}

function resolveStrokeSeeds(mesh: THREE.Mesh, triangleIndex: number) {
  if (lastStrokeMesh !== mesh || lastStrokeTriangleIndex == null) {
    return [triangleIndex]
  }

  const { adjacency, centers } = ensureMeshTopology(mesh)
  if (!adjacency?.length || !centers?.length) {
    return [triangleIndex]
  }

  const directDistance = getTriangleCenterDistance(centers, lastStrokeTriangleIndex, triangleIndex)
  const localBrushRadius = getLocalBrushRadius(mesh)
  if (directDistance > localBrushRadius * STROKE_LINK_FACTOR) {
    return [triangleIndex]
  }

  return buildSurfacePath(
    adjacency,
    centers,
    lastStrokeTriangleIndex,
    triangleIndex,
    directDistance * 2 + localBrushRadius,
  ) ?? [triangleIndex]
}

function paintMesh(mesh: THREE.Mesh, seedTriangleIndices: number[]) {
  const geometry = mesh.geometry as BVHGeometry
  const labels = faceLabelMap.get(mesh)
  const { adjacency, centers } = ensureMeshTopology(mesh)
  if (!geometry.boundsTree || !labels || !adjacency?.length || !centers?.length) return false

  const nextLabel = getBrushLabel()
  if (nextLabel == null) {
    window.alert('请先选择牙号，再进行涂色')
    return false
  }

  const safeSeeds = Array.from(
    new Set(
      seedTriangleIndices
        .map((triangleIndex) => Math.max(0, Math.min(triangleIndex, labels.length - 1)))
        .filter((triangleIndex) => Number.isFinite(triangleIndex)),
    ),
  )
  if (!safeSeeds.length) return false

  const localBrushRadius = getLocalBrushRadius(mesh) * BRUSH_PAINT_FACTOR
  const visited = new Uint8Array(labels.length)
  const queue = [...safeSeeds]
  const distanceMap = new Map<number, number>()
  let painted = false
  safeSeeds.forEach((triangleIndex) => {
    distanceMap.set(triangleIndex, 0)
  })

  while (queue.length) {
    let bestIndex = 0
    let bestDistance = Infinity
    for (let i = 0; i < queue.length; i++) {
      const candidateTriangleIndex = queue[i]
      if (candidateTriangleIndex == null) continue
      const candidateDistance = distanceMap.get(candidateTriangleIndex) ?? Infinity
      if (candidateDistance < bestDistance) {
        bestDistance = candidateDistance
        bestIndex = i
      }
    }

    const triangleIndex = queue.splice(bestIndex, 1)[0]
    if (triangleIndex == null || visited[triangleIndex]) continue
    visited[triangleIndex] = 1

    const currentDistance = distanceMap.get(triangleIndex) ?? Infinity
    if (currentDistance > localBrushRadius) {
      continue
    }

    painted = true
    labels[triangleIndex] = nextLabel

    for (const neighborTriangleIndex of adjacency[triangleIndex] ?? []) {
      if (visited[neighborTriangleIndex]) continue

      const nextDistance =
        currentDistance + getTriangleCenterDistance(centers, triangleIndex, neighborTriangleIndex)
      const previousDistance = distanceMap.get(neighborTriangleIndex)
      if (nextDistance <= localBrushRadius && (previousDistance == null || nextDistance < previousDistance)) {
        distanceMap.set(neighborTriangleIndex, nextDistance)
        queue.push(neighborTriangleIndex)
      }
    }
  }

  if (painted) {
    repaintMesh(mesh)
  }

  return painted
}

function paintAtIntersect(intersect: THREE.Intersection) {
  const mesh = intersect.object as THREE.Mesh
  const faceIndex = typeof intersect.faceIndex === 'number' ? intersect.faceIndex : -1
  if (faceIndex < 0) return false
  const currentLabel = getBrushLabel()
  const painted = paintMesh(mesh, resolveStrokeSeeds(mesh, faceIndex))
  if (painted && currentLabel != null && currentLabel > 0) {
    setToothAnchorTriangle(mesh, currentLabel, faceIndex)
  }
  lastStrokeMesh = mesh
  lastStrokeTriangleIndex = faceIndex
  return painted
}

function onPointerDown(event: PointerEvent) {
  if (previewSegmentResult.value || event.button !== 0) return

  const hit = updateHover(event)
  if (!hit) {
    if (controls) controls.enabled = true
    return
  }

  if (typeof hit.faceIndex !== 'number' || hit.faceIndex < 0) {
    return
  }

  isPainting = true
  didDragPaint = false
  didDragPaint = paintAtIntersect(hit)
  if (controls) controls.enabled = false
  event.preventDefault()
  event.stopPropagation()

  const currentTarget = event.currentTarget as HTMLElement | null
  currentTarget?.setPointerCapture?.(event.pointerId)
}

function onPointerMove(event: PointerEvent) {
  const hit = updateHover(event)
  if (!isPainting || !hit) return
  didDragPaint = paintAtIntersect(hit) || didDragPaint
  event.preventDefault()
}

function endPainting() {
  isPainting = false
  didDragPaint = false
  lastStrokeMesh = null
  lastStrokeTriangleIndex = null
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
  eventCanvas.addEventListener('pointercancel', onPointerUp)
  eventCanvas.addEventListener('pointerleave', onPointerLeave)
  window.addEventListener('pointerup', onPointerUp)
}

function unbindPointerEvents() {
  if (eventCanvas) {
    eventCanvas.removeEventListener('pointerdown', onPointerDown, true)
    eventCanvas.removeEventListener('pointermove', onPointerMove)
    eventCanvas.removeEventListener('pointerup', onPointerUp)
    eventCanvas.removeEventListener('pointercancel', onPointerUp)
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

function getExportFaceLabels(mesh: THREE.Mesh | null, toothId: number | null = null) {
  if (!mesh) return []
  const labels = faceLabelMap.get(mesh)
  if (!labels) return []

  if (toothId == null || toothId <= 0) {
    return Array.from(labels)
  }

  return Array.from(labels, (label) => (label === toothId ? toothId : 0))
}

function setToothAnchorTriangle(mesh: THREE.Mesh, toothId: number, triangleIndex: number) {
  let anchorMap = toothAnchorTriangleMap.get(mesh)
  if (!anchorMap) {
    anchorMap = new Map<number, number>()
    toothAnchorTriangleMap.set(mesh, anchorMap)
  }
  anchorMap.set(toothId, triangleIndex)
}

function getToothAnchorTriangle(mesh: THREE.Mesh, toothId: number) {
  return toothAnchorTriangleMap.get(mesh)?.get(toothId) ?? null
}

function getToothExportRadius(mesh: THREE.Mesh) {
  const position = mesh.geometry.attributes.position as THREE.BufferAttribute | undefined
  if (!position) return TOOTH_EXPORT_RADIUS_MAX

  if (!mesh.geometry.boundingBox) {
    mesh.geometry.computeBoundingBox()
  }

  const boundingBox = mesh.geometry.boundingBox
  if (!boundingBox) return TOOTH_EXPORT_RADIUS_MAX

  const size = new THREE.Vector3()
  boundingBox.getSize(size)
  const radius = Math.max(size.x, size.y) * TOOTH_EXPORT_RADIUS_FACTOR
  return Math.min(TOOTH_EXPORT_RADIUS_MAX, Math.max(TOOTH_EXPORT_RADIUS_MIN, radius))
}

function getLargestConnectedToothLabels(
  mesh: THREE.Mesh,
  toothId: number,
  anchorTriangleIndex?: number | null,
) {
  const labels = faceLabelMap.get(mesh)
  if (!labels) return []

  const { adjacency, centers } = ensureMeshTopology(mesh)
  if (!adjacency?.length) {
    return getExportFaceLabels(mesh, toothId)
  }

  if (
    anchorTriangleIndex != null &&
    anchorTriangleIndex >= 0 &&
    anchorTriangleIndex < labels.length &&
    labels[anchorTriangleIndex] === toothId &&
    centers?.length
  ) {
    const visited = new Uint8Array(labels.length)
    const queue = [anchorTriangleIndex]
    const component: number[] = []
    visited[anchorTriangleIndex] = 1
    const anchorBase = anchorTriangleIndex * 3
    const anchorCenter = new THREE.Vector3(
      centers[anchorBase] ?? 0,
      centers[anchorBase + 1] ?? 0,
      centers[anchorBase + 2] ?? 0,
    )
    const maxDistance = getToothExportRadius(mesh)

    while (queue.length) {
      const triangleIndex = queue.shift()
      if (triangleIndex == null) continue

      component.push(triangleIndex)
      for (const neighborTriangleIndex of adjacency[triangleIndex] ?? []) {
        if (visited[neighborTriangleIndex] || labels[neighborTriangleIndex] !== toothId) continue
        const neighborBase = neighborTriangleIndex * 3
        const distanceToAnchor = anchorCenter.distanceTo(
          new THREE.Vector3(
            centers[neighborBase] ?? 0,
            centers[neighborBase + 1] ?? 0,
            centers[neighborBase + 2] ?? 0,
          ),
        )
        if (distanceToAnchor > maxDistance) continue
        visited[neighborTriangleIndex] = 1
        queue.push(neighborTriangleIndex)
      }
    }

    const nextLabels = new Array<number>(labels.length).fill(0)
    component.forEach((triangleIndex) => {
      nextLabels[triangleIndex] = toothId
    })
    return nextLabels
  }

  const visited = new Uint8Array(labels.length)
  let bestComponent: number[] = []

  for (let start = 0; start < labels.length; start++) {
    if (visited[start] || labels[start] !== toothId) continue

    const queue = [start]
    const component: number[] = []
    visited[start] = 1

    while (queue.length) {
      const triangleIndex = queue.shift()
      if (triangleIndex == null) continue

      component.push(triangleIndex)
      for (const neighborTriangleIndex of adjacency[triangleIndex] ?? []) {
        if (visited[neighborTriangleIndex] || labels[neighborTriangleIndex] !== toothId) continue
        visited[neighborTriangleIndex] = 1
        queue.push(neighborTriangleIndex)
      }
    }

    if (component.length > bestComponent.length) {
      bestComponent = component
    }
  }

  if (!bestComponent.length) {
    return getExportFaceLabels(mesh, toothId)
  }

  const nextLabels = new Array<number>(labels.length).fill(0)
  bestComponent.forEach((triangleIndex) => {
    nextLabels[triangleIndex] = toothId
  })
  return nextLabels
}

function getTriangleVertices(mesh: THREE.Mesh, triangleIndex: number) {
  const position = mesh.geometry.attributes.position as THREE.BufferAttribute | undefined
  if (!position) return null

  const a = new THREE.Vector3().fromBufferAttribute(position, triangleIndex * 3)
  const b = new THREE.Vector3().fromBufferAttribute(position, triangleIndex * 3 + 1)
  const c = new THREE.Vector3().fromBufferAttribute(position, triangleIndex * 3 + 2)
  return { a, b, c }
}

function buildContourLoopsFromTriangles(triangles: ToothTriangleRecord[]) {
  const pointMap = new Map<string, Point3>()
  const edgeUseCount = new Map<string, number>()
  const vertexNeighbors = new Map<string, Set<string>>()

  const addEdge = (from: Point3, to: Point3) => {
    const fromKey = from.join(',')
    const toKey = to.join(',')
    pointMap.set(fromKey, from)
    pointMap.set(toKey, to)

    const edgeKey = fromKey < toKey ? `${fromKey}|${toKey}` : `${toKey}|${fromKey}`
    edgeUseCount.set(edgeKey, (edgeUseCount.get(edgeKey) ?? 0) + 1)
  }

  for (const triangle of triangles) {
    const [a, b, c] = triangle.vertices
    addEdge(a, b)
    addEdge(b, c)
    addEdge(c, a)
  }

  edgeUseCount.forEach((count, edgeKey) => {
    if (count !== 1) return
    const [fromKey, toKey] = edgeKey.split('|')
    if (!fromKey || !toKey) return

    if (!vertexNeighbors.has(fromKey)) vertexNeighbors.set(fromKey, new Set())
    if (!vertexNeighbors.has(toKey)) vertexNeighbors.set(toKey, new Set())
    vertexNeighbors.get(fromKey)?.add(toKey)
    vertexNeighbors.get(toKey)?.add(fromKey)
  })

  const visited = new Set<string>()
  const loops: Point3[][] = []

  const edgeKeyOf = (fromKey: string, toKey: string) =>
    fromKey < toKey ? `${fromKey}|${toKey}` : `${toKey}|${fromKey}`

  vertexNeighbors.forEach((neighbors, startKey) => {
    for (const neighborKey of neighbors) {
      const startEdgeKey = edgeKeyOf(startKey, neighborKey)
      if (visited.has(startEdgeKey)) continue

      const loop: Point3[] = []
      let previousKey: string | null = null
      let currentKey = startKey
      let nextKey: string | null = neighborKey

      while (nextKey) {
        loop.push(pointMap.get(currentKey) ?? pointMap.get(nextKey)!)
        visited.add(edgeKeyOf(currentKey, nextKey))

        previousKey = currentKey
        currentKey = nextKey

        if (currentKey === startKey) break

        const candidates = Array.from(vertexNeighbors.get(currentKey) ?? []).filter((key) => key !== previousKey)
        nextKey = candidates.find((key) => !visited.has(edgeKeyOf(currentKey, key))) ?? null
      }

      if (loop.length >= 3) {
        const closingPoint = pointMap.get(currentKey)
        if (closingPoint) loop.push(closingPoint)
        loops.push(loop)
      }
    }
  })

  return loops
}

function getPointDistance(a: Point3, b: Point3) {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  const dz = a[2] - b[2]
  return Math.hypot(dx, dy, dz)
}

function normalizeClosedLoop(loop: Point3[]) {
  if (loop.length < 2) return [...loop]
  const normalized = [...loop]
  const first = normalized[0]
  const last = normalized[normalized.length - 1]
  if (first && last && getPointDistance(first, last) < 1e-6) {
    normalized.pop()
  }
  return normalized
}

function closeLoop(loop: Point3[]) {
  if (!loop.length) return []
  const closed = [...loop]
  const first = closed[0]
  const last = closed[closed.length - 1]
  if (first && last && getPointDistance(first, last) >= 1e-6) {
    closed.push([...first] as Point3)
  }
  return closed
}

function getLoopPerimeter(loop: Point3[]) {
  const normalized = normalizeClosedLoop(loop)
  if (normalized.length < 2) return 0

  let perimeter = 0
  for (let index = 0; index < normalized.length; index++) {
    const current = normalized[index]
    const next = normalized[(index + 1) % normalized.length]
    if (!current || !next) continue
    perimeter += getPointDistance(current, next)
  }
  return perimeter
}

function simplifyClosedLoop(loop: Point3[], minSegmentLength: number) {
  let current = normalizeClosedLoop(loop)
  if (current.length < 4 || minSegmentLength <= 0) return current

  let changed = true
  while (changed && current.length >= 4) {
    changed = false
    const next: Point3[] = []

    for (let index = 0; index < current.length; index++) {
      const previous = current[(index - 1 + current.length) % current.length]
      const point = current[index]
      const following = current[(index + 1) % current.length]
      if (!previous || !point || !following) continue

      const prevDistance = getPointDistance(previous, point)
      const nextDistance = getPointDistance(point, following)
      if (prevDistance < minSegmentLength && nextDistance < minSegmentLength) {
        changed = true
        continue
      }

      next.push(point)
    }

    if (next.length >= 3) {
      current = next
    } else {
      break
    }
  }

  return current
}

function smoothClosedLoop(loop: Point3[], iterations = 4) {
  let current = normalizeClosedLoop(loop)
  if (current.length < 3) return closeLoop(current)

  const perimeter = getLoopPerimeter(current)
  const minSegmentLength = perimeter > 0 ? perimeter / Math.max(current.length * 3, 1) : 0
  current = simplifyClosedLoop(current, minSegmentLength)
  if (current.length < 3) return closeLoop(current)

  for (let iteration = 0; iteration < iterations; iteration++) {
    const next: Point3[] = []
    for (let index = 0; index < current.length; index++) {
      const point = current[index]
      const following = current[(index + 1) % current.length]
      if (!point || !following) continue

      next.push([
        point[0] * 0.75 + following[0] * 0.25,
        point[1] * 0.75 + following[1] * 0.25,
        point[2] * 0.75 + following[2] * 0.25,
      ])
      next.push([
        point[0] * 0.25 + following[0] * 0.75,
        point[1] * 0.25 + following[1] * 0.75,
        point[2] * 0.25 + following[2] * 0.75,
      ])
    }
    current = next
  }

  return closeLoop(current)
}

function smoothContourLoops(loops: Point3[][]) {
  return loops.map((loop) => smoothClosedLoop(loop))
}

function buildToothRegion(
  mesh: THREE.Mesh,
  jaw: JawType,
  toothId: number,
  labelsOverride?: ArrayLike<number> | null,
): ToothRegionRecord | null {
  const labels = labelsOverride ?? faceLabelMap.get(mesh)
  if (!labels) return null

  const triangleIndices: number[] = []
  const triangles: ToothTriangleRecord[] = []
  const bounds = new THREE.Box3()
  const centroidSum = new THREE.Vector3()
  let area = 0

  for (let triangleIndex = 0; triangleIndex < labels.length; triangleIndex++) {
    if ((labels[triangleIndex] ?? 0) !== toothId) continue

    const vertices = getTriangleVertices(mesh, triangleIndex)
    if (!vertices) continue

    const { a, b, c } = vertices
    const centroid = new THREE.Vector3().copy(a).add(b).add(c).multiplyScalar(1 / 3)
    const triangle = new THREE.Triangle(a, b, c)

    triangleIndices.push(triangleIndex)
    triangles.push({
      triangleIndex,
      centroid: toPoint3(centroid),
      vertices: [toPoint3(a), toPoint3(b), toPoint3(c)],
    })

    centroidSum.add(centroid)
    bounds.expandByPoint(a)
    bounds.expandByPoint(b)
    bounds.expandByPoint(c)
    area += triangle.getArea()
  }

  if (!triangleIndices.length || bounds.isEmpty()) return null

  const size = new THREE.Vector3()
  bounds.getSize(size)
  centroidSum.multiplyScalar(1 / triangleIndices.length)
  const rawContourLoops = buildContourLoopsFromTriangles(triangles)

  return {
    toothId,
    jaw,
    triangleCount: triangleIndices.length,
    area,
    centroid: toPoint3(centroidSum),
    bounds: {
      min: toPoint3(bounds.min),
      max: toPoint3(bounds.max),
      size: toPoint3(size),
    },
    rawContourLoops,
    contourLoops: smoothContourLoops(rawContourLoops),
    triangleIndices,
    triangles,
  }
}

function getLabeledToothIdsFromLabels(labels: ArrayLike<number>) {
  return Array.from(new Set(Array.from(labels).filter((label) => label > 0))).sort((a, b) => a - b)
}

function getJawMesh(jaw: JawType) {
  return jaw === 'upper' ? upperMesh : lowerMesh
}

function countLabeledTriangles(labels: number[]) {
  return labels.reduce((count, label) => count + (label > 0 ? 1 : 0), 0)
}

function buildVertexLabelsFromFaceLabels(mesh: THREE.Mesh, faceLabels: number[]) {
  const position = mesh.geometry.attributes.position as THREE.BufferAttribute | undefined
  const index = mesh.geometry.index
  if (!position || !faceLabels.length) return []

  if (!index && position.count === faceLabels.length * 3) {
    return faceLabels.flatMap((label) => [label, label, label])
  }

  const vertexLabels = new Uint16Array(position.count)
  for (let tri = 0; tri < faceLabels.length; tri++) {
    const label = faceLabels[tri] ?? 0
    if (index) {
      vertexLabels[index.getX(tri * 3)] = label
      vertexLabels[index.getX(tri * 3 + 1)] = label
      vertexLabels[index.getX(tri * 3 + 2)] = label
      continue
    }

    const base = tri * 3
    vertexLabels[base] = label
    vertexLabels[base + 1] = label
    vertexLabels[base + 2] = label
  }

  return Array.from(vertexLabels)
}

function buildJawExport(jaw: JawType): JawLabelExport | null {
  const mesh = getJawMesh(jaw)
  if (!mesh) return null
  const position = mesh.geometry.attributes.position as THREE.BufferAttribute | undefined
  if (!position) return null

  const faceLabels = getExportFaceLabels(mesh)
  const labels = buildVertexLabelsFromFaceLabels(mesh, faceLabels)
  const toothIds = getLabeledToothIdsFromLabels(faceLabels)
  const teeth = toothIds
    .map((toothId) => buildToothRegion(mesh, jaw, toothId, faceLabels))
    .filter((region): region is ToothRegionRecord => region !== null)

  return {
    format: 'stl-labels',
    version: 3,
    jaw,
    triangleCount: faceLabels.length,
    vertexCount: position.count,
    labeledTriangleCount: countLabeledTriangles(faceLabels),
    toothIds,
    labels,
    faceLabels,
    teeth,
  }
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
  const payload = buildJawExport(jaw)
  if (!payload) {
    window.alert(`${jaw === 'upper' ? '上颌' : '下颌'}模型尚未加载完成`)
    return
  }

  downloadJson(`${jaw}-labels.json`, payload)
}

function exportSelectedToothRegion() {
  const toothId = normalizeLabel(selectedToothId.value ?? 0)
  if (!toothId) {
    window.alert('请先选择牙号，再导出当前牙号数据')
    return
  }

  const jawCandidates = [
    { jaw: 'upper' as JawType, mesh: upperMesh },
    { jaw: 'lower' as JawType, mesh: lowerMesh },
  ] as const

  const target =
    jawCandidates.find(({ mesh }) => {
      const labels = mesh ? faceLabelMap.get(mesh) : null
      return labels ? Array.from(labels).includes(toothId) : false
    }) ?? jawCandidates.find(({ jaw }) => (toothId < 30 ? jaw === 'upper' : jaw === 'lower'))
  if (!target?.mesh) {
    window.alert(`当前牙号 ${toothId} 没有对应的模型`)
    return
  }
  const position = target.mesh.geometry.attributes.position as THREE.BufferAttribute | undefined
  if (!position) {
    window.alert(`当前牙号 ${toothId} 的模型缺少顶点数据`)
    return
  }

  const anchorTriangleIndex = getToothAnchorTriangle(target.mesh, toothId)
  const faceLabels = getLargestConnectedToothLabels(target.mesh, toothId, anchorTriangleIndex)
  const labels = buildVertexLabelsFromFaceLabels(target.mesh, faceLabels)
  const region = buildToothRegion(target.mesh, target.jaw, toothId, faceLabels)
  if (!region) {
    window.alert(`当前牙号 ${toothId} 还没有标注结果`)
    return
  }

  downloadJson(`tooth-${toothId}.json`, {
    format: 'stl-labels',
    version: 3,
    jaw: target.jaw,
    toothId,
    triangleCount: faceLabels.length,
    vertexCount: position.count,
    labeledTriangleCount: region.triangleCount,
    labels,
    faceLabels,
    region,
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


