<template>
  <div class="page">
    <div class="bar">
      <label><input v-model="showMesh" type="checkbox" @change="syncVisibility" />显示网格</label>
      <label><input v-model="showPoints" type="checkbox" @change="syncVisibility" />显示点云</label>
      <label class="fdi">
        扩展目标牙位 (FDI)
        <input v-model.number="targetFdi" type="number" min="0" max="48" step="1" />
      </label>
      <label><input v-model="expandEnabled" type="checkbox" />启用 Shift+点击扩展</label>
      <button type="button" @click="exportLabels">导出 labels JSON</button>
      <span v-if="hint" class="hint">{{ hint }}</span>
    </div>
    <div ref="wrapRef" class="stl-wrap"></div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import * as THREE from 'three'
import { STLLoader } from 'three-stdlib'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

const wrapRef = ref<HTMLDivElement | null>(null)
const showMesh = ref(true)
const showPoints = ref(true)
const hint = ref('')
const targetFdi = ref(16)
const expandEnabled = ref(false)

const stlUrl = '/models/upper.stl'
const labelUrl = '/models/upper.json'

const gingivaColor = new THREE.Color(0xc97f88)
const meshScale = 1.5
const POINT_STRIDE = 8

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let controls: OrbitControls | null = null
let raf = 0
const raycaster = new THREE.Raycaster()

let jawMesh: THREE.Mesh | null = null
let pointCloud: THREE.Points | null = null
let clickMarker: THREE.Mesh | null = null

let vertexLabels: number[] | null = null
let triAdj: number[][] | null = null
let triCount = 0

let stlGeometry: THREE.BufferGeometry | null = null

let pointerHandler: ((ev: PointerEvent) => void) | null = null

type LabelPayload = {
  labels?: number[]
  faceLabels?: number[]
}

function colorForLabel(label: number): THREE.Color {
  if (!label) return gingivaColor
  const h = (((label * 2654435761) >>> 0) % 360) / 360
  return new THREE.Color().setHSL(h, 0.65, 0.55)
}

function buildPointCloud(
  geometry: THREE.BufferGeometry,
  labels: number[],
  scale: number,
  stride: number,
): THREE.Points {
  const pos = geometry.attributes.position as THREE.BufferAttribute
  const n = pos.count
  const tc = Math.floor(n / 3)
  const st = Math.max(1, Math.floor(stride))

  let positions: Float32Array
  let colors: Float32Array

  if (labels.length === n) {
    let out = 0
    for (let i = 0; i < n; i += st) out++
    positions = new Float32Array(out * 3)
    colors = new Float32Array(out * 3)
    let o = 0
    for (let i = 0; i < n; i += st) {
      positions[o * 3] = pos.getX(i) * scale
      positions[o * 3 + 1] = pos.getY(i) * scale
      positions[o * 3 + 2] = pos.getZ(i) * scale
      const c = colorForLabel(Number(labels[i]))
      colors[o * 3] = c.r
      colors[o * 3 + 1] = c.g
      colors[o * 3 + 2] = c.b
      o++
    }
    hint.value = `点云：顶点抽样 1/${st}，约 ${out} 点（共 ${n} 顶点）`
  } else if (labels.length === tc) {
    let out = 0
    for (let t = 0; t < tc; t += st) out++
    positions = new Float32Array(out * 3)
    colors = new Float32Array(out * 3)
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const c = new THREE.Vector3()
    let o = 0
    for (let t = 0; t < tc; t += st) {
      a.fromBufferAttribute(pos, t * 3)
      b.fromBufferAttribute(pos, t * 3 + 1)
      c.fromBufferAttribute(pos, t * 3 + 2)
      positions[o * 3] = ((a.x + b.x + c.x) / 3) * scale
      positions[o * 3 + 1] = ((a.y + b.y + c.y) / 3) * scale
      positions[o * 3 + 2] = ((a.z + b.z + c.z) / 3) * scale
      const col = colorForLabel(Number(labels[t]))
      colors[o * 3] = col.r
      colors[o * 3 + 1] = col.g
      colors[o * 3 + 2] = col.b
      o++
    }
    hint.value = `点云：三角面抽样 1/${st}，约 ${out} 点（共 ${tc} 面）`
  } else {
    throw new Error(`labels 与几何不匹配：labels=${labels.length}，顶点=${n}，三角面=${tc}`)
  }

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3))

  const mat = new THREE.PointsMaterial({
    size: 2.2,
    vertexColors: true,
    sizeAttenuation: true,
    depthTest: true,
  })
  return new THREE.Points(g, mat)
}

