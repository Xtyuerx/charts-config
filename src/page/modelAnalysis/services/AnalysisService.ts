import type { RenderContext, AnalysisData, DiagnosisData } from '../types';
import type { IAnalysisStrategy } from '../strategies/base/IAnalysisStrategy';
import { AnalysisStrategyFactory } from '../factories/AnalysisStrategyFactory';
import { MidlineAnalysisStrategy } from '../strategies/MidlineAnalysisStrategy';
import { CrowdingAnalysisStrategy } from '../strategies/CrowdingAnalysisStrategy';
import { SceneManager } from '../core/SceneManager';
import * as THREE from 'three';

/**
 * 分析服务协调器
 * 负责管理所有分析策略的生命周期和切换
 */
export class AnalysisService {
  private factory: AnalysisStrategyFactory;
  private currentStrategy: IAnalysisStrategy | null = null;
  private context!: RenderContext;
  private diagnosisData: DiagnosisData | null = null;
  private toothNumberData: AnalysisData | null = null; // 存储从点云标签提取的牙号数据

  constructor() {
    this.factory = AnalysisStrategyFactory.getInstance();
  }

  /**
   * 初始化服务
   * 创建所有策略并初始化
   */
  init(context: RenderContext): void {
    this.context = context;

    console.log('🎯 初始化分析服务...');

    // 初始化所有已注册的策略
    const configs = this.factory.getAllConfigs();
    configs.forEach(config => {
      const strategy = this.factory.create(config.taskName);
      if (strategy) {
        strategy.init(context);
        console.log(`  ✓ 策略初始化: ${config.name}`);
      }
    });

    console.log(`✅ 分析服务初始化完成，共${configs.length}个策略`);
  }

  /**
   * 加载诊断数据
   */
  loadData(diagnosisData: DiagnosisData): void {
    this.diagnosisData = diagnosisData;
    console.log(`📦 加载诊断数据: ${diagnosisData.pathology_results?.length || 0}个分析结果`);

    // 🔍 调试：打印所有可用的 task_name
    if (diagnosisData.pathology_results) {
      console.log('📋 可用的分析任务:');
      diagnosisData.pathology_results.forEach((result, index) => {});
    }
  }

  /**
   * 从已提取的牙齿中心点数据生成牙号数据
   * @param centersUpper - 上颌牙齿中心点映射
   * @param centersLower - 下颌牙齿中心点映射
   */
  loadToothNumbersFromCenters(
    centersUpper: Record<number, THREE.Vector3> | null,
    centersLower: Record<number, THREE.Vector3> | null,
  ): void {
    try {
      console.log(`📥 生成牙号数据...`);

      const teethPoints: Array<{
        fdi: number;
        type: string;
        type_cn: string;
        point: [number, number, number];
      }> = [];

      // 从上颌中心点生成数据
      if (centersUpper) {
        Object.entries(centersUpper).forEach(([fdi, center]) => {
          teethPoints.push({
            fdi: Number(fdi),
            type: 'center_tooth',
            type_cn: '牙齿质心',
            point: [center.x, center.y, center.z],
          });
        });
      }

      // 从下颌中心点生成数据
      if (centersLower) {
        Object.entries(centersLower).forEach(([fdi, center]) => {
          teethPoints.push({
            fdi: Number(fdi),
            type: 'center_tooth',
            type_cn: '牙齿质心',
            point: [center.x, center.y, center.z],
          });
        });
      }

      if (teethPoints.length === 0) {
        console.warn('⚠️ 未找到牙齿中心点数据');
        return;
      }

      // 按FDI排序
      teethPoints.sort((a, b) => a.fdi - b.fdi);

      // 计算统计数据
      const upperTeeth = teethPoints.filter(t => Math.floor(t.fdi / 10) <= 2);
      const lowerTeeth = teethPoints.filter(t => Math.floor(t.fdi / 10) >= 3);
      const totalTeeth = teethPoints.length;

      // 构造符合 AnalysisData 格式的数据
      this.toothNumberData = {
        teeth_points: teethPoints as never[],
        measurements: {
          total_teeth: totalTeeth,
          upper_teeth: upperTeeth.length,
          lower_teeth: lowerTeeth.length,
          missing_teeth: this.findMissingTeeth(teethPoints.map(t => t.fdi)),
        },
      };

      console.log(
        `✅ 牙号数据已生成: ${totalTeeth}颗牙齿 (上颌${upperTeeth.length}, 下颌${lowerTeeth.length})`,
      );
      console.log(`   FDI编号: ${teethPoints.map(t => t.fdi).join(', ')}`);
    } catch (error) {
      console.error('❌ 生成牙号数据失败:', error);
    }
  }

  /**
   * 查找缺失的牙齿（标准32颗牙）
   */
  private findMissingTeeth(presentTeeth: number[]): number[] {
    const standardTeeth = [
      // 上颌
      11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 26, 27, 28,
      // 下颌
      31, 32, 33, 34, 35, 36, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48,
    ];

    return standardTeeth.filter(fdi => !presentTeeth.includes(fdi));
  }

