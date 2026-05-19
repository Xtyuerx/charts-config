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

      <div class="mode-group">
        <button :class="{ active: paintGranularity === 'face' }" @click="paintGranularity = 'face'">
          面级标注
        </button>
        <button
          :class="{ active: paintGranularity === 'vertex' }"
          @click="paintGranularity = 'vertex'"
        >
          顶点级标注
        </button>
      </div>

      <button @click="resetSegmentation">重置标注</button>
      <button @click="openImportDialog">导入分割 JSON</button>
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
      STL 本身不写回颜色，分割信息完全保存在 JSON 中。当前使用 `{{
        paintGranularity === 'face' ? 'face' : 'vertex'
      }}` 标注；导出时会同时附带 `faceLabels`、`vertexLabels`、`labelColorMap`
      以及基于几何坐标生成的稳定 `faceStableIds`/`vertexStableIds`，重新加载时优先按稳定 ID
      回填颜色。
    </div>

    <div v-if="lastImportMessage" class="import-status">
      {{ lastImportMessage }}
    </div>

    <input
      ref="fileInputRef"
      class="file-input"
      type="file"
      accept=".json,application/json"
      @change="onImportFileChange"
    />

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
type PaintGranularity = 'face' | 'vertex'
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

// 单颗牙齿区域的业务导出结构。
// 它描述的是“这个牙号对应了哪些三角面、空间位置大概在哪、轮廓大概长什么样”，
// 后续可直接用于局部重建、轮廓提取、统计分析或人工复核。
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

type SegmentationAssignment = {
  stableId: string
  labelId: number
}

// 整个上颌/下颌的分割导出结构。
// 这里既保存顺序标签数组，也保存 stableId 映射：
// 顺序数组适合同一份几何直接回放，stableId 适合在面顺序变化后尽量恢复标注。
type JawLabelExport = {
  format: 'stl-segmentation'
  version: 4
  jaw: JawType
  granularity: PaintGranularity
  geometrySignature: string
  triangleCount: number
  vertexCount: number
  labeledTriangleCount: number
  labeledVertexCount: number
  toothIds: number[]
  faceLabels: number[]
  labels: number[]
  vertexLabels: number[]
  faceStableIds: string[]
  vertexStableIds: string[]
  faceAssignments: SegmentationAssignment[]
  vertexAssignments: SegmentationAssignment[]
  labelColorMap: Record<string, string>
  teeth: ToothRegionRecord[]
}

// 单颗牙号的局部导出结构，适合按牙存档或单牙重建。
type ToothRegionExport = {
  format: 'stl-segmentation'
  version: 4
  jaw: JawType
  toothId: number
  granularity: PaintGranularity
  geometrySignature: string
  triangleCount: number
  vertexCount: number
  labeledTriangleCount: number
  labeledVertexCount: number
  faceLabels: number[]
  labels: number[]
  vertexLabels: number[]
  faceStableIds: string[]
  vertexStableIds: string[]
  faceAssignments: SegmentationAssignment[]
  vertexAssignments: SegmentationAssignment[]
  labelColorMap: Record<string, string>
  region: ToothRegionRecord
}

type SegmentationImportPayload = Partial<JawLabelExport> &
  Partial<ToothRegionExport> & {
    region?: ToothRegionRecord
    toothId?: number
  }

const containerRef = ref<HTMLDivElement>()
const fileInputRef = ref<HTMLInputElement>()

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
const paintGranularity = ref<PaintGranularity>('face')
const toothOptions = [
  11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 26, 27, 28, 31, 32, 33, 34, 35, 36, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48,
]
const selectedToothId = ref<number | null>(toothOptions[0] ?? null)
const previewSegmentResult = ref(false)
const lastImportMessage = ref('')
const labelColorMap = ref<Record<string, string>>({})

const modelConfig = {
  upper:
    'http://175.154.206.51:9000/cy-stl/3D/2605000338/2054820463892238336/stl/2605000338_2054820463892238336_upper.stl?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=minioadmin%2F20260519%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260519T030942Z&X-Amz-Expires=604800&X-Amz-SignedHeaders=host&X-Amz-Signature=dd22690da0cce28595fcadbc8beb940ec532ae638b317edb35c96a385e018f7f',
  lower:
    'http://175.154.206.51:9000/cy-stl/3D/2605000338/2054820463892238336/stl/2605000338_2054820463892238336_lower.stl?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=minioadmin%2F20260519%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260519T030942Z&X-Amz-Expires=604800&X-Amz-SignedHeaders=host&X-Amz-Signature=b84617d764e856f8bc3aa46178f92cee0d621c9b72f07773b8f2f4022c8a24be',
}

const toothColor = new THREE.Color(0xffffff)
const gingivaColor = new THREE.Color(0xc97f88)

// 这些 WeakMap/WeakSet 是“运行时缓存层”：
// 1. 不把大型派生数据直接挂在 geometry/material 上，避免和 three 的原生字段混在一起。
// 2. key 是 mesh，对应模型销毁后缓存也能自然释放，减少长期占用内存。
// 3. 这里缓存的内容大多可以从几何重新推导出来，所以适合按需构建、按 mesh 复用。
const faceLabelMap = new WeakMap<THREE.Mesh, Uint16Array>()
const vertexLabelMap = new WeakMap<THREE.Mesh, Uint16Array>()
const triangleAdjacencyMap = new WeakMap<THREE.Mesh, number[][]>()
const triangleCenterMap = new WeakMap<THREE.Mesh, Float32Array>()
const toothAnchorTriangleMap = new WeakMap<THREE.Mesh, Map<number, number>>()
const stableFaceIdMap = new WeakMap<THREE.Mesh, string[]>()
const stableVertexIdMap = new WeakMap<THREE.Mesh, string[]>()
const logicalVertexGroupMap = new WeakMap<THREE.Mesh, number[][]>()
const geometrySignatureMap = new WeakMap<THREE.Mesh, string>()
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
const STABLE_ID_PRECISION = 1e5