function buildTriangleAdjacency(pos: THREE.BufferAttribute, tc: number): number[][] {
  const edgeMap = new Map<string, number[]>()
  const p = new THREE.Vector3()
  const q = new THREE.Vector3()
  const key = (v: THREE.Vector3) =>
    `${(v.x * 1e5).toFixed(0)},${(v.y * 1e5).toFixed(0)},${(v.z * 1e5).toFixed(0)}`
  function edgeKey(ai: number, bi: number) {
    p.fromBufferAttribute(pos, ai)
    q.fromBufferAttribute(pos, bi)
    const ka = key(p)
    const kb = key(q)
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
  }
  for (let t = 0; t < tc; t++) {
    const a = 3 * t
    const b = a + 1
    const c = a + 2
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      if (u == null || v == null) continue
      const ek = edgeKey(u, v)
      let arr = edgeMap.get(ek)
      if (!arr) {
        arr = []
        edgeMap.set(ek, arr)
      }
      arr.push(t)
    }
  }
  const adj: number[][] = Array.from({ length: tc }, () => [])
  for (const list of edgeMap.values()) {
    const uniq = [...new Set(list)]
  for (let i = 0; i < uniq.length; i++) {
    for (let j = i + 1; j < uniq.length; j++) {
      const ti = uniq[i]
      const tj = uniq[j]
      if (ti == null || tj == null) continue
      adj[ti]?.push(tj)
      adj[tj]?.push(ti)
    }
  }
  }
  return adj
}

function triLabel(labels: number[], t: number) {
  return labels[3 * t]
}

function setTriLabel(labels: number[], t: number, fdi: number) {
  const b = 3 * t
  labels[b] = fdi
  labels[b + 1] = fdi
  labels[b + 2] = fdi
}

function expandToothTowardClick(
  labels: number[],
  adj: number[][],
  fdi: number,
  clickTri: number,
): { changed: number; reached: boolean } {
  if (triLabel(labels, clickTri) === fdi) return { changed: 0, reached: true }

  const queue: number[] = []
  const seen = new Set<number>()
  for (let t = 0; t < triCount; t++) {
    if (triLabel(labels, t) === fdi) {
      queue.push(t)
      seen.add(t)
    }
  }
  if (queue.length === 0) return { changed: 0, reached: false }

  let changed = 0
  while (queue.length) {
    const t = queue.shift()!
    for (const n of adj[t] || []) {
      if (triLabel(labels, n) !== 0) continue
      setTriLabel(labels, n, fdi)
      changed++
      if (!seen.has(n)) {
        seen.add(n)
        queue.push(n)
      }
      if (n === clickTri) return { changed, reached: true }
    }
  }
  return { changed, reached: false }
}

function paintMeshFromVertexLabels(mesh: THREE.Mesh, labels: number[]) {
  const geom = mesh.geometry
  const pos = geom.attributes.position as THREE.BufferAttribute
  const n = pos.count
  const colors = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const c = colorForLabel(Number(labels[i]))
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  if (!geom.attributes.color) {
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  } else {
    const attr = geom.attributes.color as THREE.BufferAttribute
    for (let i = 0; i < colors.length; i++) attr.array[i] = colors[i] ?? 0
    attr.needsUpdate = true
  }
  const mat = mesh.material as THREE.MeshPhongMaterial
  mat.vertexColors = true
  mat.color.setHex(0xffffff)
  mat.needsUpdate = true
}

function resolveVertexLabels(
  geometry: THREE.BufferGeometry,
  payload: LabelPayload,
): { vertexLabels: number[]; triangleCount: number } {
  const pos = geometry.attributes.position as THREE.BufferAttribute
  const vertexCount = pos.count
  const triangleCount = vertexCount / 3
  const sourceLabels = payload.faceLabels?.length ? payload.faceLabels : payload.labels

  if (!sourceLabels?.length) {
    throw new Error('JSON 缺少 labels 或 faceLabels')
  }

  if (sourceLabels.length === vertexCount) {
    return {
      vertexLabels: sourceLabels.map((value) => Number(value)),
      triangleCount,
    }
  }

  if (sourceLabels.length === triangleCount) {
    const vertexLabels = new Array(vertexCount)
    for (let tri = 0; tri < triangleCount; tri++) {
      const value = Number(sourceLabels[tri] ?? 0)
      const base = tri * 3
      vertexLabels[base] = value
      vertexLabels[base + 1] = value
      vertexLabels[base + 2] = value
    }

    return { vertexLabels, triangleCount }
  }

  throw new Error(
    `labels 长度与网格不一致：${sourceLabels.length} / 顶点 ${vertexCount} / 面 ${triangleCount}`,
  )
}

function refreshPointCloud() {
  if (!scene || !stlGeometry || !vertexLabels) return
  if (pointCloud) {
    scene.remove(pointCloud)
    pointCloud.geometry.dispose()
    ;(pointCloud.material as THREE.Material).dispose()
    pointCloud = null
  }
  pointCloud = buildPointCloud(stlGeometry, vertexLabels, meshScale, POINT_STRIDE)
  scene.add(pointCloud)
  syncVisibility()
}

