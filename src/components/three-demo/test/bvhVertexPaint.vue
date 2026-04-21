<template>
  <div class="three-demo">
    <div class="controls">
      <div class="control-group">
        <label>笔刷半径:</label>
        <input type="range" v-model.number="brushRadius" min="0.1" max="2" step="0.1" />
        <span>{{ brushRadius.toFixed(1) }}</span>
      </div>
      <div class="control-group">
        <label>笔刷颜色:</label>
        <input type="color" v-model="brushColor" />
      </div>
      <div class="control-group">
        <label>涂色强度:</label>
        <input type="range" v-model.number="brushIntensity" min="0.1" max="1" step="0.1" />
        <span>{{ brushIntensity.toFixed(1) }}</span>
      </div>
      <button @click="brushMode = 'tooth'">刷牙齿</button>
      <button @click="brushMode = 'gingiva'">刷牙龈</button>
      <button @click="resetSegmentation">重置分割</button>
      <button @click="buildSegmentPreview">预览分割结果</button>
      <button @click="resetColors">重置颜色</button>
      <button @click="toggleBVHVisualizer">BVH 可视化: {{ showBVHHelper ? 'ON' : 'OFF' }}</button>
      <button @click="resetCamera">重置视角</button>
      <input type="file" @change="handleFileChange" accept=".glb,.gltf,.obj,.stl" />
    </div>
    <div class="info-panel">
      <p>🎨 BVH 加速顶点涂色 - 完整方案</p>
      <p>移动鼠标: 查看半透明笔刷指示器</p>
      <p>点击模型: 对顶点进行着色</p>
      <p>⚡ 性能: O(log n + k) vs O(n)</p>
      <p v-if="lastPaintTime !== null">上次涂色耗时: {{ lastPaintTime.toFixed(2) }}ms</p>
      <p v-if="lastAffectedVertices !== null">受影响三角面数: {{ lastAffectedVertices }}</p>
    </div>
    <div ref="containerRef" class="canvas-container"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import * as THREE from 'three'
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import {
  computeBoundsTree,
  disposeBoundsTree,
  acceleratedRaycast,
  MeshBVHHelper,
} from 'three-mesh-bvh'

type SegmentLabel = 0 | 1

const brushMode = ref<'tooth' | 'gingiva'>('tooth')
const previewSegmentResult = ref(false)

// 每个 mesh 对应一份三角面标签
const faceLabelMap = new WeakMap<THREE.Mesh, Uint8Array>()

let segmentedGroup: THREE.Group | null = null

const containerRef = ref<HTMLElement>()
const brushRadius = ref(0.5)
const brushColor = ref('#ff0000')
const brushIntensity = ref(0.5)
const showBVHHelper = ref(false)
const lastPaintTime = ref<number | null>(null)
const lastAffectedVertices = ref<number | null>(null)

let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let renderer: THREE.WebGLRenderer
let controls: TrackballControls
let targets: THREE.Mesh[] = []
let activeTarget: THREE.Mesh | null = null
let brushMesh: THREE.Mesh | null = null
const bvhHelperMap: Map<THREE.Mesh, MeshBVHHelper> = new Map()
let raycaster: THREE.Raycaster
let mouse: THREE.Vector2
let animationId: number
let isPainting = false // 是否处于涂色拖拽
let hoverOnTarget = false // 鼠标是否悬停在目标网格上
let paintingPointerId: number | null = null // 当前涂色的指针 ID
let paintingCaptureTarget: HTMLElement | null = null // 捕获指针的元素

// 性能优化: 复用对象, 避免频繁创建
const tempVec = new THREE.Vector3()
const tempLocalPoint = new THREE.Vector3()
const tempColor = new THREE.Color()
const brushSphere = new THREE.Sphere()
const brushColorObj = new THREE.Color()

