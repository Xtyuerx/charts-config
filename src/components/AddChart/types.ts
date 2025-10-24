export type ChartType = 'bar' | 'line' | 'pie'

export interface ChartConfig {
  title: string
  type: ChartType
  colors: string[]
  showLegend: boolean
  xTitle?: string
  yTitle?: string
  legend: {
    show: boolean
    position: 'top' | 'bottom' | 'left' | 'right' | 'right-top'
  }
  label: {
    show: boolean
    position: 'center' | 'inside' | 'outside' | 'inner'
  }
  xAxis: {
    show: boolean
    title?: string
  }
  yAxis: {
    show: boolean
    title?: string
    min?: number
    max?: number
    interval?: number
    tickCount?: number
  }
  grid: {
    show: boolean
  }
}

export interface ChartTypeItem<T> {
  name: ChartType
  label: string
  icon: T
}

export interface CheckedChartTypeItem {
  label: string
  imageURL: string
  name: CheckedChartType
}

export interface ChartDataItem {
  [key: string]: string | number
}

export type CheckedChartType =
  | 'bar_group'
  | 'bar_stacked'
  | 'bar_percent'
  | 'line'
  | 'line_smooth'
  | 'pie'
  | 'pie_donut'

export interface ColumnDef {
  prop: string
  label?: string
}

// G2 v5 声明式配置结构
export interface ChartSpec {
  type?: string
  data?: ChartDataItem[]
  title?: string
  legend?: Record<string, unknown> | boolean
  coordinate?: Record<string, unknown>
  encode?: Record<string, string>
  transform?: { type: string; [key: string]: unknown }[]
  style?: Record<string, unknown>
  axis?: Record<string, unknown> | boolean
  tooltip?: Record<string, unknown> | boolean
  children?: ChartSpec[]
}
