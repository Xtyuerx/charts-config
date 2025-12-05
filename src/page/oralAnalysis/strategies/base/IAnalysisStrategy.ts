import type { AnalysisData, RenderContext, RenderType, MeasurementGroup } from '../../types'

/**
 * 分析策略基接口
 * 定义所有分析策略必须实现的方法
 */
export interface IAnalysisStrategy {
  // ==================== 元数据 ====================
  readonly id: string // 策略唯一标识，如 'bolton'
  readonly name: string // 显示名称，如 'Bolton分析'
  readonly taskName: string // JSON中的task_name
  readonly renderType: RenderType // 渲染类型分类

  // ==================== 生命周期方法 ====================
  /**
   * 初始化策略
   * @param context 渲染上下文
   */
  init(context: RenderContext): void

  /**
   * 渲染分析结果
   * @param data 分析数据
   */
  render(data: AnalysisData): void

  /**
   * 更新动画（可选）
   * @param deltaTime 时间增量
   */
  update(deltaTime: number): void

  /**
   * 切换显示/隐藏
   * @param visible 是否可见
   */
  toggle(visible: boolean): void

  /**
   * 清理资源
   */
  cleanup(): void

  // ==================== 数据获取 ====================
  /**
   * 获取测量数据（用于右侧面板展示）
   */
  getMeasurementData(): MeasurementGroup[]

  /**
   * 是否可见
   */
  isVisible(): boolean
}
