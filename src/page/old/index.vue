<template>
  <div>
    <el-button type="primary" :icon="Edit" @click="getChange('isShowNumber')">牙号</el-button>
    <el-button type="primary" :icon="Edit" @click="getChange('isShowWidths')"
      >牙弓宽度分析</el-button
    >
  </div>
  <div class="content">
    <!-- 3d模型展示icon -->
    <div class="content_name">
      <span
        :class="item.type == selectLabel ? 'selcet_label' : ''"
        v-for="item in labelList"
        @click="getChangeLabel(item)"
        >{{ item.label }}</span
      >
    </div>
    <div ref="container" class="oral-3d"></div>
  </div>
</template>

<script lang="ts" setup>
import { Delete, Edit, Search, Share, Upload } from '@element-plus/icons-vue'
import { ref, onMounted, onUnmounted } from 'vue'
import * as THREE from 'three'
import { OrbitControls, STLLoader, DragControls, TrackballControls } from 'three-stdlib'

const container = ref<HTMLDivElement | null>(null)

// 展示label
const labelList = ref([
  { label: '前双颌', isShow: false, type: 0, key: 'full' },
  { label: '前上颌', isShow: false, type: 1, key: 'upper' },
  { label: '前下颌', isShow: false, type: 2, key: 'lower' },
  { label: '上颌', isShow: false, type: 3, key: 'upper_angle' },
  { label: '下颌', isShow: false, type: 4, key: 'lower_angle' },
  { label: '左双颌', isShow: false, type: 5, key: 'left' },
  { label: '右双颌', isShow: false, type: 6, key: 'right' },
])

const selectLabel = ref(0)

// 存储上下颌的labels数组
let labelsUpper: number[] = []
let labelsLower: number[] = []

let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let renderer: THREE.WebGLRenderer
let controls: TrackballControls
// 存储所有可拖拽的控制点
const draggableObjects: THREE.Object3D[] = []
let dragControls: DragControls

// 存储上下颌的中心点数据，用于生成中间牙弓线
let upperCentersData: Record<number, THREE.Vector3> | null = null
let lowerCentersData: Record<number, THREE.Vector3> | null = null

let upperMesh: THREE.Mesh | null = null // 上颌
let lowerMesh: THREE.Mesh | null = null // 下颌
let upperMeshLabel: THREE.Mesh | null = null // 上颌牙齿
let lowerMeshLabel: THREE.Mesh | null = null // 下颌牙齿

// 存所有牙齿编号的 Sprite
const allToothLabels = ref<THREE.Sprite[]>([])

// 是否显示所有标签
const showAllLabels = ref(false)

//是否显示测量宽度
const showWidths = ref(false)
// 定义牙齿质心点的数据类型
interface ToothCenterPoint {
  fdi: number
  type: string
  type_cn: string
  point: [number, number, number]
}
const tabData = ref({})
interface TeethPointsData {
  teeth_points: ToothCenterPoint[]
}

let renderMissions: (() => void)[] = []

// 为不同牙齿编号定义颜色映射
const toothColorMap: Record<number, number> = {
  11: 0xff0000, // 红色
  12: 0xff4500, // 橙红色
  13: 0xff8c00, // 深橙色
  14: 0xffa500, // 橙色
  15: 0xffff00, // 黄色
  16: 0x9acd32, // 黄绿色
  17: 0x00ff00, // 绿色
  18: 0x00ced1, // 深青色
  31: 0xdc143c, // 深红色
  32: 0xb22222, // 火砖色
  33: 0x8b0000, // 深红色
  34: 0xcd5c5c, // 印度红
  35: 0xf08080, // 浅珊瑚色
  36: 0xfa8072, // 鲑鱼色
  37: 0xe9967a, // 深鲑鱼色
  38: 0xffa07a, // 浅鲑鱼色
  41: 0x20b2aa, // 浅海洋绿
  42: 0x48d1cc, // 中绿宝石
  43: 0x40e0d0, // 绿松石
  44: 0x00ffff, // 青色
  45: 0x00bfff, // 深天蓝
  46: 0x87ceeb, // 天蓝色
  47: 0x87cefa, // 浅天蓝色
  48: 0xb0c4de, // 浅钢蓝色
  21: 0x1e90ff, // 道奇蓝
  22: 0x0000ff, // 蓝色
  23: 0x8a2be2, // 蓝紫色
  24: 0x9370db, // 中紫色
  25: 0xba55d3, // 中兰花紫
  26: 0xff00ff, // 品红色
  27: 0xff1493, // 深粉红
  28: 0xc71585, // 中紫红色
}

onMounted(async () => {
  initScene()
  await loadJsonPointsItem()
  await loadJsonPoints()
  await loadTeethCenterPoints() // 加载牙齿质心点数据

  // loadModels()

  animate()
})

onUnmounted(() => {
  renderer?.dispose()
  if (dragControls) {
    dragControls.dispose()
  }
})

/**
 * 所有分类的json
 */
