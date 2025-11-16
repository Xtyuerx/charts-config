<template>
  <div class="modelAnalysis">
    <div class="header">
      <div class="head_name">
        <div class="head_cont">
          <div class="head_item select_head">
            <el-icon><House /></el-icon>
            <span>返回</span>
          </div>
          <div class="head_item">
            <el-icon><FullScreen /></el-icon>
            <span>网格</span>
          </div>
          <div class="head_item">
            <el-icon><EditPen /></el-icon>
            <span>测量</span>
          </div>
        </div>
        <div class="head_cont">
          <div class="head_item select_head">
            <el-icon><House /></el-icon>
            <span>牙号</span>
          </div>
          <div class="head_item">
            <el-icon><FullScreen /></el-icon>
            <span>牙宽测量</span>
          </div>
          <div class="head_item">
            <el-icon><EditPen /></el-icon>
            <span>测量</span>
          </div>
          <div class="head_item">
            <el-icon><House /></el-icon>
            <span>返回</span>
          </div>
          <div class="head_item">
            <el-icon><FullScreen /></el-icon>
            <span>网格</span>
          </div>
          <div class="head_item">
            <el-icon><EditPen /></el-icon>
            <span>测量</span>
          </div>
          <div class="head_item">
            <el-icon><House /></el-icon>
            <span>返回</span>
          </div>
          <div class="head_item">
            <el-icon><FullScreen /></el-icon>
            <span>网格</span>
          </div>
          <div class="head_item">
            <el-icon><EditPen /></el-icon>
            <span>测量</span>
          </div>
        </div>
      </div>
      <el-button type="success">保存</el-button>
    </div>
    <div class="content">
      <div ref="container" class="oral-3d"></div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { House, FullScreen, EditPen } from '@element-plus/icons-vue'
import { ref, onMounted, onUnmounted } from 'vue'
import * as THREE from 'three'
import { OrbitControls, STLLoader } from 'three-stdlib'

const container = ref<HTMLDivElement | null>(null)

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
  loader.load('/models/UpperJaw.stl', (geometry) => {
    const material = new THREE.MeshPhongMaterial({
      color: 0xf8d7d7,
      specular: 0x555555,
      shininess: 30,
    })
    const upperMesh = new THREE.Mesh(geometry, material)
    upperMesh.scale.set(1, 1, 1) // 缩放比例按你的文件调整
    upperMesh.position.set(0, 0, 0) // 稍微上移一点x,y,z轴的坐标
    scene.add(upperMesh)
  })

  // 下颌
  loader.load('/models/LowerJaw.stl', (geometry) => {
    const material = new THREE.MeshPhongMaterial({
      color: 0xf8d7d7,
      specular: 0x555555,
      shininess: 30,
    })
    const lowerMesh = new THREE.Mesh(geometry, material)
    lowerMesh.scale.set(1, 1, 1)
    lowerMesh.position.set(0, 0, 0) // 稍微下移一点
    scene.add(lowerMesh)
  })
}

function animate() {
  requestAnimationFrame(animate)
  controls.update()
  renderer.render(scene, camera)
}
</script>

<style lang="scss" scoped>
.modelAnalysis {
  .header {
    width: 100%;
    height: 50px;
    padding: 0px 20px;
    box-sizing: border-box;
    display: flex;
    justify-content: space-between;
    align-items: center;
    .head_name {
      width: 55%;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .head_cont {
      display: flex;
      align-items: center;
      .head_item {
        width: 60px;
        display: flex;
        flex-direction: column;
        align-items: center;
        margin: 0 3px;
        .el-icon {
          font-size: 28px;
          color: green;
          margin-bottom: 5px;
        }
        span {
          font-size: 12px;
          color: #606266;
        }
      }
      .select_head {
        border-bottom: 5px solid green;
      }
    }
  }
  .content {
    .oral-3d {
      width: 100%;
      height: 100vh;
      background-color: #f9f9f9;
      overflow: hidden;
    }
  }
}
</style>
