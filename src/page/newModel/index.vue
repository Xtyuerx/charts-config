<template>
  <div>
    <div class="header" style="display: flex; justify-content: space-between; align-items: center">
      <div style="display: flex; align-items: center">
        <el-page-header @back="router.go(-1)" />
        <div class="topBtns">
          <el-radio-group v-model="topRadio" size="mini" @change="radioChange">
            <el-radio-button label="牙号" value="1" @click="handleControlToggle('isShowNumber')" />
            <el-radio-button
              label="Bolton比"
              value="2"
              @click="handleControlToggle('isShowBolton')"
            />
            <el-radio-button label="中线关系" value="3" />
            <el-radio-button label="尖牙关系" value="4" />
            <el-radio-button label="磨牙关系" value="5" />
            <el-radio-button label="牙弓对称性" value="6" />
            <el-radio-button label="拥挤度" value="7" />
            <el-radio-button label="牙弓宽度分析" value="8" />
            <el-radio-button label="锁𬌗与反𬌗分析" value="9" />
            <el-radio-button label="牙齿间隙分析" value="10" />
            <el-radio-button label="spee曲线" value="11" />
            <el-radio-button label="上颌补偿曲线" value="12" />
            <el-radio-button label="覆盖度分析" value="13" />
          </el-radio-group>
        </div>
      </div>
      <div style="display: flex">
        <el-button>AI重置</el-button>
        <el-button type="primary">保存</el-button>
      </div>
    </div>
    <div class="content">
      <!-- 3d模型展示icon -->
      <div class="content_name">
        <span
          :class="item.type == selectedViewType ? 'selcet_label' : ''"
          v-for="item in viewLabels"
          @click="handleViewChange(item)"
          >{{ item.label }}</span
        >
      </div>
      <!-- 3d模型 -->
      <div ref="container" class="container"></div>

      <!-- 右边结果栏 -->
      <!-- 收起后显示的浮动按钮 -->
      <div class="float-btn" v-if="!visible" @click="getClickText">
        <el-icon><ArrowLeftBold /></el-icon>
      </div>

      <!-- 固定在右侧的整个模块 -->
      <div class="right-wrapper" :class="{ hidden: !visible }">
        <!-- 收起小按钮（贴在面板左侧） -->
        <div class="collapse-btn" v-if="visible" @click="getClickText">
          <el-icon><ArrowRightBold /></el-icon>
        </div>

        <!-- 红框完整子组件 -->
        <MeasurementPanel :data="measureData" @rowClick="onRowClick" />
      </div>
      <div v-if="isShowItem" class="right_text">
        <div class="text_name">磨牙关系</div>
        <div class="text_content">
          <div class="content_item select_item"><span>左侧</span><span>远近</span></div>
          <div class="content_item"><span>右侧</span><span>远近</span></div>
        </div>
        <div class="refer_text">参考值</div>
      </div>
      <div></div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import MeasurementPanel from './components/measurementPanel.vue'
import { ref, onMounted, onUnmounted } from 'vue'
import * as THREE from 'three'
import { OrbitControls, STLLoader, DragControls } from 'three-stdlib'
// import ModelAnalysisController from '@/api/system/ModelAnalysisController';
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

const container = ref<HTMLDivElement | null>(null)

const router = useRouter()
const topRadio = ref()
// 是否展开
const visible = ref(false)
const isShowItem = ref(false)

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

const dataList = ref()

// 使用组合函数
const { draggableObjects, setupDragControls, getControlPointsData } = useDragControls()
const { generateToothLabels, toggleToothNumbers, toggleWidthLabels } = useLabels()

onMounted(async () => {
  if (!container.value) return

  // 初始化场景
  const sceneSetup = initScene(container.value)
  scene = sceneSetup.scene
  camera = sceneSetup.camera
  renderer = sceneSetup.renderer
  controls = sceneSetup.controls

  // 加载数据
  const pointsData = await loadJsonPoints()
  labelsUpper = pointsData.labelsUpper
  labelsLower = pointsData.labelsLower

  // 加载模型
  // await loadModels();

  // 加载 Bolton 数据并渲染
  // await loadBoltonData();

  // 加载 Overbite 数据并渲染
  // await loadOverbiteData();

  // 设置拖拽控制
  dragControls = setupDragControls(camera, renderer, controls, DragControls)
  getStlList()
  // 开始动画循环
  animate()
})

onUnmounted(() => {
  renderer?.dispose()
  dragControls?.dispose()
})

