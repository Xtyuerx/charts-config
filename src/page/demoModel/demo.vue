<template>
  <div class="page">
    <div class="toolbar">
      <button @click="toggleSmooth">{{ smooth ? '平滑曲线: ON' : '平滑曲线: OFF' }}</button>
      <button @click="exportJSON">导出标注 (JSON)</button>
      <label><input type="checkbox" v-model="showPreview" /> 显示参考图</label>
    </div>

    <div ref="container" class="viewer">
      <img v-if="showPreview" :src="previewImageUrl" class="preview-img" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer'
import { CatmullRomCurve3 } from 'three'

// ================== 配置 ==================
const modelUrl = '/models/UpperJaw.stl' // <- 请替换成你的 stl 路径
const previewImageUrl = '/mnt/data/1531144d-8014-4388-a6a6-c4a026e00c5b.png'
const showPreview = ref(false)
const smooth = ref(true)

// 初始标注（STL 原始坐标系）
let initialMarks = [
  { position: new THREE.Vector3(12.3, 32, -5), text: '牙尖 A', color: 0xff5555, size: 2.0 },
  { position: new THREE.Vector3(30.2, 18, -5), text: '牙尖 B', color: 0xff7755, size: 2.0 },
  { position: new THREE.Vector3(-40.0, -2.0, -2.2), text: '缺损点 C', color: 0xcc4444, size: 2.0 },
]

// 需要连线的索引对
const connectionPairs: [number, number][] = [
  [0, 1],
  [1, 2],
  [0, 2],
]

// ================== three 变量 ==================
const container = ref<HTMLDivElement | null>(null)
let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let renderer: THREE.WebGLRenderer
let labelRenderer: CSS2DRenderer
let controls: OrbitControls
let modelMesh: THREE.Mesh | null = null
let animId: number | null = null

// 存标注和连接
type MarkObj = {
  idx: number
  orig: { position: THREE.Vector3; text: string; color?: number; size?: number }
  sphere: THREE.Mesh
  labelObj: CSS2DObject
  leader: THREE.Line
  highlighted: boolean
}
const marks: MarkObj[] = []

const connections: { line: THREE.Line; pair: [number, number]; distLabel: CSS2DObject }[] = []

// transform params（加载 STL 后设置）
let stlCenter = new THREE.Vector3(0, 0, 0)
let stlScale = 1

// 拖拽相关
const pointer = new THREE.Vector2()
const raycaster = new THREE.Raycaster()
const dragPlane = new THREE.Plane()
let draggingIndex: number | null = null
let dragOffset = new THREE.Vector3()
const planeIntersect = new THREE.Vector3()

// UI state
const showPreviewRef = showPreview

// ================== 生命周期 ==================
onMounted(() => {
  initThree()
  loadModel(modelUrl)
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  if (animId) cancelAnimationFrame(animId)
  renderer.domElement.removeEventListener('pointerdown', onPointerDown)
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  renderer.dispose()
})

// ================== 初始化 three ==================
function initThree() {
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0xf6f6f6)

  const rect = container.value!.getBoundingClientRect()
  camera = new THREE.PerspectiveCamera(45, rect.width / rect.height, 0.1, 5000)
  camera.position.set(120, 120, 150)

  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(rect.width, rect.height)
  container.value!.appendChild(renderer.domElement)

  labelRenderer = new CSS2DRenderer()
  labelRenderer.setSize(rect.width, rect.height)
  labelRenderer.domElement.style.position = 'absolute'
  labelRenderer.domElement.style.top = '0'
  labelRenderer.domElement.style.pointerEvents = 'none' // label layer won't block pointer
  container.value!.appendChild(labelRenderer.domElement)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08

  const amb = new THREE.AmbientLight(0xffffff, 0.9)
  scene.add(amb)
  const dir = new THREE.DirectionalLight(0xffffff, 0.6)
  dir.position.set(50, 100, 80)
  scene.add(dir)

  // pointer listeners (attached after renderer created)
  renderer.domElement.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)

  animate()
}