async function loadJsonPointsItem() {
  const allResponse = await fetch('/points/stl_all_demo.json')
  const allStl = await allResponse.json()
  const upper =
    'http://192.168.100.123:9000/cy-stl/3D/20250807105033261/1994249841554755584/stl/20251114_0004_upper.stl?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=minioadmin%2F20251203%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20251203T083510Z&X-Amz-Expires=604800&X-Amz-SignedHeaders=host&X-Amz-Signature=370f04ad97b7f0c8af15c9dbe3ab4ed0d21bcbaff7ac445c3f2aca0c324091a2'
  const upper_only_tooth =
    'http://192.168.100.123:9000/cy-stl/3D/20250807105033261/1994249841554755584/stl/20251114_0004_upper_only_tooth.stl?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=minioadmin%2F20251203%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20251203T083510Z&X-Amz-Expires=604800&X-Amz-SignedHeaders=host&X-Amz-Signature=06af9801b23c915dcac13c3856485867a84e4eb676c2801e24e12d5786a02f1e'
  const lower =
    'http://192.168.100.123:9000/cy-stl/3D/20250807105033261/1994249841554755584/stl/20251114_0004_lower.stl?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=minioadmin%2F20251203%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20251203T083510Z&X-Amz-Expires=604800&X-Amz-SignedHeaders=host&X-Amz-Signature=02bd9bc6acf2269fb2a990736cd14ff0c9d5497e393a319c15b12b3338a4900b'
  const lower_only_tooth =
    'http://192.168.100.123:9000/cy-stl/3D/20250807105033261/1994249841554755584/stl/20251114_0004_lower_only_tooth.stl?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=minioadmin%2F20251203%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20251203T083510Z&X-Amz-Expires=604800&X-Amz-SignedHeaders=host&X-Amz-Signature=4c82ce72ec87c653cba13b62135079e6d3f62c7045298d4e91536b5dc332bc59'
  loadModels(upper, upper_only_tooth, lower, lower_only_tooth)
  tabData.value = formatPathologyResults(allStl.pathology_results)
  console.log(tabData, 'tabData')

  // 等待场景初始化后再渲染点
  // 由于这个函数在 initScene 之后调用，所以可以直接渲染
  // 但为了确保模型加载完成，我们将渲染逻辑放到 loadModels 中
  // 这里只是存储数据
}
/*
判断是上颌还是下颌的FDI
上颌的点位就在加载上颌的时候去渲染，下颌的点位就在加载下颌的时候去渲染，好统一的去控制显示和隐藏
*/
function isUpper(toothNo) {
  return toothNo >= 11 && toothNo <= 28
}

function isLower(toothNo) {
  return toothNo >= 31 && toothNo <= 48
}
function getOverbite() {
  const upOverbite = []
  const lowOverbite = []
  tabData.value.overbite.teeth_points.forEach((item) => {
    if (isUpper(item.fdi)) {
      upOverbite.push(item)
    }
    if (isLower(item.fdi)) {
      lowOverbite.push(item)
    }
  })
  const obj = {
    upOverbite,
    lowOverbite,
  }
  return obj
}
function formatPathologyResults(list: any) {
  const keyMap = {
    overbite: 'overbite',
    'midline-deviation': 'midlineDeviation',
    'occlusal-relationship': 'occlusalRelationship',
    crossbite: 'crossbite',
    bolton: 'bolton',
    'arch-symmetry': 'archSymmetry',
    'tooth-crowding-degree': 'tooth-crowding-degree',
    'tooth-gap': 'tooth-gap',
    'upper-curve': 'upper-curve',
    'lower-curve': 'lower-curve',
    overjet: 'overjet',
    'arch-width': 'arch-width',
  }

  const result = {}

  list.forEach((item) => {
    const key = keyMap[item.task_name]
    if (key) {
      result[key] = item.diagnosis_result
    }
  })
  return result
}
/**
 * 根据labels数组渲染点云到STL模型上
 * @param geometry STL模型的几何体
 * @param labelsArray labels数组，长度与STL顶点数一致
 * @param parentMesh 父网格对象
 */
