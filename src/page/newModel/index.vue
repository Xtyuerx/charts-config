<template>
  <div>
    <ControlPanel @toggle="handleControlToggle" />

    <div class="content">
      <ViewSelector
        :view-labels="viewLabels"
        :selected-type="selectedViewType"
        @select="handleViewChange"
      />
      <!-- 添加 Bolton 宽度测量切换按钮 -->
      <div class="bolton-control">
        <el-button @click="toggleBoltonDisplay" type="primary">
          {{ showBolton ? '隐藏' : '显示' }} Bolton 宽度测量
        </el-button>
        <el-button @click="toggleOverbiteDisplay" type="success" style="margin-left: 10px">
          {{ showOverbite ? '隐藏' : '显示' }} 深覆合分析
        </el-button>
      </div>
      <div ref="containerRef" class="oral-3d"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import * as THREE from 'three'
import type { OrbitControls } from 'three-stdlib'
import { DragControls } from 'three-stdlib'
import ControlPanel from './components/ControlPanel.vue'
import ViewSelector from './components/ViewSelector.vue'
import { VIEW_LABELS } from './constants'
import { initScene, updateSceneView } from './utils/sceneUtils'
import {
  loadJsonPoints,
  loadTeethCenterPoints,
  loadDiagnosisData,
  extractBoltonData,
} from './utils/dataLoader'
import { loadAllModels } from './utils/stlLoader'
import { renderPointsFromJson } from './utils/pointCloudRenderer'
import { renderTeethCenterPoints } from './utils/labelUtils'
import { createMiddleArchCurve } from './utils/archWireUtils'
import { renderBoltonWidthMeasurementsFromSTL, toggleBoltonMeasurements } from './utils/boltonUtils'
import {
  renderOverbiteAnalysis,
  toggleOverbiteAnalysis,
  extractOverbiteData,
} from './utils/overbiteUtils'
import { useDragControls } from './hooks/useDragControls'
import { useLabels } from './hooks/useLabels'
import type { ViewLabel, STLModelsConfig, BoltonAnalysisData } from './types'

const containerRef = ref<HTMLDivElement | null>(null)
const viewLabels = ref(VIEW_LABELS)
const selectedViewType = ref(0)
const showBolton = ref(false)
const showOverbite = ref(false)

// Three.js 核心对象
let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let renderer: THREE.WebGLRenderer
let controls: OrbitControls
let dragControls: DragControls

// 模型对象
let upperMesh: THREE.Mesh | null = null
let lowerMesh: THREE.Mesh | null = null
let upperMeshLabel: THREE.Mesh | null = null
let lowerMeshLabel: THREE.Mesh | null = null

// Labels数据
let labelsUpper: number[] = []
let labelsLower: number[] = []

// Bolton 数据
let boltonGroup: THREE.Group | null = null

// Overbite 数据
let overbiteGroup: THREE.Group | null = null

// 使用组合函数
const { draggableObjects, setupDragControls, getControlPointsData } = useDragControls()
const { generateToothLabels, toggleToothNumbers, toggleWidthLabels } = useLabels()

onMounted(async () => {
  if (!containerRef.value) return

  // 初始化场景
  const sceneSetup = initScene(containerRef.value)
  scene = sceneSetup.scene
  camera = sceneSetup.camera
  renderer = sceneSetup.renderer
  controls = sceneSetup.controls

  // 加载数据
  const pointsData = await loadJsonPoints()
  labelsUpper = pointsData.labelsUpper
  labelsLower = pointsData.labelsLower

  // 加载模型
  await loadModels()

  // 加载 Bolton 数据并渲染
  await loadBoltonData()

  // 加载 Overbite 数据并渲染
  await loadOverbiteData()

  // 设置拖拽控制
  dragControls = setupDragControls(camera, renderer, controls, DragControls)

  // 开始动画循环
  animate()
})

onUnmounted(() => {
  renderer?.dispose()
  dragControls?.dispose()
})

/**
 * 加载所有STL模型
 */
async function loadModels() {
  // 配置STL模型URL - 实际使用时应该从props或配置文件获取
  const config: STLModelsConfig = {
    upper: '/models/upper.stl',
    upper_only_tooth: '/models/upper_only_tooth.stl',
    lower: '/models/lower.stl',
    lower_only_tooth: '/models/lower_only_tooth.stl',
  }

  const result = await loadAllModels(config, scene, renderPointsFromJson, labelsUpper, labelsLower)

  upperMesh = result.upperMesh
  lowerMesh = result.lowerMesh
  upperMeshLabel = result.upperMeshLabel
  lowerMeshLabel = result.lowerMeshLabel

  // 生成标签
  if (result.centersUpper && upperMeshLabel) {
    generateToothLabels(result.centersUpper, upperMeshLabel)
  }
  if (result.centersLower && lowerMeshLabel) {
    generateToothLabels(result.centersLower, lowerMeshLabel)
  }

  // 创建牙弓线
  if (result.centersUpper && result.centersLower) {
    createMiddleArchCurve(result.centersUpper, result.centersLower, scene, draggableObjects.value)
  }

  // 加载质心点
  const teethPoints = await loadTeethCenterPoints()
  if (teethPoints && teethPoints.length > 0) {
    const group = new THREE.Group()
    group.name = 'teeth_center_points_group'
    group.scale.set(1.5, 1.5, 1.5)
    scene.add(group)
    renderTeethCenterPoints(teethPoints, group)
  }
}