function ensureVertexColors(mesh: THREE.Mesh, initialColor = new THREE.Color(0xdddddd)) {
  const geometry = mesh.geometry
  const position = geometry.attributes.position
  if (!position) return
  if (!geometry.attributes.color) {
    const count = position.count
    const colors = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      colors[i * 3] = initialColor.r
      colors[i * 3 + 1] = initialColor.g
      colors[i * 3 + 2] = initialColor.b
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  }
  if (mesh.material instanceof THREE.MeshStandardMaterial) {
    mesh.material.vertexColors = true
    mesh.material.needsUpdate = true
  }
}

function clearTargets() {
  targets.forEach((mesh) => {
    const helper = bvhHelperMap.get(mesh)
    if (helper) {
      scene.remove(helper)
      bvhHelperMap.delete(mesh)
    }
    if (mesh.geometry.boundsTree) {
      mesh.geometry.disposeBoundsTree()
    }
    mesh.geometry.dispose()
    if (mesh.material instanceof THREE.Material) {
      mesh.material.dispose()
    }
    if (scene && mesh.parent) {
      mesh.parent.remove(mesh)
    }
  })
  targets = []
  activeTarget = null
}

function setTargets(meshes: THREE.Mesh[]) {
  clearTargets()
  targets = meshes
  activeTarget = meshes[0] ?? null

  targets.forEach((mesh) => {
    ensureVertexColors(mesh)
    ensureFaceLabels(mesh)
    buildBVHForMesh(mesh)
    repaintMeshByFaceLabels(mesh)
  })
}

function repaintMeshByFaceLabels(mesh: THREE.Mesh) {
  const geometry = mesh.geometry
  const colors = geometry.attributes.color
  const faceLabels = faceLabelMap.get(mesh)

  if (!colors || !faceLabels) return

  const toothColor = new THREE.Color(0xffffff)
  const gingivaColor = new THREE.Color(0xc97f88)

  if (geometry.index) {
    const index = geometry.index
    for (let tri = 0; tri < faceLabels.length; tri++) {
      const color = faceLabels[tri] === 1 ? toothColor : gingivaColor

      const a = index.getX(tri * 3)
      const b = index.getX(tri * 3 + 1)
      const c = index.getX(tri * 3 + 2)

      colors.setXYZ(a, color.r, color.g, color.b)
      colors.setXYZ(b, color.r, color.g, color.b)
      colors.setXYZ(c, color.r, color.g, color.b)
    }
  } else {
    for (let tri = 0; tri < faceLabels.length; tri++) {
      const color = faceLabels[tri] === 1 ? toothColor : gingivaColor
      const a = tri * 3
      const b = tri * 3 + 1
      const c = tri * 3 + 2

      colors.setXYZ(a, color.r, color.g, color.b)
      colors.setXYZ(b, color.r, color.g, color.b)
      colors.setXYZ(c, color.r, color.g, color.b)
    }
  }

  colors.needsUpdate = true
}

function initScene(): void {
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0xe2e3dd)

  // 配置相机
  camera = new THREE.PerspectiveCamera(
    75,
    containerRef.value!.clientWidth / containerRef.value!.clientHeight,
    0.1,
    1000,
  )
  camera.position.set(0, 50, 0)
  camera.lookAt(0, 0, 0)
  camera.up.set(0, 0, 1)

  // 配置渲染器
  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(containerRef.value!.clientWidth, containerRef.value!.clientHeight)
  containerRef.value!.appendChild(renderer.domElement)

  // 配置控制器
  controls = new TrackballControls(camera, renderer.domElement)
  controls.rotateSpeed = 3.0
  controls.zoomSpeed = 1.2
  controls.panSpeed = 0.8

  // 添加坐标轴
  const axesHelper = new THREE.AxesHelper(50)
  scene.add(axesHelper)

  // 初始化 Raycaster
  raycaster = new THREE.Raycaster()
  mouse = new THREE.Vector2()

  window.addEventListener('resize', onWindowResize)
}

