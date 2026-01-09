import * as THREE from 'three'
import type {
  AnalysisData,
  RenderContext,
  ToothPoint,
  MeasurementGroup,
  RenderType,
} from '../../types'
import { POINT_TYPE_COLORS, SCENE_CONFIG } from '../../constants'
import { createMiddleArchWire, type ArchWireResult } from '../../utils/ArchWireUtils'
import type { IAnalysisStrategy } from './IAnalysisStrategy'

/**
 * 分析策略抽象基类
 * 使用模板方法模式定义分析的渲染流程
 */
export abstract class BaseAnalysisStrategy implements IAnalysisStrategy {
  // ==================== 子类必须定义的元数据 ====================
  abstract readonly id: string
  abstract readonly name: string
  abstract readonly taskName: string
  abstract readonly renderType: RenderType

  // ==================== 受保护的属性 ====================
  protected context!: RenderContext // 渲染上下文
  protected group: THREE.Group // 该分析的所有3D对象容器（用于非标签元素）
  protected visible = false // 是否可见
  protected data: AnalysisData | null = null // 分析数据
  protected archWire: ArchWireResult | null = null // 牙弓线

  constructor() {
    this.group = new THREE.Group()
  }

  // ==================== 生命周期方法 ====================

  /**
   * 初始化策略
   * 创建Group并添加到场景中
   */
  init(context: RenderContext): void {
    this.context = context
    this.group.name = `${this.taskName}_group`
    this.group.visible = false
    context.scene.add(this.group)

    console.log(`✅ 策略初始化: ${this.name}`)
  }

  /**
   * 渲染流程（模板方法）
   * 定义了渲染的标准步骤，子类通过重写钩子方法来定制
   */
  render(data: AnalysisData): void {
    console.log(`🎨 开始渲染: ${this.name} (${this.renderType})`)

    // 清理旧对象
    this.cleanup()
    this.data = data

    // 1. 渲染点位（根据 renderType 决定是否渲染）
    const shouldRenderPoints = this.shouldRenderPoints()
    if (shouldRenderPoints && data.teeth_points && data.teeth_points.length > 0) {
      this.renderPoints(data.teeth_points)
    }

    // 2. 渲染特定元素（子类实现：线、面、曲线等）
    this.renderSpecificElements(data)

    // 3. 渲染测量标注（子类实现：数值、文字等）
    this.renderMeasurements(data.measurements)

    console.log(`✅ 渲染完成: ${this.name}, 对象数量: ${this.group.children.length}`)
  }

  /**
   * 动画更新（可选实现）
   * 默认不做任何事，子类可以重写来实现动画效果
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  update(_deltaTime: number): void {
    // 默认不实现动画
    // 子类如需要动画效果可重写此方法
  }

  /**
   * 切换显示/隐藏
   */
  toggle(visible: boolean): void {
    this.visible = visible
    this.group.visible = visible

    // 同时控制添加到 mesh 上的标签的可见性
    this.toggleMeshChildren(visible)

    console.log(`👁️ ${this.name} 可见性: ${visible}`)
  }

  /**
   * 切换 mesh 子对象的可见性（如标签）
   * 子类可以重写此方法来控制特定的 mesh 子对象
   */
  protected toggleMeshChildren(visible: boolean): void {
    // 默认实现：遍历所有 mesh 的子对象，找到策略创建的标签并切换可见性
    if (!this.context) return

    const meshes = [
      this.context.upperMesh,
      this.context.lowerMesh,
      this.context.upperMeshLabel,
      this.context.lowerMeshLabel,
    ].filter(Boolean) as THREE.Mesh[]

    console.log('meshes', meshes, this.taskName)

    meshes.forEach((mesh) => {
      mesh.children.forEach((child) => {
        // 根据 name 前缀识别是否为当前策略创建的对象
        if (child.name.startsWith(`${this.taskName}_`)) {
          child.visible = visible
        }
      })
    })
  }

