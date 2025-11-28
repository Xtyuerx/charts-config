<template>
  <div ref="container" class="oral-3d"></div>
</template>

<script lang="ts" setup>
import { ref, onMounted, onUnmounted } from 'vue'
import * as THREE from 'three'
import { OrbitControls, STLLoader } from 'three-stdlib'

const container = ref<HTMLDivElement | null>(null)

let stlCenter = new THREE.Vector3()
let stlScale = 1
let pointsCloudUpper: THREE.Points | null = null
let pointsCloudLower: THREE.Points | null = null

let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let renderer: THREE.WebGLRenderer
let controls: OrbitControls

onMounted(() => {
  initScene()
  loadModels()
  animate()
})

onUnmounted(() => {
  renderer?.dispose()
})

function renderPointsFromJsonB(pointsArray: number[], color: number) {
  const geometry = new THREE.BufferGeometry()
  const transformed = new Float32Array(pointsArray.length)

  for (let i = 0; i < pointsArray.length; i += 3) {
    const x = pointsArray[i]
    const y = pointsArray[i + 1]
    const z = pointsArray[i + 2]

    // 坐标映射到 STL 的空间
    transformed[i] = (x - stlCenter.x) * stlScale
    transformed[i + 1] = (y - stlCenter.y) * stlScale
    transformed[i + 2] = (z - stlCenter.z) * stlScale
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(transformed, 3))

  const material = new THREE.PointsMaterial({
    color: 0xffb6c1,
    size: 0.8, // 🔹 点大小
    sizeAttenuation: true,
  })

  const points = new THREE.Points(geometry, material)
  scene.add(points)

  return points
}

function initScene() {
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0xf2f2f2)

  const width = container.value!.clientWidth
  const height = container.value!.clientHeight

  camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000)
  camera.position.set(0, 0, 150)

  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(width, height)
  container.value!.appendChild(renderer.domElement)

  // 灯光
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
  scene.add(ambientLight)
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8)
  dirLight.position.set(100, 100, 100)
  scene.add(dirLight)

  // 控制器
  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.05
  controls.minDistance = 30
  controls.maxDistance = 300

  // 可选：坐标轴辅助
  // const axesHelper = new THREE.AxesHelper(50)
  // scene.add(axesHelper)
}

function loadModels() {
  const loader = new STLLoader()

  // 上颌
  loader.load('/models/upper.stl', (geometry) => {
    const material = new THREE.MeshPhongMaterial({
      color: 0xffb6c1,
      opacity: 0.5,
      specular: 0x555555,
      shininess: 100,
      reflectivity: 0.5,
    })
    const upperMesh = new THREE.Mesh(geometry, material)
    upperMesh.scale.set(1, 1, 1) // 缩放比例按你的文件调整
    // upperMesh.position.set(0, 10, 0) // 稍微上移一点
    // 绕 Y 轴旋转 90°（相当于左右旋转）
    // scene.rotation.y = Math.PI

    // 向下仰俯 45°（绕 X 轴）
    scene.rotation.x = -Math.PI / 2
    scene.rotation.z = -Math.PI / 2
    scene.add(upperMesh)
  })

  // 下颌
  loader.load('/models/lower.stl', (geometry) => {
    const material = new THREE.MeshPhongMaterial({
      color: 0xffb6c1,
      emissive: 0x333333, // 自发光颜色
      emissiveIntensity: 0.3, // 自发光强度 (0-1)
      shininess: 100, // 光泽度
      // specular: 0xffffff, // 高光颜色
      specular: 0x555555,
      // shininess: 30,
    })
    const lowerMesh = new THREE.Mesh(geometry, material)
    lowerMesh.scale.set(1, 1, 1)
    // lowerMesh.position.set(0, -10, 0) // 稍微下移一点
    scene.rotation.x = -Math.PI / 2
    scene.rotation.z = -Math.PI / 2
    scene.add(lowerMesh)
  })
  setTimeout(() => {
    // 上颌
    loader.load('/models/upper_only_tooth.stl', (geometry) => {
      const material = new THREE.MeshPhongMaterial({
        color: 0xffffff,
        specular: 0x555555,
        shininess: 30,
        flatShading: false, // 关键：设置为false启用平滑着色
      })

      const upperMesh = new THREE.Mesh(geometry, material)
      upperMesh.scale.set(1, 1, 1) // 缩放比例按你的文件调整
      // upperMesh.position.set(0, 10, 0) // 稍微上移一点
      // 绕 Y 轴旋转 90°（相当于左右旋转）
      // scene.rotation.y = Math.PI

      // 向下仰俯 45°（绕 X 轴）
      scene.rotation.x = -Math.PI / 2
      scene.rotation.z = -Math.PI / 2
      scene.add(upperMesh)
      geometry.computeBoundingBox()
      const bbox = geometry.boundingBox!

      // 记录 STL 的中心点
      bbox.getCenter(stlCenter)

      // 平移模型到原点
      geometry.translate(-stlCenter.x, -stlCenter.y, -stlCenter.z)

      // 获取包围盒尺寸
      const size = new THREE.Vector3()
      bbox.getSize(size)
      const maxSide = Math.max(size.x, size.y, size.z)

      // 统一缩放到 100 范围
      stlScale = 100 / maxSide
      scene.scale.setScalar(stlScale)

      // ✅ STL 加载完后加载点位
      loadJsonPoints()
    })
    loader.load('/models/lower_only_tooth.stl', (geometry) => {
      const material = new THREE.MeshPhongMaterial({
        color: 0xffffff,
        specular: 0x555555,
        shininess: 100,
      })
      const upperMesh = new THREE.Mesh(geometry, material)
      upperMesh.scale.set(1, 1, 1) // 缩放比例按你的文件调整
      // upperMesh.position.set(0, 10, 0) // 稍微上移一点
      // 绕 Y 轴旋转 90°（相当于左右旋转）
      // scene.rotation.y = Math.PI

      // 向下仰俯 45°（绕 X 轴）
      scene.rotation.x = -Math.PI / 2
      scene.rotation.z = -Math.PI / 2
      scene.add(upperMesh)
    })
  }, 300)
  // 坐标轴辅助
  const axesHelper = new THREE.AxesHelper(100)
  scene.add(axesHelper)
}

async function loadJsonPoints() {
  const upperJson = await fetch('/points/upper.json').then((r) => r.json())
  const lowerJson = await fetch('/points/lower.json').then((r) => r.json())
  pointsCloudUpper = renderPointsFromJsonB(upperJson.labels, 0x00ff88)

  pointsCloudLower = renderPointsFromJsonB(lowerJson.labels, 0xff8800)
}

function animate() {
  requestAnimationFrame(animate)
  controls.update()
  renderer.render(scene, camera)
}
</script>

<style scoped>
.oral-3d {
  width: 100%;
  height: 100vh;
  background-color: #f9f9f9;
  overflow: hidden;
}
</style>
