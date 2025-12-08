import * as THREE from 'three'
import { OrbitControls, DragControls } from 'three-stdlib'
import { SCENE_CONFIG } from '../constants'
import { RenderContext } from './RenderContext'

/**
 * 场景管理器（单例模式）
 * 负责创建和管理Three.js场景、相机、渲染器、控制器等核心对象
 */
export class SceneManager {
  private static instance: SceneManager | null = null

  private scene!: THREE.Scene
  private camera!: THREE.PerspectiveCamera
  private renderer!: THREE.WebGLRenderer
  private controls!: OrbitControls
  private dragControls: DragControls | null = null
  private draggableObjects: THREE.Object3D[] = []
  private container!: HTMLDivElement
  private animationId: number | null = null
  private renderContext!: RenderContext

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): SceneManager {
    if (!SceneManager.instance) {
      SceneManager.instance = new SceneManager()
    }
    return SceneManager.instance
  }

  /**
   * 初始化场景
   */
  init(container: HTMLDivElement): RenderContext {
    this.container = container

    // 创建场景
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(SCENE_CONFIG.background)

    // 获取容器尺寸
    const width = container.clientWidth
    const height = container.clientHeight

    // 创建相机
    this.camera = new THREE.PerspectiveCamera(
      SCENE_CONFIG.cameraFov,
      width / height,
      SCENE_CONFIG.cameraNear,
      SCENE_CONFIG.cameraFar,
    )
    this.camera.position.set(
      SCENE_CONFIG.cameraPosition.x,
      SCENE_CONFIG.cameraPosition.y,
      SCENE_CONFIG.cameraPosition.z,
    )

    // 创建渲染器
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setSize(width, height)
    this.renderer.setPixelRatio(window.devicePixelRatio)
    container.appendChild(this.renderer.domElement)

    // 添加灯光
    this.setupLights()

    // 创建控制器
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.05
    this.controls.minDistance = 30
    this.controls.maxDistance = 300

    // 添加坐标轴辅助（开发模式可选）
    const axesHelper = new THREE.AxesHelper(100)
    axesHelper.visible = false // 默认隐藏
    this.scene.add(axesHelper)

    // 设置场景旋转
    this.scene.rotation.x = SCENE_CONFIG.sceneRotation.x
    this.scene.rotation.z = SCENE_CONFIG.sceneRotation.z

    // 创建渲染上下文
    this.renderContext = new RenderContext(this.scene, this.camera, this.renderer)

    return this.renderContext
  }

  /**
   * 设置灯光
   */
  private setupLights(): void {
    // 环境光
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
    this.scene.add(ambientLight)

    // 主方向光
    const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.8)
    dirLight1.position.set(100, 100, 100)
    this.scene.add(dirLight1)

    // 补光
    const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.4)
    dirLight2.position.set(-100, -100, -100)
    this.scene.add(dirLight2)
  }

  /**
   * 初始化拖拽控制
   */
  setupDragControls(): void {
    if (!this.camera || !this.renderer) {
      console.warn('相机或渲染器未初始化，无法设置拖拽控制')
      return
    }

    // 创建拖拽控制器
    this.dragControls = new DragControls(
      this.draggableObjects,
      this.camera,
      this.renderer.domElement,
    )

    // 拖拽开始时禁用轨道控制
    this.dragControls.addEventListener('dragstart', () => {
      this.controls.enabled = false
    })

    // 拖拽结束时启用轨道控制
    this.dragControls.addEventListener('dragend', () => {
      this.controls.enabled = true
    })

    // 拖拽过程中的处理
    this.dragControls.addEventListener('drag', (event: { object: THREE.Object3D }) => {
      this.handleDrag(event.object)
    })

    console.log('✅ 拖拽控制已初始化')
  }

  /**
   * 处理拖拽事件
   */
  private handleDrag(object: THREE.Object3D): void {
    // 处理中线分析的控制点拖拽
    if (object.userData.isMidlineControlPoint) {
      const strategy = object.userData.strategy
      const controlPointId = object.userData.controlPointId

      if (strategy && typeof strategy.updatePlane === 'function') {
        strategy.updatePlane(controlPointId)
      }
    }

    // 其他类型的拖拽控制点可以在这里添加
  }

  /**
   * 添加可拖拽对象
   */
  addDraggableObject(object: THREE.Object3D): void {
    if (!this.draggableObjects.includes(object)) {
      this.draggableObjects.push(object)

      // 如果拖拽控制器已经初始化，更新它
      if (this.dragControls) {
        this.dragControls.dispose()
        this.setupDragControls()
      }
    }
  }

  /**
   * 移除可拖拽对象
   */
  removeDraggableObject(object: THREE.Object3D): void {
    const index = this.draggableObjects.indexOf(object)
    if (index > -1) {
      this.draggableObjects.splice(index, 1)

      // 如果拖拽控制器已经初始化，更新它
      if (this.dragControls) {
        this.dragControls.dispose()
        this.setupDragControls()
      }
    }
  }

  /**
   * 清除所有可拖拽对象
   */
  clearDraggableObjects(): void {
    this.draggableObjects = []
    if (this.dragControls) {
      this.dragControls.dispose()
      this.dragControls = null
    }
  }

  /**
   * 开始动画循环
   */
  startAnimation(customRender?: () => void): void {
    const animate = () => {
      this.animationId = requestAnimationFrame(animate)

      // 更新控制器
      this.controls.update()

      // 自定义渲染逻辑
      if (customRender) {
        customRender()
      }

      // 渲染场景
      this.renderer.render(this.scene, this.camera)
    }

    animate()
  }

  /**
   * 停止动画循环
   */
  stopAnimation(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }
  }

  /**
   * 更新场景视角
   */
  updateView(
    viewKey: string,
    meshes: {
      upperMesh: THREE.Mesh | null
      lowerMesh: THREE.Mesh | null
      upperMeshLabel: THREE.Mesh | null
      lowerMeshLabel: THREE.Mesh | null
    },
  ): void {
    const { upperMesh, lowerMesh, upperMeshLabel, lowerMeshLabel } = meshes

    if (!upperMesh || !lowerMesh || !upperMeshLabel || !lowerMeshLabel) return

    // 重置所有显示
    upperMesh.visible = false
    lowerMesh.visible = false
    upperMeshLabel.visible = false
    lowerMeshLabel.visible = false

    switch (viewKey) {
      case 'full':
        upperMesh.visible = true
        lowerMesh.visible = true
        upperMeshLabel.visible = true
        lowerMeshLabel.visible = true
        this.scene.rotation.set(-Math.PI / 2, 0, -Math.PI / 2)
        break

      case 'upper':
        upperMesh.visible = true
        upperMeshLabel.visible = true
        this.scene.rotation.set(-Math.PI / 2, 0, -Math.PI / 2)
        break

      case 'lower':
        lowerMesh.visible = true
        lowerMeshLabel.visible = true
        this.scene.rotation.set(-Math.PI / 2, 0, -Math.PI / 2)
        break

      case 'upper_angle':
        upperMesh.visible = true
        upperMeshLabel.visible = true
        this.scene.rotation.set(-Math.PI, 0, -Math.PI / 2)
        break

      case 'lower_angle':
        lowerMesh.visible = true
        lowerMeshLabel.visible = true
        this.scene.rotation.set(0, 0, -Math.PI / 2)
        break

      case 'left':
        upperMesh.visible = true
        upperMeshLabel.visible = true
        lowerMesh.visible = true
        lowerMeshLabel.visible = true
        this.scene.rotation.set(-Math.PI / 2, 0, -Math.PI)
        break

      case 'right':
        upperMesh.visible = true
        upperMeshLabel.visible = true
        lowerMesh.visible = true
        lowerMeshLabel.visible = true
        this.scene.rotation.set(-Math.PI / 4, 0, 0)
        break
    }
  }

  /**
   * 处理窗口大小变化
   */
  handleResize(): void {
    if (!this.container || !this.camera || !this.renderer) return

    const width = this.container.clientWidth
    const height = this.container.clientHeight

    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
  }

  /**
   * 获取场景对象
   */
  getScene(): THREE.Scene {
    return this.scene
  }

  /**
   * 获取相机对象
   */
  getCamera(): THREE.PerspectiveCamera {
    return this.camera
  }

  /**
   * 获取渲染器对象
   */
  getRenderer(): THREE.WebGLRenderer {
    return this.renderer
  }

  /**
   * 获取控制器对象
   */
  getControls(): OrbitControls {
    return this.controls
  }

  /**
   * 获取渲染上下文
   */
  getRenderContext(): RenderContext {
    return this.renderContext
  }

  /**
   * 清理资源
   */
  dispose(): void {
    this.stopAnimation()
    this.controls.dispose()

    // 清理拖拽控制器
    if (this.dragControls) {
      this.dragControls.dispose()
      this.dragControls = null
    }

    this.clearDraggableObjects()
    this.renderContext.dispose()

    // 从DOM中移除渲染器canvas
    if (this.container && this.renderer.domElement) {
      this.container.removeChild(this.renderer.domElement)
    }

    // 重置单例
    SceneManager.instance = null
  }
}