function renderPointsFromJson(
  geometry: THREE.BufferGeometry,
  labelsArray: number[],
  parentMesh: THREE.Mesh,
) {
  // 获取STL几何体的顶点位置数组
  console.log(labelsArray, 'labelsArray')
  const positions = geometry.getAttribute('position')

  if (!positions) {
    console.error('几何体没有position属性')
    return
  }

  const vertexCount = positions.count

  // 验证labels数组长度是否与顶点数匹配
  if (labelsArray.length !== vertexCount) {
    console.warn(`Labels数组长度(${labelsArray.length})与STL顶点数(${vertexCount})不匹配`)
  }

  // 按牙齿编号分组顶点
  const groupedByTooth: Record<number, Float32Array> = {}
  const pointsPerTooth: Record<number, number> = {}
  // 记录每颗牙齿的中心点坐标（用于放置文字标签）
  const toothCenters: Record<number, THREE.Vector3> = {}

  // 先统计每个牙齿编号的点数
  for (let i = 0; i < Math.min(vertexCount, labelsArray.length); i++) {
    const toothLabel = labelsArray[i]
    if (toothLabel === undefined) continue

    if (!pointsPerTooth[toothLabel]) {
      pointsPerTooth[toothLabel] = 0
      toothCenters[toothLabel] = new THREE.Vector3(0, 0, 0)
    }
    pointsPerTooth[toothLabel]++
  }

  // 为每个牙齿编号分配数组getNumberList(upperMeshLabel)
  Object.keys(pointsPerTooth).forEach((label) => {
    const labelNum = Number(label)
    const count = pointsPerTooth[labelNum]
    if (count !== undefined) {
      groupedByTooth[labelNum] = new Float32Array(count * 3)
      getToothWidthAndCenter(groupedByTooth[labelNum])
    }
  })
  console.log(groupedByTooth, 'groupedByTooth')

  // 临时索引记录器，用于填充分组数组
  const tempIndices: Record<number, number> = {}
  Object.keys(pointsPerTooth).forEach((label) => {
    tempIndices[Number(label)] = 0
  })
  // 将顶点坐标按牙齿编号分组，同时计算中心点
  for (let i = 0; i < Math.min(vertexCount, labelsArray.length); i++) {
    const toothLabel = labelsArray[i]
    if (toothLabel === undefined) continue

    const x = positions.getX(i)
    const y = positions.getY(i)
    const z = positions.getZ(i)

    const idx = tempIndices[toothLabel]
    if (idx === undefined) continue

    const group = groupedByTooth[toothLabel]
    if (!group) continue

    group[idx] = x
    group[idx + 1] = y
    group[idx + 2] = z

    // 累加坐标用于计算中心点
    const center = toothCenters[toothLabel]
    if (center) {
      center.x += x
      center.y += y
      center.z += z
    }

    const newIdx = tempIndices[toothLabel]
    if (newIdx !== undefined) {
      tempIndices[toothLabel] = newIdx + 3
    }
  }
  // 计算每颗牙齿的平均中心点
  Object.keys(toothCenters).forEach((label) => {
    const toothLabel = Number(label)
    const center = toothCenters[toothLabel]
    const count = pointsPerTooth[toothLabel]
    if (center && count) {
      center.x /= count
      center.y /= count
      center.z /= count
    }
  })

  // 为每个牙齿编号创建独立的点云对象和文字标签
  Object.keys(groupedByTooth).forEach((label) => {
    const toothLabel = Number(label)
    const positionsArray = groupedByTooth[toothLabel]

    if (!positionsArray) return

    // 创建几何体并设置顶点位置
    const pointGeometry = new THREE.BufferGeometry()
    pointGeometry.setAttribute('position', new THREE.BufferAttribute(positionsArray, 3))

    // // 获取该牙齿编号对应的颜色，如果没有则使用随机颜色
    // const color = toothColorMap[toothLabel] || Math.random() * 0xffffff

    // // 创建点材质
    // const pointMaterial = new THREE.PointsMaterial({
    //   color: color,
    //   size: 0.15, // 点的大小
    //   sizeAttenuation: true,
    //   depthTest: false, // 确保点云始终可见
    //   depthWrite: false,
    //   // transparent: true,
    //   opacity: 0.8,
    // })

    // // 创建点云对象
    // const points = new THREE.Points(pointGeometry, pointMaterial)
    // points.name = `tooth_${toothLabel}` // 设置名称便于后续识别和控制

    // // 将点云添加到父网格对象中
    // parentMesh.add(points)

    // 创建文字标签显示牙齿编号
    // const center = toothCenters[toothLabel]
    // if (center) {
    //   // console.log(toothLabel, center, 'toothLabel, center')
    //   createToothLabel(toothLabel, center, parentMesh)
    // }
  })

  // console.log(`已渲染 ${Object.keys(groupedByTooth).length} 个牙齿的点云`)

  return toothCenters
}
function getLabelNumber(centers: any, parentMesh: THREE.Mesh) {
  Object.keys(centers).forEach((label) => {
    const toothLabel = Number(label)
    const center = centers[toothLabel]
    if (center) {
      const label = createToothLabel(toothLabel)
      label?.position.copy(center)
      if (!label) return
      label.visible = false
      parentMesh.add(label)
      allToothLabels.value.push(label)
    }
  })
}

/**
 * 创建牙齿编号文字标签
 * @param toothLabel 牙齿编号
 * @param position 标签位置（牙齿中心点）
 * @param parentMesh 父网格对象
 * position: THREE.Vector3, parentMesh: THREE.Mesh
 */