  /**
   * 切换分析类型
   * @param taskName 任务名称（如 'bolton', 'overbite'）
   * @returns 是否切换成功
   */
  switchAnalysis(taskName: string): boolean {
    console.log(`🔄 切换分析: ${taskName}`);

    // 隐藏当前策略
    if (this.currentStrategy) {
      this.currentStrategy.toggle(false);
      console.log(`  ⊗ 隐藏当前策略: ${this.currentStrategy.name}`);
    }

    // 获取新策略
    const strategy = this.factory.create(taskName);
    if (!strategy) {
      console.warn(`❌ 未找到分析策略: ${taskName}`);
      return false;
    }

    // 提取对应数据
    const analysisData = this.extractAnalysisData(taskName);
    if (!analysisData) {
      console.warn(`❌ 未找到分析数据: ${taskName}`);
      return false;
    }

    // 渲染并显示
    strategy.render(analysisData);
    strategy.toggle(true);

    this.currentStrategy = strategy;
    console.log(`✅ 切换成功: ${strategy.name}`);

    // 如果是中线分析策略，注册可拖拽对象
    if (strategy instanceof MidlineAnalysisStrategy) {
      this.registerMidlineDraggableObjects(strategy);
    }

    // 如果是拥挤度分析策略，注册可拖拽对象
    if (strategy instanceof CrowdingAnalysisStrategy) {
      this.registerCrowdingDraggableObjects(strategy);
    }

    return true;
  }

  /**
   * 注册中线分析的可拖拽对象
   */
  private registerMidlineDraggableObjects(strategy: MidlineAnalysisStrategy): void {
    const draggableObjects = strategy.getDraggableObjects();

    if (draggableObjects.length > 0) {
      console.log(`🎯 注册${draggableObjects.length}个可拖拽控制点`);

      // 获取SceneManager实例并添加可拖拽对象
      const sceneManager = SceneManager.getInstance();

      draggableObjects.forEach(obj => {
        sceneManager.addDraggableObject(obj);
        obj.userData.draggable = true;
      });

      // 初始化拖拽控制（如果还没有初始化）
      sceneManager.setupDragControls();
    }
  }

  /**
   * 注册拥挤度分析的可拖拽对象
   */
  private registerCrowdingDraggableObjects(strategy: CrowdingAnalysisStrategy): void {
    const draggableObjects = strategy.getDraggableObjects();

    if (draggableObjects.length > 0) {
      console.log(`🎯 注册${draggableObjects.length}个可拖拽点位`);

      // 获取SceneManager实例并添加可拖拽对象
      const sceneManager = SceneManager.getInstance();

      draggableObjects.forEach(obj => {
        sceneManager.addDraggableObject(obj);
        obj.userData.draggable = true;
      });

      // 初始化拖拽控制（如果还没有初始化）
      sceneManager.setupDragControls();
    }
  }

  /**
   * 从完整数据中提取指定分析的数据
   */
  private extractAnalysisData(taskName: string): AnalysisData | null {
    // 特殊处理牙号分析：优先使用从点云标签加载的数据
    if (taskName === 'tooth-number' && this.toothNumberData) {
      console.log('📊 使用点云标签数据进行牙号分析');
      return this.toothNumberData;
    }

    if (!this.diagnosisData?.pathology_results) {
      console.warn('⚠️ 诊断数据未加载');
      return null;
    }

    const result = this.diagnosisData.pathology_results.find(r => r.task_name === taskName);

    if (!result) {
      console.warn(`⚠️ 未找到任务数据: ${taskName}`);
      console.warn(
        `📋 当前可用的任务: ${this.diagnosisData.pathology_results
          .map(r => r.task_name)
          .join(', ')}`,
      );
      return null;
    }

    return result.diagnosis_result;
  }

  /**
   * 获取当前测量数据（用于右侧面板展示）
   */
  getCurrentMeasurements() {
    return this.currentStrategy?.getMeasurementData() || null;
  }

  /**
   * 获取当前策略名称
   */
  getCurrentStrategyName(): string {
    return this.currentStrategy?.name || '';
  }

  /**
   * 切换当前分析的显示状态
   */
  toggleCurrentAnalysis(): void {
    if (this.currentStrategy) {
      const newState = !this.currentStrategy.isVisible();
      this.currentStrategy.toggle(newState);
      console.log(`👁️ ${this.currentStrategy.name} 可见性: ${newState ? '显示' : '隐藏'}`);
    }
  }

  /**
   * 清理所有资源
   */
  cleanup(): void {
    console.log('🧹 清理分析服务...');

    this.factory.getAllConfigs().forEach(config => {
      const strategy = this.factory.create(config.taskName);
      strategy?.cleanup();
    });

    this.currentStrategy = null;
    this.diagnosisData = null;

    console.log('✅ 分析服务清理完成');
  }

  /**
   * 获取所有可用的分析配置
   */
  getAvailableAnalyses() {
    return this.factory.getAllConfigs();
  }
}