function setupLights(): void {
  const ambientLight = new THREE.AmbientLight(0xffffff, 1.8)
  scene.add(ambientLight)

  const mainLight = new THREE.DirectionalLight(0xffffff, 1.6)
  mainLight.position.set(8, 12, 10)
  scene.add(mainLight)

  const fillLight = new THREE.DirectionalLight(0xffffff, 1.0)
  fillLight.position.set(-8, -6, 8)
  scene.add(fillLight)

  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x888888, 0.8)
  scene.add(hemiLight)
}

/**
 * 步骤 1: 给 mesh 构建 BVH
 * 这是性能加速的关键步骤
 */
function buildBVHForMesh(mesh: THREE.Mesh): void {
  const geometry = mesh.geometry

  // 确保几何体有索引(BVH 需要)
  if (!geometry.index) {
    console.warn('几何体没有索引, BVH 可能无法正常工作')
  }

  // 设置 BVH 相关方法
  geometry.computeBoundsTree = computeBoundsTree
  geometry.disposeBoundsTree = disposeBoundsTree

  // 构建 BVH 树
  console.log('开始构建 BVH...')
  const startTime = performance.now()
  geometry.computeBoundsTree()
  const buildTime = performance.now() - startTime
  console.log(`BVH 构建完成, 耗时: ${buildTime.toFixed(2)}ms`)

  // 启用加速射线检测(可选, 用于更快的点击检测)
  if (geometry.boundsTree) {
    mesh.raycast = acceleratedRaycast
  }

  // 创建 BVH 可视化辅助器(用于调试)
  if (showBVHHelper.value) {
    createBVHVisualizer(mesh)
  }
}

/**
 * 创建 BVH 可视化辅助器(用于调试)
 */
function createBVHVisualizer(mesh: THREE.Mesh): void {
  // 移除旧的辅助器
  let bvhHelper = bvhHelperMap.get(mesh)
  if (bvhHelper) {
    scene.remove(bvhHelper)
    bvhHelperMap.delete(mesh)
  }

  if (!mesh.geometry.boundsTree) return

  // 创建可视化辅助器(深度级别 10)
  bvhHelper = new MeshBVHHelper(mesh, 10)
  scene.add(bvhHelper)
  bvhHelperMap.set(mesh, bvhHelper)
}

/**
 * 切换 BVH 可视化
 */
function toggleBVHVisualizer(): void {
  showBVHHelper.value = !showBVHHelper.value
  targets.forEach((target) => {
    if (showBVHHelper.value) {
      createBVHVisualizer(target)
      return
    }
    const helper = bvhHelperMap.get(target)
    if (!helper) return
    scene.remove(helper)
    bvhHelperMap.delete(target)
  })
}

/**
 * 创建默认模型(高精度球体)并初始化顶点颜色 + 构建 BVH
 */
function createModelWithVertexColors(): void {
  // 1. 创建高精度球体几何体(128x128 分段, 约 16k 顶点)
  const geometry = new THREE.SphereGeometry(2, 128, 128)

  // 2. 初始化顶点颜色
  const count = geometry.attributes.position.count
  const colors = new Float32Array(count * 3)

  // 初始化为灰色
  const initialColor = new THREE.Color(0xdddddd)
  for (let i = 0; i < count; i++) {
    colors[i * 3] = initialColor.r
    colors[i * 3 + 1] = initialColor.g
    colors[i * 3 + 2] = initialColor.b
  }

  // 3. 将颜色数据设置为几何体的 'color' 属性
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

  // 4. 创建材质, 启用顶点颜色
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
  })

  // 5. 创建网格
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(0, 0, 0)
  scene.add(mesh)

  setTargets([mesh])

  // 调整相机以适合模型
  fitCameraToObject()
}

/**
 * 创建半透明笔刷指示器
 */
