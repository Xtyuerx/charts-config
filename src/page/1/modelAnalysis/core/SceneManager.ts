import * as THREE from 'three';
import { TrackballControls, DragControls } from 'three-stdlib';
import { SCENE_CONFIG } from '../constants';
import { RenderContext } from './RenderContext';

/**
 * 场景管理器（单例模式）
 * 负责创建和管理Three.js场景、相机、渲染器、控制器等核心对象
 */
export class SceneManager {
  private static instance: SceneManager | null = null;

  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private controls: TrackballControls | null = null;
  private dragControls: DragControls | null = null;
  private draggableObjects: THREE.Object3D[] = [];
  private container!: HTMLDivElement;
  private animationId: number | null = null;
  private renderContext!: RenderContext;

  // 保存模型的朝向信息，用于视角切换
  private modelOrientation: {
    frontDirection: THREE.Vector3;
    leftRightDirection: THREE.Vector3;
    upDirection: THREE.Vector3;
    targetPoint: THREE.Vector3;
    upperMidpoint: THREE.Vector3;
    lowerMidpoint: THREE.Vector3 | null;
  } | null = null;

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): SceneManager {
    if (!SceneManager.instance) {
      SceneManager.instance = new SceneManager();
    }
    return SceneManager.instance;
  }

  /**
   * 初始化场景
   */
  init(container: HTMLDivElement): RenderContext {
    this.container = container;

    // 创建场景
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SCENE_CONFIG.background);

    // 获取容器尺寸
    const width = container.clientWidth;
    const height = container.clientHeight;

    // 创建相机
    this.camera = new THREE.PerspectiveCamera(
      SCENE_CONFIG.cameraFov,
      width / height,
      SCENE_CONFIG.cameraNear,
      SCENE_CONFIG.cameraFar,
    );
    this.camera.position.set(
      SCENE_CONFIG.cameraPosition.x,
      SCENE_CONFIG.cameraPosition.y,
      SCENE_CONFIG.cameraPosition.z,
    );
    // 设置相机的上方向（Z轴为上），确保OrbitControls工作正常
    this.camera.up.set(SCENE_CONFIG.cameraUp.x, SCENE_CONFIG.cameraUp.y, SCENE_CONFIG.cameraUp.z);
    // 让相机朝向场景中心
    this.camera.lookAt(0, 0, 0);

    // 创建渲染器
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    // 添加灯光
    this.setupLights();
    // 初始化 TrackballControls（使用默认目标点，模型加载后会更新）
    this.initOrbitControls();
    // 注意：不在这里初始化 TrackballControls
    // 将在模型加载、居中、朝向调整后再初始化控制器
    // 这样可以确保控制器的目标点和相机位置都是正确的

    // 添加坐标轴辅助（开发模式可选）
    const axesHelper = new THREE.AxesHelper(100);
    axesHelper.visible = false; // 默认显示
    this.scene.add(axesHelper);

    // 创建渲染上下文
    this.renderContext = new RenderContext(this.scene, this.camera, this.renderer);

    return this.renderContext;
  }

  /**
   * 初始化 TrackballControls
   * 应该在模型加载、居中、朝向调整后调用
   */
  private initOrbitControls(): void {
    if (this.controls) {
      // 如果已经初始化过，先清理
      this.controls.dispose();
    }

    // 创建控制器
    this.controls = new TrackballControls(this.camera, this.renderer.domElement);
    this.controls.rotateSpeed = 4.0;
    this.controls.zoomSpeed = 1.2;
    this.controls.panSpeed = 0.8;
    this.controls.staticMoving = true;
    this.controls.dynamicDampingFactor = 0.15;
  }

  /**
   * 设置灯光
   */
  private setupLights(): void {
    // 环境光
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    this.scene.add(ambientLight);

    // 主方向光
    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight1.position.set(100, 100, 100);
    this.scene.add(dirLight1);

    // 补光
    const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.6);
    dirLight2.position.set(-1, 0.5, -1);
    this.scene.add(dirLight2);
  }

  /**
   * 初始化拖拽控制
   */
  setupDragControls(): void {
    if (!this.camera || !this.renderer) {
      console.warn('相机或渲染器未初始化，无法设置拖拽控制');
      return;
    }

    // 创建拖拽控制器
    this.dragControls = new DragControls(
      this.draggableObjects,
      this.camera,
      this.renderer.domElement,
    );

    // 拖拽开始时禁用轨道控制
    this.dragControls.addEventListener('dragstart', () => {
      if (this.controls) {
        this.controls.enabled = false;
      }
    });

    // 拖拽结束时启用轨道控制
    this.dragControls.addEventListener('dragend', (event: { object: THREE.Object3D }) => {
      if (this.controls) {
        this.controls.enabled = true;
      }

      // 处理拥挤度分析点位拖拽结束
      if (event.object.userData.isCrowdingPoint) {
        const strategy = event.object.userData.strategy;
        if (strategy && typeof strategy.getUpdatedPoints === 'function') {
          const updatedPoints = strategy.getUpdatedPoints();
        }
      }

      // 处理覆合分析点位拖拽结束
      if (event.object.userData.isOverbitePoint) {
        const strategy = event.object.userData.strategy;
        if (strategy && typeof strategy.getUpdatedPoints === 'function') {
          const updatedPoints = strategy.getUpdatedPoints();
        }
      }
      // 处理覆盖分析点位拖拽结束
      if (event.object.userData.isOverjetPoint) {
        const strategy = event.object.userData.strategy;
        if (strategy && typeof strategy.getUpdatedPoints === 'function') {
          const updatedPoints = strategy.getUpdatedPoints();
        }
      }
    });

    // 拖拽过程中的处理
    this.dragControls.addEventListener('drag', (event: { object: THREE.Object3D }) => {
      this.handleDrag(event.object);
    });
  }

  /**
   * 处理拖拽事件
   */
  private handleDrag(object: THREE.Object3D): void {
    // 处理中线分析的控制点拖拽
    if (object.userData.isMidlineControlPoint) {
      const strategy = object.userData.strategy;
      const controlPointId = object.userData.controlPointId;

      if (strategy && typeof strategy.updatePlane === 'function') {
        // 传入拖拽后的新位置，让策略约束到曲线上
        strategy.updatePlane(controlPointId, object.position);
      }
    }
    // 🔑 新增：通用拖拽处理 - 处理有 onDrag 回调的对象
    if (object.userData?.onDrag && typeof object.userData.onDrag === 'function') {
      object.userData.onDrag(object.position);
      return; // 如果有专门的 onDrag 处理，就不需要继续其他处理
    }
    // 处理拥挤度分析的点位拖拽
    if (object.userData.isCrowdingPoint) {
      const strategy = object.userData.strategy;

      if (strategy && typeof strategy.updateOnDrag === 'function') {
        strategy.updateOnDrag(object);
      }
    }

    // 处理覆合分析的点位拖拽
    if (object.userData.isOverbitePoint) {
      const strategy = object.userData.strategy;

      if (strategy && typeof strategy.updateOnDrag === 'function') {
        strategy.updateOnDrag(object);
      }
    }

    // 处理覆盖分析的点位拖拽
    if (object.userData.isOverjetPoint) {
      const strategy = object.userData.strategy;

      if (strategy && typeof strategy.updateOnDrag === 'function') {
        strategy.updateOnDrag(object);
      }
    }

    // 其他类型的拖拽控制点可以在这里添加
  }

  /**
   * 添加可拖拽对象
   */
  addDraggableObject(object: THREE.Object3D): void {
    if (!this.draggableObjects.includes(object)) {
      this.draggableObjects.push(object);

      // 如果拖拽控制器已经初始化，更新它
      if (this.dragControls) {
        this.dragControls.dispose();
        this.setupDragControls();
      }
    }
  }

  /**
   * 移除可拖拽对象
   */
  removeDraggableObject(object: THREE.Object3D): void {
    const index = this.draggableObjects.indexOf(object);
    if (index > -1) {
      this.draggableObjects.splice(index, 1);

      // 如果拖拽控制器已经初始化，更新它
      if (this.dragControls) {
        this.dragControls.dispose();
        this.setupDragControls();
      }
    }
  }

  /**
   * 清除所有可拖拽对象
   */
  clearDraggableObjects(): void {
    this.draggableObjects = [];
    if (this.dragControls) {
      this.dragControls.dispose();
      this.dragControls = null;
    }
  }

  /**
   * 开始动画循环
   */
  startAnimation(customRender?: () => void): void {
    const animate = () => {
      this.animationId = requestAnimationFrame(animate);

      // 更新控制器
      if (this.controls) {
        this.controls.update();
      }

      // 自定义渲染逻辑
      if (customRender) {
        customRender();
      }

      // 渲染场景
      this.renderer.render(this.scene, this.camera);
    };

    animate();
  }

  /**
   * 停止动画循环
   */
  stopAnimation(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  /**
   * 计算可见mesh的精确中心点和合适的相机距离
   * @param meshes 要分析的mesh列表
   * @returns 中心点和建议的相机距离
   */
  private calculateViewCenter(meshes: THREE.Mesh[]): { center: THREE.Vector3; distance: number } {
    if (meshes.length === 0) {
      return { center: new THREE.Vector3(0, 0, 0), distance: 150 };
    }

    // 计算所有可见mesh的组合边界框
    const boundingBox = new THREE.Box3();
    meshes.forEach(mesh => {
      const box = new THREE.Box3().setFromObject(mesh);
      boundingBox.union(box);
    });

    // 获取中心点
    const center = new THREE.Vector3();
    boundingBox.getCenter(center);

    // 计算边界框大小
    const size = new THREE.Vector3();
    boundingBox.getSize(size);

    // 根据边界框大小计算合适的相机距离
    const maxDimension = Math.max(size.x, size.y, size.z);
    const distance = Math.max(150, maxDimension * 1.5);

    return { center, distance };
  }

  /**
   * 更新场景视角
   * 基于保存的模型朝向信息，通过调整相机位置来切换视角
   * 这样可以避免OrbitControls在旋转场景下出现的旋转轴错乱问题
   */
  updateView(
    viewKey: string,
    meshes: {
      upperMesh: THREE.Mesh | null;
      lowerMesh: THREE.Mesh | null;
      upperMeshLabel: THREE.Mesh | null;
      lowerMeshLabel: THREE.Mesh | null;
    },
  ): void {
    const { upperMesh, lowerMesh, upperMeshLabel, lowerMeshLabel } = meshes;

    if (!upperMesh || !lowerMesh || !upperMeshLabel || !lowerMeshLabel) return;

    // 重置所有显示
    upperMesh.visible = false;
    lowerMesh.visible = false;
    upperMeshLabel.visible = false;
    lowerMeshLabel.visible = false;
    // 如果没有保存的模型朝向信息，从当前mesh计算中心点
    if (!this.modelOrientation) {
      // 计算上颌和下颌的边界框中心
      const calcMeshCenter = (mesh: THREE.Mesh | null): THREE.Vector3 | null => {
        if (!mesh) return null;
        const box = new THREE.Box3().setFromObject(mesh);
        const center = new THREE.Vector3();
        box.getCenter(center);
        return center;
      };

      const upperCenter = calcMeshCenter(upperMesh);
      const lowerCenter = calcMeshCenter(lowerMesh);
      const bothCenter =
        upperCenter && lowerCenter
          ? new THREE.Vector3().addVectors(upperCenter, lowerCenter).multiplyScalar(0.5)
          : upperCenter || lowerCenter || new THREE.Vector3(0, 0, 0);

      this.modelOrientation = {
        frontDirection: new THREE.Vector3(0, 1, 0),
        leftRightDirection: new THREE.Vector3(1, 0, 0),
        upDirection: new THREE.Vector3(0, 0, 1),
        targetPoint: bothCenter,
        upperMidpoint: upperCenter || bothCenter,
        lowerMidpoint: lowerCenter,
      };
      // 确保控制器已初始化
      if (!this.controls) {
        this.initOrbitControls();
      }

      console.warn('⚠️ 使用默认朝向信息，建议先加载模型并调用adjustCameraToFaceFrontTeeth');
    }

    const {
      frontDirection,
      leftRightDirection,
      upDirection,
      targetPoint,
      upperMidpoint,
      lowerMidpoint,
    } = this.modelOrientation;
    let cameraPosition: THREE.Vector3;
    let viewTarget: THREE.Vector3;
    let distance: number;

    // 根据视角计算相机位置和观察目标
    switch (viewKey) {
      case 'full': {
        // 前双颌视图：相机从正前方观察，观察双颌中心
        upperMesh.visible = true;
        lowerMesh.visible = true;
        upperMeshLabel.visible = true;
        lowerMeshLabel.visible = true;

        // 使用实际可见mesh计算精确中心
        const viewInfo = this.calculateViewCenter([upperMesh, lowerMesh]);
        viewTarget = viewInfo.center;
        distance = viewInfo.distance;
        cameraPosition = viewTarget.clone().add(frontDirection.clone().multiplyScalar(distance));
        break;
      }

      case 'upper': {
        // 前上颌视图：相机从正前方观察，观察上颌中心
        upperMesh.visible = true;
        upperMeshLabel.visible = true;

        // 使用上颌mesh的精确中心
        const viewInfo = this.calculateViewCenter([upperMesh]);
        viewTarget = viewInfo.center;
        distance = viewInfo.distance;
        cameraPosition = viewTarget.clone().add(frontDirection.clone().multiplyScalar(distance));
        break;
      }

      case 'lower': {
        // 前下颌视图：相机从正前方观察，观察下颌中心
        lowerMesh.visible = true;
        lowerMeshLabel.visible = true;

        // 使用下颌mesh的精确中心
        const viewInfo = this.calculateViewCenter([lowerMesh]);
        viewTarget = viewInfo.center;
        distance = viewInfo.distance;
        cameraPosition = viewTarget.clone().add(frontDirection.clone().multiplyScalar(distance));
        break;
      }

      case 'upper_angle': {
        // 上颌斜视图：从前下方往上看，观察上颌中心（增加倾斜角度）
        upperMesh.visible = true;
        upperMeshLabel.visible = true;

        // 使用上颌mesh的精确中心
        const viewInfo = this.calculateViewCenter([upperMesh]);
        viewTarget = viewInfo.center;
        cameraPosition = viewTarget
          .clone()
          .add(frontDirection.clone().multiplyScalar(50))
          .add(upDirection.clone().multiplyScalar(-130));
        break;
      }

      case 'lower_angle': {
        // 下颌斜视图：从前上方往下看，观察下颌中心（增加倾斜角度）
        lowerMesh.visible = true;
        lowerMeshLabel.visible = true;

        // 使用下颌mesh的精确中心
        const viewInfo = this.calculateViewCenter([lowerMesh]);
        viewTarget = viewInfo.center;
        cameraPosition = viewTarget
          .clone()
          .add(frontDirection.clone().multiplyScalar(50))
          .add(upDirection.clone().multiplyScalar(130));
        break;
      }

      case 'left': {
        // 左双颌视图：相机从患者左侧观察，观察双颌中心
        upperMesh.visible = true;
        upperMeshLabel.visible = true;
        lowerMesh.visible = true;
        lowerMeshLabel.visible = true;

        // 使用双颌mesh的精确中心
        const viewInfo = this.calculateViewCenter([upperMesh, lowerMesh]);
        viewTarget = viewInfo.center;
        distance = viewInfo.distance;
        // 左侧 = leftRightDirection 的反方向
        cameraPosition = viewTarget
          .clone()
          .add(leftRightDirection.clone().multiplyScalar(-distance));
        break;
      }

      case 'right': {
        // 右双颌视图：相机从患者右侧观察，观察双颌中心
        upperMesh.visible = true;
        upperMeshLabel.visible = true;
        lowerMesh.visible = true;
        lowerMeshLabel.visible = true;

        // 使用双颌mesh的精确中心
        const viewInfo = this.calculateViewCenter([upperMesh, lowerMesh]);
        viewTarget = viewInfo.center;
        distance = viewInfo.distance;
        // 右侧 = leftRightDirection 的正方向
        cameraPosition = viewTarget
          .clone()
          .add(leftRightDirection.clone().multiplyScalar(distance));
        break;
      }

      default: {
        viewTarget = targetPoint.clone();
        distance = 150;
        cameraPosition = viewTarget.clone().add(frontDirection.clone().multiplyScalar(distance));
      }
    }

    // 设置相机位置和朝向
    this.camera.position.copy(cameraPosition);
    this.camera.lookAt(viewTarget);

    // 更新OrbitControls的目标点并更新
    if (this.controls) {
      this.controls.target.copy(viewTarget);
      this.controls.update();
    }
  }

  /**
   * 处理窗口大小变化
   */
  handleResize(): void {
    if (!this.container || !this.camera || !this.renderer) return;

    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  /**
   * 基于前方向对模型三角面进行投影分析，找出最靠前面的几何中心
   * @param mesh 要分析的网格模型
   * @param frontDirection 前方向向量
   * @param topPercent 取前X%的三角面（默认10%）
   * @returns 最靠前面的几何中心点
   */
  private getFrontFaceCenter(
    mesh: THREE.Mesh,
    frontDirection: THREE.Vector3,
    topPercent = 0.1,
  ): THREE.Vector3 | null {
    const geometry = mesh.geometry;
    if (!geometry || !geometry.attributes.position) {
      return null;
    }

    const positions = geometry.attributes.position;
    const vertexCount = positions.count;

    // 存储每个三角面的信息
    interface FaceInfo {
      center: THREE.Vector3; // 三角面中心
      projection: number; // 在前方向上的投影值
      vertices: THREE.Vector3[]; // 三角面的三个顶点
    }

    const faces: FaceInfo[] = [];

    // 遍历所有三角面
    for (let i = 0; i < vertexCount; i += 3) {
      // 获取三角面的三个顶点
      const v1 = new THREE.Vector3(positions.getX(i), positions.getY(i), positions.getZ(i));
      const v2 = new THREE.Vector3(
        positions.getX(i + 1),
        positions.getY(i + 1),
        positions.getZ(i + 1),
      );
      const v3 = new THREE.Vector3(
        positions.getX(i + 2),
        positions.getY(i + 2),
        positions.getZ(i + 2),
      );

      // 应用模型的世界变换
      v1.applyMatrix4(mesh.matrixWorld);
      v2.applyMatrix4(mesh.matrixWorld);
      v3.applyMatrix4(mesh.matrixWorld);

      // 计算三角面中心
      const center = new THREE.Vector3()
        .add(v1)
        .add(v2)
        .add(v3)
        .multiplyScalar(1 / 3);

      // 计算中心点在前方向上的投影
      const projection = center.dot(frontDirection);

      faces.push({
        center,
        projection,
        vertices: [v1, v2, v3],
      });
    }

    if (faces.length === 0) {
      return null;
    }

    // 按投影值降序排序（投影值越大，越靠前）
    faces.sort((a, b) => b.projection - a.projection);

    // 取前X%的三角面
    const topCount = Math.max(1, Math.floor(faces.length * topPercent));
    const topFaces = faces.slice(0, topCount);

    // 计算这些三角面所有顶点的几何中心
    const allVertices: THREE.Vector3[] = [];
    topFaces.forEach(face => {
      allVertices.push(...face.vertices);
    });

    const geometricCenter = new THREE.Vector3();
    allVertices.forEach(v => geometricCenter.add(v));
    geometricCenter.multiplyScalar(1 / allVertices.length);

    return geometricCenter;
  }

  /**
   * 计算两条线段的交点（或最近点对的中点）
   * 在3D空间中，两条线可能不相交（异面线），此时返回最近点对的中点
   * @param line1Start 线段1的起点
   * @param line1End 线段1的终点
   * @param line2Start 线段2的起点
   * @param line2End 线段2的终点
   * @returns 交点或最近点对的中点
   */
  private calculateLinesIntersection(
    line1Start: THREE.Vector3,
    line1End: THREE.Vector3,
    line2Start: THREE.Vector3,
    line2End: THREE.Vector3,
  ): THREE.Vector3 {
    // 线段1的方向向量
    const dir1 = new THREE.Vector3().subVectors(line1End, line1Start);
    // 线段2的方向向量
    const dir2 = new THREE.Vector3().subVectors(line2End, line2Start);
    // 连接两线段起点的向量
    const w0 = new THREE.Vector3().subVectors(line1Start, line2Start);

    // 计算参数
    const a = dir1.dot(dir1); // 线段1方向的长度平方
    const b = dir1.dot(dir2); // 两方向的点积
    const c = dir2.dot(dir2); // 线段2方向的长度平方
    const d = dir1.dot(w0);
    const e = dir2.dot(w0);

    const denominator = a * c - b * b;

    // 如果分母接近0，说明两线段平行
    if (Math.abs(denominator) < 0.0001) {
      // 平行情况：返回两线段中点的中点
      const mid1 = new THREE.Vector3().addVectors(line1Start, line1End).multiplyScalar(0.5);
      const mid2 = new THREE.Vector3().addVectors(line2Start, line2End).multiplyScalar(0.5);
      return new THREE.Vector3().addVectors(mid1, mid2).multiplyScalar(0.5);
    }

    // 计算两线段最近点的参数
    const t1 = (b * e - c * d) / denominator;
    const t2 = (a * e - b * d) / denominator;

    // 限制参数在[0,1]范围内（确保在线段上而不是延长线上）
    const clampedT1 = Math.max(0, Math.min(1, t1));
    const clampedT2 = Math.max(0, Math.min(1, t2));

    // 计算两线段上最近的两个点
    const closestPoint1 = new THREE.Vector3()
      .copy(line1Start)
      .add(dir1.clone().multiplyScalar(clampedT1));
    const closestPoint2 = new THREE.Vector3()
      .copy(line2Start)
      .add(dir2.clone().multiplyScalar(clampedT2));

    // 返回最近点对的中点
    return new THREE.Vector3().addVectors(closestPoint1, closestPoint2).multiplyScalar(0.5);
  }

  /**
   * 根据前牙位置自动调整相机，让FDI 11、21、31、41正对相机
   * @param toothCenters 牙齿中心点数据 {fdi: number, center: THREE.Vector3}[]
   */
  adjustCameraToFaceFrontTeeth(toothCenters: { fdi: number; center: THREE.Vector3 }[]): void {
    if (!toothCenters || toothCenters.length === 0) {
      console.warn('无法调整相机：牙齿中心点数据为空');
      return;
    }

    // 查找上颌中切牙 FDI 11 和 21
    const tooth11 = toothCenters.find(t => t.fdi === 11);
    const tooth21 = toothCenters.find(t => t.fdi === 21);
    // 查找下颌中切牙 FDI 31 和 41
    const tooth31 = toothCenters.find(t => t.fdi === 31);
    const tooth41 = toothCenters.find(t => t.fdi === 41);
    // 查找上颌后牙 FDI 16 和 26
    const tooth16 = toothCenters.find(t => t.fdi === 16);
    const tooth26 = toothCenters.find(t => t.fdi === 26);

    if (!tooth11 || !tooth21) {
      console.warn('无法调整相机：未找到FDI 11或21号牙');
      return;
    }

    // 步骤1：计算初步的左右方向和前方向
    // 综合上下颌的信息，避免单颌倾斜导致的偏差

    // Z轴方向（垂直方向）
    const upDirection = new THREE.Vector3(0, 0, 1);

    // 计算上颌11-21连线的方向
    // FDI: 11=右上中切牙(患者右侧), 21=左上中切牙(患者左侧)
    // 从21到11：从患者左侧到右侧
    const upper1121 = new THREE.Vector3().subVectors(tooth11.center, tooth21.center).normalize();

    // 计算与11-21垂直的方向：11-21 × up
    const upperPerp = new THREE.Vector3().crossVectors(upper1121, upDirection).normalize();

    // 如果有下颌数据，同时考虑下颌的方向
    let frontDirection: THREE.Vector3;
    let leftRightDirection: THREE.Vector3;

    if (tooth31 && tooth41) {
      // 计算下颌31-41连线的方向
      // FDI: 31=右下中切牙(患者右侧), 41=左下中切牙(患者左侧)
      // 从41到31：从患者左侧到右侧
      const lower3141 = new THREE.Vector3().subVectors(tooth31.center, tooth41.center).normalize();

      // 计算与31-41垂直的方向：31-41 × up
      const lowerPerp = new THREE.Vector3().crossVectors(lower3141, upDirection).normalize();

      // 取上下颌垂直方向的平均（更稳定）
      const avgPerp = new THREE.Vector3().addVectors(upperPerp, lowerPerp).normalize();

      // 取上下颌11-21和31-41连线的平均方向
      const avg1121 = new THREE.Vector3().addVectors(upper1121, lower3141).normalize();

      // 根据实际测试，交换前方向和左右方向的定义
      // 前方向 = 11-21连线的方向（从左到右）
      frontDirection = avg1121.clone();

      // 左右方向 = 垂直于11-21连线的方向
      leftRightDirection = avgPerp.clone();

      // 确保方向是水平的（去除Z分量，避免倾斜）
      frontDirection.z = 0;
      frontDirection.normalize();
      leftRightDirection.z = 0;
      leftRightDirection.normalize();
    } else {
      // 只有上颌数据时，交换方向
      frontDirection = upper1121.clone();
      leftRightDirection = upperPerp.clone();

      // 确保方向是水平的（去除Z分量，避免倾斜）
      frontDirection.z = 0;
      frontDirection.normalize();
      leftRightDirection.z = 0;
      leftRightDirection.normalize();
    }

    // 步骤2：使用后牙验证和修正前方向
    // （保留原有的方向验证逻辑...）
    const frontTeethFDIs = [11, 21, 12, 22, 13, 23, 31, 41, 32, 42, 33, 43];
    const backTeethFDIs = [
      14, 15, 16, 17, 18, 24, 25, 26, 27, 28, 34, 35, 36, 37, 38, 44, 45, 46, 47, 48,
    ];

    const frontTeeth = toothCenters.filter(t => frontTeethFDIs.includes(t.fdi));
    const backTeeth = toothCenters.filter(t => backTeethFDIs.includes(t.fdi));

    let needsFlip = false;
    if (frontTeeth.length > 0 && backTeeth.length > 0) {
      const frontAvg =
        frontTeeth.reduce((sum, t) => sum + t.center.dot(frontDirection), 0) / frontTeeth.length;
      const backAvg =
        backTeeth.reduce((sum, t) => sum + t.center.dot(frontDirection), 0) / backTeeth.length;

      if (frontAvg < backAvg) {
        needsFlip = true;
      }
    }

    if (needsFlip) {
      frontDirection.negate();
    }

    // 步骤3：基于前方向对模型进行投影分析，找出最靠前面的几何中心
    const meshes = this.renderContext.getAllMeshes();

    // 分析上颌模型
    let upperFrontCenter: THREE.Vector3 | null = null;
    if (meshes.upperMesh) {
      upperFrontCenter = this.getFrontFaceCenter(meshes.upperMesh, frontDirection, 0.05);
    }

    // 分析下颌模型
    let lowerFrontCenter: THREE.Vector3 | null = null;
    if (meshes.lowerMesh) {
      lowerFrontCenter = this.getFrontFaceCenter(meshes.lowerMesh, frontDirection, 0.05);
    }

    // 步骤4：计算最终的观察目标点
    // 使用牙齿中心点作为上下颌单独展示的基准，使用投影分析结果作为整体观察目标
    const upperToothMidpoint = new THREE.Vector3()
      .addVectors(tooth11.center, tooth21.center)
      .multiplyScalar(0.5);

    let lowerToothMidpoint: THREE.Vector3 | null = null;
    if (tooth31 && tooth41) {
      lowerToothMidpoint = new THREE.Vector3()
        .addVectors(tooth31.center, tooth41.center)
        .multiplyScalar(0.5);
    }

    // 计算整体观察目标（用于双颌视图）
    let targetPoint: THREE.Vector3;
    if (upperFrontCenter && lowerFrontCenter) {
      targetPoint = new THREE.Vector3()
        .addVectors(upperFrontCenter, lowerFrontCenter)
        .multiplyScalar(0.5);
    } else if (lowerToothMidpoint && tooth31 && tooth41) {
      targetPoint = this.calculateLinesIntersection(
        tooth11.center,
        tooth31.center,
        tooth21.center,
        tooth41.center,
      );
    } else {
      targetPoint = upperToothMidpoint.clone();
      console.warn('⚠️ 使用上颌前牙中点作为观察目标');
    }

    // 步骤5：强化左右方向验证（使用16和26号牙）
    if (tooth16 && tooth26) {
      // 计算从16号牙（右侧）到26号牙（左侧）的向量
      const tooth16to26 = new THREE.Vector3()
        .subVectors(tooth26.center, tooth16.center)
        .normalize();

      // 检查leftRightDirection和tooth16to26的点积
      // 如果点积为负，说明方向相反，需要翻转
      const dotProduct = leftRightDirection.dot(tooth16to26);
      if (dotProduct < 0) {
        leftRightDirection.negate();
      } else {
      }
    }

    // 步骤6：调整相机位置并确保水平对齐
    const cameraDistance = 150;

    // 将相机放置在前方向的延长线上
    const cameraPosition = new THREE.Vector3()
      .copy(targetPoint)
      .add(frontDirection.clone().multiplyScalar(cameraDistance));

    // 设置相机位置和朝向
    this.camera.position.copy(cameraPosition);
    this.camera.lookAt(targetPoint);

    // 调整相机的up向量，确保11-21连线在视觉上是水平的
    // 计算相机的右方向（应该与leftRightDirection对齐）
    const cameraRight = new THREE.Vector3().crossVectors(frontDirection, upDirection).normalize();

    // 如果leftRightDirection和cameraRight方向相反，翻转leftRightDirection
    if (cameraRight.dot(leftRightDirection) < 0) {
      leftRightDirection.negate();
    }

    // 保存模型朝向信息，用于后续视角切换
    // 注意：使用牙齿中心点作为上下颌单独展示的基准
    this.modelOrientation = {
      frontDirection: frontDirection.clone(),
      leftRightDirection: leftRightDirection.clone(),
      upDirection: upDirection.clone(),
      targetPoint: targetPoint.clone(),
      upperMidpoint: upperToothMidpoint.clone(),
      lowerMidpoint: lowerToothMidpoint ? lowerToothMidpoint.clone() : null,
    };

    // 初始化 OrbitControls（在模型居中和朝向调整之后）
    this.initOrbitControls();

    // 设置控制器的目标点
    if (this.controls) {
      this.controls.target.copy(targetPoint);
      this.controls.update();
    }
  }

  /**
   * 翻转相机180度（围绕观察目标旋转）
   * 用于修正自动调整方向不准确的情况
   */
  flipCameraDirection(): void {
    if (!this.controls) {
      console.warn('⚠️ TrackballControls 尚未初始化');
      return;
    }

    // 获取当前相机位置和目标点
    const currentPosition = this.camera.position.clone();
    const target = this.controls.target.clone();

    // 计算从目标到相机的向量
    const toCamera = new THREE.Vector3().subVectors(currentPosition, target);

    // 翻转方向（围绕目标旋转180度）
    toCamera.negate();

    // 设置新的相机位置
    const newPosition = new THREE.Vector3().addVectors(target, toCamera);
    this.camera.position.copy(newPosition);
    this.camera.lookAt(target);

    // 更新控制器
    this.controls.update();
  }

  /**
   * 获取场景对象
   */
  getScene(): THREE.Scene {
    return this.scene;
  }

  /**
   * 获取相机对象
   */
  getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  /**
   * 获取渲染器对象
   */
  getRenderer(): THREE.WebGLRenderer {
    return this.renderer;
  }

  /**
   * 获取控制器对象
   */
  getControls(): TrackballControls | null {
    return this.controls;
  }

  /**
   * 获取渲染上下文
   */
  getRenderContext(): RenderContext {
    return this.renderContext;
  }

  /**
   * 清理资源
   */
  dispose(): void {
    this.stopAnimation();

    // 清理控制器
    if (this.controls) {
      this.controls.dispose();
      this.controls = null;
    }

    // 清理拖拽控制器
    if (this.dragControls) {
      this.dragControls.dispose();
      this.dragControls = null;
    }

    this.clearDraggableObjects();
    this.renderContext.dispose();

    // 从DOM中移除渲染器canvas
    if (this.container && this.renderer.domElement) {
      this.container.removeChild(this.renderer.domElement);
    }

    // 重置单例
    SceneManager.instance = null;
  }
}