function createToothLabel(toothLabel: number) {
  // 创建canvas来绘制文字
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return

  // 设置canvas大小
  canvas.width = 256
  canvas.height = 256

  // 设置文字样式 - 背景透明或半透明
  // context.fillStyle = 'rgba(255, 255, 255, 0.8)' // 半透明白色背景
  // context.fillRect(0, 0, canvas.width, canvas.height)

  context.font = ' 120px Arial'
  context.fillStyle = '#000000'
  context.textAlign = 'center'
  context.textBaseline = 'middle'

  // 绘制牙齿编号
  context.fillText(toothLabel.toString(), canvas.width / 2, canvas.height / 2)

  // 创建纹理
  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true

  // 创建sprite材质
  const spriteMaterial = new THREE.SpriteMaterial({
    map: texture,
    // transparent: true,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: true, // 启用尺寸衰减，让标签大小随距离变化
  })

  // 创建sprite对象
  const sprite = new THREE.Sprite(spriteMaterial)
  // sprite.position.copy(position)
  // 调整标签大小，使其相对于牙齿模型合适
  // 由于模型scale为1.5，标签大小需要相应调整
  sprite.scale.set(2, 2, 1) // 根据实际效果调整这个值
  sprite.name = `label_${toothLabel}`

  // 将标签添加到父网格对象中
  // parentMesh.add(sprite)
  return sprite
}

/*
    创建切片
*/

function createSlicePlane(point: THREE.Vector3, normal: THREE.Vector3) {
  // 1. 创建平面几何
  const planeGeometry = new THREE.PlaneGeometry(50, 50) // 切片大小可调整

  // 2. 材质
  const planeMaterial = new THREE.MeshBasicMaterial({
    color: 0xffff00,
    side: THREE.DoubleSide,
    opacity: 0.5,
    transparent: true,
  })

  const plane = new THREE.Mesh(planeGeometry, planeMaterial)

  // 3. 将平面 Z 轴方向对齐到目标法线方向
  const quat = new THREE.Quaternion()
  quat.setFromUnitVectors(
    new THREE.Vector3(0, 0, 1), // 平面默认朝向
    normal.clone().normalize(), // 模型表面法线
  )
  plane.quaternion.copy(quat)

  // 4. 设置平面位置（模型上的点）
  plane.position.copy(point)

  scene.add(plane)
  return plane
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
  controls = new TrackballControls(camera, renderer.domElement)
  controls.rotateSpeed = 3.0
  controls.zoomSpeed = 1.2
  controls.panSpeed = 0.8

  // 初始化拖拽控制器
  dragControls = new DragControls(draggableObjects, camera, renderer.domElement)
  dragControls.addEventListener('dragstart', function (event: { object: THREE.Object3D }) {
    controls.enabled = false
    if (event.object.userData.isControlPoint) {
      // 可能需要高亮或其他反馈
    }
  })
  dragControls.addEventListener('dragend', function () {
    controls.enabled = true
  })
  dragControls.addEventListener('drag', function (event: { object: THREE.Object3D }) {
    if (event.object.userData.isControlPoint) {
      const point = event.object
      const curve = point.userData.curve
      if (curve) {
        // 简单的约束：找到曲线上最近的点
        // 注意：这里需要将世界坐标转换为曲线所在的局部坐标（如果曲线跟随Mesh移动）
        // 简化处理：假设曲线和点都在同一个坐标系下

        // 更精确的方法是投影，这里简单演示用参数t寻找最近点比较耗时，
        // 实际应用可能需要更高效的投影算法或者仅仅限制在切线方向移动

        const pos = point.position.clone()
        // 将位置投影到曲线上
        // 获取曲线上的最近点（近似）
        const t = getClosestPointTOnCurve(pos, curve)
        const newPos = curve.getPointAt(t)
        point.position.copy(newPos)

        // 更新显示的坐标值或其他
        console.log('Point T:', t, 'Position:', newPos)
      }
    }
  })
}

// 辅助函数：寻找曲线上离目标点最近的 t 值 (0-1)
function getClosestPointTOnCurve(
  point: THREE.Vector3,
  curve: THREE.Curve<THREE.Vector3>,
  divisions = 100,
): number {
  let bestT = 0
  let minDistanceSq = Infinity

  for (let i = 0; i <= divisions; i++) {
    const t = i / divisions
    const pt = curve.getPointAt(t)
    const distSq = point.distanceToSquared(pt)
    if (distSq < minDistanceSq) {
      minDistanceSq = distSq
      bestT = t
    }
  }
  // 可以进一步通过二分查找或梯度下降优化 bestT
  return bestT
}
function loadSTL(url: string) {
  return new Promise((resolve, reject) => {
    const loader = new STLLoader()
    loader.load(url, resolve, undefined, reject)
  })
}