const getStlList = async () => {
  // let params = {
  //   businessId: '2512001230',
  //   analysisType: 2,
  //   caseCode: '1996390639587037184',
  //   upperStlUrl:
  //     'http://175.154.206.51:9000/ds-dev/attachment/2025/08/f7af906f9a3b4089a76c6e2d40333ad9.stl?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=minioadmin%2F20251202%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20251202T010859Z&X-Amz-Expires=604800&X-Amz-SignedHeaders=host&X-Amz-Signature=76b41cf1397fa4fa01b699270492d2f686505009dc4d7466347a175a0021b0a9',
  //   lowerStlUrl:
  //     'http://175.154.206.51:9000/ds-dev/attachment/2025/08/bd22978dc62e45e29ec6070563c5e375.stl?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=minioadmin%2F20251202%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20251202T010859Z&X-Amz-Expires=604800&X-Amz-SignedHeaders=host&X-Amz-Signature=97c05e1fd46ad7358a239d78dd3cf99542a4b32a11c78f0ce98edd69bd153d38',
  // };
  // ModelAnalysisController.getStlData(params).then(async res => {
  //   console.log(res, '123456');

  //   const data = JSON.parse(res.data?.modifyAnalysisData);
  //   dataList.value = data.pathology_results;
  //   console.log(data, 'data');
  //   const upper = data.basic_algorithm_info.upper_stl;
  //   const upper_only_tooth = data.basic_algorithm_info.upper_only_tooth_stl;
  //   const lower = data.basic_algorithm_info.lower_stl;
  //   const lower_only_tooth = data.basic_algorithm_info.lower_only_tooth_stl;
  //   loadModels(upper, upper_only_tooth, lower, lower_only_tooth);
  // });
  loadModels()
}

/**
 * 加载所有STL模型
 */
//upper, upper_only_tooth, lower, lower_only_tooth
async function loadModels() {
  // 配置STL模型URL - 实际使用时应该从props或配置文件获取
  // const config: STLModelsConfig = {
  //   upper: upper,
  //   upper_only_tooth: upper_only_tooth,
  //   lower: lower,
  //   lower_only_tooth: lower_only_tooth,
  // };
  const config: STLModelsConfig = {
    upper: '/models/upper.stl',
    upper_only_tooth: '/models/upper_only_tooth.stl',
    lower: '/models/lower.stl',
    lower_only_tooth: '/models/lower_only_tooth.stl',
  }

  const result = await loadAllModels(config, scene, renderPointsFromJson, labelsUpper, labelsLower)
  console.log(result, 'result')
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
  // await loadBoltonData(result);
  // 创建牙弓线
  // if (result.centersUpper && result.centersLower) {
  //   createMiddleArchCurve(result.centersUpper, result.centersLower, scene, draggableObjects.value);
  // }

  // 加载中线偏差
  const midlineData = extractBoltonData(dataList.value, 'midline-deviation')
  const teethPoints = midlineData.teeth_points

  renderToothPointsPipeline(teethPoints, {
    groupName: 'teeth_center_points_group',
    upperMesh,
    lowerMesh,
  })
  // if (teethPoints && teethPoints.length > 0) {
  //   const upLabel = [];
  //   const lowLabel = [];
  //   teethPoints.forEach(item => {
  //     if (isUpper(item.fdi)) {
  //       upLabel.push(item);
  //     }
  //     if (isLower(item.fdi)) {
  //       lowLabel.push(item);
  //     }
  //   });
  //   const group = new THREE.Group();
  //   group.name = 'teeth_center_points_group';
  //   group.scale.set(1.5, 1.5, 1.5);
  //   scene.add(group);
  //   renderTeethCenterPoints(upLabel, upperMeshLabel);
  //   renderTeethCenterPoints(lowLabel, lowerMeshLabel);
  // }
}
/*
判断是上颌还是下颌的FDI
上颌的点位就在加载上颌的时候去渲染，下颌的点位就在加载下颌的时候去渲染，好统一的去控制显示和隐藏
*/
function defaultIsUpper(toothNo) {
  return toothNo >= 11 && toothNo <= 28
}

function defaultIsLower(toothNo) {
  return toothNo >= 31 && toothNo <= 48
}
/**
 * 通用点位数据渲染管道
 * @param rawData 原始数据
 * @param options 配置：如何读取点号、如何判断上/下颌、Group 名称等
 */
function renderToothPointsPipeline(rawData, options) {
  const {
    getFdi = (item) => item.fdi, // 如何获取 FDI 或点号
    isUpper = defaultIsUpper, // 上颌判断规则
    isLower = defaultIsLower, // 下颌判断规则
    groupName = 'default_points_group',
    renderFn = renderTeethCenterPoints, // 最终渲染函数
    upperMesh,
    lowerMesh,
  } = options

  const upperList = []
  const lowerList = []

  rawData.forEach((item) => {
    const fdi = getFdi(item)
    if (isUpper(fdi)) upperList.push(item)
    if (isLower(fdi)) lowerList.push(item)
  })

  const group = new THREE.Group()
  group.name = groupName
  group.scale.set(1.5, 1.5, 1.5)
  scene.add(group)

  renderFn(upperList, upperMesh)
  renderFn(lowerList, lowerMesh)

  return group
}

