<template>
  <div ref="container" class="oral-3d"></div>
</template>

<script lang="ts" setup>
import { ref, onMounted, onUnmounted } from 'vue'
import * as THREE from 'three'
import { OrbitControls, STLLoader, DragControls } from 'three-stdlib'

const container = ref<HTMLDivElement | null>(null)

// 存储上下颌的labels数组
let labelsUpper: number[] = []
let labelsLower: number[] = []

let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let renderer: THREE.WebGLRenderer
let controls: OrbitControls
// 存储所有可拖拽的控制点
const draggableObjects: THREE.Object3D[] = []
let dragControls: DragControls

// 存储上下颌的中心点数据，用于生成中间牙弓线
let upperCentersData: Record<number, THREE.Vector3> | null = null
let lowerCentersData: Record<number, THREE.Vector3> | null = null

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
  await loadJsonPoints()
  loadModels()
  animate()
})

onUnmounted(() => {
  renderer?.dispose()
  if (dragControls) {
    dragControls.dispose()
  }
})

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

  // 为每个牙齿编号分配数组
  Object.keys(pointsPerTooth).forEach((label) => {
    const labelNum = Number(label)
    const count = pointsPerTooth[labelNum]
    if (count !== undefined) {
      groupedByTooth[labelNum] = new Float32Array(count * 3)
    }
  })

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

    // 获取该牙齿编号对应的颜色，如果没有则使用随机颜色
    const color = toothColorMap[toothLabel] || Math.random() * 0xffffff

    // 创建点材质
    const pointMaterial = new THREE.PointsMaterial({
      color: color,
      size: 0.15, // 点的大小
      sizeAttenuation: true,
      depthTest: false, // 确保点云始终可见
      depthWrite: false,
      // transparent: true,
      opacity: 0.8,
    })

    // 创建点云对象
    const points = new THREE.Points(pointGeometry, pointMaterial)
    points.name = `tooth_${toothLabel}` // 设置名称便于后续识别和控制

    // 将点云添加到父网格对象中
    parentMesh.add(points)

    // 创建文字标签显示牙齿编号
    const center = toothCenters[toothLabel]
    if (center) {
      createToothLabel(toothLabel, center, parentMesh)
    }
  })

  // console.log(`已渲染 ${Object.keys(groupedByTooth).length} 个牙齿的点云`)

  return toothCenters
}

/**
 * 创建牙齿编号文字标签
 * @param toothLabel 牙齿编号
 * @param position 标签位置（牙齿中心点）
 * @param parentMesh 父网格对象
 */
function createToothLabel(toothLabel: number, position: THREE.Vector3, parentMesh: THREE.Mesh) {
  // 创建canvas来绘制文字
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return

  // 设置canvas大小
  canvas.width = 256
  canvas.height = 256

  // 设置文字样式 - 背景透明或半透明
  context.fillStyle = 'rgba(255, 255, 255, 0.8)' // 半透明白色背景
  context.fillRect(0, 0, canvas.width, canvas.height)

  context.font = 'Bold 100px Arial'
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
  sprite.position.copy(position)
  // 调整标签大小，使其相对于牙齿模型合适
  // 由于模型scale为1.5，标签大小需要相应调整
  sprite.scale.set(2, 2, 1) // 根据实际效果调整这个值
  sprite.name = `label_${toothLabel}`

  // 将标签添加到父网格对象中
  parentMesh.add(sprite)
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
    upperMesh.scale.set(1.5, 1.5, 1.5)

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
      specular: 0x555555,
    })
    const lowerMesh = new THREE.Mesh(geometry, material)
    lowerMesh.scale.set(1.5, 1.5, 1.5)
    scene.rotation.x = -Math.PI / 2
    scene.rotation.z = -Math.PI / 2
    scene.add(lowerMesh)
  })
  setTimeout(() => {
    // 上颌牙齿部分
    loader.load('/models/upper_only_tooth.stl', (geometry) => {
      const material = new THREE.MeshPhongMaterial({
        color: 0xffffff,
        specular: 0x555555,
        shininess: 30,
        flatShading: false,
      })

      const upperMesh = new THREE.Mesh(geometry, material)
      upperMesh.scale.set(1.5, 1.5, 1.5)
      scene.rotation.x = -Math.PI / 2
      scene.rotation.z = -Math.PI / 2
      scene.add(upperMesh)

      // 使用新的渲染方法，传入geometry和labels数组
      const centers = renderPointsFromJson(geometry, labelsUpper, upperMesh)
      if (centers) {
        upperCentersData = centers
        tryCreateMiddleArchCurve()
      }
    })
    // 下颌牙齿部分
    loader.load('/models/lower_only_tooth.stl', (geometry) => {
      const material = new THREE.MeshPhongMaterial({
        color: 0xffffff,
        specular: 0x555555,
        shininess: 100,
      })
      const downMesh = new THREE.Mesh(geometry, material)
      downMesh.scale.set(1.5, 1.5, 1.5)
      scene.rotation.x = -Math.PI / 2
      scene.rotation.z = -Math.PI / 2
      scene.add(downMesh)

      // 使用新的渲染方法，传入geometry和labels数组
      const centers = renderPointsFromJson(geometry, labelsLower, downMesh)
      if (centers) {
        lowerCentersData = centers
        tryCreateMiddleArchCurve()
      }
    })
  }, 300)
  // 坐标轴辅助
  const axesHelper = new THREE.AxesHelper(100)
  scene.add(axesHelper)
}

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
  const tubeGeometry = new THREE.TubeGeometry(curve, 64, 0.5, 8, false)

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

    const sphereGeo = new THREE.SphereGeometry(1, 16, 16)
    const sphereMat = new THREE.MeshBasicMaterial({
      color: 0x0000ff,
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