function createBrushIndicator(): void {
  const brushGeometry = new THREE.SphereGeometry(brushRadius.value, 32, 32)
  const brushMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ff00,
    transparent: true,
    opacity: 0.25,
    depthWrite: false,
    side: THREE.DoubleSide,
  })

  brushMesh = new THREE.Mesh(brushGeometry, brushMaterial)
  brushMesh.visible = false
  scene.add(brushMesh)
}

/**
 * Raycast 到目标网格, 返回命中结果
 */
function raycastToTarget(event: PointerEvent): THREE.Intersection | null {
  if (!containerRef.value || targets.length === 0) return null

  const rect = containerRef.value.getBoundingClientRect()
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

  raycaster.setFromCamera(mouse, camera)
  const intersects = raycaster.intersectObjects(targets, true)
  const hit = intersects.length > 0 ? intersects[0] : null
  activeTarget = hit ? (hit.object as THREE.Mesh) : null
  return hit
}

/**
 * 更新 hover 状态与笔刷指示器
 */
function updateHover(event: PointerEvent): THREE.Intersection | null {
  if (!brushMesh) return null
  const hit = raycastToTarget(event)
  hoverOnTarget = !!hit

  if (hit) {
    brushMesh.position.copy(hit.point)
    brushMesh.visible = true
  } else {
    brushMesh.visible = false
  }
  return hit
}

/**
 * 在命中点执行涂色
 */
function paintAtIntersect(intersect: THREE.Intersection): void {
  if (!activeTarget) return
  const worldPoint = intersect.point.clone()
  const localPoint = activeTarget.worldToLocal(worldPoint)
  paintMeshWithBVH(activeTarget, localPoint)
}

/**
 * 指针按下: 若命中目标则进入涂色模式
 */
function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return // 仅左键
  const hit = updateHover(event)
  if (hit) {
    isPainting = true
    controls.enabled = false // 暂停旋转
    paintAtIntersect(hit)
    event.preventDefault()
    event.stopPropagation() // 阻止事件继续传递给 TrackballControls
    // 捕获指针, 确保 move/up 不丢失
    paintingPointerId = event.pointerId
    paintingCaptureTarget = event.currentTarget as HTMLElement | null
    if (paintingCaptureTarget?.setPointerCapture) {
      paintingCaptureTarget.setPointerCapture(event.pointerId)
    }
  } else {
    controls.enabled = true // 允许旋转
  }
}

/**
 * 指针移动: 更新 hover；若正在涂色则连续涂
 */
function onPointerMove(event: PointerEvent) {
  const hit = updateHover(event)
  if (isPainting && hit) {
    paintAtIntersect(hit)
    event.preventDefault()
  }
  // 未在涂色时不改变 controls.enabled, 保持当前模式
}

/**
 * 指针抬起或离开: 结束涂色, 恢复旋转
 */
function endPainting() {
  isPainting = false
  controls.enabled = true
  // 释放指针捕获
  if (
    paintingCaptureTarget &&
    paintingPointerId !== null &&
    paintingCaptureTarget.releasePointerCapture
  ) {
    try {
      paintingCaptureTarget.releasePointerCapture(paintingPointerId)
    } catch (e) {
      // ignore if already released
    }
  }
  paintingPointerId = null
  paintingCaptureTarget = null
}

function onPointerUp(): void {
  endPainting()
}

function onPointerLeave(): void {
  brushMesh && (brushMesh.visible = false)
  endPainting()
}

/**
 * 核心着色函数: 使用 BVH 加速, 只处理笔刷范围内的三角形顶点
 *
 * 性能对比:
 * - 原始方案: O(n) - 遍历所有顶点
 * - BVH 方案: O(log n + k) - 只遍历相关三角面, k << n
 *
 * 当顶点数达到几十万时, BVH 方案性能提升 100+ 倍
 */