// 项目里同时存在上下颌两个 mesh，很多逻辑都要“对所有当前可编辑模型批量执行”。
// 单独封装这个函数后，后续无论是重绘、重置、预览还是导出都只需要面向这一层处理。
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

// 统一把 STL 几何转换成当前页面可编辑的绘制几何。
// 这里做了两件事：
// 1. 尽量转成 non-indexed，后续按三角面/顶点直接写颜色时更直观。
// 2. 清掉旧的 color attribute，避免重复导入或重新准备 mesh 时沿用脏颜色。
// computeVertexNormals 只服务于当前编辑视图的光照表现，不影响导出 JSON 的标签结果。
function toPaintGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const nextGeometry = geometry.index ? geometry.toNonIndexed() : geometry.clone()
  if (nextGeometry.getAttribute('color')) {
    nextGeometry.deleteAttribute('color')
  }
  nextGeometry.computeVertexNormals()
  return nextGeometry
}

function quantizeCoordinate(value: number) {
  return Math.round(value * STABLE_ID_PRECISION)
}

function pointToStableKey(x: number, y: number, z: number) {
  return `${quantizeCoordinate(x)},${quantizeCoordinate(y)},${quantizeCoordinate(z)}`
}

function getVertexIndex(
  geometry: THREE.BufferGeometry,
  triangleIndex: number,
  vertexOffset: number,
) {
  return geometry.index
    ? geometry.index.getX(triangleIndex * 3 + vertexOffset)
    : triangleIndex * 3 + vertexOffset
}

function getTriangleVertexIndices(geometry: THREE.BufferGeometry, triangleIndex: number) {
  return [
    getVertexIndex(geometry, triangleIndex, 0),
    getVertexIndex(geometry, triangleIndex, 1),
    getVertexIndex(geometry, triangleIndex, 2),
  ]
}