// ================== 加载 STL ==================
function loadModel(url: string) {
  const loader = new STLLoader()
  loader.load(
    url,
    (geometry) => {
      geometry.computeBoundingBox()
      if (geometry.boundingBox) {
        geometry.boundingBox.getCenter(stlCenter)
        geometry.translate(-stlCenter.x, -stlCenter.y, -stlCenter.z)
      }

      const mat = new THREE.MeshStandardMaterial({ color: 0xf8d7d7, roughness: 0.4 })
      const mesh = new THREE.Mesh(geometry, mat)

      // scale to fit
      const bbox = new THREE.Box3().setFromObject(mesh)
      const size = new THREE.Vector3()
      bbox.getSize(size)
      const maxSide = Math.max(size.x, size.y, size.z)
      if (maxSide > 0) {
        stlScale = 100 / maxSide
        mesh.scale.setScalar(stlScale)
      }

      scene.add(mesh)
      modelMesh = mesh

      // create marks and lightweight connections (straight lines)
      createMarksFromInitial(initialMarks)
      createLightConnections() // only straight lines initially
    },
    undefined,
    (err) => {
      console.error('STL load error', err)
    },
  )
}

// ================== 工具函数 ==================
function toModelCoord(orig: THREE.Vector3) {
  return orig.clone().sub(stlCenter).multiplyScalar(stlScale)
}

function smoothPoints(points: THREE.Vector3[], divisions = 40) {
  if (points.length <= 2) return points
  const curve = new CatmullRomCurve3(points)
  return curve.getPoints(divisions)
}

// ================== 创建标注 ==================
// function createMarksFromInitial(
//   arr: { position: THREE.Vector3; text: string; color?: number; size?: number }[],
// ) {
//   // cleanup
//   marks.forEach((m) => {
//     scene.remove(m.sphere)
//     scene.remove(m.labelObj)
//     scene.remove(m.leader)
//   })
//   marks.length = 0

//   arr.forEach((d, i) => {
//     const pos = toModelCoord(d.position)
//     const geo = new THREE.SphereGeometry(d.size ?? 2, 24, 20)
//     const mat = new THREE.MeshStandardMaterial({
//       color: d.color ?? 0xff5555,
//       metalness: 0.2,
//       roughness: 0.4,
//       emissive: 0x000000,
//     })
//     const sphere = new THREE.Mesh(geo, mat)
//     sphere.position.copy(pos)
//     sphere.userData.index = i
//     scene.add(sphere)

//     // leader line (initial)
//     const leaderGeom = new THREE.BufferGeometry().setFromPoints([
//       new THREE.Vector3(0, 0, 0),
//       new THREE.Vector3(8, 8, 0),
//     ])
//     const leaderMat = new THREE.LineBasicMaterial({ color: 0x333333 })
//     const leader = new THREE.Line(leaderGeom, leaderMat)
//     leader.position.copy(pos)
//     scene.add(leader)

//     // label via CSS2DObject
//     const div = document.createElement('div')
//     div.className = 'label-box'
//     div.textContent = d.text
//     // crucial: labels should not block pointer events (we set pointer-events none in CSS)
//     const labelObj = new CSS2DObject(div)
//     const camDir = new THREE.Vector3().subVectors(camera.position, pos).normalize()
//     labelObj.position.copy(pos.clone().add(camDir.multiplyScalar(12)))
//     scene.add(labelObj)

//     marks.push({
//       idx: i,
//       orig: { position: d.position.clone(), text: d.text, color: d.color, size: d.size },
//       sphere,
//       labelObj,
//       leader,
//       highlighted: false,
//     })
//   })
// }

// ================== 轻量连接（直线，仅在非交互时使用） ==================
function createLightConnections() {
  // cleanup
  connections.forEach((c) => {
    scene.remove(c.line)
    scene.remove(c.distLabel)
  })
  connections.length = 0

  connectionPairs.forEach((pair) => {
    const [i, j] = pair
    const A = marks[i].sphere.position.clone()
    const B = marks[j].sphere.position.clone()
    const geom = new THREE.BufferGeometry().setFromPoints([A, B])
    const mat = new THREE.LineBasicMaterial({ color: 0x00b6ff })
    const line = new THREE.Line(geom, mat)
    scene.add(line)

    // distance label (CSS2D)
    const div = document.createElement('div')
    div.className = 'distance-label'
    div.textContent = A.distanceTo(B).toFixed(2) + ' mm'
    const distLabel = new CSS2DObject(div)
    distLabel.position.copy(A.clone().add(B).multiplyScalar(0.5))
    scene.add(distLabel)

    connections.push({ line, pair: [i, j], distLabel })
  })
}

