import type { G2Spec, Encode, LegendComponent, ViewComposition, GaugeMark } from '@antv/g2'

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

export type OptionFields = {
  text: string // 数据源文本
  label: string // 数据源标签
  key: string // 数据源键
  value: number | string // 数据源值
  type?: 'count' | 'value' // 数据源类型 count: 计数类型 value: 值类型
}

export interface Props {
  visible: boolean // 是否显示
  config?: ChartConfig // 图表配置
  dataSource?: ChartDataItem[] // 数据源
  dataSourceFields?: OptionFields[] // 数据源下拉
  xAxisFields?: OptionFields[] // 横轴下拉
  yAxisFields?: OptionFields[] // 纵轴下拉
}

export type ChartDataItem = Record<string, unknown>

export type ChartStatus = 'loading' | 'success' | 'error'

export interface ChartConfig {
  id?: string // 图表id
  title?: string // 图表标题
  type: ChartMainType
  subType: ChartSubType // 图表子类型
  /* 主题 */
  theme?: string | number // 主题颜色
  xField: string // 横轴字段
  categorySort?: 'asc' | 'desc' // 分类排序
  valueFields: string[] // 值字段
  categoryField?: string // 分类字段
  expandDuplicates?: boolean // 是否展开重复数据
  dataSource?: number | string // 数据源
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
  name: ChartMainType // 图表主类型
  label: string // 图表主类型标签
  icon: T // 图表主类型图标
}

export interface CheckedChartTypeItem {
  label: string // 图表子类型标签
  imageURL: string // 图表子类型图标
  name: ChartSubType // 图表子类型
}

export interface ColumnDef {
  prop: string // 列属性
  label?: string // 列标签
  type?: string // 列类型
}

// G2 v5 声明式配置结构
export type ChartSpec = G2Spec & {
  buildEncode?: (cfg: ChartConfig) => Encode // 构建编码
  buildChildren?: (cfg: ChartConfig) => ViewComposition['children'] // 构建子视图
  legend?: G2Spec['legend'] // 图例
  children?: ViewComposition['children'] // 子视图
  encode?: Encode // 编码
  labels?: GaugeMark['labels'] // 标签
}