function hashStringList(values: string[]) {
  let hash = 2166136261
  for (const value of values) {
    for (let index = 0; index < value.length; index++) {
      hash ^= value.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
    hash ^= 124
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

// 为每个顶点生成稳定 ID，并把“坐标完全相同的顶点”归成一组。
// STL/非索引几何里经常会出现视觉上是同一个点、但索引不同的重复顶点；
// 导出/回填/顶点级涂色时，业务上希望它们视作同一个逻辑顶点。
function buildStableVertexData(geometry: THREE.BufferGeometry) {
  const position = geometry.attributes.position as THREE.BufferAttribute | undefined
  if (!position) {
    return {
      stableIds: [] as string[],
      groupsByIndex: [] as number[][],
    }
  }

  const stableIds = new Array<string>(position.count)
  const keyToIndices = new Map<string, number[]>()

  for (let index = 0; index < position.count; index++) {
    const stableId = pointToStableKey(
      position.getX(index),
      position.getY(index),
      position.getZ(index),
    )
    stableIds[index] = stableId
    const indices = keyToIndices.get(stableId)
    if (indices) {
      indices.push(index)
    } else {
      keyToIndices.set(stableId, [index])
    }
  }

  const groupsByIndex = Array.from({ length: position.count }, () => [] as number[])
  keyToIndices.forEach((indices) => {
    indices.forEach((index) => {
      groupsByIndex[index] = indices
    })
  })

  return { stableIds, groupsByIndex }
}

// faceStableId 的目标不是绝对数学唯一，而是“在同一份或极相近几何中尽量稳定”。
// 这里组合了：
// 1. 三个顶点的量化坐标
// 2. 三角面中心点的量化坐标
// 这样即便 triangleIndex 顺序变化，只要几何本身没明显变化，仍有较大概率命中回填。
function buildStableFaceIds(geometry: THREE.BufferGeometry) {
  const position = geometry.attributes.position as THREE.BufferAttribute | undefined
  if (!position) return [] as string[]

  const triangleCount = geometry.index ? geometry.index.count / 3 : Math.floor(position.count / 3)
  const stableIds = new Array<string>(triangleCount)
  const center = new THREE.Vector3()
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()

  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex++) {
    const vertexIndices = getTriangleVertexIndices(geometry, triangleIndex)
    // 这里不用当前运行时的 triangleIndex 直接当唯一标识，
    // 而是用量化后的顶点坐标 + 面心坐标生成稳定 faceId。
    // 这样重新加载 STL 时，JSON 回放尽量依赖几何本身，而不是依赖当前面顺序。
    const vertexKeys = vertexIndices
      .map((vertexIndex) =>
        pointToStableKey(
          position.getX(vertexIndex),
          position.getY(vertexIndex),
          position.getZ(vertexIndex),
        ),
      )
      .sort()
    getTriangleCenter(geometry, triangleIndex, center, a, b, c)
    stableIds[triangleIndex] =
      `${vertexKeys.join('|')}#${pointToStableKey(center.x, center.y, center.z)}`
  }

  return stableIds
}

function buildGeometrySignature(
  mesh: THREE.Mesh,
  stableFaceIds: string[],
  stableVertexIds: string[],
) {
  // geometrySignature 用来快速判断“当前 STL 与导出 JSON 是否大致还是同一份几何”。
  // 它不直接参与赋值，只用于提示导入结果的可信度：
  // - 一致：顺序标签和 stableId 命中通常都比较可靠
  // - 不一致：仍会尝试按 stableId 恢复，但用户需要知道当前结果可能只是近似匹配
  const position = mesh.geometry.attributes.position as THREE.BufferAttribute | undefined
  if (!position) return `${mesh.name}|empty`

  if (!mesh.geometry.boundingBox) {
    mesh.geometry.computeBoundingBox()
  }

  const bounds = mesh.geometry.boundingBox
  const minKey = bounds ? pointToStableKey(bounds.min.x, bounds.min.y, bounds.min.z) : '0,0,0'
  const maxKey = bounds ? pointToStableKey(bounds.max.x, bounds.max.y, bounds.max.z) : '0,0,0'
  const triangleCount = mesh.geometry.index
    ? mesh.geometry.index.count / 3
    : Math.floor(position.count / 3)

  return [
    mesh.name,
    triangleCount,
    position.count,
    minKey,
    maxKey,
    hashStringList(stableFaceIds),
    hashStringList(stableVertexIds),
  ].join('|')
}

// 颜色只负责前端视觉反馈，不是分割结果本体。
// 真正需要保存和回放的是 labelId、faceLabels、vertexLabels 以及 stableId 映射。
function getLabelHexColor(label: number) {
  if (!label) return '#c97f88'
  const customColor = labelColorMap.value[String(label)]
  if (customColor) {
    return `#${new THREE.Color(customColor).getHexString()}`
  }
  const h = (((label * 2654435761) >>> 0) % 360) / 360
  return `#${new THREE.Color().setHSL(h, 0.65, 0.55).getHexString()}`
}

function colorForLabel(label: number): THREE.Color {
  if (!label) return gingivaColor
  const customColor = labelColorMap.value[String(label)]
  if (customColor) return new THREE.Color(customColor)
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

  return target
    .copy(a)
    .add(b)
    .add(c)
    .multiplyScalar(1 / 3)
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
    geometry.index
      ? geometry.index.getX(triangleIndex * 3 + vertexOffset)
      : triangleIndex * 3 + vertexOffset

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

// 上下颌 mesh 的几何数据是核心，材质只是编辑阶段的视觉承载。
// 这里保留了项目原本的 Phong 材质风格，让编辑视图继续有立体感；
// 真正的“标签状态”全部保存在 faceLabelMap / vertexLabelMap，不保存在材质里。
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

function ensureVertexLabels(mesh: THREE.Mesh) {
  if (vertexLabelMap.has(mesh)) return
  const position = mesh.geometry.attributes.position as THREE.BufferAttribute | undefined
  if (!position) return
  vertexLabelMap.set(mesh, new Uint16Array(position.count))
}

// three 的材质默认不会使用几何上的 color attribute。
// 这一步是在“材质层”打开顶点色开关；真正的颜色值仍然由 repaintMesh 写入几何。
function enableVertexColors(mesh: THREE.Mesh) {
  const apply = (material: THREE.Material) => {
    if (
      material instanceof THREE.MeshPhongMaterial ||
      material instanceof THREE.MeshStandardMaterial
    ) {
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

// face 模式是编辑时最稳定的主视角，但很多导出或预览又需要 vertexLabels。
// 因此这里提供一个“面标签 -> 顶点标签”的单向投影，便于统一后续流程。
function buildVertexLabelsFromFaceLabelsData(mesh: THREE.Mesh, faceLabels: ArrayLike<number>) {
  const position = mesh.geometry.attributes.position as THREE.BufferAttribute | undefined
  if (!position) return new Uint16Array()

  const nextVertexLabels = new Uint16Array(position.count)
  const triangleCount = mesh.geometry.index
    ? mesh.geometry.index.count / 3
    : Math.floor(position.count / 3)
  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex++) {
    const label = normalizeLabel(faceLabels[triangleIndex] ?? 0)
    const vertexIndices = getTriangleVertexIndices(mesh.geometry, triangleIndex)
    vertexIndices.forEach((vertexIndex) => {
      nextVertexLabels[vertexIndex] = label
    })
  }
  return nextVertexLabels
}

function resolveTriangleLabelFromVertexLabels(vertexLabels: number[]) {
  // 顶点模式下，真实标注结果是 vertexLabels。
  // 但很多后续处理仍然需要 face 视角，所以这里把顶点标签折算成三角面标签。
  // 业务上要求至少 2 个顶点同标签，避免只碰到一个角点就把整面都判成该牙号。
  const positiveLabels = vertexLabels.filter((label) => label > 0)
  if (positiveLabels.length < 2) return 0

  const countMap = new Map<number, number>()
  positiveLabels.forEach((label) => {
    countMap.set(label, (countMap.get(label) ?? 0) + 1)
  })

  let bestLabel = positiveLabels[0] ?? 0
  let bestCount = -1
  countMap.forEach((count, label) => {
    if (count > bestCount) {
      bestLabel = label
      bestCount = count
    }
  })
  return bestLabel
}

function syncFaceLabelsFromVertexLabels(
  mesh: THREE.Mesh,
  sourceVertexLabels?: ArrayLike<number> | null,
) {
  const faceLabels = faceLabelMap.get(mesh)
  const vertexLabels = sourceVertexLabels ?? vertexLabelMap.get(mesh)
  if (!faceLabels || !vertexLabels) return faceLabels ?? null

  for (let triangleIndex = 0; triangleIndex < faceLabels.length; triangleIndex++) {
    const vertexIndices = getTriangleVertexIndices(mesh.geometry, triangleIndex)
    faceLabels[triangleIndex] = resolveTriangleLabelFromVertexLabels(
      vertexIndices.map((vertexIndex) => normalizeLabel(vertexLabels[vertexIndex] ?? 0)),
    )
  }

  return faceLabels
}

function repaintMesh(mesh: THREE.Mesh) {
  const colorAttr = mesh.geometry.getAttribute('color') as THREE.BufferAttribute | undefined
  if (!colorAttr) return

  // 这里是“标签 -> 视觉颜色”的唯一落点。
  // 不管前面是导入 JSON、重置标签还是笔刷改色，最终都要回到这里把 label 数组刷到 color attribute。
  const activeGranularity = paintGranularity.value
  const faceLabels = faceLabelMap.get(mesh)
  const vertexLabels = vertexLabelMap.get(mesh)

  if (activeGranularity === 'vertex' && vertexLabels?.length === colorAttr.count) {
    for (let vertexIndex = 0; vertexIndex < colorAttr.count; vertexIndex++) {
      const color = colorForLabel(vertexLabels[vertexIndex] ?? 0)
      colorAttr.setXYZ(vertexIndex, color.r, color.g, color.b)
    }
    colorAttr.needsUpdate = true
    return
  }

  if (!faceLabels) return

  const paintTriangle = (tri: number, a: number, b: number, c: number) => {
    const color = colorForLabel(faceLabels[tri] ?? 0)
    colorAttr.setXYZ(a, color.r, color.g, color.b)
    colorAttr.setXYZ(b, color.r, color.g, color.b)
    colorAttr.setXYZ(c, color.r, color.g, color.b)
  }

  if (mesh.geometry.index) {
    const index = mesh.geometry.index
    for (let tri = 0; tri < faceLabels.length; tri++) {
      paintTriangle(tri, index.getX(tri * 3), index.getX(tri * 3 + 1), index.getX(tri * 3 + 2))
    }
  } else {
    for (let tri = 0; tri < faceLabels.length; tri++) {
      paintTriangle(tri, tri * 3, tri * 3 + 1, tri * 3 + 2)
    }
  }

  colorAttr.needsUpdate = true
}

function preparePaintMesh(mesh: THREE.Mesh) {
  if (preparedMeshSet.has(mesh)) return

  const position = mesh.geometry.attributes.position as THREE.BufferAttribute | undefined
  if (!position) return

  // 初始化默认颜色时全部按牙龈粉色处理，意味着“未标注 = 牙龈/背景区域”。
  // 后续只有 label > 0 的位置才会被刷成具体牙号颜色。
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
  ensureVertexLabels(mesh)

  // 这一段是整个导入/导出/顶点模式一致性的基础：
  // - stable ids：给后续 JSON 回填提供尽量稳定的几何锚点
  // - logical vertex groups：把重复顶点当作同一个逻辑点处理
  // - geometry signature：帮助判断导入结果是否可靠
  const { stableIds: stableVertexIds, groupsByIndex } = buildStableVertexData(mesh.geometry)
  const stableFaceIds = buildStableFaceIds(mesh.geometry)
  stableVertexIdMap.set(mesh, stableVertexIds)
  stableFaceIdMap.set(mesh, stableFaceIds)
  logicalVertexGroupMap.set(mesh, groupsByIndex)
  geometrySignatureMap.set(mesh, buildGeometrySignature(mesh, stableFaceIds, stableVertexIds))

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

function getTriangleCenterDistance(
  centers: Float32Array,
  fromTriangleIndex: number,
  toTriangleIndex: number,
) {
  const fromBase = fromTriangleIndex * 3
  const toBase = toTriangleIndex * 3
  const dx = (centers[fromBase] ?? 0) - (centers[toBase] ?? 0)
  const dy = (centers[fromBase + 1] ?? 0) - (centers[toBase + 1] ?? 0)
  const dz = (centers[fromBase + 2] ?? 0) - (centers[toBase + 2] ?? 0)
  return Math.hypot(dx, dy, dz)
}

function ensureMeshTopology(mesh: THREE.Mesh) {
  // 邻接表和三角面中心既用于笔刷扩散，也用于拖拽路径补桥、连通域提取等算法。
  // 这些数据推导成本不低，所以缓存起来，第一次没有时再构建。
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
  // 拖动画笔时，如果相邻两次命中的三角面之间存在一小段空隙，
  // 这里会沿 mesh 表面寻找一条“短路径”把中间面补上，避免画出来断断续续。
  // 算法本质上是一个带距离约束的最短路径搜索，边权取三角面中心点之间的距离。
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
      if (
        nextDistance <= maxDistance &&
        (previousDistance == null || nextDistance < previousDistance)
      ) {
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

  return (
    buildSurfacePath(
      adjacency,
      centers,
      lastStrokeTriangleIndex,
      triangleIndex,
      directDistance * 2 + localBrushRadius,
    ) ?? [triangleIndex]
  )
}

function collectTrianglesWithinBrush(mesh: THREE.Mesh, seedTriangleIndices: number[]) {
  const geometry = mesh.geometry as BVHGeometry
  const labels = faceLabelMap.get(mesh)
  const { adjacency, centers } = ensureMeshTopology(mesh)
  if (!geometry.boundsTree || !labels || !adjacency?.length || !centers?.length)
    return [] as number[]

  const safeSeeds = Array.from(
    new Set(
      seedTriangleIndices
        .map((triangleIndex) => Math.max(0, Math.min(triangleIndex, labels.length - 1)))
        .filter((triangleIndex) => Number.isFinite(triangleIndex)),
    ),
  )
  if (!safeSeeds.length) return [] as number[]

  // 笔刷扩散不是简单的欧氏球体查询，而是沿三角面邻接关系在“网格表面”传播。
  // 这样能避免隔着牙缝或空洞把另一侧表面误刷到，更符合实际“沿表面涂抹”的手感。
  const localBrushRadius = getLocalBrushRadius(mesh) * BRUSH_PAINT_FACTOR
  const visited = new Uint8Array(labels.length)
  const queue = [...safeSeeds]
  const distanceMap = new Map<number, number>()
  const triangles: number[] = []
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

    triangles.push(triangleIndex)

    for (const neighborTriangleIndex of adjacency[triangleIndex] ?? []) {
      if (visited[neighborTriangleIndex]) continue

      const nextDistance =
        currentDistance + getTriangleCenterDistance(centers, triangleIndex, neighborTriangleIndex)
      const previousDistance = distanceMap.get(neighborTriangleIndex)
      if (
        nextDistance <= localBrushRadius &&
        (previousDistance == null || nextDistance < previousDistance)
      ) {
        distanceMap.set(neighborTriangleIndex, nextDistance)
        queue.push(neighborTriangleIndex)
      }
    }
  }

  return triangles
}

function paintMesh(mesh: THREE.Mesh, seedTriangleIndices: number[]) {
  const labels = faceLabelMap.get(mesh)
  const vertexLabels = vertexLabelMap.get(mesh)
  if (!labels) return false

  const nextLabel = getBrushLabel()
  if (nextLabel == null) {
    window.alert('请先选择牙号，再进行涂色')
    return false
  }

  const triangles = collectTrianglesWithinBrush(mesh, seedTriangleIndices)
  if (!triangles.length) return false

  // face 模式下直接改三角面标签，然后再整体同步回 vertexLabels。
  // 这样可以保证无论当前查看模式是什么，导出时两套标签始终尽量保持一致。
  triangles.forEach((triangleIndex) => {
    labels[triangleIndex] = nextLabel
  })

  if (vertexLabels) {
    vertexLabels.set(buildVertexLabelsFromFaceLabelsData(mesh, labels))
  }

  repaintMesh(mesh)
  return true
}

function paintVerticesAtIntersect(
  mesh: THREE.Mesh,
  seedTriangleIndices: number[],
  localPoint: THREE.Vector3,
) {
  const vertexLabels = vertexLabelMap.get(mesh)
  const position = mesh.geometry.attributes.position as THREE.BufferAttribute | undefined
  const logicalGroups = logicalVertexGroupMap.get(mesh)
  if (!vertexLabels || !position || !logicalGroups?.length) return false

  const nextLabel = getBrushLabel()
  if (nextLabel == null) {
    window.alert('请先选择牙号，再进行涂色')
    return false
  }

  const triangles = collectTrianglesWithinBrush(mesh, seedTriangleIndices)
  if (!triangles.length) return false

  // vertex 模式分两层过滤：
  // 1. 先找出笔刷覆盖到的三角面，限定一个局部候选区域
  // 2. 再按“顶点到命中点的距离”精确判断哪些顶点真正落在半径内
  // 这样既避免全局扫顶点，也保证顶点模式比 face 模式更细。
  const localBrushRadius = getLocalBrushRadius(mesh) * BRUSH_PAINT_FACTOR
  const paintedVertexIndices = new Set<number>()
  const vertexPoint = new THREE.Vector3()

  for (const triangleIndex of triangles) {
    const vertexIndices = getTriangleVertexIndices(mesh.geometry, triangleIndex)
    for (const vertexIndex of vertexIndices) {
      vertexPoint.set(
        position.getX(vertexIndex),
        position.getY(vertexIndex),
        position.getZ(vertexIndex),
      )
      if (vertexPoint.distanceTo(localPoint) > localBrushRadius) continue
      // STL 转成当前可绘制几何后，经常会出现“坐标相同但索引不同”的重复顶点。
      // 业务上这些点应视为同一个逻辑顶点，所以这里整组一起写入 label，
      // 避免视觉上出现裂缝，也避免导出的 vertexLabels 自相矛盾。
      for (const groupedVertexIndex of logicalGroups[vertexIndex] ?? [vertexIndex]) {
        vertexLabels[groupedVertexIndex] = nextLabel
        paintedVertexIndices.add(groupedVertexIndex)
      }
    }
  }

  if (!paintedVertexIndices.size) return false

  syncFaceLabelsFromVertexLabels(mesh, vertexLabels)
  repaintMesh(mesh)
  return true
}

function paintAtIntersect(intersect: THREE.Intersection) {
  const mesh = intersect.object as THREE.Mesh
  const faceIndex = typeof intersect.faceIndex === 'number' ? intersect.faceIndex : -1
  if (faceIndex < 0) return false
  const currentLabel = getBrushLabel()
  const seedTriangleIndices = resolveStrokeSeeds(mesh, faceIndex)
  const painted =
    paintGranularity.value === 'vertex'
      ? paintVerticesAtIntersect(
          mesh,
          seedTriangleIndices,
          mesh.worldToLocal(intersect.point.clone()),
        )
      : paintMesh(mesh, seedTriangleIndices)
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
  // pointerdown 用 capture 是为了尽量抢先接管绘制手势，
  // 避免 Orbit/Trackball 控件先消费事件，导致“按下想画，结果先转模型”。
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
    const faceLabels = faceLabelMap.get(mesh)
    const vertexLabels = vertexLabelMap.get(mesh)
    if (faceLabels) faceLabels.fill(0)
    if (vertexLabels) vertexLabels.fill(0)
    toothAnchorTriangleMap.set(mesh, new Map())
    repaintMesh(mesh)
  })
  labelColorMap.value = {}
  lastImportMessage.value = ''
  refreshPreviewIfNeeded()
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

function getExportVertexLabels(mesh: THREE.Mesh | null) {
  if (!mesh) return []
  const vertexLabels = vertexLabelMap.get(mesh)
  if (paintGranularity.value === 'vertex' && vertexLabels?.length) {
    return Array.from(vertexLabels)
  }

  // 即便当前是 face 模式，导出也仍然补齐 vertexLabels。
  // 这样下游使用方不需要关心用户当时是按哪种粒度编辑的。
  const faceLabels = faceLabelMap.get(mesh)
  return faceLabels ? Array.from(buildVertexLabelsFromFaceLabelsData(mesh, faceLabels)) : []
}

function buildAssignments(stableIds: string[], labels: number[]) {
  const assignmentMap = new Map<string, number>()
  for (let index = 0; index < Math.min(stableIds.length, labels.length); index++) {
    const labelId = normalizeLabel(labels[index] ?? 0)
    if (!labelId) continue
    const stableId = stableIds[index]
    if (!stableId) continue
    assignmentMap.set(stableId, labelId)
  }
  return Array.from(assignmentMap.entries()).map(([stableId, labelId]) => ({ stableId, labelId }))
}

// 这里导出的颜色字典只负责 labelId -> color 的显示映射，
// 不参与“某个面/顶点属于哪个牙号”的业务判定。
function buildLabelColorMap(labels: ArrayLike<number>) {
  return getLabeledToothIdsFromLabels(labels).reduce<Record<string, string>>((acc, toothId) => {
    acc[String(toothId)] = getLabelHexColor(toothId)
    return acc
  }, {})
}

function refreshPreviewIfNeeded() {
  if (previewSegmentResult.value) {
    buildPreview()
  }
}

function openImportDialog() {
  fileInputRef.value?.click()
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
  // 单牙导出时会围绕一个锚点三角面截取“最大连通牙块”。
  // 半径如果太小会截断同一颗牙，太大又可能把相邻区域带进去，所以这里按整体模型尺寸自适应。
  const radius = Math.max(size.x, size.y) * TOOTH_EXPORT_RADIUS_FACTOR
  return Math.min(TOOTH_EXPORT_RADIUS_MAX, Math.max(TOOTH_EXPORT_RADIUS_MIN, radius))
}

function getLargestConnectedToothLabels(
  mesh: THREE.Mesh,
  toothId: number,
  anchorTriangleIndex?: number | null,
) {
  // 同一个 toothId 可能因为误刷、噪声或历史导入，散落成多个不连通小岛。
  // 导出单颗牙时，我们只取“锚点附近的主要连通块”或“最大连通块”，
  // 避免把远处的脏标签一起导出，影响单牙区域的几何质量。
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

  const [aIndex, bIndex, cIndex] = getTriangleVertexIndices(mesh.geometry, triangleIndex)
  const a = new THREE.Vector3().fromBufferAttribute(position, aIndex)
  const b = new THREE.Vector3().fromBufferAttribute(position, bIndex)
  const c = new THREE.Vector3().fromBufferAttribute(position, cIndex)
  return { a, b, c }
}

function buildContourLoopsFromTriangles(triangles: ToothTriangleRecord[]) {
  // 轮廓提取思路：
  // 1. 统计所有三角边被使用的次数
  // 2. 只出现 1 次的边就是区域边界
  // 3. 再把这些边按邻接关系串成闭环
  // 这种做法不要求几何是规则网格，只依赖当前三角面集合本身。
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

        const candidates = Array.from(vertexNeighbors.get(currentKey) ?? []).filter(
          (key) => key !== previousKey,
        )
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
  // 导出的 rawContourLoops 保留原始边界，便于复核；
  // contourLoops 则做轻量平滑，便于前端展示或下游轮廓使用。
  // 这里不是追求 CAD 级拟合，只做温和的视觉顺滑处理。
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
  // 单牙区域导出时，除了标签数组，还会补充一份“几何摘要”：
  // - 三角面列表
  // - 包围盒
  // - 面积
  // - 质心
  // - 原始/平滑轮廓
  // 这样后续做单牙重建、轮廓分析或人工审查时，不必重新从整颌 STL 中二次扫描。
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
    const centroid = new THREE.Vector3()
      .copy(a)
      .add(b)
      .add(c)
      .multiplyScalar(1 / 3)
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

function countLabeledVertices(labels: number[]) {
  return labels.reduce((count, label) => count + (label > 0 ? 1 : 0), 0)
}

function buildVertexLabelsFromFaceLabels(mesh: THREE.Mesh, faceLabels: number[]) {
  return Array.from(buildVertexLabelsFromFaceLabelsData(mesh, faceLabels))
}

function getMeshGeometrySignature(mesh: THREE.Mesh) {
  return geometrySignatureMap.get(mesh) ?? `${mesh.name}|unknown`
}

function buildJawExport(jaw: JawType): JawLabelExport | null {
  const mesh = getJawMesh(jaw)
  if (!mesh) return null
  const position = mesh.geometry.attributes.position as THREE.BufferAttribute | undefined
  if (!position) return null

  // 导出时同时保留三层信息：
  // 1. faceLabels：适合区域提取、轮廓计算、面级回放
  // 2. vertexLabels：适合更细粒度的局部修整
  // 3. stableIds / assignments：适合重新加载后尽量稳定恢复
  const faceLabels = getExportFaceLabels(mesh)
  const vertexLabels = getExportVertexLabels(mesh)
  const toothIds = getLabeledToothIdsFromLabels([...faceLabels, ...vertexLabels])
  const teeth = toothIds
    .map((toothId) => buildToothRegion(mesh, jaw, toothId, faceLabels))
    .filter((region): region is ToothRegionRecord => region !== null)
  const faceStableIds = stableFaceIdMap.get(mesh) ?? []
  const vertexStableIds = stableVertexIdMap.get(mesh) ?? []

  return {
    format: 'stl-segmentation',
    version: 4,
    jaw,
    granularity: paintGranularity.value,
    geometrySignature: getMeshGeometrySignature(mesh),
    triangleCount: faceLabels.length,
    vertexCount: position.count,
    labeledTriangleCount: countLabeledTriangles(faceLabels),
    labeledVertexCount: countLabeledVertices(vertexLabels),
    toothIds,
    faceLabels,
    labels: vertexLabels,
    vertexLabels,
    faceStableIds,
    vertexStableIds,
    faceAssignments: buildAssignments(faceStableIds, faceLabels),
    vertexAssignments:
      paintGranularity.value === 'vertex' ? buildAssignments(vertexStableIds, vertexLabels) : [],
    labelColorMap: buildLabelColorMap([...faceLabels, ...vertexLabels]),
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

  const faceStableIds = stableFaceIdMap.get(target.mesh) ?? []
  const vertexStableIds = stableVertexIdMap.get(target.mesh) ?? []
  const payload: ToothRegionExport = {
    format: 'stl-segmentation',
    version: 4,
    jaw: target.jaw,
    toothId,
    granularity: paintGranularity.value,
    geometrySignature: getMeshGeometrySignature(target.mesh),
    triangleCount: faceLabels.length,
    vertexCount: position.count,
    labeledTriangleCount: region.triangleCount,
    labeledVertexCount: countLabeledVertices(labels),
    faceLabels,
    labels,
    vertexLabels: labels,
    faceStableIds,
    vertexStableIds,
    faceAssignments: buildAssignments(faceStableIds, faceLabels),
    vertexAssignments:
      paintGranularity.value === 'vertex' ? buildAssignments(vertexStableIds, labels) : [],
    labelColorMap: buildLabelColorMap([...faceLabels, ...labels]),
    region,
  }

  downloadJson(`tooth-${toothId}.json`, payload)
}

function exportUpperLabels() {
  exportJawLabels('upper')
}

function exportLowerLabels() {
  exportJawLabels('lower')
}

function getImportedAssignments(
  payload: SegmentationImportPayload,
  stableIds: string[],
  labels: number[],
  kind: 'face' | 'vertex',
) {
  const directAssignments = kind === 'face' ? payload.faceAssignments : payload.vertexAssignments
  if (Array.isArray(directAssignments) && directAssignments.length) {
    return directAssignments
      .filter(
        (item): item is SegmentationAssignment =>
          !!item && typeof item.stableId === 'string' && Number.isFinite(item.labelId),
      )
      .map((item) => ({
        stableId: item.stableId,
        labelId: normalizeLabel(item.labelId),
      }))
  }

  // 兼容旧版 JSON：
  // 老数据可能只有顺序标签数组，没有 stableId assignments。
  // 如果同时拿到了 stableIds，这里就临时补成 stableId -> labelId 映射，后续统一处理。
  if (stableIds.length === labels.length && labels.length) {
    return stableIds
      .map((stableId, index) => ({
        stableId,
        labelId: normalizeLabel(labels[index] ?? 0),
      }))
      .filter((item) => item.labelId > 0)
  }

  return [] as SegmentationAssignment[]
}

function applyAssignmentsByStableId(
  targetLabels: Uint16Array,
  stableIds: string[],
  assignments: SegmentationAssignment[],
) {
  if (!targetLabels.length || !stableIds.length || !assignments.length) return 0

  // stableId 不是一对一假设。
  // 尤其在 vertex 模式下，相同坐标点可能映射到多个索引，
  // 因此这里先建立 stableId -> indices 的反向索引，再批量写回所有命中的位置。
  const stableIndexMap = new Map<string, number[]>()
  stableIds.forEach((stableId, index) => {
    const indices = stableIndexMap.get(stableId)
    if (indices) {
      indices.push(index)
    } else {
      stableIndexMap.set(stableId, [index])
    }
  })

  let matched = 0
  assignments.forEach(({ stableId, labelId }) => {
    for (const index of stableIndexMap.get(stableId) ?? []) {
      targetLabels[index] = normalizeLabel(labelId)
      matched += 1
    }
  })

  return matched
}

function inferJawFromPayload(payload: SegmentationImportPayload): JawType | null {
  if (payload.jaw === 'upper' || payload.jaw === 'lower') return payload.jaw
  const toothId = normalizeLabel(payload.toothId ?? 0)
  if (!toothId) return null
  return toothId < 30 ? 'upper' : 'lower'
}

async function onImportFileChange(event: Event) {
  const input = event.target as HTMLInputElement | null
  const file = input?.files?.[0]
  if (!file) return

  try {
    const payload = JSON.parse(await file.text()) as SegmentationImportPayload
    applyImportedSegmentation(payload)
  } catch (error) {
    console.error(error)
    window.alert('分割 JSON 解析失败，请确认文件格式正确')
  } finally {
    if (input) input.value = ''
  }
}

function applyImportedSegmentation(payload: SegmentationImportPayload) {
  const jaw = inferJawFromPayload(payload)
  const mesh = jaw ? getJawMesh(jaw) : null
  if (!jaw || !mesh) {
    window.alert('无法从 JSON 判断对应的上下颌模型')
    return
  }

  const faceLabels = faceLabelMap.get(mesh)
  const vertexLabels = vertexLabelMap.get(mesh)
  if (!faceLabels || !vertexLabels) {
    window.alert('模型标签缓存尚未准备完成')
    return
  }

  faceLabels.fill(0)
  vertexLabels.fill(0)
  const signatureMatches =
    !payload.geometrySignature || payload.geometrySignature === getMeshGeometrySignature(mesh)

  // 导入时同时解析 face / vertex 两套标签，但不强行要求两者都存在。
  // 因为历史 JSON、局部导出 JSON、外部修订 JSON 的结构可能不完全一致。
  const importedFaceLabels = Array.isArray(payload.faceLabels)
    ? payload.faceLabels.map((label) => normalizeLabel(label))
    : Array.isArray(payload.labels) && payload.labels.length === faceLabels.length
      ? payload.labels.map((label) => normalizeLabel(label))
      : []
  const importedVertexLabels =
    Array.isArray(payload.vertexLabels) && payload.vertexLabels.length
      ? payload.vertexLabels.map((label) => normalizeLabel(label))
      : Array.isArray(payload.labels) && payload.labels.length === vertexLabels.length
        ? payload.labels.map((label) => normalizeLabel(label))
        : []

  const faceAssignments = getImportedAssignments(
    payload,
    Array.isArray(payload.faceStableIds) ? payload.faceStableIds : [],
    importedFaceLabels,
    'face',
  )
  const vertexAssignments = getImportedAssignments(
    payload,
    Array.isArray(payload.vertexStableIds) ? payload.vertexStableIds : [],
    importedVertexLabels,
    'vertex',
  )

  let matchedFaces = applyAssignmentsByStableId(
    faceLabels,
    stableFaceIdMap.get(mesh) ?? [],
    faceAssignments,
  )
  let matchedVertices = applyAssignmentsByStableId(
    vertexLabels,
    stableVertexIdMap.get(mesh) ?? [],
    vertexAssignments,
  )

  // 导入优先级：
  // 1. 先按 stableId 恢复，因为它尽量不依赖当前三角面顺序
  // 2. 如果 stableId 一个都对不上，再退回顺序数组
  //    这种退回方式要求当前 STL 与导出时基本还是同一份几何
  if (!matchedFaces && importedFaceLabels.length === faceLabels.length) {
    faceLabels.set(importedFaceLabels)
    matchedFaces = faceLabels.length
  }

  if (!matchedVertices && importedVertexLabels.length === vertexLabels.length) {
    vertexLabels.set(importedVertexLabels)
    matchedVertices = vertexLabels.length
  }

  if (!matchedVertices && matchedFaces) {
    vertexLabels.set(buildVertexLabelsFromFaceLabelsData(mesh, faceLabels))
  }

  if (!matchedFaces && matchedVertices) {
    syncFaceLabelsFromVertexLabels(mesh, vertexLabels)
  }

  // labelColorMap 只恢复“某个牙号应该显示成什么颜色”，
  // 不影响标签归属；即便缺失，也仍能根据牙号哈希出默认颜色。
  if (payload.labelColorMap && typeof payload.labelColorMap === 'object') {
    labelColorMap.value = Object.entries(payload.labelColorMap).reduce<Record<string, string>>(
      (acc, [labelId, color]) => {
        if (typeof color === 'string') {
          acc[labelId] = color
        }
        return acc
      },
      {},
    )
  }

  if (payload.granularity === 'face' || payload.granularity === 'vertex') {
    paintGranularity.value = payload.granularity
  } else if (matchedVertices && !matchedFaces) {
    paintGranularity.value = 'vertex'
  } else {
    paintGranularity.value = 'face'
  }

  if (payload.toothId) {
    selectedToothId.value = normalizeLabel(payload.toothId)
  }

  repaintMesh(mesh)
  refreshPreviewIfNeeded()
  lastImportMessage.value = `${jaw === 'upper' ? '上颌' : '下颌'}分割已恢复：匹配 ${matchedFaces} 个面，${matchedVertices} 个顶点${signatureMatches ? '' : '；注意当前 STL 与 JSON 的 geometrySignature 不一致，结果依赖 stableId 匹配'}`
}

function buildSegmentedGeometry(mesh: THREE.Mesh, isTooth: boolean) {
  const labels = faceLabelMap.get(mesh)
  const positions = mesh.geometry.attributes.position as THREE.BufferAttribute | undefined
  const normals = mesh.geometry.attributes.normal as THREE.BufferAttribute | undefined
  const index = mesh.geometry.index
  if (!labels || !positions) return null

  const nextPositions: number[] = []
  const nextNormals: number[] = []

  // 预览模式不是直接给原 mesh 换材质，
  // 而是重新拆两份几何：
  // - label > 0 视为牙体
  // - label = 0 视为牙龈
  // 这样预览效果更接近“真实分割结果”，也不会污染编辑态颜色。
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

  // 预览组完全独立于编辑 mesh：
  // 编辑态保留原始模型和逐牙颜色，预览态则只看“牙体 vs 牙龈”的最终拆分结果。
  // 两套对象分开，切换预览时逻辑更干净，也避免频繁改原 mesh 的材质和可见性状态。
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
watch(paintGranularity, () => {
  getAllMeshes().forEach(repaintMesh)
  refreshPreviewIfNeeded()
})

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
  top: 122px;
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
  top: 170px;
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

.import-status {
  position: absolute;
  top: 246px;
  left: 12px;
  z-index: 10;
  max-width: min(720px, calc(100% - 24px));
  padding: 8px 12px;
  font-size: 13px;
  color: #0f766e;
  background: rgba(236, 253, 245, 0.96);
  border: 1px solid rgba(15, 118, 110, 0.18);
  border-radius: 10px;
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08);
}

.file-input {
  display: none;
}

button.active {
  color: #fff;
  background: #409eff;
  border-color: #409eff;
}
</style>