function fitCameraFromBox(box: THREE.Box3, cam: THREE.PerspectiveCamera) {
  const center = new THREE.Vector3()
  const size = new THREE.Vector3()
  box.getCenter(center)
  box.getSize(size)
  const maxDim = Math.max(size.x, size.y, size.z) || 1
  const dist = maxDim / (2 * Math.tan((cam.fov * Math.PI) / 360))
  cam.position.copy(center.clone().add(new THREE.Vector3(dist * 1.2, -dist * 1.2, dist * 0.9)))
  cam.near = Math.max(maxDim / 100, 0.01)
  cam.far = maxDim * 100
  cam.updateProjectionMatrix()
  if (controls) {
    controls.target.copy(center)
    controls.update()
  }
}

function fitCameraToObject(obj: THREE.Object3D, cam: THREE.PerspectiveCamera) {
  fitCameraFromBox(new THREE.Box3().setFromObject(obj), cam)
}

function fitCameraToObjects(objects: THREE.Object3D[], cam: THREE.PerspectiveCamera) {
  const box = new THREE.Box3()
  for (const o of objects) box.expandByObject(o)
  fitCameraFromBox(box, cam)
}

function syncVisibility() {
  if (jawMesh) jawMesh.visible = showMesh.value
  if (pointCloud) pointCloud.visible = showPoints.value
}

function onResize() {
  if (!wrapRef.value || !renderer || !camera) return
  const w = wrapRef.value.clientWidth
  const h = wrapRef.value.clientHeight
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  renderer.setSize(w, h)
}

function loop() {
  raf = requestAnimationFrame(loop)
  controls?.update()
  if (renderer && scene && camera) renderer.render(scene, camera)
}

function exportLabels() {
  if (!vertexLabels) {
    hint.value = '无标签数据可导出'
    return
  }
  const payload = { version: 1, labels: vertexLabels }
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'labels-edited.json'
  a.click()
  URL.revokeObjectURL(url)
  hint.value = '已下载 labels-edited.json'
}