function paintMeshWithBVH(mesh: THREE.Mesh, localPoint: THREE.Vector3): void {
  const startTime = performance.now()
  const geometry = mesh.geometry
  const bvh = geometry.boundsTree

  if (!bvh) {
    console.warn('BVH 未构建')
    return
  }

  ensureFaceLabels(mesh)
  const faceLabels = faceLabelMap.get(mesh)
  if (!faceLabels) return

  brushSphere.set(localPoint, brushRadius.value)

  const hitTriangleIndices: number[] = []
  const triCenter = new THREE.Vector3()

  bvh.shapecast({
    intersectsBounds: (boxBounds: THREE.Box3) => {
      return boxBounds.intersectsSphere(brushSphere)
    },
    intersectsTriangle: (tri: THREE.Triangle, triangleIndex: number) => {
      triCenter
        .copy(tri.a)
        .add(tri.b)
        .add(tri.c)
        .multiplyScalar(1 / 3)

      if (triCenter.distanceTo(localPoint) <= brushRadius.value) {
        hitTriangleIndices.push(triangleIndex)
      }

      return false
    },
  })

  const nextLabel = getBrushLabel()
  for (const triangleIndex of hitTriangleIndices) {
    faceLabels[triangleIndex] = nextLabel
  }

  repaintMeshByFaceLabels(mesh)

  const paintTime = performance.now() - startTime
  lastPaintTime.value = paintTime
  lastAffectedVertices.value = hitTriangleIndices.length
}
function resetSegmentation() {
  targets.forEach((mesh) => {
    ensureFaceLabels(mesh)
    const faceLabels = faceLabelMap.get(mesh)
    if (!faceLabels) return

    faceLabels.fill(0)
    repaintMeshByFaceLabels(mesh)
  })

  lastPaintTime.value = null
  lastAffectedVertices.value = null
}
function buildSegmentedGeometry(mesh: THREE.Mesh, targetLabel: SegmentLabel) {
  const source = mesh.geometry
  const positions = source.attributes.position as THREE.BufferAttribute | undefined
  const normals = source.attributes.normal as THREE.BufferAttribute | undefined
  const index = source.index
  const faceLabels = faceLabelMap.get(mesh)

  if (!positions || !faceLabels) return null

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

  for (let tri = 0; tri < faceLabels.length; tri++) {
    if (faceLabels[tri] !== targetLabel) continue

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

  if (nextPositions.length === 0) return null

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(nextPositions, 3))

  if (nextNormals.length > 0) {
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nextNormals, 3))
  } else {
    geometry.computeVertexNormals()
  }

  geometry.computeBoundingSphere()
  geometry.computeBoundingBox()

  return geometry
}

function disposeSegmentedGroup() {
  if (!segmentedGroup) return

  scene.remove(segmentedGroup)
  segmentedGroup.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return

    child.geometry.dispose()
    if (Array.isArray(child.material)) {
      child.material.forEach((mat) => mat.dispose())
    } else {
      child.material.dispose()
    }
  })

  segmentedGroup = null
  setTargetsVisible(true)
}
function setTargetsVisible(visible: boolean) {
  targets.forEach((mesh) => {
    mesh.visible = visible
  })
}

function buildSegmentPreview() {
  if (!scene || targets.length === 0) return

  disposeSegmentedGroup()
  segmentedGroup = new THREE.Group()

  targets.forEach((mesh) => {
    const toothGeometry = buildSegmentedGeometry(mesh, 1)
    const gingivaGeometry = buildSegmentedGeometry(mesh, 0)

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
      segmentedGroup!.add(toothMesh)
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
      segmentedGroup!.add(gingivaMesh)
    }
  })

  if (segmentedGroup.children.length === 0) {
    console.warn('没有可预览的分割结果')
    segmentedGroup = null
    setTargetsVisible(true)
    return
  }

  scene.add(segmentedGroup)
  setTargetsVisible(false)
}

function getBrushLabel(): SegmentLabel {
  return brushMode.value === 'tooth' ? 1 : 0
}