  /**
   * 清理所有3D对象和资源
   */
  cleanup(): void {
    // 清理 group 中的对象
    while (this.group.children.length > 0) {
      const child = this.group.children[0]

      if (child) {
        this.group.remove(child)
      }

      // 释放几何体和材质
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose()

        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose())
        } else if (child.material) {
          child.material.dispose()
        }
      }

      // 释放线对象
      if (child instanceof THREE.Line) {
        child.geometry?.dispose()
        if (child.material && !Array.isArray(child.material)) {
          child.material.dispose()
        }
      }
    }

    // 清理添加到 mesh 上的标签
    this.cleanupMeshChildren()
  }

  /**
   * 清理添加到 mesh 上的子对象（如标签）
   */
  protected cleanupMeshChildren(): void {
    if (!this.context) return

    const meshes = [
      this.context.upperMesh,
      this.context.lowerMesh,
      this.context.upperMeshLabel,
      this.context.lowerMeshLabel,
    ].filter(Boolean) as THREE.Mesh[]

    meshes.forEach((mesh) => {
      // 收集需要删除的子对象
      const toRemove: THREE.Object3D[] = []
      mesh.children.forEach((child) => {
        if (child.name.startsWith(`${this.taskName}_`)) {
          toRemove.push(child)
        }
      })

      // 删除并释放资源
      toRemove.forEach((child) => {
        mesh.remove(child)

        // 释放 Sprite 的材质和纹理
        if (child instanceof THREE.Sprite) {
          const material = child.material as THREE.SpriteMaterial
          if (material.map) {
            material.map.dispose()
          }
          material.dispose()
        }
      })
    })
  }

  /**
   * 是否可见
   */
  isVisible(): boolean {
    return this.visible
  }

  /**
   * 获取测量数据（用于右侧面板）
   * 子类可重写此方法来格式化数据
   */
  getMeasurementData(): MeasurementGroup[] {
    if (!this.data?.measurements) return []

    // 默认实现：将measurements转换为简单的展示格式
    return this.formatMeasurements(this.data.measurements)
  }

  // ==================== 子类必须实现的抽象方法 ====================

  /**
   * 渲染特定元素（线、面、曲线等）
   * 子类必须实现
   */
  protected abstract renderSpecificElements(data: AnalysisData): void

  /**
   * 渲染测量标注
   * 子类必须实现
   */
  protected renderMeasurements(measurements?: Record<string, unknown>): void {
    // 默认实现：输出调试信息
    console.log(`${this.name}: renderMeasurements 未实现，跳过渲染`, measurements)
  }

  /**
   * 格式化测量数据为面板展示格式
   * 子类可重写来定制展示内容
   */
  protected abstract formatMeasurements(measurements: Record<string, unknown>): MeasurementGroup[]

  // ==================== 通用工具方法 ====================

  /**
   * 判断是否应该渲染点位球体
   * 根据 renderType 决定是否渲染点位
   * LABEL_ONLY 类型不渲染点位，只渲染标签
   */
  protected shouldRenderPoints(): boolean {
    return this.renderType.includes('POINT')
  }

  /**
   * 渲染点位标记
   */
  protected renderPoints(teethPoints: ToothPoint[]): void {
    const upperPoints = teethPoints.filter((p) => this.isUpper(p.fdi))
    const lowerPoints = teethPoints.filter((p) => this.isLower(p.fdi))

    this.createPointMarkers(upperPoints)
    this.createPointMarkers(lowerPoints)
  }

  /**
   * 创建点位标记（简化版渲染器）
   * 完整版在第四步的渲染器层实现
   */
  protected createPointMarkers(points: ToothPoint[]): void {
    console.log('createPointMarkers', points)
    const scale = 1.5 // SCENE_CONFIG.modelScale - 提前定义

    points.forEach((p) => {
      // 防御性检查：确保 point 数据存在且有效
      if (!p.point || !Array.isArray(p.point) || p.point.length < 3) {
        console.warn(`⚠️ 跳过无效点位数据: FDI=${p.fdi}, type=${p.type}, point=`, p.point)
        return
      }

      // 检查坐标值是否为有效数字
      if (
        typeof p.point[0] !== 'number' ||
        typeof p.point[1] !== 'number' ||
        typeof p.point[2] !== 'number' ||
        isNaN(p.point[0]) ||
        isNaN(p.point[1]) ||
        isNaN(p.point[2])
      ) {
        console.warn(`⚠️ 跳过无效坐标值: FDI=${p.fdi}, type=${p.type}, point=`, p.point)
        return
      }

      console.log('p', p.point[0], p.point[1], p.point[2], p)
      const color = this.getPointColor(p.type)

      // 创建球体作为点标记
      const geometry = new THREE.SphereGeometry(0.5, 16, 16)
      const material = new THREE.MeshPhongMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.3,
      })
      const sphere = new THREE.Mesh(geometry, material)

      // 设置位置（考虑缩放）
      sphere.position.set(p.point[0] * scale, p.point[1] * scale, p.point[2] * scale)
      sphere.name = `point_${p.fdi}_${p.type}`

      this.group.add(sphere)
    })
  }

  /**
   * 根据点位类型获取颜色
   */
  protected getPointColor(type: string): number {
    return POINT_TYPE_COLORS[type] || 0xffffff
  }

  /**
   * 判断是否为上颌牙齿
   * FDI系统：11-18（右上）、21-28（左上）
   */
  protected isUpper(fdi: number): boolean {
    return (fdi >= 11 && fdi <= 18) || (fdi >= 21 && fdi <= 28)
  }

  /**
   * 判断是否为下颌牙齿
   * FDI系统：31-38（左下）、41-48（右下）
   */
  protected isLower(fdi: number): boolean {
    return (fdi >= 31 && fdi <= 38) || (fdi >= 41 && fdi <= 48)
  }

  /**
   * 创建简单的文本标签（临时实现）
   * 完整版在渲染器层实现
   */
  protected createSimpleLabel(
    text: string,
    position: THREE.Vector3,
    color = '#ffffff',
  ): THREE.Sprite {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建canvas context')

    canvas.width = 256
    canvas.height = 128

    context.fillStyle = color
    context.font = '48px Arial'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(text, 128, 64)

    const texture = new THREE.CanvasTexture(canvas)
    const material = new THREE.SpriteMaterial({ map: texture })
    const sprite = new THREE.Sprite(material)

    sprite.position.copy(position)
    sprite.scale.set(4, 2, 1)

    return sprite
  }

  /**
   * 创建不缩放的线（用于添加到 mesh 的元素）
   * @param start 起点坐标（原始坐标，不应用缩放）
   * @param end 终点坐标（原始坐标，不应用缩放）
   * @param color 线条颜色
   * @param lineWidth 线条宽度
   */
  protected createLineUnscaled(
    start: number[] | THREE.Vector3,
    end: number[] | THREE.Vector3,
    color = 0x00ff00,
    lineWidth = 2,
  ): THREE.Line {
    // 转换为 Vector3（不应用缩放）
    const startVec = Array.isArray(start)
      ? new THREE.Vector3(start[0], start[1], start[2])
      : start.clone()

    const endVec = Array.isArray(end) ? new THREE.Vector3(end[0], end[1], end[2]) : end.clone()

    // 创建几何体
    const points = [startVec, endVec]
    const geometry = new THREE.BufferGeometry().setFromPoints(points)

    // 创建材质
    const material = new THREE.LineBasicMaterial({
      color,
      linewidth: lineWidth,
    })

    const line = new THREE.Line(geometry, material)
    line.name = 'unscaled_line'

    return line
  }

  /**
   * 计算两点中点（不应用缩放，用于添加到 mesh 的元素）
   */
  protected getMidPointUnscaled(p1: number[], p2: number[]): THREE.Vector3 {
    return new THREE.Vector3(
      ((p1[0] ?? 0) + (p2[0] ?? 0)) / 2,
      ((p1[1] ?? 0) + (p2[1] ?? 0)) / 2,
      ((p1[2] ?? 0) + (p2[2] ?? 0)) / 2,
    )
  }

  /**
   * 计算两点中点（应用缩放，用于添加到 group 的元素）
   */
  protected getMidPoint(p1: number[], p2: number[]): THREE.Vector3 {
    const scale = 1.5 // SCENE_CONFIG.modelScale
    return new THREE.Vector3(
      (((p1[0] ?? 0) + (p2[0] ?? 0)) / 2) * scale,
      (((p1[1] ?? 0) + (p2[1] ?? 0)) / 2) * scale,
      (((p1[2] ?? 0) + (p2[2] ?? 0)) / 2) * scale,
    )
  }

  // ==================== 方案2: 直接添加到 Mesh 的辅助方法 ====================

  /**
   * 添加对象到对应的 mesh
   * 对象会成为 mesh 的子对象，自动跟随 mesh 的可见性
   * @param object 要添加的 3D 对象
   * @param fdi 牙齿的 FDI 号码
   */
  protected addToMesh(object: THREE.Object3D, fdi: number): void {
    const isUpper = this.isUpper(fdi)
    const targetMesh = isUpper ? this.context.upperMeshLabel : this.context.lowerMeshLabel

    if (!targetMesh) {
      console.warn(`⚠️ 目标 mesh 不存在: ${isUpper ? '上颌' : '下颌'}，FDI: ${fdi}`)
      return
    }

    // 设置名称前缀，方便后续识别和清理
    if (!object.name.startsWith(this.taskName)) {
      object.name = `${this.taskName}_${object.name || 'object'}`
    }

    // 设置渲染顺序和深度测试，确保测量元素始终可见
    object.renderOrder = 999 // 使用很大的值，确保在最后渲染

    // 遍历所有子对象，设置材质属性
    object.traverse((child) => {
      child.renderOrder = 999

      // 对于有材质的对象，禁用深度测试，确保不被遮挡
      if ('material' in child) {
        const material = (child as THREE.Mesh | THREE.Line | THREE.Sprite).material
        if (material) {
          if (Array.isArray(material)) {
            material.forEach((mat) => {
              mat.depthTest = false // 禁用深度测试，始终显示在前面
              mat.depthWrite = false // 不写入深度缓冲
              mat.transparent = true // 启用透明，避免完全遮挡其他元素
            })
          } else {
            material.depthTest = false
            material.depthWrite = false
            material.transparent = true
          }
        }
      }
    })

    targetMesh.add(object)
  }

  /**
   * 智能添加线到对应的 mesh
   * 根据连接的两个牙齿的 FDI 号码自动判断应该添加到哪里
   * @param line 要添加的线对象
   * @param fdi1 第一个牙齿的 FDI 号码
   * @param fdi2 第二个牙齿的 FDI 号码
   */
  protected addLineToMesh(line: THREE.Object3D, fdi1: number, fdi2: number): void {
    const isUpper1 = this.isUpper(fdi1)
    const isUpper2 = this.isUpper(fdi2)

    // 如果两个点都在同一个颌，添加到对应的 mesh
    if (isUpper1 && isUpper2) {
      this.addToMesh(line, fdi1)
    } else if (!isUpper1 && !isUpper2) {
      this.addToMesh(line, fdi1)
    } else {
      // 跨颌的线（如咬合关系），添加到主 group
      if (!line.name.startsWith(this.taskName)) {
        line.name = `${this.taskName}_${line.name || 'cross_jaw'}`
      }
      this.group.add(line)
    }
  }

  /**
   * 批量添加对象到对应的 mesh
   * @param objects 要添加的对象数组
   * @param fdi 牙齿的 FDI 号码（决定添加到哪个 mesh）
   */
  protected addMultipleToMesh(objects: THREE.Object3D[], fdi: number): void {
    objects.forEach((obj) => this.addToMesh(obj, fdi))
  }

  /**
   * 根据颌过滤点位数据
   * @param points 所有点位数据
   * @param jaw 'upper' | 'lower' | 'both'
   */
  protected filterPointsByJaw(points: ToothPoint[], jaw: 'upper' | 'lower' | 'both'): ToothPoint[] {
    if (jaw === 'both') return points

    return points.filter((p) => {
      return jaw === 'upper' ? this.isUpper(p.fdi) : this.isLower(p.fdi)
    })
  }

  /**
   * 将点位数据分组为上下颌
   */
  protected splitPointsByJaw(points: ToothPoint[]): {
    upper: ToothPoint[]
    lower: ToothPoint[]
  } {
    return {
      upper: points.filter((p) => this.isUpper(p.fdi)),
      lower: points.filter((p) => this.isLower(p.fdi)),
    }
  }

  /**
   * 计算多个点的中心位置（不缩放，用于添加到 mesh）
   * @param points 点坐标数组
   * @returns 中心点坐标（不缩放）
   */
  protected calculatePointsCenterUnscaled(points: number[][]): THREE.Vector3 {
    const sum = points.reduce(
      (acc, p) => {
        acc.x += p[0] || 0
        acc.y += p[1] || 0
        acc.z += p[2] || 0
        return acc
      },
      { x: 0, y: 0, z: 0 },
    )

    return new THREE.Vector3(sum.x / points.length, sum.y / points.length, sum.z / points.length)
  }

  /**
   * 创建球体标记（不缩放，用于添加到 mesh）
   * @param position 位置向量（不缩放）
   * @param color 颜色
   * @param radius 半径
   * @param opacity 不透明度
   * @returns 球体 Mesh
   */
  protected createSphereMarker(
    position: THREE.Vector3,
    color: number,
    radius = 0.8,
    opacity = 0.8,
  ): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(radius, 16, 16)
    const material = new THREE.MeshPhongMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.3,
      transparent: true,
      opacity,
    })
    const sphere = new THREE.Mesh(geometry, material)
    sphere.position.copy(position)
    return sphere
  }
  /**
   * 获取完整的诊断数据（包含所有分析任务）
   * @returns 完整的诊断数据，如果不可用则返回 null
   */
  protected getCompleteDiagnosisData(): import('../../types').DiagnosisData | null {
    // 方法1: 通过 context 获取（如果已经添加到 RenderContext）
    if (this.context && 'diagnosisData' in this.context) {
      return (this.context as any).diagnosisData || null
    }

    // 方法2: 通过 AnalysisService 单例获取（如果实现了单例模式）
    // 注意：这需要 AnalysisService 实现单例模式或提供静态方法

    console.warn('⚠️ 无法获取完整的诊断数据，请确保已正确配置数据访问')
    return null
  }

  /**
   * 获取指定任务的分析数据
   * @param taskName 任务名称
   * @returns 指定任务的分析数据，如果不存在则返回 null
   */
  protected getAnalysisDataByTaskName(taskName: string): import('../../types').AnalysisData | null {
    const completeDiagnosisData = this.getCompleteDiagnosisData()
    if (!completeDiagnosisData?.pathology_results) {
      return null
    }

    const result = completeDiagnosisData.pathology_results.find((r) => r.task_name === taskName)
    return result?.diagnosis_result || null
  }

  /**
   * 获取所有可用的分析任务数据
   * @returns 所有分析任务的数据映射
   */
  protected getAllAnalysisData(): Record<string, import('../../types').AnalysisData> {
    const completeDiagnosisData = this.getCompleteDiagnosisData()
    const result: Record<string, import('../../types').AnalysisData> = {}

    if (completeDiagnosisData?.pathology_results) {
      completeDiagnosisData.pathology_results.forEach((pathologyResult) => {
        if (pathologyResult.task_name && pathologyResult.diagnosis_result) {
          result[pathologyResult.task_name] = pathologyResult.diagnosis_result
        }
      })
    }

    return result
  }

  /**
   * 创建牙弓线
   * 优先使用 teeth_points 数据（来自拥挤度分析），否则使用模型提取的中心点
   */
  protected createArchWire(teethPoints?: ToothPoint[]): void {
    const scale = SCENE_CONFIG.modelScale

    // 🔑 获取拥挤度分析数据
    const crowdingData = this.getAnalysisDataByTaskName('tooth-crowding-degree')
    console.log('拥挤度分析数据:', crowdingData)

    // 🔑 优先使用拥挤度分析的 teeth_points（如果可用）
    let pointsToUse = teethPoints
    if (!pointsToUse && crowdingData?.teeth_points) {
      pointsToUse = crowdingData.teeth_points
      console.log('✅ 使用拥挤度分析的 teeth_points 数据创建牙弓线')
    }

    if (!pointsToUse || pointsToUse.length === 0) {
      console.warn('⚠️ 没有可用的点位数据，无法创建牙弓线')
      return
    }

    // 🔑 直接使用坐标点创建牙弓线，不计算中心点
    this.archWire = this.createArchWireFromPoints(pointsToUse, scale)
    console.log('牙弓线:', this.archWire)

    if (!this.archWire) {
      console.warn('⚠️ 牙弓线创建失败')
      return
    }

    console.log('✅ 牙弓线创建成功')

    // 添加到场景
    this.group.add(this.archWire.group)
  }
  /**
   * 直接使用坐标点创建牙弓线（投射到平面后）
   * @param teethPoints 牙齿点位数据
   * @param scale 缩放比例
   * @returns 牙弓线结果对象
   */
  private createArchWireFromPoints(
    teethPoints: ToothPoint[],
    scale: number,
  ): ArchWireResult | null {
    // 🔑 第一步：计算平面的Z轴位置（使用31和41号牙的平均值）
    const planeZ = this.calculatePlaneZ(teethPoints, scale)
    if (planeZ === null) {
      console.warn('⚠️ 无法确定平面Z轴位置，使用原始Z轴坐标')
    }

    // 过滤下颌点位并按 FDI 排序
    const lowerPoints = teethPoints
      .filter((p) => this.isLower(p.fdi))
      .sort((a, b) => {
        // 下颌排序：右侧 48->47->...->41，然后左侧 31->32->...->38
        if (a.fdi >= 41 && a.fdi <= 48 && b.fdi >= 41 && b.fdi <= 48) {
          return b.fdi - a.fdi // 右侧降序
        }
        if (a.fdi >= 31 && a.fdi <= 38 && b.fdi >= 31 && b.fdi <= 38) {
          return a.fdi - b.fdi // 左侧升序
        }
        if (a.fdi >= 41 && a.fdi <= 48 && b.fdi >= 31 && b.fdi <= 38) {
          return -1 // 右侧在前
        }
        if (a.fdi >= 31 && a.fdi <= 38 && b.fdi >= 41 && b.fdi <= 48) {
          return 1 // 左侧在后
        }
        return a.fdi - b.fdi
      })

    if (lowerPoints.length < 2) {
      console.warn('⚠️ 下颌点位数量不足，无法创建牙弓线')
      return null
    }

    // 🔑 第二步：收集所有有效的点位并投射到平面上
    const archPoints: THREE.Vector3[] = []
    const pointsWithFDI: Array<{ point: THREE.Vector3; fdi: number }> = [] // 保存点位和对应的FDI

    lowerPoints.forEach((toothPoint) => {
      // 防御性检查
      if (toothPoint.point && typeof toothPoint.point === 'string') {
        toothPoint.point = JSON.parse(toothPoint.point)
      }
      if (!toothPoint.point || !Array.isArray(toothPoint.point) || toothPoint.point.length < 3) {
        console.warn(`⚠️ 跳过无效点位: FDI=${toothPoint.fdi}`, toothPoint.point)
        return
      }

      // 检查坐标值是否有效
      const [x, y, z] = toothPoint.point
      if (
        typeof x !== 'number' ||
        typeof y !== 'number' ||
        typeof z !== 'number' ||
        isNaN(x) ||
        isNaN(y) ||
        isNaN(z)
      ) {
        console.warn(`⚠️ 跳过无效坐标: FDI=${toothPoint.fdi}`, toothPoint.point)
        return
      }

      // 应用缩放
      const scaledPoint = new THREE.Vector3(x * scale, y * scale, z * scale)

      // 🔑 投射到平面：如果有有效的planeZ，则使用它；否则保持原Z轴
      const projectedPoint =
        planeZ !== null ? this.projectPointToPlaneZ(scaledPoint, planeZ) : scaledPoint

      archPoints.push(projectedPoint)
      pointsWithFDI.push({ point: projectedPoint, fdi: toothPoint.fdi })
    })

    if (archPoints.length < 2) {
      console.warn('⚠️ 有效点位数量不足，无法创建牙弓线')
      return null
    }

    console.log(
      `✅ 点位投射完成，投射点数量: ${archPoints.length}，平面Z轴: ${planeZ?.toFixed(2) || '未设置'}`,
    )

    // 🔑 第三步：使用投射后的点创建平滑曲线
    const curve = new THREE.CatmullRomCurve3(archPoints)
    curve.closed = false
    curve.curveType = 'catmullrom' // 使用 catmullrom 类型可以创建更平滑的曲线
    curve.tension = 0.5 // 张力参数，值越小曲线越平滑

    // 创建组
    const archGroup = new THREE.Group()
    archGroup.name = 'projected_arch_wire_group'

    // 创建管道几何体
    const tubeGeometry = new THREE.TubeGeometry(
      curve,
      200, // 分段数
      0.25, // 管道半径
      8, // 径向分段
      false,
    )

    const material = new THREE.MeshStandardMaterial({
      color: '#00CED1', // 青色
      roughness: 1.0,
      metalness: 0.0,
      depthTest: false,
      transparent: true,
      opacity: 1.0,
    })

    const tubeMesh = new THREE.Mesh(tubeGeometry, material)
    tubeMesh.renderOrder = 999
    tubeMesh.name = 'projected_arch_wire'
    archGroup.add(tubeMesh)
    // 🔑 第四步：添加点位标记（可视化投射后的点）
    pointsWithFDI.forEach(({ point, fdi }) => {
      // 创建球体标记
      const sphereGeometry = new THREE.SphereGeometry(0.4, 16, 16)
      const sphereMaterial = new THREE.MeshPhongMaterial({
        color: 0xff6b6b, // 红色，便于区分
        emissive: 0xff6b6b,
        emissiveIntensity: 0.3,
        transparent: true,
        opacity: 0.8,
        depthTest: false,
      })
      const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial)
      sphere.position.copy(point)
      sphere.renderOrder = 1000 // 确保在牙弓线之上
      sphere.name = `arch_point_${fdi}`
      archGroup.add(sphere)
    })
    return {
      group: archGroup,
      curve,
      tubeMesh,
      controlPoints: [],
    }
  }
  /**
   * 计算平面的Z轴位置（使用31和41号牙的Z轴平均值）
   * @param teethPoints 牙齿点位数据
   * @param scale 缩放比例
   * @returns 平面的Z轴坐标，如果找不到31或41号牙则返回null
   */
  private calculatePlaneZ(teethPoints: ToothPoint[], scale: number): number | null {
    // 查找31号牙和41号牙
    const tooth31 = teethPoints.find((p) => p.fdi === 31)
    const tooth41 = teethPoints.find((p) => p.fdi === 41)

    // 防御性检查
    const getValidZ = (tooth: ToothPoint | undefined): number | null => {
      if (!tooth) return null

      let point = tooth.point
      if (typeof point === 'string') {
        point = JSON.parse(point)
      }

      if (!Array.isArray(point) || point.length < 3) return null

      const z = point[2]
      if (typeof z !== 'number' || isNaN(z)) return null

      return z * scale
    }

    const z31 = getValidZ(tooth31)
    const z41 = getValidZ(tooth41)

    // 如果两个都有，取平均值
    if (z31 !== null && z41 !== null) {
      const avgZ = (z31 + z41) / 2
      console.log(
        `✅ 使用31号牙(Z=${z31.toFixed(2)})和41号牙(Z=${z41.toFixed(2)})的平均值作为平面Z轴: ${avgZ.toFixed(2)}`,
      )
      return avgZ
    }

    // 如果只有一个，使用那个
    if (z31 !== null) {
      console.log(`⚠️ 只找到31号牙，使用其Z轴: ${z31.toFixed(2)}`)
      return z31
    }

    if (z41 !== null) {
      console.log(`⚠️ 只找到41号牙，使用其Z轴: ${z41.toFixed(2)}`)
      return z41
    }

    console.warn('⚠️ 未找到31号牙或41号牙，无法确定平面Z轴位置')
    return null
  }
  /**
   * 将点投射到指定Z轴的平面上
   * @param point 原始点
   * @param planeZ 平面的Z轴坐标
   * @returns 投射后的点（X、Y不变，Z设置为planeZ）
   */
  private projectPointToPlaneZ(point: THREE.Vector3, planeZ: number): THREE.Vector3 {
    return new THREE.Vector3(point.x, point.y, planeZ)
  }
}