// ================== 精细避障路径生成（只在拖拽或结束时调用） ==================
function computeSafePath(
  A: THREE.Vector3,
  B: THREE.Vector3,
  mesh: THREE.Mesh,
  segments = 48,
  lift = 1.2,
) {
  const dir = new THREE.Vector3().subVectors(B, A)
  const step = dir.clone().divideScalar(segments)
  const pts: THREE.Vector3[] = []

  for (let i = 0; i <= segments; i++) {
    const p = A.clone().add(step.clone().multiplyScalar(i))
    // cast a ray from above toward model to detect penetration
    const from = p.clone().add(new THREE.Vector3(0, 0, 3))
    const down = new THREE.Vector3(0, 0, -1)
    raycaster.set(from, down)
    const hits = raycaster.intersectObject(mesh, true)
    if (hits.length > 0) {
      const h = hits[0]
      const normal = (h.face?.normal?.clone() ?? new THREE.Vector3(0, 1, 0)).transformDirection(
        mesh.matrixWorld,
      )
      p.add(normal.multiplyScalar(lift))
    }
    pts.push(p)
  }
  return pts
}

// ================== 拖拽/拾取 ==================
function getPointerNDC(e: PointerEvent) {
  const rect = renderer.domElement.getBoundingClientRect()
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
}

function onPointerDown(e: PointerEvent) {
  getPointerNDC(e)
  raycaster.setFromCamera(pointer, camera)
  const intersects = raycaster.intersectObjects(
    marks.map((m) => m.sphere),
    true,
  )
  if (intersects.length > 0) {
    const picked = intersects[0].object as THREE.Mesh
    const idx = picked.userData.index as number
    draggingIndex = idx

    // set drag plane perpendicular to camera at the picked position
    dragPlane.setFromNormalAndCoplanarPoint(
      camera.getWorldDirection(new THREE.Vector3()).clone().negate(),
      picked.position,
    )

    // compute offset between picked pos and intersection
    dragPlane.projectPoint(intersects[0].point, planeIntersect)
    dragOffset.copy(picked.position).sub(planeIntersect)

    // highlight and enable fine updates during drag
    toggleHighlight(idx, true)
    controls.enabled = false

    // when dragging starts -> replace only relevant connections with coarse safe paths (small segments)
    updateConnectionDuringDrag(idx)
  } else {
    // deselect all
    marks.forEach((m) => toggleHighlight(m.idx, false))
  }
  e.preventDefault()
}

function onPointerMove(e: PointerEvent) {
  if (draggingIndex === null) return
  getPointerNDC(e)
  raycaster.setFromCamera(pointer, camera)

  // try to stick to model surface
  const hits = raycaster.intersectObject(modelMesh!, true)
  if (hits.length > 0) {
    const pt = hits[0].point.clone()
    const normal = (hits[0].face?.normal?.clone() ?? new THREE.Vector3(0, 1, 0)).transformDirection(
      modelMesh!.matrixWorld,
    )
    const lift = (marks[draggingIndex].orig.size ?? 2) * 0.6
    pt.add(normal.multiplyScalar(lift))
    setMarkPosition(draggingIndex, pt)
  } else {
    // project onto dragPlane
    if (raycaster.ray.intersectPlane(dragPlane, planeIntersect)) {
      planeIntersect.add(dragOffset)
      setMarkPosition(draggingIndex, planeIntersect.clone())
    }
  }

  // during dragging: do cheap/update for affected connections only (small segments)
  updateConnectionDuringDrag(draggingIndex)
}

function onPointerUp() {
  if (draggingIndex !== null) {
    // finalize: recompute fine path & smooth for all affected connections
    finalizeConnectionsAfterDrag(draggingIndex)
    toggleHighlight(draggingIndex, false)
    draggingIndex = null
    controls.enabled = true
  }
}

