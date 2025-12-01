<template>
  <div ref="container" class="oral-3d"></div>
</template>

<script lang="ts" setup>
import { ref, onMounted, onUnmounted } from 'vue'
import * as THREE from 'three'
import { OrbitControls, STLLoader } from 'three-stdlib'

const container = ref<HTMLDivElement | null>(null)

// 存储上下颌的labels数组
let labelsUpper: number[] = []
let labelsLower: number[] = []

let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let renderer: THREE.WebGLRenderer
let controls: OrbitControls

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
  21: 0x1e90ff, // 道奇蓝
  22: 0x0000ff, // 蓝色
  23: 0x8a2be2, // 蓝紫色
  24: 0x9370db, // 中紫色
  25: 0xba55d3, // 中兰花紫
  26: 0xff00ff, // 品红色
  27: 0xff1493, // 深粉红
  28: 0xc71585, // 中紫红色
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
}

onMounted(async () => {
  initScene()
  await loadJsonPoints()
  loadModels()
  animate()
})

onUnmounted(() => {
  renderer?.dispose()
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
      transparent: true,
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

  console.log(`已渲染 ${Object.keys(groupedByTooth).length} 个牙齿的点云`)
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
    transparent: true,
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
    upperMesh.scale.set(1.5, 1.5, 1.5) // 缩放比例按你的文件调整
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
    lowerMesh.scale.set(1.5, 1.5, 1.5)
    // lowerMesh.position.set(0, -10, 0) // 稍微下移一点
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
        // depthTest: false,
        flatShading: false, // 关键：设置为false启用平滑着色
      })

      const upperMesh = new THREE.Mesh(geometry, material)
      upperMesh.scale.set(1.5, 1.5, 1.5) // 缩放比例按你的文件调整
      // upperMesh.position.set(0, 10, 0) // 稍微上移一点
      // 绕 Y 轴旋转 90°（相当于左右旋转）
      // scene.rotation.y = Math.PI

      // 向下仰俯 45°（绕 X 轴）
      scene.rotation.x = -Math.PI / 2
      scene.rotation.z = -Math.PI / 2
      scene.add(upperMesh)

      // 使用新的渲染方法，传入geometry和labels数组
      renderPointsFromJson(geometry, labelsUpper, upperMesh)
    })
    // 下颌牙齿部分
    loader.load('/models/lower_only_tooth.stl', (geometry) => {
      const material = new THREE.MeshPhongMaterial({
        color: 0xffffff,
        specular: 0x555555,
        shininess: 100,
      })
      const downMesh = new THREE.Mesh(geometry, material)
      downMesh.scale.set(1.5, 1.5, 1.5) // 缩放比例按你的文件调整
      // downMesh.position.set(0, 10, 0) // 稍微上移一点
      // 绕 Y 轴旋转 90°（相当于左右旋转）
      // scene.rotation.y = Math.PI

      // 向下仰俯 45°（绕 X 轴）
      scene.rotation.x = -Math.PI / 2
      scene.rotation.z = -Math.PI / 2
      scene.add(downMesh)

      // 使用新的渲染方法，传入geometry和labels数组
      renderPointsFromJson(geometry, labelsLower, downMesh)
    })
  }, 300)
  // 坐标轴辅助
  const axesHelper = new THREE.AxesHelper(100)
  scene.add(axesHelper)
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