onMounted(() => {
  const el = wrapRef.value
  if (!el) return

  const w = el.clientWidth
  const h = el.clientHeight || 600

  scene = new THREE.Scene()
  scene.background = new THREE.Color(0xf5f7fa)

  camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 2000)
  camera.up.set(0, 0, 1)

  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(w, h)
  el.appendChild(renderer.domElement)

  scene.add(new THREE.AmbientLight(0xffffff, 0.55))
  const dir = new THREE.DirectionalLight(0xffffff, 0.85)
  dir.position.set(80, -60, 120)
  scene.add(dir)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true

  pointerHandler = (ev: PointerEvent) => {
    if (!expandEnabled.value || !ev.shiftKey || !jawMesh || !vertexLabels || !triAdj) return
    const fdi = Math.floor(Number(targetFdi.value))
    if (!fdi || fdi < 11) {
      hint.value = '请填写有效 FDI 牙位（如 16、21）'
      return
    }
    const rect = renderer!.domElement.getBoundingClientRect()
    const mx = ((ev.clientX - rect.left) / rect.width) * 2 - 1
    const my = -((ev.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(new THREE.Vector2(mx, my), camera!)
    const hits = raycaster.intersectObject(jawMesh, false)
    if (!hits.length) return
    const hit = hits[0]
    if (!hit) return
    const face = hit.face
    if (!face) return
    const clickTri = Math.floor(face.a / 3)
    const pt = hit.point.clone()

    if (clickMarker) {
      scene!.remove(clickMarker)
      ;(clickMarker.geometry as THREE.SphereGeometry).dispose()
      ;(clickMarker.material as THREE.MeshBasicMaterial).dispose()
      clickMarker = null
    }
    const mk = new THREE.Mesh(
      new THREE.SphereGeometry(0.8, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xff3366, depthTest: false }),
    )
    mk.position.copy(pt)
    mk.renderOrder = 10
    scene!.add(mk)
    clickMarker = mk

    const { changed, reached } = expandToothTowardClick(vertexLabels, triAdj, fdi, clickTri)
    paintMeshFromVertexLabels(jawMesh, vertexLabels)
    refreshPointCloud()

    hint.value = reached
      ? `已扩展牙位 ${fdi} 至点击附近，改写约 ${changed} 个三角面（红球为点击位置）`
      : `未能连通到该牙（或该牙无种子面）。已改 ${changed} 面。请换近处点击或检查 FDI。`
  }

  renderer.domElement.addEventListener('pointerdown', pointerHandler)

  const loader = new STLLoader()

  async function loadLabelsAndPointCloud(geometry: THREE.BufferGeometry) {
    hint.value = '标签下载/解析中（大文件可能卡顿数十秒）…'
    try {
      const res = await fetch(labelUrl)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as LabelPayload
      if (!json.labels?.length && json.faceLabels?.length) {
        json.labels = json.faceLabels
      }
      if (!json.labels?.length) throw new Error('JSON 无 labels')

      await new Promise<void>((r) => setTimeout(r, 0))

      const pos = geometry.attributes.position as THREE.BufferAttribute
      const resolved = resolveVertexLabels(geometry, json)
      vertexLabels = resolved.vertexLabels
      const vn = pos.count
      triCount = resolved.triangleCount
      json.labels = [...vertexLabels]

      if (json.labels.length === vn) {
        vertexLabels = json.labels.map((x) => Number(x))
      } else if (json.labels.length === triCount) {
        vertexLabels = new Array(vn)
        for (let t = 0; t < triCount; t++) {
          const v = Number(json.labels[t])
          const b = 3 * t
          vertexLabels[b] = v
          vertexLabels[b + 1] = v
          vertexLabels[b + 2] = v
        }
      } else {
        throw new Error(
          `labels 长度与网格不一致：${json.labels.length} / 顶点 ${vn} / 面 ${triCount}`,
        )
      }

      hint.value = '正在构建三角邻接（大模型需数十秒）…'
      await new Promise<void>((r) => setTimeout(r, 0))
      triAdj = buildTriangleAdjacency(pos, triCount)

      if (jawMesh) paintMeshFromVertexLabels(jawMesh, vertexLabels)

      pointCloud = buildPointCloud(geometry, vertexLabels, meshScale, POINT_STRIDE)
      scene!.add(pointCloud)

      if (jawMesh) fitCameraToObjects([jawMesh, pointCloud], camera!)
      syncVisibility()
      hint.value += ' | 勾选「启用」后 Shift+点击：沿牙龈扩展该牙至点击处'
    } catch (e) {
      hint.value = `仅显示网格（标签失败）：${e instanceof Error ? e.message : String(e)}`
      console.error(e)
    }
  }

  loader.load(
    stlUrl,
    (geometry) => {
      geometry.computeVertexNormals()
      stlGeometry = geometry
      const mat = new THREE.MeshPhongMaterial({
        color: 0xc97f88,
        specular: 0x444444,
        shininess: 60,
        side: THREE.DoubleSide,
      })
      jawMesh = new THREE.Mesh(geometry, mat)
      jawMesh.scale.set(meshScale, meshScale, meshScale)
      scene!.add(jawMesh)

      fitCameraToObject(jawMesh, camera!)
      hint.value = '模型已加载，标签加载中…'
      syncVisibility()

      void loadLabelsAndPointCloud(geometry)
    },
    undefined,
    (err) => {
      console.error('STL 加载失败', err)
      hint.value = 'STL 加载失败，见控制台'
    },
  )

  window.addEventListener('resize', onResize)
  loop()
})

onUnmounted(() => {
  if (renderer?.domElement && pointerHandler) {
    renderer.domElement.removeEventListener('pointerdown', pointerHandler)
  }
  pointerHandler = null

  window.removeEventListener('resize', onResize)
  cancelAnimationFrame(raf)
  controls?.dispose()

  jawMesh?.geometry.dispose()
  if (jawMesh?.material) {
    const m = jawMesh.material
    ;(Array.isArray(m) ? m : [m]).forEach((x) => x.dispose())
  }
  jawMesh = null

  pointCloud?.geometry.dispose()
  if (pointCloud?.material) {
    const m = pointCloud.material
    ;(Array.isArray(m) ? m : [m]).forEach((x) => x.dispose())
  }
  pointCloud = null

  clickMarker?.geometry.dispose()
  if (clickMarker?.material) {
    const m = clickMarker.material
    ;(Array.isArray(m) ? m : [m]).forEach((x) => x.dispose())
  }
  clickMarker = null

  renderer?.dispose()
  if (renderer?.domElement.parentElement) {
    renderer.domElement.parentElement.removeChild(renderer.domElement)
  }
  renderer = null
  scene = null
  camera = null
  controls = null
  vertexLabels = null
  triAdj = null
})
</script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  height: 90vh;
}
.bar {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  padding: 8px 12px;
  background: #fff;
  border-bottom: 1px solid #ebeef5;
  font-size: 14px;
}
.bar label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.bar .fdi input {
  width: 56px;
}
.bar button {
  padding: 4px 10px;
  cursor: pointer;
}
.hint {
  color: #606266;
  font-size: 12px;
  flex: 1;
  min-width: 200px;
}
.stl-wrap {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: #f5f7fa;
}
</style>
