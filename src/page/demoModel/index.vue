<template>
  <div ref="container" class="viewer">
    <!-- Three.js canvas 将被插入 container 中 -->
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer'
import { Line2 } from 'three/examples/jsm/lines/Line2'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry'

// container ref
const container = ref<HTMLDivElement | null>(null)

// ----- 手动写死的标签点（示例） -----
// 请用你自己的 STL 模型坐标替换这些 Vector3 值
const labelDefs: { position: THREE.Vector3; text: string }[] = [
  { position: new THREE.Vector3(12.3, 32, -5), text: '牙尖 A' },
  { position: new THREE.Vector3(30.2, 18, -5), text: '牙尖 B' },
  { position: new THREE.Vector3(-40.0, -2.0, -2.2), text: '缺损点 C' },
]

// three vars
let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let renderer: THREE.WebGLRenderer
let labelRenderer: CSS2DRenderer
let controls: OrbitControls
let modelMesh: THREE.Mesh | null = null
let animationId: number | null = null

const labelGroups: {
  group: THREE.Object3D
  sphere: THREE.Mesh
  line: THREE.Line
  cssObject: CSS2DObject
}[] = []

// ---------------- init ----------------
onMounted(() => {
  initThree()
  loadModelAndCreateLabels('/models/UpperJaw.stl') // <- 替换为你的 stl 路径
  window.addEventListener('resize', onWindowResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  if (animationId) cancelAnimationFrame(animationId)
  // dispose three resources (简单处理)
  renderer.dispose()
})
// ------------------- 生成避障路线 -------------------
function buildSafePath(
  A: THREE.Vector3,
  B: THREE.Vector3,
  mesh: THREE.Mesh,
  segments = 70, // 检测段数（越多越精细）
  lift = 0.8, // 每次避障抬高量（毫米级）
) {
  const raycaster = new THREE.Raycaster()
  const dir = new THREE.Vector3().subVectors(B, A)
  const step = dir.clone().divideScalar(segments)

  const points: THREE.Vector3[] = []

  for (let i = 0; i <= segments; i++) {
    const p = A.clone().add(step.clone().multiplyScalar(i))

    // 向模型发射一条射线（Z 方向，最稳定）
    raycaster.set(p.clone().add(new THREE.Vector3(0, 0, 3)), new THREE.Vector3(0, 0, -1))

    const hit = raycaster.intersectObject(mesh, true)[0]
    if (hit) {
      const normal = hit.face?.normal?.clone() || new THREE.Vector3(0, 1, 0)
      normal.transformDirection(mesh.matrixWorld)
      p.add(normal.multiplyScalar(lift))
    }

    points.push(p)
  }

  return points
}
// 绘制避障连线
function drawPath(points: THREE.Vector3[]) {
  const geometry = new LineGeometry()
  geometry.setPositions(points.flatMap((p) => [p.x, p.y, p.z]))

  const material = new LineMaterial({
    color: 0x00b6ff,
    linewidth: 2, // 必须用 Line2 才有效
    worldUnits: false,
  })

  const line = new Line2(geometry, material)
  line.computeLineDistances()

  return line
}
function addDistanceLabel(A: THREE.Vector3, B: THREE.Vector3) {
  const text = `${A.distanceTo(B).toFixed(2)} mm`
  const div = document.createElement('div')

  div.textContent = text
  div.style.padding = '4px 6px'
  div.style.borderRadius = '4px'
  div.style.background = 'rgba(0,0,0,0.6)'
  div.style.color = '#fff'
  div.style.fontSize = '12px'

  const label = new CSS2DObject(div)
  const mid = A.clone().add(B).multiplyScalar(0.5)
  label.position.copy(mid)

  return label
}
// ---------------- functions ----------------
function initThree() {
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0xf2f2f2)

  const rect = container.value!.getBoundingClientRect()
  camera = new THREE.PerspectiveCamera(45, rect.width / rect.height, 0.1, 5000)
  camera.position.set(120, 120, 150)

  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(rect.width, rect.height)
  renderer.shadowMap.enabled = false
  container.value!.appendChild(renderer.domElement)

  // CSS2DRenderer 用于 DOM 标签（总是在摄像机面向）
  labelRenderer = new CSS2DRenderer()
  labelRenderer.setSize(rect.width, rect.height)
  labelRenderer.domElement.style.position = 'absolute'
  labelRenderer.domElement.style.top = '0'
  labelRenderer.domElement.style.pointerEvents = 'none' // 标签不拦截鼠标
  container.value!.appendChild(labelRenderer.domElement)

  // 控制器
  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08

  // Lights
  const amb = new THREE.AmbientLight(0xffffff, 0.9)
  scene.add(amb)

  const dir = new THREE.DirectionalLight(0xffffff, 0.6)
  dir.position.set(50, 100, 80)
  scene.add(dir)

  animate()
}