async function loadModels(
  upper: string,
  upper_only_tooth: string,
  lower: string,
  lower_only_tooth: string,
) {
  // ---------------------------
  // 1. 并行加载 2 个整体 STL
  // ---------------------------
  const [upperGeo, lowerGeo] = await Promise.all([loadSTL(upper), loadSTL(lower)])

  // 渲染上颌整体
  const upperMaterial = new THREE.MeshPhongMaterial({
    color: 0xffb6c1,
    opacity: 0.5,
    specular: 0x555555,
    shininess: 100,
    reflectivity: 0.5,
    side: THREE.DoubleSide,
  })
  upperMesh = new THREE.Mesh(upperGeo, upperMaterial)
  upperMesh.scale.set(1.5, 1.5, 1.5)
  scene.rotation.x = -Math.PI / 2
  scene.rotation.z = -Math.PI / 2
  scene.add(upperMesh)

  // 渲染下颌整体
  const lowerMaterial = new THREE.MeshPhongMaterial({
    color: 0xffb6c1,
    emissive: 0x333333,
    emissiveIntensity: 0.3,
    shininess: 100,
    specular: 0x555555,
    side: THREE.DoubleSide,
  })
  lowerMesh = new THREE.Mesh(lowerGeo, lowerMaterial)
  lowerMesh.scale.set(1.5, 1.5, 1.5)
  scene.add(lowerMesh)

  // ---------------------------
  // 2. 并行加载 2 个牙齿 STL
  // ---------------------------
  const [upperToothGeo, lowerToothGeo] = await Promise.all([
    loadSTL(upper_only_tooth),
    loadSTL(lower_only_tooth),
  ])

  // 渲染上颌牙齿
  const upperToothMat = new THREE.MeshPhongMaterial({
    color: 0xffffff,
    specular: 0x555555,
    shininess: 30,
    flatShading: false,
    side: THREE.DoubleSide,
  })
  upperMeshLabel = new THREE.Mesh(upperToothGeo, upperToothMat)
  upperMeshLabel.scale.set(1.5, 1.5, 1.5)
  scene.add(upperMeshLabel)

  const centersUpper = renderPointsFromJson(upperToothGeo, labelsUpper, upperMeshLabel)
  if (centersUpper) getLabelNumber(centersUpper, upperMeshLabel)
  const overbiteLabel = getOverbite()
  if (overbiteLabel.upOverbite) {
    renderTeethCenterPoints(overbiteLabel.upOverbite, upperMeshLabel)
  }
  console.log(overbiteLabel, 'overbiteLabel')

  // 渲染下颌牙齿
  const lowerToothMat = new THREE.MeshPhongMaterial({
    color: 0xffffff,
    specular: 0x555555,
    shininess: 30,
    flatShading: false,
    side: THREE.DoubleSide,
  })
  lowerMeshLabel = new THREE.Mesh(lowerToothGeo, lowerToothMat)
  lowerMeshLabel.scale.set(1.5, 1.5, 1.5)
  scene.add(lowerMeshLabel)

  const centersLower = renderPointsFromJson(lowerToothGeo, labelsLower, lowerMeshLabel)
  if (centersLower) getLabelNumber(centersLower, lowerMeshLabel)
  if (overbiteLabel.lowOverbite) {
    renderTeethCenterPoints(overbiteLabel.lowOverbite, lowerMeshLabel)
  }

  // ---------------------------
  // 3. 四个 STL 都加载完后，再加载质心点
  // ---------------------------
  // const teethPoints = await loadTeethCenterPoints()
  // if (teethPoints && teethPoints.length > 0) {
  //   const group = new THREE.Group()
  //   group.name = 'teeth_center_points_group'
  //   group.scale.set(1.5, 1.5, 1.5)
  //   scene.add(group)

  //   renderTeethCenterPoints(teethPoints, group)
  // }
  // 坐标轴辅助
  const axesHelper = new THREE.AxesHelper(100)
  scene.add(axesHelper)

  // 标签
  addAxisLabels(scene)
  // 刻度
  addAxisTicks(scene, 50, 5)
}
function getLabelList() {}

/**
 * 尝试创建中间牙弓线（当上下颌数据都准备好时）
 */
