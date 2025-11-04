import { CURRENT_CHART_MAP } from './constants'
import type { ColumnDef, ChartDataItem, ChartMainType, ChartSubType } from './types'
export function injectColumnTypes(columns: ColumnDef[], tableData: ChartDataItem[]): ColumnDef[] {
  if (!Array.isArray(columns) || columns.length === 0) return []
  if (!Array.isArray(tableData) || tableData.length === 0) return columns

  const firstRow = tableData[0]

  return columns.map((col) => {
    const value = firstRow?.[col.prop]
    const type = Array.isArray(value) ? 'array' : typeof value
    return { ...col, type }
  })
}

// 生成唯一图表ID
export function generateChartId(): string {
  return `chart_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

// 在columns中寻找series字段
export function findSeriesField(columns: ColumnDef[], key: string[]): ColumnDef[] | void {
  return columns.filter((col) => key.includes(col.prop))
}

// 通过图表子类型subType获取图表类型type
export function getChartTypeBySubType(subType: ChartSubType): ChartMainType | void {
  return Object.keys(CURRENT_CHART_MAP).find((key) =>
    CURRENT_CHART_MAP[key as ChartMainType].some((item) => item.name === subType),
  ) as ChartMainType | void
}