function loadModelAndCreateLabels(stlUrl: string) {
  const loader = new STLLoader()
  loader.load(
    stlUrl,
    (geometry) => {
      // stl geometry -> mesh
      const material = new THREE.MeshStandardMaterial({
        color: 0xf8d7d7,
        specular: 0x555555,
        shininess: 30,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.castShadow = false
      mesh.receiveShadow = false

      // 常见的 STL 需要旋转调整 —— 这里把 X 旋转 -90° 以便与多数牙科模型对齐（若你的模型不需要可删）
      // mesh.rotation.y = -90
      // mesh.rotation.x = Math.PI
      // 计算中心并把模型放在原点
      geometry.computeBoundingBox()
      if (geometry.boundingBox) {
        const center = new THREE.Vector3()
        geometry.boundingBox.getCenter(center)
        mesh.geometry.translate(-center.x, -center.y, -center.z)
      }

      // 缩放使模型适配视图（可根据情况调整）
      // 这里按包围盒最大边长缩放到约 100 单位
      const bbox = new THREE.Box3().setFromObject(mesh)
      const size = new THREE.Vector3()
      bbox.getSize(size)
      const maxSide = Math.max(size.x, size.y, size.z)
      if (maxSide > 0) {
        const scale = 100 / maxSide
        mesh.scale.setScalar(scale)
      }

      scene.add(mesh)
      modelMesh = mesh

      // 创建标签点（在模型加载后）
      createLabelPoints()
      // ------------------- 连接 A → B，避障连线 -------------------
      const A = labelDefs[0].position.clone()
      const B = labelDefs[1].position.clone()

      // 生成避障路径
      const safePoints = buildSafePath(A, B, modelMesh)

      // 绘制路径
      const safeLine = drawPath(safePoints)
      scene.add(safeLine)

      // 添加距离标注
      const distLabel = addDistanceLabel(A, B)
      scene.add(distLabel)
    },
    (xhr) => {
      // 进度（可选）
      // console.log((xhr.loaded / xhr.total) * 100 + "% loaded");
    },
    (err) => {
      console.error('STL load error:', err)
    },
  )
}

// 创建 3D 小点 + 线 + DOM 标签（CSS2D）
function createLabelPoints() {
  if (!modelMesh) return

  // 清理已有
  labelGroups.forEach((lg) => {
    lg.group.remove(lg.sphere)
    lg.group.remove(lg.line)
    lg.group.remove(lg.cssObject)
    scene.remove(lg.group)
  })
  labelGroups.length = 0

  const sphereGeom = new THREE.SphereGeometry(1.6, 16, 12) // 小点半径（会受全局 scale 影响）
  const sphereMat = new THREE.MeshStandardMaterial({
    color: 0xff6655,
    metalness: 0.3,
    roughness: 0.5,
  })

  for (const def of labelDefs) {
    // 因为我们对模型做了 translate/scale，输入坐标应与模型原始坐标系一致。
    // 若你的坐标基于模型加载后的位置/缩放，需要做相同变换（见下）
    // 将用户给的坐标（假设是 STL 原始坐标）应用同样的缩放和平移：
    const worldPos = def.position.clone()

    // 如果你对模型应用了 translate(center), scale(s)
    // 需要把坐标移动到同一坐标系：先减去 center，再乘以 scale
    // 我在上面对 geometry.translate(-center) 做了处理，并对 mesh 做了 scale
    // 因此如果你的 labelDefs 是 model 原始坐标（跟 geometry 一致），需要同样转换：
    // -> apply translation: (pos - center) * scale
    // For simplicity: assume labelDefs are already in the same coordinates as final mesh.
    // If标签位置不对：把你的坐标按同样的 center/scale 处理（我在注释里写明如何处理）。

    // 创建一个 group 以便整体偏移 label（sphere + line + css）
    const group = new THREE.Object3D()
    group.position.copy(worldPos)

    // sphere
    const sphere = new THREE.Mesh(sphereGeom, sphereMat)
    sphere.castShadow = false
    sphere.receiveShadow = false
    sphere.position.set(0, 0, 0)
    group.add(sphere)

    // CSS2D label DOM
    const div = document.createElement('div')
    div.className = 'label-box'
    div.textContent = def.text
    // pointer events none so it doesn't block OrbitControls
    div.style.pointerEvents = 'auto' // 如果需要交互可改为 auto
    // label 可以自定义样式，下面 CSS 有样式示例
    const cssObj = new CSS2DObject(div)
    // 将 label 放置在点外侧（沿着从模型质心指向点的方向），使 label 不与模型表面重叠
    // compute an outward offset
    const bbox = new THREE.Box3().setFromObject(modelMesh!)
    const center = new THREE.Vector3()
    bbox.getCenter(center)
    // direction from model center to point
    const dir = new THREE.Vector3().subVectors(worldPos, center).normalize()
    const outwardOffset = dir.clone().multiplyScalar(12) // 偏移长度（可调）
    cssObj.position.copy(outwardOffset)
    group.add(cssObj)

    // line: from sphere (0,0,0) to cssObj.position
    const lineGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      cssObj.position.clone(),
    ])
    const lineMat = new THREE.LineBasicMaterial({ color: 0x333333 })
    const line = new THREE.Line(lineGeom, lineMat)
    group.add(line)

    // 把 group 添加到场景（坐标系与 mesh 一致）
    scene.add(group)

    // store
    labelGroups.push({ group, sphere, line, cssObject: cssObj })
  }
}

