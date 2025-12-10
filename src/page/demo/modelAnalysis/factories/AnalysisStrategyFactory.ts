import type { IAnalysisStrategy } from '../strategies/base/IAnalysisStrategy'
import type { StrategyConfig, RenderType } from '../types'

// 导入具体策略
import { OverjetAnalysisStrategy } from '../strategies/OverjetAnalysisStrategy'
import { BoltonAnalysisStrategy } from '../strategies/BoltonAnalysisStrategy'
import { ToothNumberAnalysisStrategy } from '../strategies/ToothNumberAnalysisStrategy'
import { CrossbiteAnalysisStrategy } from '../strategies/CrossbiteAnalysisStrategy'
import { CrowdingAnalysisStrategy } from '../strategies/CrowdingAnalysisStrategy'
import { ArchWidthAnalysisStrategy } from '../strategies/ArchWidthAnalysisStrategy'
import { ToothGapAnalysisStrategy } from '../strategies/ToothGapAnalysisStrategy'
import { ArchSymmetryAnalysisStrategy } from '../strategies/ArchSymmetryAnalysisStrategy'
import { MidlineAnalysisStrategy } from '../strategies/MidlineAnalysisStrategy'
import { OcclusionAnalysisStrategy } from '../strategies/OcclusionAnalysisStrategy'
import { LowerCurveAnalysisStrategy } from '../strategies/LowerCurveAnalysisStrategy'
import { UpperCurveAnalysisStrategy } from '../strategies/UpperCurveAnalysisStrategy'
import { OverbiteAnalysisStrategy } from '../strategies/OverbiteAnalysisStrategy'

/**
 * 分析策略工厂（单例模式）
 * 负责注册和创建分析策略实例
 */
export class AnalysisStrategyFactory {
  private static instance: AnalysisStrategyFactory | null = null
  private strategies = new Map<string, IAnalysisStrategy>()
  private strategyConfigs: StrategyConfig[] = []

  private constructor() {
    // 私有构造函数，防止外部实例化
  }

  /**
   * 获取单例实例
   */
  static getInstance(): AnalysisStrategyFactory {
    if (!AnalysisStrategyFactory.instance) {
      AnalysisStrategyFactory.instance = new AnalysisStrategyFactory()
      AnalysisStrategyFactory.instance.registerAllStrategies()
    }
    return AnalysisStrategyFactory.instance
  }

  /**
   * 注册所有策略
   * ✅ 全部12个策略已实现完成
   */
  private registerAllStrategies(): void {
    const strategies: IAnalysisStrategy[] = [
      // ✅ 所有策略（按照UI顺序）
      new ToothNumberAnalysisStrategy(), // 1. 牙号
      new BoltonAnalysisStrategy(), // 2. Bolton分析
      new OverbiteAnalysisStrategy(), // 14. 深覆合分析
      new MidlineAnalysisStrategy(), // 3. 中线关系
      new OcclusionAnalysisStrategy(), // 4-5. 咬合关系（尖牙+磨牙）
      new ArchSymmetryAnalysisStrategy(), // 6. 牙弓对称性
      new CrowdingAnalysisStrategy(), // 7. 拥挤度
      new ArchWidthAnalysisStrategy(), // 8. 牙弓宽度
      new CrossbiteAnalysisStrategy(), // 9. 锁𬌗与反𬌗
      new ToothGapAnalysisStrategy(), // 10. 牙齿间隙
      new LowerCurveAnalysisStrategy(), // 11. Spee曲线
      new UpperCurveAnalysisStrategy(), // 12. 上颌补偿曲线
      new OverjetAnalysisStrategy(), // 13. 覆盖度分析
    ]

    strategies.forEach((strategy) => {
      this.register(strategy)
    })

    console.log(`📋 策略工厂初始化完成，已注册 ${strategies.length} 个策略`)
  }

  /**
   * 注册单个策略
   */
  register(strategy: IAnalysisStrategy): void {
    this.strategies.set(strategy.taskName, strategy)
    this.strategyConfigs.push({
      id: strategy.id,
      name: strategy.name,
      taskName: strategy.taskName,
      renderType: strategy.renderType,
      radioValue: this.strategyConfigs.length.toString(), // 自动生成radioValue
    })

    console.log(`  ✓ 注册策略: ${strategy.name} (${strategy.taskName})`)
  }

  /**
   * 根据taskName创建策略实例
   */
  create(taskName: string): IAnalysisStrategy | null {
    const strategy = this.strategies.get(taskName)
    if (!strategy) {
      console.warn(`⚠️ 未找到策略: ${taskName}`)
    }
    return strategy || null
  }

  /**
   * 获取所有策略配置
   */
  getAllConfigs(): StrategyConfig[] {
    return [...this.strategyConfigs]
  }

  /**
   * 根据渲染类型获取策略
   */
  getByRenderType(renderType: RenderType): IAnalysisStrategy[] {
    return Array.from(this.strategies.values()).filter((s) => s.renderType === renderType)
  }

  /**
   * 获取策略数量
   */
  getStrategyCount(): number {
    return this.strategies.size
  }

  /**
   * 重置工厂（用于测试）
   */
  static reset(): void {
    AnalysisStrategyFactory.instance = null
  }
}