/**
 * 加载 Bolton 数据并渲染宽度测量线
 */
async function loadBoltonData() {
  try {
    // 加载完整诊断数据
    const diagnosisData = await loadDiagnosisData('/points/stl_all_demo.json')

    // 提取 Bolton 数据
    const boltonData = extractBoltonData(diagnosisData)

    if (boltonData && (upperMeshLabel || lowerMeshLabel)) {
      console.log('开始渲染 Bolton 测量线...')

      // 从模型加载结果中获取中心点
      const config: STLModelsConfig = {
        upper: '/models/upper.stl',
        upper_only_tooth: '/models/upper_only_tooth.stl',
        lower: '/models/lower.stl',
        lower_only_tooth: '/models/lower_only_tooth.stl',
      }
      const result = await loadAllModels(
        config,
        scene,
        renderPointsFromJson,
        labelsUpper,
        labelsLower,
      )

      // 为上颌渲染测量线
      if (upperMeshLabel && result.centersUpper && result.upperToothPointsData) {
        boltonGroup = renderBoltonWidthMeasurementsFromSTL(
          boltonData as unknown as BoltonAnalysisData,
          result.upperToothPointsData,
          result.centersUpper,
          scene,
          upperMeshLabel,
        )
      }

      // 为下颌渲染测量线
      if (lowerMeshLabel && result.centersLower && result.lowerToothPointsData) {
        const lowerBoltonGroup = renderBoltonWidthMeasurementsFromSTL(
          boltonData as unknown as BoltonAnalysisData,
          result.lowerToothPointsData,
          result.centersLower,
          scene,
          lowerMeshLabel,
        )

        // 合并上下颌测量线组
        if (boltonGroup && lowerBoltonGroup) {
          lowerBoltonGroup.children.forEach((child) => boltonGroup?.add(child))
        } else if (!boltonGroup) {
          boltonGroup = lowerBoltonGroup
        }
      }

      // 默认隐藏
      if (boltonGroup) {
        boltonGroup.visible = false
      }
    }
  } catch (error) {
    console.error('加载 Bolton 数据失败:', error)
  }
}

/**
 * 加载 Overbite 深覆合数据并渲染
 */
async function loadOverbiteData() {
  try {
    // 加载完整诊断数据
    const diagnosisData = await loadDiagnosisData('/points/stl_all_demo.json')

    // 提取 Overbite 数据
    const overbiteData = extractOverbiteData(diagnosisData)

    if (overbiteData) {
      console.log('开始渲染 Overbite 测量...')
      overbiteGroup = renderOverbiteAnalysis(overbiteData, scene)

      // 默认隐藏
      if (overbiteGroup) {
        overbiteGroup.visible = false
      }
    }
  } catch (error) {
    console.error('加载 Overbite 数据失败:', error)
  }
}

/**
 * 切换 Bolton 测量线显示
 */
function toggleBoltonDisplay() {
  showBolton.value = !showBolton.value
  toggleBoltonMeasurements(scene, showBolton.value)
}

/**
 * 切换 Overbite 测量显示
 */
function toggleOverbiteDisplay() {
  showOverbite.value = !showOverbite.value
  toggleOverbiteAnalysis(scene, showOverbite.value)
}

/**
 * 处理控制面板切换
 */
function handleControlToggle(type: 'number' | 'width') {
  if (type === 'number') {
    toggleToothNumbers()
  } else if (type === 'width') {
    toggleWidthLabels()
  }
}

/**
 * 处理视角切换
 */
function handleViewChange(view: ViewLabel) {
  selectedViewType.value = view.type
  updateSceneView(view.key, { upperMesh, lowerMesh, upperMeshLabel, lowerMeshLabel }, scene)
}

/**
 * 动画循环
 */
function animate() {
  requestAnimationFrame(animate)
  controls.update()
  renderer.render(scene, camera)
}

// 暴露方法供外部调用
defineExpose({
  getControlPointsData,
})
</script>

<style scoped lang="scss">
.content {
  position: relative;
  background-color: #f9f9f9;
}

.bolton-control {
  position: absolute;
  top: 80px;
  right: 20px;
  z-index: 100;
}

.oral-3d {
  width: 100%;
  height: 100vh;
  overflow: hidden;
}
</style>