function ensureFaceLabels(mesh: THREE.Mesh) {
  const geometry = mesh.geometry
  const triangleCount = geometry.index
    ? geometry.index.count / 3
    : geometry.attributes.position.count / 3

  if (!faceLabelMap.has(mesh)) {
    faceLabelMap.set(mesh, new Uint8Array(triangleCount))
  }
}

/**
 * 回退方案: 传统 O(n) 遍历方法(当 BVH 未构建时使用)
 */
function paintMeshFallback(mesh: THREE.Mesh, localPoint: THREE.Vector3): void {
  const startTime = performance.now()
  const geometry = mesh.geometry
  const positions = geometry.attributes.position
  const colors = geometry.attributes.color

  if (!colors) return

  brushColorObj.set(brushColor.value)
  const currentRadius = brushRadius.value

  let paintedCount = 0
  // 遍历所有顶点(性能较差)
  for (let i = 0; i < positions.count; i++) {
    tempVec.set(positions.getX(i), positions.getY(i), positions.getZ(i))

    const dist = tempVec.distanceTo(localPoint)

    if (dist < currentRadius) {
      const factor = 1 - dist / currentRadius
      tempColor.set(colors.getX(i), colors.getY(i), colors.getZ(i))
      tempColor.lerp(brushColorObj, factor * brushIntensity.value)
      colors.setXYZ(i, tempColor.r, tempColor.g, tempColor.b)
      paintedCount++
    }
  }

  colors.needsUpdate = true

  const paintTime = performance.now() - startTime
  lastPaintTime.value = paintTime
  lastAffectedVertices.value = paintedCount
  console.warn(`回退方法: ${paintedCount} 个顶点, 耗时 ${paintTime.toFixed(2)}ms`)
}

/**
 * 重置所有顶点颜色为初始灰色
 */
function resetColors(): void {
  const initialColor = new THREE.Color(0xdddddd)
  targets.forEach((mesh) => {
    const colors = mesh.geometry.attributes.color
    if (!colors) return
    const count = colors.count
    for (let i = 0; i < count; i++) {
      colors.setXYZ(i, initialColor.r, initialColor.g, initialColor.b)
    }
    colors.needsUpdate = true
  })
  lastPaintTime.value = null
  lastAffectedVertices.value = null
}

/**
 * 更新笔刷指示器大小
 */
function updateBrushSize(): void {
  if (!brushMesh) return

  const oldGeometry = brushMesh.geometry
  brushMesh.geometry = new THREE.SphereGeometry(brushRadius.value, 32, 32)
  oldGeometry.dispose()
}

/**
 * 处理文件加载
 */
async function handleFileChange(event: Event): Promise<void> {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return

  // 移除旧模型
  clearTargets()

  const fileName = file.name.toLowerCase()
  const url = URL.createObjectURL(file)

  try {
    const fileType = fileName.split('.').pop()
    let geometry: THREE.BufferGeometry | null = null

    switch (fileType) {
      case 'glb':
      case 'gltf':
        geometry = await loadGLTF(url)
        break
      case 'obj':
        geometry = await loadOBJ(url)
        break
      case 'stl':
        geometry = await loadSTL(url)
        break
      default:
        throw new Error('不支持的文件类型')
    }

    if (!geometry) throw new Error('未找到几何体')

    // 初始化顶点颜色
    const count = geometry.attributes.position.count
    const colors = new Float32Array(count * 3)
    const initialColor = new THREE.Color(0xdddddd)
    for (let i = 0; i < count; i++) {
      colors[i * 3] = initialColor.r
      colors[i * 3 + 1] = initialColor.g
      colors[i * 3 + 2] = initialColor.b
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

    // 创建材质和网格
    const material = new THREE.MeshStandardMaterial({
      color: 0xf2f2f2,
      vertexColors: true,
      side: THREE.DoubleSide,
      metalness: 0.05,
      roughness: 0.9,
      emissive: 0x222222,
      emissiveIntensity: 0.35,
    })
    const mesh = new THREE.Mesh(geometry, material)
    scene.add(mesh)
    setTargets([mesh])

    // 调整相机
    fitCameraToObject()
  } catch (error) {
    console.error('加载模型失败:', error)
  } finally {
    URL.revokeObjectURL(url)
  }
}

function loadGLTF(url: string): Promise<THREE.BufferGeometry | null> {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader()
    loader.load(
      url,
      (gltf) => {
        // 查找第一个 mesh
        let foundGeometry: THREE.BufferGeometry | null = null
        gltf.scene.traverse((child) => {
          if (child instanceof THREE.Mesh && !foundGeometry) {
            foundGeometry = child.geometry
          }
        })
        if (foundGeometry) {
          resolve(foundGeometry)
        } else {
          reject(new Error('未找到几何体'))
        }
      },
      undefined,
      reject,
    )
  })
}