// ================== 设置点位置 ==================
function setMarkPosition(index: number, worldPos: THREE.Vector3) {
  const m = marks[index]
  if (!m) return
  m.sphere.position.copy(worldPos)

  // update label offset (face camera)
  const camDir = new THREE.Vector3().subVectors(camera.position, worldPos).normalize()
  const offset = camDir.clone().multiplyScalar(12)
  m.labelObj.position.copy(worldPos.clone().add(offset))

  // update leader line
  const p1 = m.labelObj.position.clone().sub(worldPos)
  ;(m.leader.geometry as THREE.BufferGeometry).setFromPoints([new THREE.Vector3(0, 0, 0), p1])
  m.leader.position.copy(worldPos)
}

// ================== 高亮 ==================
function toggleHighlight(index: number, on: boolean) {
  const m = marks[index]
  if (!m) return
  if (on) {
    m.sphere.scale.setScalar(1.4)
    ;(m.sphere.material as THREE.MeshStandardMaterial).emissive.setHex(0x333333)
    m.highlighted = true
  } else {
    m.sphere.scale.setScalar(1.0)
    ;(m.sphere.material as THREE.MeshStandardMaterial).emissive.setHex(0x000000)
    m.highlighted = false
  }
}

// ================== 仅更新受影响的连接（拖拽期间：轻量版本） ==================
function updateConnectionDuringDrag(changedIdx: number) {
  // For each connection that involves changedIdx, compute coarse safe path (low segments)
  connections.forEach((c) => {
    const [i, j] = c.pair
    if (i === changedIdx || j === changedIdx) {
      const A = marks[i].sphere.position.clone()
      const B = marks[j].sphere.position.clone()
      // cheap safe path: fewer segments
      const pts = computeSafePath(A, B, modelMesh!, 20, 1.0)
      const ptsToUse = smooth.value ? smoothPoints(pts, 24) : pts
      ;(c.line.geometry as THREE.BufferGeometry).setFromPoints(ptsToUse)
      // update distance text quickly
      const dist = A.distanceTo(B).toFixed(2) + ' mm'
      ;(c.distLabel.element as HTMLDivElement).textContent = dist
      c.distLabel.position.copy(A.clone().add(B).multiplyScalar(0.5))
    }
  })
}

// ================== 拖拽结束后：计算更精细的路径（segments 更多） ==================
function finalizeConnectionsAfterDrag(changedIdx: number) {
  connections.forEach((c) => {
    const [i, j] = c.pair
    if (i === changedIdx || j === changedIdx) {
      const A = marks[i].sphere.position.clone()
      const B = marks[j].sphere.position.clone()
      const pts = computeSafePath(A, B, modelMesh!, 60, 1.2)
      const ptsToUse = smooth.value ? smoothPoints(pts, 80) : pts
      ;(c.line.geometry as THREE.BufferGeometry).setFromPoints(ptsToUse)
      const dist = A.distanceTo(B).toFixed(2) + ' mm'
      ;(c.distLabel.element as HTMLDivElement).textContent = dist
      c.distLabel.position.copy(A.clone().add(B).multiplyScalar(0.5))
    }
  })
}

// ================== 创建轻量直线 connections（初始或重建） ==================
// function createLightConnections() {
//   // cleanup
//   connections.forEach((c) => {
//     scene.remove(c.line)
//     scene.remove(c.distLabel)
//   })
//   connections.length = 0

//   connectionPairs.forEach((pair) => {
//     const [i, j] = pair
//     const A = marks[i].sphere.position.clone()
//     const B = marks[j].sphere.position.clone()
//     const geom = new THREE.BufferGeometry().setFromPoints([A, B])
//     const mat = new THREE.LineBasicMaterial({ color: 0x00b6ff })
//     const line = new THREE.Line(geom, mat)
//     scene.add(line)

//     const div = document.createElement('div')
//     div.className = 'distance-label'
//     div.textContent = A.distanceTo(B).toFixed(2) + ' mm'
//     const distLabel = new CSS2DObject(div)
//     distLabel.position.copy(A.clone().add(B).multiplyScalar(0.5))
//     scene.add(distLabel)

//     connections.push({ line, pair: [i, j], distLabel })
//   })
// }

// ================== 导出 JSON ==================
function exportJSON() {
  const data = marks.map((m) => {
    const world = m.sphere.position.clone()
    const orig = world
      .clone()
      .multiplyScalar(1 / stlScale)
      .add(stlCenter)
    return {
      text: m.orig.text,
      x: orig.x,
      y: orig.y,
      z: orig.z,
      color: m.orig.color,
      size: m.orig.size,
    }
  })
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'marks.json'
  a.click()
  URL.revokeObjectURL(url)
}

