import * as THREE from 'three'
import type {
  AnalysisData,
  RenderContext,
  ToothPoint,
  MeasurementGroup,
  RenderType,
} from '../../types'
import type { IAnalysisStrategy } from './IAnalysisStrategy'
import { POINT_TYPE_COLORS } from '../../constants'

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
  protected group: THREE.Group // 该分析的所有3D对象容器
  protected visible = false // 是否可见
  protected data: AnalysisData | null = null // 分析数据

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
    console.log(`🎨 开始渲染: ${this.name}`)

    // 清理旧对象
    this.cleanup()
    this.data = data

    // 1. 渲染点位（所有策略都需要）
    if (data.teeth_points && data.teeth_points.length > 0) {
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
    console.log(`👁️ ${this.name} 可见性: ${visible}`)
  }

  /**
   * 清理所有3D对象和资源
   */
  cleanup(): void {
    // 递归清理所有子对象
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
  protected abstract renderMeasurements(measurements: Record<string, unknown>): void

  /**
   * 格式化测量数据为面板展示格式
   * 子类可重写来定制展示内容
   */
  protected abstract formatMeasurements(measurements: Record<string, unknown>): MeasurementGroup[]

  // ==================== 通用工具方法 ====================

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
    points.forEach((p) => {
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
      const scale = 1.5 // SCENE_CONFIG.modelScale
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
   */
  protected isUpper(fdi: number): boolean {
    return fdi >= 11 && fdi <= 28
  }

  /**
   * 判断是否为下颌牙齿
   */
  protected isLower(fdi: number): boolean {
    return fdi >= 31 && fdi <= 48
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
   * 计算两点中点
   */
  protected getMidPoint(p1: number[], p2: number[]): THREE.Vector3 {
    const scale = 1.5 // SCENE_CONFIG.modelScale
    return new THREE.Vector3(
      (((p1[0] ?? 0) + (p2[0] ?? 0)) / 2) * scale,
      (((p1[1] ?? 0) + (p2[1] ?? 0)) / 2) * scale,
      (((p1[2] ?? 0) + (p2[2] ?? 0)) / 2) * scale,
    )
  }
}