function loadOBJ(url: string): Promise<THREE.BufferGeometry | null> {
  return new Promise((resolve, reject) => {
    const loader = new OBJLoader()
    loader.load(
      url,
      (object) => {
        let foundGeometry: THREE.BufferGeometry | null = null
        object.traverse((child) => {
          if (child instanceof THREE.Mesh && !foundGeometry) {
            foundGeometry = child.geometry
          }
        })
        if (foundGeometry) {
          resolve(foundGeometry)
        } else {
          reject(new Error('未找到几何体'))
        }
      },
      undefined,
      reject,
    )
  })
}

function loadSTL(url: string): Promise<THREE.BufferGeometry> {
  return new Promise(async (resolve, reject) => {
    try {
      const loader = new STLLoader()
      const geometry = await loader.loadAsync(url)
      geometry.computeVertexNormals()
      resolve(geometry)
    } catch (error) {
      reject(error)
    }
  })
}

function fitCameraToObject() {
  if (targets.length === 0) return

  const box = new THREE.Box3()
  targets.forEach((mesh) => box.expandByObject(mesh))
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())

  const maxDim = Math.max(size.x, size.y, size.z)
  const fov = camera.fov * (Math.PI / 180)
  let cameraDistance = maxDim / 2 / Math.tan(fov / 2)
  cameraDistance *= 1.5

  camera.position.set(
    center.x + cameraDistance,
    center.y + cameraDistance * 0.6,
    center.z + cameraDistance,
  )
  camera.lookAt(center)

  if (controls) {
    controls.target.copy(center)
    controls.update()
  }
}

function resetCamera() {
  fitCameraToObject()
}

function onWindowResize() {
  if (!containerRef.value) return
  camera.aspect = containerRef.value.clientWidth / containerRef.value.clientHeight
  camera.updateProjectionMatrix()
  renderer.setSize(containerRef.value.clientWidth, containerRef.value.clientHeight)
}

function animate() {
  animationId = requestAnimationFrame(animate)
  controls.update()
  renderer.render(scene, camera)
}

async function loadTestResource(scene: THREE.Scene): Promise<THREE.Group> {
  const upper =
    'http://121.199.1.155:19000/ds-prod/attachment/2026/04/2fd26a3e82034e23a3ce4e1c9e5d8d4b.stl?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=dsminioadmin%2F20260414%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260414T011154Z&X-Amz-Expires=604800&X-Amz-SignedHeaders=host&X-Amz-Signature=7434fd62f2b5083277ec65470e5d8cd688b0b710033ccd5f916801475031c949'
  const lower =
    'http://121.199.1.155:19000/ds-prod/attachment/2026/04/c4c9de9ed8324e2b9605e50beb1d6d36.stl?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=dsminioadmin%2F20260414%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260414T011154Z&X-Amz-Expires=604800&X-Amz-SignedHeaders=host&X-Amz-Signature=651746aaad7f3fc810314de0322d2585009e99b3bad53973018871fc4012e742'
  const loader = new STLLoader()
  const upperGeometry = await loader.loadAsync(upper)
  const lowerGeometry = await loader.loadAsync(lower)

  const material = new THREE.MeshStandardMaterial({
    color: 0xf2f2f2,
    vertexColors: true,
    side: THREE.DoubleSide,
    metalness: 0.05,
    roughness: 0.9,
    emissive: 0x222222,
    emissiveIntensity: 0.35,
  })

  const upperMesh = new THREE.Mesh(upperGeometry, material)
  const lowerMesh = new THREE.Mesh(lowerGeometry, material)

  const group = new THREE.Group()
  group.add(lowerMesh)
  group.add(upperMesh)
  scene.add(group)
  return group
}