function tryCreateMiddleArchCurve() {
  if (!upperCentersData || !lowerCentersData) return

  // 定义配对的牙齿编号顺序 (从右到左)
  // 右上-右下, ..., 左上-左下
  const pairs = [
    [18, 48],
    [17, 47],
    [16, 46],
    [15, 45],
    [14, 44],
    [13, 43],
    [12, 42],
    [11, 41],
    [21, 31],
    [22, 32],
    [23, 33],
    [24, 34],
    [25, 35],
    [26, 36],
    [27, 37],
    [28, 38],
  ]

  const points: THREE.Vector3[] = []

  pairs.forEach(([upperCode, lowerCode]) => {
    // 确保编号存在
    if (upperCode === undefined || lowerCode === undefined) return

    // @ts-expect-error - 编号经过验证后不会为undefined
    const pUpper = upperCentersData[upperCode]
    // @ts-expect-error - 编号经过验证后不会为undefined
    const pLower = lowerCentersData[lowerCode]

    if (pUpper && pLower) {
      // 如果上下都有，取中点
      const mid = new THREE.Vector3().addVectors(pUpper, pLower).multiplyScalar(0.5)
      points.push(mid)
    } else if (pUpper) {
      // 只有上牙，直接取上牙点（或者可以考虑忽略以保证平滑）
      // points.push(pUpper.clone())
    } else if (pLower) {
      // 只有下牙
      // points.push(pLower.clone())
    }
  })

  if (points.length < 2) return

  // 创建曲线
  const curve = new THREE.CatmullRomCurve3(points)
  curve.closed = false
  curve.curveType = 'catmullrom'
  curve.tension = 0.5

  // 创建一个Group来存放线和控制点，并应用与牙齿模型相同的变换
  const archGroup = new THREE.Group()
  archGroup.scale.set(1.5, 1.5, 1.5)
  // archGroup.rotation.copy(scene.rotation) // 不，Mesh是直接add到scene的，scene旋转了，所以Group加到scene里也会自动跟着旋转
  scene.add(archGroup)

  // Step 2: 编织绳样式
  const tubeGeometry = new THREE.TubeGeometry(curve, 64, 0.2, 8, false)

  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#ddd'
    ctx.fillRect(0, 0, 64, 64)
    ctx.fillStyle = '#888'
    for (let i = 0; i < 64; i += 8) {
      ctx.beginPath()
      ctx.moveTo(0, i)
      ctx.lineTo(64, i + 32)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, i + 4)
      ctx.lineTo(64, i + 36)
      ctx.stroke()
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(20, 1)

  const material = new THREE.MeshStandardMaterial({
    map: texture,
    color: 0xffaa44,
    roughness: 0.8,
    metalness: 0.2,
    depthTest: false, // 禁用深度测试，使其不被遮挡
    transparent: true, // 配合depthTest使用
  })

  const tubeMesh = new THREE.Mesh(tubeGeometry, material)
  tubeMesh.renderOrder = 999 // 确保最后渲染
  tubeMesh.name = `middle_arch_wire`
  archGroup.add(tubeMesh)

  // Step 3: 添加控制点
  const controlPointCount = 5
  // 清空之前的控制点（如果有）
  // 注意：如果之前有逻辑处理 draggableObjects 清理，这里最好重置一下
  // 但这里只调用一次，所以暂时直接 push

  for (let i = 0; i < controlPointCount; i++) {
    const t = i / (controlPointCount - 1)
    const pointPos = curve.getPointAt(t)
    console.log(pointPos, 'pointPos')

    const sphereGeo = new THREE.SphereGeometry(0.5, 16, 16)
    const sphereMat = new THREE.MeshBasicMaterial({
      color: '#285e50',
      depthTest: false, // 禁用深度测试
      transparent: true,
    })
    const sphere = new THREE.Mesh(sphereGeo, sphereMat)
    sphere.renderOrder = 999 // 确保最后渲染

    sphere.position.copy(pointPos)
    sphere.userData.isControlPoint = true
    sphere.userData.curve = curve
    sphere.userData.t = t
    sphere.userData.jaw = 'middle' // 标记为中间线

    archGroup.add(sphere)

    draggableObjects.push(sphere)
    // const point = new THREE.Vector3(-7.638894279422592, 21.033211280852846, -2.091617858593957)
    // const normal = new THREE.Vector3(-7.638894279422592, 21.033211280852846, -2.091617858593957)
    // createSlicePlane(point, normal)
  }
}

async function loadJsonPoints() {
  try {
    // 加载上下颌的JSON文件，这些文件包含labels数组
    const upperJson = await fetch('/points/upper.json').then((r) => r.json())
    const lowerJson = await fetch('/points/lower.json').then((r) => r.json())

    // 提取labels数组
    labelsUpper = upperJson.labels || []
    labelsLower = lowerJson.labels || []

    console.log(`上颌labels数量: ${labelsUpper.length}`)
    console.log(`下颌labels数量: ${labelsLower.length}`)

    // 统计不同牙齿编号的数量
    const upperToothCounts = countToothLabels(labelsUpper)
    const lowerToothCounts = countToothLabels(labelsLower)

    console.log('上颌牙齿分布:', upperToothCounts)
    console.log('下颌牙齿分布:', lowerToothCounts)
  } catch (error) {
    console.error('加载JSON点位数据失败:', error)
  }
}

import { Text } from 'troika-three-text'
// import { reset } from '@kitware/vtk.js/Common/DataModel/BoundingBox';
function addAxisTicks(scene, length = 50, step = 5) {
  const tickMaterial = new THREE.LineBasicMaterial({ color: 0x888888 })

  const makeTicks = (axis) => {
    const points = [] as any
    for (let i = 0; i <= length; i += step) {
      if (axis === 'x') {
        points.push(new THREE.Vector3(i, -0.5, 0))
        points.push(new THREE.Vector3(i, 0.5, 0))
      }
      if (axis === 'y') {
        points.push(new THREE.Vector3(-0.5, i, 0))
        points.push(new THREE.Vector3(0.5, i, 0))
      }
      if (axis === 'z') {
        points.push(new THREE.Vector3(0, -0.5, i))
        points.push(new THREE.Vector3(0, 0.5, i))
      }
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points)
    return new THREE.LineSegments(geometry, tickMaterial)
  }

  scene.add(makeTicks('x'))
  scene.add(makeTicks('y'))
  scene.add(makeTicks('z'))
}

