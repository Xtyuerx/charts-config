import type { ColumnDef, ChartDataItem } from './types'
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
