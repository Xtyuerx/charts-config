import type { G2Spec, Encode } from '@antv/g2'

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
  config: ChartConfig
  dataSource: {
    label: string
    value: number
    tableData: ChartDataItem[]
    columns: ColumnDef[]
  }[]
}

export type ChartDataItem = Record<string, unknown>
export interface ChartConfig {
  title?: string
  type: ChartMainType
  subType: ChartSubType
  theme: string
  categoryField: string
  categorySort?: 'asc' | 'desc'
  valueFields: string[]
  colorField?: string
  dataSource: number
  legend: {
    show: boolean
    position: 'top' | 'bottom' | 'left' | 'right' | 'top-right'
  }
  label: {
    show: boolean
    position: 'center' | 'inner' | 'outer' | 'inside'
  }
  yAxis: {
    show: boolean
    title?: string
    min?: number
    max?: number
    tickCount?: number
    interval?: number
  }
  xAxis: {
    show: boolean
    title?: string
  }
  grid: {
    show: boolean
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
  legend?: G2Spec['legend']
}