/**
 * 加载 Bolton 数据并渲染宽度测量线
 */
async function loadBoltonData(data) {
  const result = data
  try {
    // 加载完整诊断数据

    // 提取 Bolton 数据
    const boltonData = extractBoltonData(dataList.value, 'bolton')
    console.log(boltonData, 'boltonData')
    if (boltonData && (upperMeshLabel || lowerMeshLabel)) {
      // 为上颌渲染测量线
      console.log(result, '111111为上颌渲染测量线111')
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
        // // 合并上下颌测量线组
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
function handleControlToggle(type: string) {
  if (type === 'isShowNumber') {
    toggleToothNumbers()
  } else if (type === 'isShowBolton') {
    toggleBoltonDisplay()
  }
}

/**
 * 处理视角切换
 */
function handleViewChange(view: ViewLabel) {
  selectedViewType.value = view.type
  updateSceneView(view.key, { upperMesh, lowerMesh, upperMeshLabel, lowerMeshLabel }, scene)
}

const onRowClick = (row: any) => {
  isShowItem.value = true
  visible.value = false
  // console.log('父组件接收到子组件点击', row);
}

const getClickText = () => {
  visible.value = !visible.value
  isShowItem.value = false
}

const radioChange = () => {}

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
  .content_name {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    padding: 15px;
    display: flex;
    justify-content: center;
    align-items: center;
    span {
      padding: 0 5px;
      width: 60px;
      height: 50px;
      text-align: center;
      line-height: 50px;
    }
    .selcet_label {
      background-color: #fff;
      text-align: center;
      line-height: 50px;
      color: #285e50;
    }
  }
  .icon_see {
    position: absolute;
    top: 300px;
    right: 415px;
    font-size: 28px;
    color: #285e50;
  }
  .right-wrapper {
    position: absolute;
    right: 0;
    top: 20px;
    width: 420px;
    height: calc(100vh - 220px);
    background: #fff;
    z-index: 999;
    transition: transform 0.3s ease;
    border-left: 1px solid #e5e5e5;
    // box-shadow: -4px 0 8px rgba(0, 0, 0, 0.05);
  }

  /* 收起后隐藏 */
  .right-wrapper.hidden {
    transform: translateX(100%);
  }

  /* 面板上的收起按钮 */
  .collapse-btn {
    position: absolute;
    left: -22px;
    top: 55%;
    transform: translateY(-50%);
    width: 22px;
    height: 80px;
    background: #285e50;
    color: white;
    border-radius: 6px 0 0 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* 收起后只剩一个贴边按钮 */
  .float-btn {
    position: fixed;
    right: 0;
    top: 55%;
    transform: translateY(-50%);
    width: 22px;
    height: 80px;
    background: #285e50;
    color: white;
    border-radius: 6px 0 0 6px;
    cursor: pointer;
    z-index: 999;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .all_right {
    width: 420px;
    position: absolute;
    top: 20px;
    right: 0px;
    // position: relative;

    .card-header {
      font-size: 18px;
      font-weight: 600;
    }
    .card_item {
      margin-bottom: 15px;
      .item_name {
        font-size: 16px;
        font-weight: 600;
      }
      .item_text {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 3px 0;
      }
    }
  }
  .right_text {
    background-color: #fff;
    width: 350px;
    // min-height: 400px;
    position: absolute;
    top: 20px;
    right: 0px;
    border-radius: 8px;
    .text_name {
      text-align: center;
      height: 50px;
      line-height: 50px;
      font-size: 14px;
      font-weight: 600;
    }
    .text_content {
      padding: 10px 20px;
      box-sizing: border-box;
      font-size: 14px;
      border-bottom: 1px solid #ddd;
      border-top: 1px solid #ddd;
      .content_item {
        height: 56px;
        line-height: 56px;
        display: flex;
        justify-content: space-around;
        align-items: center;
        text-align: center;
        border-radius: 5px;
        margin: 5px 0;
      }
      .select_item {
        border: 1px solid #285e50;
        color: #285e50;
      }
    }
    .refer_text {
      padding: 10px 20px;
      box-sizing: border-box;
      font-size: 14px;
    }
  }
}
.container {
  width: 100%;
  height: calc(100vh - 200px);
  background-color: #f9f9f9;
  overflow: hidden;
}
</style>
