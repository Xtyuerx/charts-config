import type * as THREE from 'three'

// ==================== 基础数据类型 ====================

/**
 * 牙齿点位数据
 */
export interface ToothPoint {
  fdi: number
  type: string
  type_cn: string
  point: [number, number, number]
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
 * STL 模型 URL 配置
 */
export interface STLModelsConfig {
  upper: string
  upper_only_tooth: string
  lower: string
  lower_only_tooth: string
}

// ==================== 策略模式相关类型 ====================

/**
 * 渲染类型分类
 */
export type RenderType = 'LABEL_ONLY' | 'POINT_ONLY' | 'POINT_LINE' | 'POINT_SLICE' | 'POINT_CURVE'

/**
 * 渲染上下文 - 包含3D场景核心对象
 */
export interface RenderContext {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  upperMesh: THREE.Mesh | null
  lowerMesh: THREE.Mesh | null
  upperMeshLabel: THREE.Mesh | null
  lowerMeshLabel: THREE.Mesh | null
  centersUpper: Record<number, THREE.Vector3> | null // 上颌牙齿中心点
  centersLower: Record<number, THREE.Vector3> | null // 下颌牙齿中心点
}

/**
 * 分析数据结构（从JSON中提取）
 */
export interface AnalysisData {
  teeth_points: ToothPoint[]
  measurements: Record<string, unknown>
  [key: string]: unknown // 支持扩展字段
}

/**
 * 分析策略配置
 */
export interface StrategyConfig {
  id: string
  name: string
  taskName: string
  renderType: RenderType
  radioValue: string // 对应UI按钮的value
}

/**
 * 病理诊断结果
 */
export interface PathologyResult {
  task_name: string
  diagnosis_result: AnalysisData
}

/**
 * 完整的诊断数据
 */
export interface DiagnosisData {
  pathology_results: PathologyResult[]
  basic_algorithm_info?: {
    upper_stl: string
    lower_stl: string
    upper_only_tooth_stl: string
    lower_only_tooth_stl: string
    [key: string]: unknown
  }
}

/**
 * 响应数据
 */

export interface ResponseData {
  success: boolean
  data: DiagnosisData
}

// ==================== 渲染器配置类型 ====================

/**
 * 点渲染器配置
 */
export interface PointRendererOptions {
  color?: number
  size?: number
  opacity?: number
  label?: string
  showLabel?: boolean
}

/**
 * 线渲染器配置
 */
export interface LineRendererOptions {
  color?: number
  lineWidth?: number
  dashed?: boolean
  dashSize?: number
  gapSize?: number
  showArrows?: boolean
  showLabel?: boolean
  labelText?: string
}

/**
 * 标签渲染器配置
 */
export interface LabelRendererOptions {
  fontSize?: number
  fontColor?: string
  backgroundColor?: string
  padding?: number
  borderRadius?: number
  position?: THREE.Vector3
}

/**
 * 切片渲染器配置
 */
export interface SliceRendererOptions {
  color?: number
  opacity?: number
  width?: number
  height?: number
  showBorder?: boolean
}

// ==================== 测量面板数据类型 ====================

/**
 * 测量项
 */
export interface MeasurementItem {
  name: string
  value: string | number
  result: string
}

/**
 * 测量组
 */
export interface MeasurementGroup {
  groupName: string
  children: MeasurementItem[]
}
