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
      <div v-if="debugInfo" class="debug-panel">
        <span class="debug-chip">labelLevel: {{ debugInfo.labelLevel }}</span>
        <span class="debug-chip">renderMode: {{ debugInfo.renderMode }}</span>
        <span class="debug-chip">triangleCount: {{ debugInfo.triangleCount }}</span>
        <span class="debug-chip">vertexCount: {{ debugInfo.vertexCount }}</span>
        <span class="debug-chip">faceLabels: {{ debugInfo.faceLabelsLength }}</span>
        <span class="debug-chip">labels: {{ debugInfo.labelsLength }}</span>
        <span class="debug-chip">teeth: {{ debugInfo.teethCount }}</span>
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
  labelLevel?: 'face' | 'vertex'
  toothId?: number
  labels?: number[]
  faceLabels?: number[]
  triangleCount?: number
  vertexCount?: number
  region?: ToothRegionRecord
  teeth?: ToothRegionRecord[]
}

type Point3 = [number, number, number]

type ToothTriangleRecord = {
  triangleIndex?: number
  centroid?: Point3
  vertices: [Point3, Point3, Point3]
}

type ToothRegionRecord = {
  toothId: number
  centroid?: Point3
  contourLoops?: Point3[][]
  rawContourLoops?: Point3[][]
  triangleIndices?: number[]
  triangles?: ToothTriangleRecord[]
}

type DebugInfo = {
  labelLevel: 'face' | 'vertex' | 'unknown'
  renderMode: 'triangles' | 'labels'
  triangleCount: number
  vertexCount: number
  faceLabelsLength: number
  labelsLength: number
  teethCount: number
}

const containerRef = ref<HTMLDivElement | null>(null)
const toothIds = ref<number[]>([])
const sourceLabel = ref('默认上颌')
const debugInfo = ref<DebugInfo | null>(null)
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
let activeObject: THREE.Object3D | null = null
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