// ================== animate ==================
function animate() {
  animId = requestAnimationFrame(animate)

  // update label positions & leaders (lightweight)
  marks.forEach((m) => {
    const pos = m.sphere.position
    const camDir = new THREE.Vector3().subVectors(camera.position, pos).normalize()
    const offset = camDir.clone().multiplyScalar(12)
    m.labelObj.position.copy(pos.clone().add(offset))
    const p1 = m.labelObj.position.clone().sub(pos)
    ;(m.leader.geometry as THREE.BufferGeometry).setFromPoints([new THREE.Vector3(0, 0, 0), p1])
    m.leader.position.copy(pos)
  })

  // update distance labels' text & positions (cheap)
  connections.forEach((c) => {
    const [i, j] = c.pair
    const A = marks[i].sphere.position.clone()
    const B = marks[j].sphere.position.clone()
    ;(c.distLabel.element as HTMLDivElement).textContent = A.distanceTo(B).toFixed(2) + ' mm'
    c.distLabel.position.copy(A.clone().add(B).multiplyScalar(0.5))
  })

  controls.update()
  renderer.render(scene, camera)
  labelRenderer.render(scene, camera)
}

// ================== UI helpers ==================
function toggleSmooth() {
  smooth.value = !smooth.value
  // rebuild final connections (use light connections then finalize)
  createLightConnections()
  // finalize all with fine paths (non-blocking, but do sequential small updates)
  connections.forEach((c, idx) => {
    const [i, j] = c.pair
    const A = marks[i].sphere.position.clone()
    const B = marks[j].sphere.position.clone()
    const pts = computeSafePath(A, B, modelMesh!, 48, 1.2)
    const ptsToUse = smooth.value ? smoothPoints(pts, 60) : pts
    ;(c.line.geometry as THREE.BufferGeometry).setFromPoints(ptsToUse)
  })
}

// ================== 事件绑定（pointer handlers 已在 initThree 里注册） ==================
function onResize() {
  if (!container.value) return
  const w = container.value.clientWidth
  const h = container.value.clientHeight
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  renderer.setSize(w, h)
  labelRenderer.setSize(w, h)
}

// pointer handlers are defined above: onPointerDown/onPointerMove/onPointerUp

// ================== 初始化完成：创建标注 & light connections helper ==================
function createMarksFromInitial(
  initial: { position: THREE.Vector3; text: string; color?: number; size?: number }[],
) {
  // already defined earlier — but we might need to call it from loadModel; so we ensure unique naming
  // (This is intentionally left as alias to function defined earlier)
}
// NOTE: aliasing made earlier; actually createMarksFromInitial defined earlier in code; but to ensure scope, call previous function:

// After model loads we already call createMarksFromInitial(initialMarks) and createLightConnections();

// expose showPreview reactive
const showPreviewReactive = showPreviewRef
</script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  height: 100vh;
}
.toolbar {
  padding: 8px;
  background: #fff;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  display: flex;
  gap: 8px;
  align-items: center;
  z-index: 50;
}
.viewer {
  position: relative;
  flex: 1;
  overflow: hidden;
  background: #f6f6f6;
}

/* preview image (debug) */
.preview-img {
  position: absolute;
  right: 12px;
  top: 12px;
  width: 260px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.08);
  z-index: 20;
}

/* label & distance CSS */
/* IMPORTANT: labels must NOT block mouse so drag works (pointer-events: none) */
.label-box {
  display: inline-block;
  padding: 6px 10px;
  background: rgba(20, 20, 20, 0.85);
  color: #fff;
  border-radius: 6px;
  font-size: 13px;
  transform: translate(-50%, -50%);
  white-space: nowrap;
  pointer-events: none; /* <-- crucial for dragging */
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
  user-select: none;
}

.distance-label {
  padding: 4px 8px;
  background: rgba(0, 0, 0, 0.8);
  color: #fff;
  border-radius: 6px;
  font-size: 12px;
  transform: translate(-50%, -50%);
  pointer-events: none;
}

/* small screen */
@media (max-width: 600px) {
  .label-box {
    font-size: 11px;
    padding: 4px 8px;
  }
  .distance-label {
    font-size: 11px;
  }
}
</style>