// 监听笔刷半径变化
watch(brushRadius, () => {
  updateBrushSize()
})

onMounted(async () => {
  initScene()
  setupLights()
  createBrushIndicator()

  const group = await loadTestResource(scene)
  const meshes: THREE.Mesh[] = []
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      meshes.push(child)
    }
  })
  setTargets(meshes)
  fitCameraToObject()

  containerRef.value?.addEventListener('pointerdown', onPointerDown, {
    passive: false,
    capture: true,
  })
  containerRef.value?.addEventListener('pointermove', onPointerMove, { passive: false })
  containerRef.value?.addEventListener('pointerup', onPointerUp, { passive: true })
  containerRef.value?.addEventListener('pointerleave', onPointerLeave, { passive: true })
  // 全局监听, 保证在容器外抬起也能结束涂色并恢复旋转
  window.addEventListener('pointerup', onPointerUp, { passive: true })

  animate()
})

onBeforeUnmount(() => {
  if (animationId) cancelAnimationFrame(animationId)

  containerRef.value?.removeEventListener('pointermove', onPointerMove)
  containerRef.value?.removeEventListener('pointerdown', onPointerDown, { capture: true } as any)
  containerRef.value?.removeEventListener('pointerup', onPointerUp)
  containerRef.value?.removeEventListener('pointerleave', onPointerLeave)
  window.removeEventListener('pointerup', onPointerUp)

  // 清理资源
  clearTargets()
  if (brushMesh) {
    brushMesh.geometry.dispose()
    if (brushMesh.material instanceof THREE.Material) {
      brushMesh.material.dispose()
    }
  }
  if (renderer) renderer.dispose()
  window.removeEventListener('resize', onWindowResize)
})
</script>

<style scoped>
.three-demo {
  width: 100%;
  height: 100vh;
  display: flex;
  flex-direction: column;
  position: relative;
}

.controls {
  padding: 10px;
  background: rgba(51, 51, 51, 0.9);
  display: flex;
  gap: 15px;
  align-items: center;
  flex-wrap: wrap;
  z-index: 10;
}

.control-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.control-group label {
  color: white;
  font-size: 14px;
  white-space: nowrap;
}

.control-group input[type='range'] {
  width: 150px;
}

.control-group input[type='color'] {
  width: 40px;
  height: 30px;
  border: none;
  cursor: pointer;
}

.control-group span {
  color: white;
  min-width: 40px;
  font-size: 14px;
}

.controls button {
  padding: 8px 16px;
  background: #4a90e2;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.controls button:hover {
  background: #357abd;
}

.controls input[type='file'] {
  color: white;
  font-size: 14px;
}

.info-panel {
  position: absolute;
  top: 70px;
  left: 20px;
  background-color: rgba(0, 0, 0, 0.7);
  padding: 15px;
  border-radius: 5px;
  z-index: 10;
  color: #fff;
  font-size: 14px;
}

.info-panel p {
  margin: 5px 0;
}

.canvas-container {
  flex: 1;
  width: 100%;
  overflow: hidden;
  cursor: crosshair;
}
</style>
