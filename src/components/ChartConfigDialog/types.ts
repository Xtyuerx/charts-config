import type { G2Spec, Encode, LegendComponent, ViewComposition } from '@antv/g2'

export type LabelComponent =
  | 'top'
  | 'left'
  | 'right'
  | 'bottom'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'inside'

export type ChartMainType = 'bar' | 'line' | 'pie'
export type ChartSubType =
  | 'bar_group'
  | 'bar_stacked'
  | 'bar_percent'
  | 'line'
  | 'line_smooth'
  | 'pie'
  | 'pie_donut'

export interface Props {
  visible: boolean
  config?: ChartConfig
  dataSource: {
    label: string
    value: number
    tableData: ChartDataItem[]
    columns: ColumnDef[]
  }[]
}

export type ChartDataItem = Record<string, unknown>
export interface ChartConfig {
  id?: string // 图表id
  title?: string // 图表标题
  type: ChartMainType
  subType: ChartSubType // 图表子类型
  /* 主题 */
  theme?: {
    name: string // 主题名称
    colors: string[] // 主题颜色
  }
  xField: string // 横轴字段
  categorySort?: 'asc' | 'desc' // 分类排序
  valueFields: string[] // 值字段
  categoryField?: string // 分类字段
  dataSource: number // 数据源
  /* 图例 */
  legend: {
    show: boolean // 是否显示
    position: LegendComponent['position'] // 图例位置
  }
  /* 标签 */
  label: {
    show: boolean // 是否显示
    position: LabelComponent // 标签位置
  }
  /* 纵轴 */
  yAxis: {
    show: boolean // 是否显示
    title?: string // 纵轴标题
    min?: number // 纵轴最小值
    max?: number // 纵轴最大值
    tickCount?: number // 纵轴刻度
    interval?: number // 纵轴间隔
  }
  /* 横轴 */
  xAxis: {
    show: boolean // 是否显示
    title?: string // 横轴标题
  }
  /* 网格 */
  grid: {
    show: boolean // 是否显示
  }
}

export interface ChartTypeItem<T> {
  name: ChartMainType
  label: string
  icon: T
}

export interface CheckedChartTypeItem {
  label: string
  imageURL: string
  name: ChartSubType
}

export interface ColumnDef {
  prop: string
  label?: string
  type?: string
}

// G2 v5 声明式配置结构
export type ChartSpec = G2Spec & {
  buildEncode?: (cfg: ChartConfig) => Encode
  buildChildren?: (cfg: ChartConfig) => ViewComposition['children']
  legend?: G2Spec['legend']
  children?: ViewComposition['children']
}
