import type { TeethPointsData } from '../types'
import { countToothLabels } from './geometryUtils'

/**
 * 加载牙齿标签点云数据
 * @returns Promise with labels data
 */
export async function loadJsonPoints(): Promise<{
  labelsUpper: number[]
  labelsLower: number[]
}> {
  try {
    const [upperJson, lowerJson] = await Promise.all([
      fetch('/points/upper.json').then((r) => r.json()),
      fetch('/points/lower.json').then((r) => r.json()),
    ])

    const labelsUpper = upperJson.labels || []
    const labelsLower = lowerJson.labels || []

    console.log(`上颌labels数量: ${labelsUpper.length}`)
    console.log(`下颌labels数量: ${labelsLower.length}`)

    const upperToothCounts = countToothLabels(labelsUpper)
    const lowerToothCounts = countToothLabels(labelsLower)

    console.log('上颌牙齿分布:', upperToothCounts)
    console.log('下颌牙齿分布:', lowerToothCounts)

    return { labelsUpper, labelsLower }
  } catch (error) {
    console.error('加载JSON点位数据失败:', error)
    return { labelsUpper: [], labelsLower: [] }
  }
}

/**
 * 加载牙齿质心点数据
 * @returns Promise with teeth center points
 */
export async function loadTeethCenterPoints() {
  try {
    const response = await fetch('/points/teeth_centers.json')
    const data: TeethPointsData = await response.json()

    console.log('牙齿质心点数据:', data.teeth_points)
    return data.teeth_points
  } catch (error) {
    console.error('加载牙齿质心点数据失败:', error)
    return null
  }
}

/**
 * 加载诊断数据（包含 Bolton 等多种分析）
 * @param jsonUrl JSON 文件路径
 * @returns 诊断数据
 */
export async function loadDiagnosisData(jsonUrl: string): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(jsonUrl)
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    const data = await response.json()
    console.log(`已加载诊断数据，包含 ${data.pathology_results?.length || 0} 项分析`)
    return data
  } catch (error) {
    console.error(`加载诊断数据失败: ${jsonUrl}`, error)
    throw error
  }
}

/**
 * 从诊断数据中提取 Bolton 分析数据
 * @param diagnosisData 完整的诊断数据
 * @returns Bolton 分析数据，如果不存在则返回 null
 */
export function extractBoltonData(
  diagnosisData: Record<string, unknown>,
): Record<string, unknown> | null {
  if (!diagnosisData?.pathology_results) {
    return null
  }

  const pathologyResults = diagnosisData.pathology_results as Array<Record<string, unknown>>
  const boltonResult = pathologyResults.find((result) => result.task_name === 'bolton')

  if (!boltonResult?.diagnosis_result) {
    console.warn('未找到 Bolton 分析数据')
    return null
  }

  const diagnosisResult = boltonResult.diagnosis_result as Record<string, unknown>
  console.log('已提取 Bolton 数据:', {
    牙齿数量: (diagnosisResult.teeth_points as unknown[])?.length || 0,
    宽度数据: Object.keys((diagnosisResult.measurements as Record<string, unknown>)?.width || {})
      .length,
  })

  return diagnosisResult
}
