import * as THREE from 'three'
import { OrbitControls } from 'three-stdlib'
import { SCENE_CONFIG } from '../constants'

/**
 * 初始化Three.js场景
 * @param container DOM容器元素
 * @returns 场景相关对象
 */
export function initScene(container: HTMLDivElement) {
  // 创建场景
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(SCENE_CONFIG.background)

  // 获取容器尺寸
  const width = container.clientWidth
  const height = container.clientHeight

  // 创建相机
  const camera = new THREE.PerspectiveCamera(
    SCENE_CONFIG.cameraFov,
    width / height,
    SCENE_CONFIG.cameraNear,
    SCENE_CONFIG.cameraFar,
  )
  camera.position.set(
    SCENE_CONFIG.cameraPosition.x,
    SCENE_CONFIG.cameraPosition.y,
    SCENE_CONFIG.cameraPosition.z,
  )

  // 创建渲染器
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(width, height)
  container.appendChild(renderer.domElement)

  // 添加灯光
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
  scene.add(ambientLight)

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8)
  dirLight.position.set(100, 100, 100)
  scene.add(dirLight)

  // 创建控制器
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.05
  controls.minDistance = 30
  controls.maxDistance = 300

  // 添加坐标轴辅助
  const axesHelper = new THREE.AxesHelper(100)
  scene.add(axesHelper)

  // 设置场景旋转
  scene.rotation.x = SCENE_CONFIG.sceneRotation.x
  scene.rotation.z = SCENE_CONFIG.sceneRotation.z

  return { scene, camera, renderer, controls }
}

/**
 * 根据视角类型更新场景显示
 * @param viewKey 视角键值
 * @param meshes 网格对象集合
 * @param scene 场景对象
 */
export function updateSceneView(
  viewKey: string,
  meshes: {
    upperMesh: THREE.Mesh | null
    lowerMesh: THREE.Mesh | null
    upperMeshLabel: THREE.Mesh | null
    lowerMeshLabel: THREE.Mesh | null
  },
  scene: THREE.Scene,
): void {
  const { upperMesh, lowerMesh, upperMeshLabel, lowerMeshLabel } = meshes

  if (!upperMesh || !lowerMesh || !upperMeshLabel || !lowerMeshLabel) return

  // 重置所有显示
  const resetVisibility = () => {
    upperMesh.visible = false
    lowerMesh.visible = false
    upperMeshLabel.visible = false
    lowerMeshLabel.visible = false
  }

  resetVisibility()

  switch (viewKey) {
    case 'full':
      upperMesh.visible = true
      lowerMesh.visible = true
      upperMeshLabel.visible = true
      lowerMeshLabel.visible = true
      scene.rotation.set(-Math.PI / 2, 0, -Math.PI / 2)
      break

    case 'upper':
      upperMesh.visible = true
      upperMeshLabel.visible = true
      scene.rotation.set(-Math.PI / 2, 0, -Math.PI / 2)
      break

    case 'lower':
      lowerMesh.visible = true
      lowerMeshLabel.visible = true
      scene.rotation.set(-Math.PI / 2, 0, -Math.PI / 2)
      break

    case 'upper_angle':
      upperMesh.visible = true
      upperMeshLabel.visible = true
      scene.rotation.set(-Math.PI, 0, -Math.PI / 2)
      break

    case 'lower_angle':
      lowerMesh.visible = true
      lowerMeshLabel.visible = true
      scene.rotation.set(0, 0, -Math.PI / 2)
      break

    case 'left':
      upperMesh.visible = true
      upperMeshLabel.visible = true
      lowerMesh.visible = true
      lowerMeshLabel.visible = true
      scene.rotation.set(-Math.PI / 2, 0, -Math.PI)
      break

    case 'right':
      upperMesh.visible = true
      upperMeshLabel.visible = true
      lowerMesh.visible = true
      lowerMeshLabel.visible = true
      scene.rotation.set(-Math.PI / 4, 0, 0)
      break
  }
}