function addAxisLabels(scene) {
  const labels = [
    { text: 'X', pos: [50, 0, 0], color: 'red' },
    { text: 'Y', pos: [0, 50, 0], color: 'green' },
    { text: 'Z', pos: [0, 0, 50], color: 'blue' },
  ]

  labels.forEach((l) => {
    const label = new Text()
    label.text = l.text
    label.fontSize = 4
    label.color = l.color
    label.position.set(...l.pos)
    scene.add(label)
    label.sync()
    // 始终朝向相机, 方向始终正对
    renderMissions.push(() => label.quaternion.copy(camera.quaternion))
  })
}

/**
 * 加载牙齿质心点数据
 */
async function loadTeethCenterPoints() {
  try {
    // 假设数据存放在 /points/teeth_centers.json
    // 如果数据在其他地方，请修改路径
    const response = await fetch('/points/teeth_centers.json')
    const data: TeethPointsData = await response.json()

    console.log('牙齿质心点数据:', data.teeth_points)
    // 等待场景初始化后再渲染点
    // 由于这个函数在 initScene 之后调用，所以可以直接渲染
    // 但为了确保模型加载完成，我们将渲染逻辑放到 loadModels 中
    // 这里只是存储数据
    return data.teeth_points
  } catch (error) {
    console.error('加载牙齿质心点数据失败:', error)
    return null
  }
}

/**
 * 渲染牙齿质心点到场景中
 * @param teethPoints 牙齿质心点数组
 * @param parentMesh 父网格对象（可选，如果不提供则直接添加到场景）
 */
function renderTeethCenterPoints(teethPoints: ToothCenterPoint[], parentMesh: THREE.Mesh) {
  if (!teethPoints || teethPoints.length === 0) return

  // 创建一个组来存放所有质心点
  const centerPointsGroup = new THREE.Group()
  centerPointsGroup.name = 'teeth_center_points'

  teethPoints.forEach((item) => {
    const { fdi, point } = item
    const [x, y, z] = point

    // 创建球体表示质心点
    const sphereGeometry = new THREE.SphereGeometry(0.5, 16, 16)

    // 根据牙齿编号获取颜色
    const color = toothColorMap[fdi] || 0xffff00 // 默认黄色

    const sphereMaterial = new THREE.MeshBasicMaterial({
      color: color,
      depthTest: false, // 确保始终可见
      transparent: true,
      opacity: 0.9,
    })

    const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial)
    sphere.position.set(x, y, z)
    sphere.name = `center_point_${fdi}`
    sphere.userData.fdi = fdi
    sphere.userData.type = item.type
    sphere.userData.type_cn = item.type_cn

    centerPointsGroup.add(sphere)

    // 创建文字标签显示FDI编号
    // createCenterPointLabel(fdi, new THREE.Vector3(x, y, z), centerPointsGroup)
  })

  // 将质心点组添加到父网格或场景
  // if (parentMesh) {
  parentMesh.add(centerPointsGroup)
  // } else {
  //   scene.add(centerPointsGroup)
  // }

  console.log(`已渲染 ${teethPoints.length} 个牙齿质心点`)
}

/**
 * 创建质心点的文字标签
 * @param fdi 牙齿编号
 * @param position 标签位置
 * @param parentGroup 父组对象
 */
function createCenterPointLabel(fdi: number, position: THREE.Vector3, parentGroup: THREE.Group) {
  // 创建canvas来绘制文字
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return

  // 设置canvas大小
  canvas.width = 128
  canvas.height = 128

  // 绘制背景圆形
  context.fillStyle = 'rgba(0, 0, 0, 0.6)'
  context.beginPath()
  context.arc(64, 64, 60, 0, Math.PI * 2)
  context.fill()

  // 绘制文字
  context.font = 'Bold 50px Arial'
  context.fillStyle = '#ffffff'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(fdi.toString(), 64, 64)

  // 创建纹理
  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true

  // 创建sprite材质
  const spriteMaterial = new THREE.SpriteMaterial({
    map: texture,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: true,
  })

  // 创建sprite对象
  const sprite = new THREE.Sprite(spriteMaterial)
  // 标签位置稍微偏移一点，避免与球体重叠
  sprite.position.set(position.x, position.y, position.z + 1.5)
  sprite.scale.set(1.5, 1.5, 1)
  sprite.name = `center_label_${fdi}`

  parentGroup.add(sprite)
}

/**
 * 统计labels数组中各个牙齿编号的数量
 * @param labels labels数组
 * @returns 牙齿编号到数量的映射
 */
function countToothLabels(labels: number[]): Record<number, number> {
  const counts: Record<number, number> = {}
  labels.forEach((label) => {
    counts[label] = (counts[label] || 0) + 1
  })
  return counts
}

