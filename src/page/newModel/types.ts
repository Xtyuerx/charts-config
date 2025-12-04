import type * as THREE from 'three'

/**
 * 牙齿质心点数据类型
 */
export interface ToothCenterPoint {
  fdi: number
  type: string
  type_cn: string
  point: [number, number, number]
}

/**
 * 牙齿质心点数据集合
 */
export interface TeethPointsData {
  teeth_points: ToothCenterPoint[]
}

/**
 * 视角标签项
 */
export interface ViewLabel {
  label: string
  isShow: boolean
  type: number
  key: 'full' | 'upper' | 'lower' | 'upper_angle' | 'lower_angle' | 'left' | 'right'
}

/**
 * 牙齿编号到中心点的映射
 */
export type ToothCentersMap = Record<number, THREE.Vector3>

/**
 * 控制点数据
 */
export interface ControlPointData {
  id: number
  position: THREE.Vector3
  t?: number
  jaw?: string
}

/**
 * 牙齿宽度和中心数据
 */
export interface ToothWidthData {
  width: number
  center: THREE.Vector3
}

/**
 * STL 模型 URL 配置
 */
export interface STLModelsConfig {
  upper: string
  upper_only_tooth: string
  lower: string
  lower_only_tooth: string
}

/**
 * Bolton 分析 - 牙齿边界点
 */
export interface BoltonToothPoint {
  fdi: number
  type: 'boundary_mesial' | 'boundary_distal'
  type_cn: string
  point: [number, number, number]
}

/**
 * Bolton 分析数据
 */
export interface BoltonAnalysisData {
  teeth_points: BoltonToothPoint[]
  measurements: {
    front_ratio_percent?: number
    all_ratio_percent?: number
    width?: Record<string, number>
    [key: string]: any
  }
}

/**
 * 病理诊断结果
 */
export interface PathologyResult {
  task_name: string
  diagnosis_result: any
}

/**
 * 完整的诊断数据
 */
export interface DiagnosisData {
  pathology_results: PathologyResult[]
}