// 当窗口大小改变
function onWindowResize() {
  if (!container.value) return
  const width = container.value.clientWidth
  const height = container.value.clientHeight

  camera.aspect = width / height
  camera.updateProjectionMatrix()

  renderer.setSize(width, height)
  labelRenderer.setSize(width, height)
}

// animate loop
function animate() {
  animationId = requestAnimationFrame(animate)

  // 可选：小点做微小动画吸引注意（例如呼吸效果）
  labelGroups.forEach((lg, idx) => {
    const t = performance.now() / 1000 + idx
    const s = 1 + Math.sin(t * 2) * 0.03
    lg.sphere.scale.setScalar(s)
    // 同步 line 的端点（cssObject 位置可能会随 label offset 改变）
    const p0 = new THREE.Vector3(0, 0, 0)
    const p1 = lg.cssObject.position.clone()
    const pts = new Float32Array([p0.x, p0.y, p0.z, p1.x, p1.y, p1.z])
    ;(lg.line.geometry as THREE.BufferGeometry).setAttribute(
      'position',
      new THREE.BufferAttribute(pts, 3),
    )
    ;(lg.line.geometry as THREE.BufferGeometry).computeBoundingSphere()
    ;(lg.line.geometry as THREE.BufferGeometry).attributes.position.needsUpdate = true
  })

  controls.update()

  renderer.render(scene, camera)
  labelRenderer.render(scene, camera)
}
</script>

<style scoped>
.viewer {
  width: 100%;
  height: 100vh;
  position: relative;
  overflow: hidden;
}

/* CSS for labels rendered by CSS2DRenderer */
.label-box {
  display: inline-block;
  padding: 6px 10px;
  background: rgba(20, 20, 20, 0.8);
  color: #fff;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1;
  transform: translate(-50%, -50%);
  white-space: nowrap;
  pointer-events: auto; /* 如果你想让标签能被点击或 hover，保留 auto */
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
  user-select: none;
}

/* 小屏时缩小文本 */
@media (max-width: 600px) {
  .label-box {
    padding: 4px 8px;
    font-size: 11px;
  }
}
</style>