// 暴露获取控制点位置的方法
defineExpose({
  getControlPointsData,
})

/**
 * 获取所有控制点的位置信息
 */
function getControlPointsData() {
  const data = draggableObjects.map((obj) => {
    return {
      id: obj.id,
      position: obj.position.clone(),
      // 如果需要，可以返回在曲线上的 t 值
      t: obj.userData.t,
      // 所在的颌 (upper/lower) - 需要在创建时存入 userData
      jaw: obj.userData.jaw,
    }
  })
  console.log('Control Points Data:', data)
  return data
}
/*
计算牙齿的宽度
*/
const getNumberList = (parentMesh: THREE.Mesh, toothPoints) => {
  Object.keys(toothPoints).forEach((toothNum) => {
    const points = toothPoints[toothNum]

    const { width, center } = getToothWidthAndCenter(points)
    const label = createWidthLabel(width.toFixed(2) + ' mm')

    // 标签位置略高于牙齿中心
    label.position.set(center.x, center.y + 1.5, center.z)

    label.visible = false // 初始隐藏
    scene.add(label)

    toothWidthLabels.push(label)
  })
}
function getToothWidthAndCenter(points: Float32Array) {
  if (!points || points.length < 3) return { width: 0, center: new THREE.Vector3() }

  let minX = points[0],
    maxX = points[0]
  let sumX = 0,
    sumY = 0,
    sumZ = 0
  const n = points.length / 3

  for (let i = 0; i < n; i++) {
    const x = points[i * 3]
    const y = points[i * 3 + 1]
    const z = points[i * 3 + 2]

    if (x < minX) minX = x
    if (x > maxX) maxX = x

    sumX += x
    sumY += y
    sumZ += z
  }

  const width = maxX - minX

  // 中心点（用作标签位置，Y 偏上）
  const center = new THREE.Vector3(sumX / n, sumY / n, sumZ / n)

  return { width, center }
}
function createWidthLabel(text: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 128
  const ctx = canvas.getContext('2d')!

  ctx.font = '48px Arial'
  ctx.fillStyle = 'black'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 20, 64)

  const texture = new THREE.CanvasTexture(canvas)
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(12, 6, 1) // 调整大小

  return sprite
}

function animate() {
  requestAnimationFrame(animate)
  controls.update()
  renderMissions.forEach((m) => m())
  renderer.render(scene, camera)
}

const getChangeLabel = (item: any) => {
  selectLabel.value = item.type
  if (!upperMesh || !lowerMesh) return

  if (item.key === 'full') {
    upperMesh.visible = true
    lowerMesh.visible = true
    upperMeshLabel.visible = true
    lowerMeshLabel.visible = true
    scene.rotation.set(-Math.PI / 2, 0, -Math.PI / 2)
  }
  if (item.key === 'upper') {
    upperMesh.visible = true
    upperMeshLabel.visible = true
    lowerMesh.visible = false
    lowerMeshLabel.visible = false
    scene.rotation.set(-Math.PI / 2, 0, -Math.PI / 2)
  }
  if (item.key === 'lower') {
    upperMesh.visible = false
    upperMeshLabel.visible = false
    lowerMesh.visible = true
    lowerMeshLabel.visible = true
    scene.rotation.set(-Math.PI / 2, 0, -Math.PI / 2)
  }
  if (item.key === 'upper_angle') {
    upperMesh.visible = true
    upperMeshLabel.visible = true
    lowerMesh.visible = false
    lowerMeshLabel.visible = false
    scene.rotation.set(-Math.PI, 0, -Math.PI / 2)
  }
  if (item.key === 'lower_angle') {
    upperMesh.visible = false
    upperMeshLabel.visible = false
    lowerMesh.visible = true
    lowerMeshLabel.visible = true
    scene.rotation.set(0, 0, -Math.PI / 2)
  }
  if (item.key === 'left') {
    upperMesh.visible = true
    upperMeshLabel.visible = true
    lowerMesh.visible = true
    lowerMeshLabel.visible = true
    scene.rotation.set(-Math.PI / 2, 0, -Math.PI)
  }
  if (item.key === 'right') {
    upperMesh.visible = true
    upperMeshLabel.visible = true
    lowerMesh.visible = true
    lowerMeshLabel.visible = true
    scene.rotation.set(-Math.PI / 4, 0, 0)
  }
}
const getChange = (selectValue: any) => {
  //点击牙号
  if (selectValue == 'isShowNumber') {
    showAllLabels.value = !showAllLabels.value

    allToothLabels.value.forEach((label) => {
      label.visible = showAllLabels.value
    })
  }
  //点击牙弓宽度
  if (selectValue == 'isShowWidths') {
    // ShowWidths
    showWidths.value = !showWidths.value

    toothWidthLabels.forEach((label) => {
      label.visible = showWidths.value
    })
  }
}
</script>

<style lang="scss" scoped>
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
}
.oral-3d {
  width: 100%;
  height: 100vh;
  background-color: #f9f9f9;
  overflow: hidden;
}
</style>