function createBaseJawMesh(sourceGeometry: THREE.BufferGeometry) {
  const geometry = toRenderGeometry(sourceGeometry)
  const material = new THREE.MeshBasicMaterial({
    side: MATERIAL_CONFIG.jaw.side,
    color: gingivaColor,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.scale.set(SCENE_CONFIG.modelScale, SCENE_CONFIG.modelScale, SCENE_CONFIG.modelScale)
  mesh.renderOrder = 1
  return mesh
}

function getTriangleRegionOffset(triangles: ToothTriangleRecord[]) {
  const bounds = new THREE.Box3()
  triangles.forEach((triangle) => {
    triangle.vertices?.forEach((vertex) => {
      if (!vertex) return
      bounds.expandByPoint(new THREE.Vector3(vertex[0], vertex[1], vertex[2]))
    })
  })

  if (bounds.isEmpty()) return 0.01

  const size = new THREE.Vector3()
  bounds.getSize(size)
  const maxDimension = Math.max(size.x, size.y, size.z)
  return Math.max(maxDimension * 0.001, 0.01)
}

function analyzeTriangleBoundary(
  sourceGeometry: THREE.BufferGeometry,
  triangleIndices: ArrayLike<number>,
) {
  const position = sourceGeometry.attributes.position as THREE.BufferAttribute | undefined
  const index = sourceGeometry.index
  if (!position || !triangleIndices.length) {
    return {
      boundaryVertexCount: 0,
      branchingVertexCount: 0,
    }
  }

  const edgeUseCount = new Map<string, number>()
  const vertexNeighbors = new Map<string, Set<string>>()
  const temp = new THREE.Vector3()
  const normalizeCoordinate = (value: number) => (Object.is(value, -0) ? 0 : value)
  const getVertexIndex = (triangleIndex: number, vertexOffset: number) =>
    index ? index.getX(triangleIndex * 3 + vertexOffset) : triangleIndex * 3 + vertexOffset
  const getVertexKey = (vertexIndex: number) => {
    temp.fromBufferAttribute(position, vertexIndex)
    return `${normalizeCoordinate(temp.x)},${normalizeCoordinate(temp.y)},${normalizeCoordinate(temp.z)}`
  }
  const getEdgeKey = (fromKey: string, toKey: string) =>
    fromKey < toKey ? `${fromKey}|${toKey}` : `${toKey}|${fromKey}`

  for (let index = 0; index < triangleIndices.length; index++) {
    const triangleIndex = triangleIndices[index]
    if (!Number.isFinite(triangleIndex)) continue

    const vertexKeys = [
      getVertexKey(getVertexIndex(triangleIndex, 0)),
      getVertexKey(getVertexIndex(triangleIndex, 1)),
      getVertexKey(getVertexIndex(triangleIndex, 2)),
    ]
    for (const [from, to] of [
      [vertexKeys[0], vertexKeys[1]],
      [vertexKeys[1], vertexKeys[2]],
      [vertexKeys[2], vertexKeys[0]],
    ] as const) {
      if (!from || !to) continue
      const edgeKey = getEdgeKey(from, to)
      edgeUseCount.set(edgeKey, (edgeUseCount.get(edgeKey) ?? 0) + 1)
    }
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

  let branchingVertexCount = 0
  vertexNeighbors.forEach((neighbors) => {
    if (neighbors.size !== 2) {
      branchingVertexCount += 1
    }
  })

  return {
    boundaryVertexCount: vertexNeighbors.size,
    branchingVertexCount,
  }
}

function canUseRegionCap(region: ToothRegionRecord, sourceGeometry: THREE.BufferGeometry) {
  if (!region.rawContourLoops?.length || !region.triangleIndices?.length) return false
  const { branchingVertexCount } = analyzeTriangleBoundary(sourceGeometry, region.triangleIndices)
  return branchingVertexCount === 0
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

function toVector3FromPoint(point: Point3) {
  return new THREE.Vector3(point[0], point[1], point[2])
}

function getLoopCenter(loop: Point3[]) {
  const normalized = normalizeClosedLoop(loop)
  const center = new THREE.Vector3()
  if (!normalized.length) return center

  normalized.forEach((point) => {
    center.add(toVector3FromPoint(point))
  })
  return center.multiplyScalar(1 / normalized.length)
}

function getLoopNormal(loop: Point3[]) {
  const normalized = normalizeClosedLoop(loop)
  const normal = new THREE.Vector3()
  if (normalized.length < 3) return normal

  for (let index = 0; index < normalized.length; index++) {
    const current = normalized[index]
    const next = normalized[(index + 1) % normalized.length]
    if (!current || !next) continue

    normal.x += (current[1] - next[1]) * (current[2] + next[2])
    normal.y += (current[2] - next[2]) * (current[0] + next[0])
    normal.z += (current[0] - next[0]) * (current[1] + next[1])
  }

  if (normal.lengthSq() > 1e-10) {
    return normal.normalize()
  }

  const origin = toVector3FromPoint(normalized[0])
  for (let index = 1; index < normalized.length - 1; index++) {
    const current = normalized[index]
    const next = normalized[index + 1]
    if (!current || !next) continue

    const edgeA = toVector3FromPoint(current).sub(origin)
    const edgeB = toVector3FromPoint(next).sub(origin)
    normal.crossVectors(edgeA, edgeB)
    if (normal.lengthSq() > 1e-10) {
      return normal.normalize()
    }
  }

  return normal
}

function appendCapTriangles(
  nextPositions: number[],
  nextNormals: number[],
  loops: Point3[][],
  capCenter?: Point3,
) {
  const center = capCenter ? toVector3FromPoint(capCenter) : null

  const pushCapTriangle = (a: Point3, b: Point3, c: Point3, normal: THREE.Vector3) => {
    nextPositions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2])
    nextNormals.push(
      normal.x,
      normal.y,
      normal.z,
      normal.x,
      normal.y,
      normal.z,
      normal.x,
      normal.y,
      normal.z,
    )
  }

  for (const loop of loops) {
    const normalized = normalizeClosedLoop(loop)
    if (normalized.length < 3) continue

    const loopCenter = getLoopCenter(normalized)
    const loopNormal = getLoopNormal(normalized)
    if (loopNormal.lengthSq() <= 1e-10) continue

    let tangent = toVector3FromPoint(normalized[0]).sub(loopCenter)
    tangent.addScaledVector(loopNormal, -tangent.dot(loopNormal))

    if (tangent.lengthSq() <= 1e-10) {
      for (let index = 1; index < normalized.length; index++) {
        tangent = toVector3FromPoint(normalized[index]).sub(toVector3FromPoint(normalized[0]))
        tangent.addScaledVector(loopNormal, -tangent.dot(loopNormal))
        if (tangent.lengthSq() > 1e-10) break
      }
    }

    if (tangent.lengthSq() <= 1e-10) continue
    tangent.normalize()

    const bitangent = new THREE.Vector3().crossVectors(loopNormal, tangent)
    if (bitangent.lengthSq() <= 1e-10) continue
    bitangent.normalize()

    const contour = normalized.map((point) => {
      const vector = toVector3FromPoint(point).sub(loopCenter)
      return new THREE.Vector2(vector.dot(tangent), vector.dot(bitangent))
    })
    const faces = THREE.ShapeUtils.triangulateShape(contour, [])
    if (!faces.length) continue

    const desiredNormal = loopNormal.clone()
    if (center) {
      const outwardHint = loopCenter.clone().sub(center)
      if (outwardHint.lengthSq() > 1e-10 && desiredNormal.dot(outwardHint) < 0) {
        desiredNormal.negate()
      }
    }

    for (const face of faces) {
      const [indexA, indexB, indexC] = face
      const pointA = normalized[indexA]
      const pointB = normalized[indexB]
      const pointC = normalized[indexC]
      if (!pointA || !pointB || !pointC) continue

      const edgeAB = toVector3FromPoint(pointB).sub(toVector3FromPoint(pointA))
      const edgeAC = toVector3FromPoint(pointC).sub(toVector3FromPoint(pointA))
      const faceNormal = new THREE.Vector3().crossVectors(edgeAB, edgeAC)
      if (faceNormal.lengthSq() <= 1e-10) continue

      if (faceNormal.dot(desiredNormal) < 0) {
        pushCapTriangle(pointA, pointC, pointB, desiredNormal)
      } else {
        pushCapTriangle(pointA, pointB, pointC, desiredNormal)
      }
    }
  }
}

function createTriangleRegionGeometry(region: ToothRegionRecord, sourceGeometry: THREE.BufferGeometry) {
  const triangles = region.triangles ?? []
  const positions: number[] = []
  const normals: number[] = []
  const offsetDistance = getTriangleRegionOffset(triangles)

  triangles.forEach((triangle) => {
    const [a, b, c] = triangle.vertices ?? []
    if (!a || !b || !c) return

    const pointA = new THREE.Vector3(a[0], a[1], a[2])
    const pointB = new THREE.Vector3(b[0], b[1], b[2])
    const pointC = new THREE.Vector3(c[0], c[1], c[2])
    const normal = new THREE.Vector3()
      .crossVectors(pointB.clone().sub(pointA), pointC.clone().sub(pointA))
      .normalize()

    if (Number.isFinite(offsetDistance) && offsetDistance > 0 && normal.lengthSq() > 0) {
      pointA.addScaledVector(normal, offsetDistance)
      pointB.addScaledVector(normal, offsetDistance)
      pointC.addScaledVector(normal, offsetDistance)
    }

    positions.push(pointA.x, pointA.y, pointA.z, pointB.x, pointB.y, pointB.z, pointC.x, pointC.y, pointC.z)
    normals.push(
      normal.x,
      normal.y,
      normal.z,
      normal.x,
      normal.y,
      normal.z,
      normal.x,
      normal.y,
      normal.z,
    )
  })

  const capLoops =
    canUseRegionCap(region, sourceGeometry)
      ? region.rawContourLoops?.length
        ? region.rawContourLoops
        : region.contourLoops?.length
          ? region.contourLoops
          : []
      : []
  if (capLoops.length) {
    appendCapTriangles(positions, normals, capLoops, region.centroid)
  }

  if (!positions.length) return null

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.computeBoundingSphere()
  geometry.computeBoundingBox()
  return geometry
}

function createRegionMesh(region: ToothRegionRecord, sourceGeometry: THREE.BufferGeometry) {
  if (!region.triangles?.length) return null

  const geometry = createTriangleRegionGeometry(region, sourceGeometry)
  if (!geometry) return null

  const material = new THREE.MeshBasicMaterial({
    side: MATERIAL_CONFIG.jaw.side,
    color: colorForLabel(region.toothId),
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.scale.set(SCENE_CONFIG.modelScale, SCENE_CONFIG.modelScale, SCENE_CONFIG.modelScale)
  mesh.renderOrder = 2
  return mesh
}

function fitCameraToObject(object: THREE.Object3D) {
  if (!camera || !controls) return

  const box = new THREE.Box3().setFromObject(object)
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

function clearCurrentObject() {
  if (!scene || !activeObject) return
  scene.remove(activeObject)
  activeObject.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    child.geometry.dispose()
    if (Array.isArray(child.material)) {
      child.material.forEach((material) => material.dispose())
    } else {
      child.material.dispose()
    }
  })
  activeObject = null
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

function collectTriangleRegions(payload?: LabelJson) {
  if (!payload) return []
  const regions = payload.region ? [payload.region] : payload.teeth ?? []
  return regions.filter((region) => region.triangles?.length)
}

function resolveLabelLevel(payload?: LabelJson): DebugInfo['labelLevel'] {
  if (payload?.labelLevel) return payload.labelLevel
  if (payload?.faceLabels?.length) return 'face'
  if (
    typeof payload?.triangleCount === 'number' &&
    Array.isArray(payload.labels) &&
    payload.labels.length === payload.triangleCount
  ) {
    return 'face'
  }
  if (
    typeof payload?.vertexCount === 'number' &&
    Array.isArray(payload.labels) &&
    payload.labels.length === payload.vertexCount
  ) {
    return 'vertex'
  }
  return 'unknown'
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

  clearCurrentObject()
  clearOverlay()

  const stlUrl = jaw === 'upper' ? upperStlUrl : lowerStlUrl
  const sourceGeometry = await loadSTL(stlUrl)
  const triangleRegions = collectTriangleRegions(payload)
  let renderObject: THREE.Object3D

  if (triangleRegions.length) {
    const group = new THREE.Group()
    group.add(createBaseJawMesh(sourceGeometry))
    triangleRegions.forEach((region) => {
      const mesh = createRegionMesh(region, sourceGeometry)
      if (mesh) group.add(mesh)
    })
    renderObject = group
    toothIds.value = triangleRegions.map((region) => region.toothId).sort((a, b) => a - b)
  } else {
    const normalizedGeometry = toRenderGeometry(sourceGeometry)
    const triangleLabels = buildTriangleLabels(normalizedGeometry, labels)
    const paintGeometry = createPaintGeometry(normalizedGeometry, triangleLabels)
    normalizedGeometry.dispose()
    renderObject = createMesh(paintGeometry)
    toothIds.value = Array.from(new Set(Array.from(triangleLabels).filter((label) => label > 0))).sort(
      (a, b) => a - b,
    )
  }
  sourceGeometry.dispose()
  sourceLabel.value = sourceName
  debugInfo.value = {
    labelLevel: resolveLabelLevel(payload),
    renderMode: triangleRegions.length ? 'triangles' : 'labels',
    triangleCount: payload?.triangleCount ?? 0,
    vertexCount: payload?.vertexCount ?? 0,
    faceLabelsLength: payload?.faceLabels?.length ?? 0,
    labelsLength: payload?.labels?.length ?? 0,
    teethCount: triangleRegions.length,
  }
  console.info('[JSON debug]', debugInfo.value)

  scene.add(renderObject)
  activeObject = renderObject

  const overlay = createContourOverlay(payload)
  if (overlay) {
    scene.add(overlay)
    activeOverlay = overlay
  }

  fitCameraToObject(renderObject)
}

async function loadDefaultUpper() {
  const data = await loadLabelJson(upperJsonUrl)
  const labels = resolveLabels(data)
  await renderDataset('upper', labels, '默认上颌', data)
}

async function loadJsonPayload(payload: LabelJson, fileName: string) {
  const jaw: JawType = payload.jaw === 'lower' ? 'lower' : 'upper'
  const labels = resolveLabels(payload)
  const triangleRegions = collectTriangleRegions(payload)
  if (!labels.length && !triangleRegions.length) {
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

  clearCurrentObject()
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
  debugInfo.value = null
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

.debug-panel {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.debug-chip {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 4px 10px;
  border-radius: 999px;
  background: #e2e8f0;
  color: #0f172a;
  font-size: 12px;
  line-height: 1.2;
}
</style>
