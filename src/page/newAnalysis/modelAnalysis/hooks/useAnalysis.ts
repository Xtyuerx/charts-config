import { ref, onUnmounted } from 'vue'
import type * as THREE from 'three'
import { AnalysisService } from '../services/AnalysisService'
import type { RenderContext, MeasurementGroup, ResponseData, DiagnosisData } from '../types'

/**
 * 分析管理 Hook
 * 封装分析任务的切换、数据管理等功能
 */
export function useAnalysis() {
  const analysisService = new AnalysisService()

  const currentAnalysisName = ref<string>('')
  const measurementData = ref<MeasurementGroup[] | null>(null)
  const isAnalysisVisible = ref(false)
  const error = ref<string | null>(null)

  /**
   * 初始化分析系统
   */
  const initAnalysis = (context: RenderContext) => {
    try {
      analysisService.init(context)
      console.log('✅ 分析系统初始化完成')
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '分析系统初始化失败'
      error.value = errorMsg
      console.error('❌ 分析系统初始化失败:', err)
      throw err
    }
  }

  /**
   * 加载诊断数据
   */
  const loadDiagnosisData = async (jsonUrl: string) => {
    try {
      console.log(`📥 加载诊断数据: ${jsonUrl}`)
      const response = await fetch(jsonUrl)
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      const data: ResponseData = await response.json()

      // 🔍 详细打印数据结构
      console.log('📊 诊断数据结构:', data)
      if (data) {
        Object.keys(data).forEach((taskName) => {
          const taskData = (data as Record<string, any>)[taskName]
          console.log(`  - ${taskName}:`, {
            hasMeasurements: !!taskData.measurements,
            hasTeethPoints: !!taskData.teeth_points,
            teethPointsCount: taskData.teeth_points?.length || 0,
            measurementKeys: taskData.measurements ? Object.keys(taskData.measurements) : [],
          })

          // 特别关注曲线数据
          if (taskName === 'upper-curve' || taskName === 'lower-curve') {
            console.log(`    🔵 ${taskName} 详细数据:`, {
              measurements: taskData.measurements,
              curve_data_exists: !!taskData.measurements?.curve_data,
              curve_data_length: taskData.measurements?.curve_data?.length || 0,
              curve_reference_teeth: taskData.measurements?.curve_reference_teeth,
            })
          }

          // 特别关注中线数据
          if (taskName === 'midline-deviation') {
            console.log(`    🔵 ${taskName} 详细数据:`, {
              measurements: taskData.measurements,
              upper: taskData.measurements?.upper,
              lower: taskData.measurements?.lower,
            })
          }
        })
      }

      analysisService.loadData(data as DiagnosisData)
      console.log('✅ 诊断数据加载完成')
      return data
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '诊断数据加载失败'
      error.value = errorMsg
      console.error('❌ 诊断数据加载失败:', err)
      throw err
    }
  }

  /**
   * 从已提取的牙齿中心点生成牙号数据
   */
  const loadToothNumbersFromCenters = (
    centersUpper: Record<number, THREE.Vector3> | null,
    centersLower: Record<number, THREE.Vector3> | null,
  ) => {
    try {
      console.log(`📊 生成牙号数据...`)
      analysisService.loadToothNumbersFromCenters(centersUpper, centersLower)
      console.log('✅ 牙号数据生成完成')
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '牙号数据生成失败'
      error.value = errorMsg
      console.error('❌ 牙号数据生成失败:', err)
      throw err
    }
  }

  /**
   * 切换到指定分析
   */
  const switchTo = (taskName: string) => {
    try {
      const success = analysisService.switchAnalysis(taskName)

      if (success) {
        currentAnalysisName.value = analysisService.getCurrentStrategyName()
        measurementData.value = analysisService.getCurrentMeasurements()
        isAnalysisVisible.value = true
        error.value = null
        console.log(`✅ 切换成功: ${currentAnalysisName.value}`)
      } else {
        error.value = `切换失败: ${taskName}`
        console.warn(`⚠️ 切换失败: ${taskName}`)
      }

      return success
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '分析切换失败'
      error.value = errorMsg
      console.error('❌ 分析切换失败:', err)
      return false
    }
  }

  /**
   * 切换当前分析的显示/隐藏
   */
  const toggleDisplay = () => {
    analysisService.toggleCurrentAnalysis()
    isAnalysisVisible.value = !isAnalysisVisible.value
  }

  /**
   * 获取所有可用的分析类型
   */
  const getAvailableAnalyses = () => {
    return analysisService.getAvailableAnalyses()
  }

  /**
   * 获取当前任务的 task_name
   */
  const getCurrentTaskName = () => {
    return analysisService.getCurrentTaskName()
  }

  /**
   * 获取当前任务更新后的点位数据
   */
  const getCurrentUpdatedPoints = () => {
    return analysisService.getCurrentUpdatedPoints()
  }

  /**
   * 清理资源
   */
  const cleanup = () => {
    analysisService.cleanup()
    currentAnalysisName.value = ''
    measurementData.value = null
    isAnalysisVisible.value = false
    error.value = null
    console.log('🧹 分析系统资源已清理')
  }

  // 组件卸载时自动清理
  onUnmounted(() => {
    cleanup()
  })

  return {
    // 状态
    currentAnalysisName,
    measurementData,
    isAnalysisVisible,
    error,

    // 方法
    initAnalysis,
    loadDiagnosisData,
    loadToothNumbersFromCenters,
    switchTo,
    toggleDisplay,
    getAvailableAnalyses,
    getCurrentTaskName,
    getCurrentUpdatedPoints,
    cleanup,
  }
}
