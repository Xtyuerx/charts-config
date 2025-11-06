// components/ChartConfigDialog/hooks/useChartRender.ts
import { ref, watch, onUnmounted, type Ref, unref } from 'vue'
import { Chart } from '@antv/g2'
import { COLOR_THEMES } from './constants'
import type {
  ChartConfig,
  ChartSubType,
  ChartSpec,
  ChartDataItem,
  OptionFields,
  ChartStatus,
} from './types'

// ---------------- 常量定义 ----------------
const PERCENT_FIELD = 'percent'
const PERCENT_DECIMAL_PLACES = 2
const SERIES_FIELD = 'series'
const VALUE_FIELD = 'value'

// ---------------- 子类型映射 ----------------
const subTypeMap: Record<ChartSubType, ChartSpec> = {
  // 柱状图
  bar_group: {
    type: 'interval',
    buildEncode: (cfg) => {
      // 多个纵轴值时，转换为长表格式并使用统一字段
      if (cfg.valueFields.length > 1) {
        return {
          x: cfg.xField,
          y: VALUE_FIELD,
          color: SERIES_FIELD,
        }
      }
      return {
        x: cfg.xField,
        y: cfg.valueFields[0],
      }
    },
    transform: (cfg) => {
      // 只有在多系列时才使用 dodgeX 转换，避免展开重复数据时被合并
      if (cfg.valueFields.length > 1) {
        return [{ type: 'dodgeX' }]
      }
      // 展开重复数据时，不使用任何转换，确保每个数据点都独立显示
      return []
    },
  },
  bar_stacked: {
    type: 'interval',
    buildEncode: (cfg) => {
      // 多个纵轴值时，转换为长表格式并使用统一字段
      if (cfg.valueFields.length > 1) {
        return {
          x: cfg.xField,
          y: VALUE_FIELD,
          color: SERIES_FIELD,
        }
      }
      return {
        x: cfg.xField,
        y: cfg.valueFields[0],
      }
    },
    transform: [{ type: 'stackY' }],
  },
  bar_percent: {
    type: 'interval',
    buildEncode: (cfg) => ({
      x: cfg.xField,
      y: PERCENT_FIELD,
      color: cfg.valueFields.length > 1 ? SERIES_FIELD : undefined,
    }),
    transform: [{ type: 'stackY' }],
  },

  // 折线图
  line: {
    type: 'view',
    buildEncode: (cfg) => {
      // 多个纵轴值时，转换为长表格式并使用统一字段
      if (cfg.valueFields.length > 1) {
        return {
          x: cfg.xField,
          y: VALUE_FIELD,
          color: SERIES_FIELD,
        }
      }
      return {
        x: cfg.xField,
        y: cfg.valueFields[0],
      }
    },
    style: { lineWidth: 2 },
    buildChildren: () => [{ type: 'line' }, { type: 'point', style: { fill: 'white' } }],
  },
  line_smooth: {
    type: 'view',
    buildEncode: (cfg) => {
      // 多个纵轴值时，转换为长表格式并使用统一字段
      if (cfg.valueFields.length > 1) {
        return {
          x: cfg.xField,
          y: VALUE_FIELD,
          color: SERIES_FIELD,
        }
      }
      return {
        x: cfg.xField,
        y: cfg.valueFields[0],
      }
    },
    buildChildren: () => [
      { type: 'line', style: { lineWidth: 2, shape: 'smooth' } },
      { type: 'point', style: { fill: 'white' } },
    ],
  },

  // 饼图
  pie: {
    type: 'interval',
    coordinate: { type: 'theta', innerRadius: 0 },
    buildEncode: (cfg) => ({
      y: PERCENT_FIELD,
      color: cfg.xField,
    }),
    transform: [{ type: 'stackY' }],
  },
  pie_donut: {
    type: 'interval',
    coordinate: { type: 'theta', innerRadius: 0.6 },
    buildEncode: (cfg) => ({
      y: PERCENT_FIELD,
      color: cfg.xField,
    }),
    transform: [{ type: 'stackY' }],
  },
}

/**
 * 获取默认图表数据
 */
const getDefaultChartData = (): ChartDataItem[] => {
  return [
    { genre: 'Sports', sold: 275 },
    { genre: 'Strategy', sold: 115 },
    { genre: 'Action', sold: 120 },
    { genre: 'Shooter', sold: 350 },
    { genre: 'Other', sold: 150 },
  ]
}

// ---------------- 辅助函数 ----------------
/**
 * 根据字段名从 columns 中获取对应的 label
 * @param field 字段名
 * @param columns 列定义数组
 * @returns 字段对应的 label，如果找不到则返回字段名本身
 */
const getFieldLabel = (field: string, columns?: OptionFields[]): string => {
  if (!columns || !Array.isArray(columns)) return field
  const column = columns.find((col) => col.value === field)
  return column?.label || field
}

/**
 * 判断字段是否为 count 类型
 * @param field 字段名
 * @param yFields 字段配置数组
 * @returns 是否为 count 类型
 */
const isCountField = (field: string, yFields?: OptionFields[]): boolean => {
  if (!yFields) return false
  const fieldConfig = yFields.find((f) => f.value === field)
  return fieldConfig?.type === 'count'
}

/**
 * 判断字段数组中是否包含 count 类型的字段
 * @param fields 字段名数组
 * @param yFields 字段配置数组
 * @returns 是否包含 count 类型字段
 */
const hasCountFields = (fields: string[], yFields?: OptionFields[]): boolean => {
  if (!yFields) return false
  return fields.some((field) => isCountField(field, yFields))
}

/**
 * 判断字段数组中是否所有字段都是 count 类型
 * @param fields 字段名数组
 * @param yFields 字段配置数组
 * @returns 是否所有字段都是 count 类型
 */
const areAllCountFields = (fields: string[], yFields?: OptionFields[]): boolean => {
  if (!yFields || fields.length === 0) return false
  return fields.every((field) => isCountField(field, yFields))
}

/**
 * 计算 count 类型字段的分类统计数据
 * @param data 原始数据
 * @param countFields count 类型的字段数组
 * @param xField 横轴字段
 * @returns 分类统计结果 { fieldName: { category: count } }
 */
const calculateCountByCategory = (
  data: ChartDataItem[],
  countFields: string[],
  xField: string,
): Record<string, Record<string, number>> => {
  const categoryCounts: Record<string, Record<string, number>> = {}

  for (const field of countFields) {
    categoryCounts[field] = {}
    // 按横轴字段分组统计
    for (const row of data) {
      const category = String(row[xField])
      if (!categoryCounts[field][category]) {
        categoryCounts[field][category] = 0
      }

      // 对于 count 类型字段：
      // 1. 如果字段存在且非空，统计非空值的行数
      // 2. 如果字段不存在，统计该分类下所有数据的行数
      if (field in row) {
        // 字段存在，统计该分类下该字段非空值的行数
        if (row[field] !== null && row[field] !== undefined && row[field] !== '') {
          categoryCounts[field][category] += 1
        }
      } else {
        // 字段不存在，统计该分类下所有数据的行数
        categoryCounts[field][category] += 1
      }
    }
  }

  return categoryCounts
}

/**
 * 获取字段的值（根据字段类型处理）
 * @param row 数据行
 * @param field 字段名
 * @param yFields 字段配置数组
 * @param categoryCounts count 类型字段的分类统计数据
 * @param xField 横轴字段
 * @returns 字段值
 */
const getFieldValue = (
  row: ChartDataItem,
  field: string,
  yFields?: OptionFields[],
  categoryCounts?: Record<string, Record<string, number>>,
  xField?: string,
): number => {
  if (isCountField(field, yFields) && categoryCounts && xField) {
    // 如果是 count 类型，使用按横轴分类统计的值
    const category = String(row[xField])
    return categoryCounts[field]?.[category] || 0
  } else {
    // 如果是 value 类型，使用原始值
    const raw = Number(row[field] ?? 0)
    return Number.isFinite(raw) ? raw : 0
  }
}

/**
 * 判断是否为饼图类型
 */
const isPieChartType = (subType: ChartSubType): boolean => {
  return subType === 'pie' || subType === 'pie_donut'
}

/**
 * 根据分类字段对数据进行排序
 * @param data 数据数组
 * @param xField 横轴字段
 * @param categorySort 排序方式：'asc' 升序，'desc' 降序
 * @param valueFields 值字段数组，用于排序依据
 * @param yFields 字段配置数组
 * @returns 排序后的数据
 */
const sortDataByCategory = (
  data: ChartDataItem[],
  xField: string,
  categorySort?: 'asc' | 'desc',
  valueFields?: string[],
  yFields?: OptionFields[],
): ChartDataItem[] => {
  if (!categorySort || !data.length) {
    return data
  }

  // 创建数据副本进行排序
  const sortedData = [...data]

  // 如果有值字段，按值排序；否则按分类名称排序
  if (valueFields && valueFields.length > 0) {
    const firstValueField = valueFields[0]

    if (!firstValueField) {
      return sortedData
    }

    // 计算每个分类的总值（用于排序）
    const categoryTotals = new Map<string, number>()

    for (const row of data) {
      const category = String(row[xField])
      let value = 0

      if (isCountField(firstValueField, yFields)) {
        // 对于 count 类型字段，统计该分类下的数据条数
        const categoryCounts = calculateCountByCategory(data, [firstValueField], xField)
        value = categoryCounts[firstValueField]?.[category] || 0
      } else {
        // 对于 value 类型字段，使用原始值
        value = Number(row[firstValueField] ?? 0)
      }

      categoryTotals.set(category, (categoryTotals.get(category) || 0) + value)
    }

    // 按值排序
    sortedData.sort((a, b) => {
      const categoryA = String(a[xField])
      const categoryB = String(b[xField])
      const valueA = categoryTotals.get(categoryA) || 0
      const valueB = categoryTotals.get(categoryB) || 0

      return categorySort === 'asc' ? valueA - valueB : valueB - valueA
    })
  } else {
    // 按分类名称排序
    sortedData.sort((a, b) => {
      const categoryA = String(a[xField])
      const categoryB = String(b[xField])

      return categorySort === 'asc'
        ? categoryA.localeCompare(categoryB)
        : categoryB.localeCompare(categoryA)
    })
  }

  return sortedData
}

/**
 * 为数据计算百分比字段
 * @param data 原始数据
 * @param valueField 数值字段名
 * @returns 包含 percent 字段的新数据
 */
const calculatePercent = (
  data: ChartDataItem[],
  valueField: string,
): Array<ChartDataItem & { percent: number }> => {
  const total = data.reduce((sum, item) => {
    const value = Number(item[valueField] ?? 0)
    return sum + (Number.isFinite(value) ? value : 0)
  }, 0)

  return data.map((item) => {
    const value = Number(item[valueField] ?? 0)
    const percent = total > 0 && Number.isFinite(value) ? value / total : 0
    return { ...item, percent }
  })
}

/**
 * 格式化百分比显示
 */
const formatPercent = (value: number): string => {
  return `${(value * 100).toFixed(PERCENT_DECIMAL_PLACES)}%`
}

/**
 * 宽表转长表：将多个 valueFields 展开为多序列
 * 生成字段：xField、value（统一为数值字段）、series（序列名为原字段名）
 * 保留所有原始字段，确保tooltip能显示完整信息
 * 当字段type为count时，根据横轴分类统计对应分类的数据
 */
const wideToLong = (
  data: ChartDataItem[],
  valueFields: string[],
  yFields?: OptionFields[],
  xField?: string,
): Array<ChartDataItem & { [VALUE_FIELD]: number; [SERIES_FIELD]: string }> => {
  const result: Array<ChartDataItem & { [VALUE_FIELD]: number; [SERIES_FIELD]: string }> = []

  if (!xField) {
    // 如果没有横轴字段，直接使用原始逻辑
    for (const row of data) {
      for (const field of valueFields) {
        const value = getFieldValue(row, field, yFields)
        const newRow: ChartDataItem & { [VALUE_FIELD]: number; [SERIES_FIELD]: string } = {
          ...row,
          [VALUE_FIELD]: value,
          [SERIES_FIELD]: getFieldLabel(field, yFields) || field,
        }
        result.push(newRow)
      }
    }
    return result
  }

  // 获取所有 count 类型的字段
  const countFields = valueFields.filter((field) => isCountField(field, yFields))

  // 计算 count 类型字段的分类统计数据
  const categoryCounts =
    countFields.length > 0 ? calculateCountByCategory(data, countFields, xField) : {}

  // 获取所有唯一分类
  const uniqueCategories = new Set<string>()
  for (const row of data) {
    uniqueCategories.add(String(row[xField]))
  }

  // 检查是否所有字段都是 count 类型
  const allCountFields = areAllCountFields(valueFields, yFields)

  // 如果所有字段都是 count 类型，为每个分类创建唯一的数据行
  if (allCountFields && uniqueCategories.size > 0) {
    for (const category of uniqueCategories) {
      // 找到该分类的第一行数据作为基础
      const baseRow = data.find((row) => String(row[xField]) === category) || {}

      for (const field of valueFields) {
        const value = getFieldValue(baseRow, field, yFields, categoryCounts, xField)

        // 创建新行，保留所有原始字段
        const newRow: ChartDataItem & { [VALUE_FIELD]: number; [SERIES_FIELD]: string } = {
          ...baseRow,
          [xField]: category,
          [VALUE_FIELD]: value,
          [SERIES_FIELD]: getFieldLabel(field, yFields) || field,
        }

        result.push(newRow)
      }
    }
  } else {
    // 如果不是所有字段都是 count 类型，使用原始逻辑
    for (const row of data) {
      for (const field of valueFields) {
        const value = getFieldValue(row, field, yFields, categoryCounts, xField)

        // 创建新行，保留所有原始字段
        const newRow: ChartDataItem & { [VALUE_FIELD]: number; [SERIES_FIELD]: string } = {
          ...row,
          [VALUE_FIELD]: value,
          [SERIES_FIELD]: getFieldLabel(field, yFields) || field,
        }

        result.push(newRow)
      }
    }
  }

  return result
}

/**
 * 为重复数据添加行索引，实现数据展开
 * @param data 原始数据
 * @param valueField 值字段
 * @param xField 横轴字段
 * @param yFields 字段配置数组
 * @returns 长表格式数据
 */
const expandDuplicateData = (
  data: ChartDataItem[],
  valueField: string,
  xField: string,
  yFields?: OptionFields[],
): Array<ChartDataItem & { [VALUE_FIELD]: number; [SERIES_FIELD]: string }> => {
  const result: Array<ChartDataItem & { [VALUE_FIELD]: number; [SERIES_FIELD]: string }> = []

  // 为每个原始数据行创建对应的长表数据，确保所有数据都能展开显示
  for (let i = 0; i < data.length; i++) {
    const row = data[i]
    if (!row) continue

    let value: number
    if (isCountField(valueField, yFields)) {
      // 对于 count 类型字段，每行数据计为 1
      value =
        row[valueField] !== null && row[valueField] !== undefined && row[valueField] !== '' ? 1 : 0
    } else {
      // 对于 value 类型字段，使用原始值
      value = getFieldValue(row, valueField, yFields)
    }

    // 使用统一的系列名称，确保所有数据属于同一系列
    // 这样G2会将它们作为同一系列下的多个柱子，而不是不同系列
    const seriesName = getFieldLabel(valueField, yFields) || valueField

    // 创建一个唯一的分组标识符，确保即使值相同也不会被合并
    // 这个标识符将被用作一个额外的维度，而不是系列字段
    const groupKey = `${String(row[xField])}_${i}`

    result.push({
      ...row,
      [xField]: groupKey, // 使用唯一的分组标识符作为横轴值
      [VALUE_FIELD]: value,
      [SERIES_FIELD]: seriesName, // 使用统一的系列名称
      // 保留原始横轴值和行索引信息，用于tooltip显示
      _originalXField: String(row[xField]),
      _rowIndex: i + 1,
      _uniqueId: groupKey,
    })
  }

  return result
}

/**
 * 针对已为长表的数据，按组（如 xField）计算百分比字段
 * 保留所有原始字段，确保tooltip能显示完整信息
 */
const calculatePercentByGroup = (
  data: ChartDataItem[],
  yField: string,
  groupField: string,
): Array<ChartDataItem & { [PERCENT_FIELD]: number }> => {
  const groupTotal = new Map<string, number>()
  for (const row of data) {
    const key = String(row[groupField])
    const raw = Number(row[yField] ?? 0)
    const value = Number.isFinite(raw) ? raw : 0
    groupTotal.set(key, (groupTotal.get(key) ?? 0) + value)
  }

  return data.map((row) => {
    const key = String(row[groupField])
    const denom = groupTotal.get(key) ?? 0
    const raw = Number(row[yField] ?? 0)
    const value = Number.isFinite(raw) ? raw : 0
    const percent = denom > 0 ? value / denom : 0

    // 保留所有原始字段，添加百分比字段
    return { ...row, [PERCENT_FIELD]: percent }
  })
}

/**
 * 聚合饼图数据：
 * - 若只有一个 valueField：先按 xField 聚合求和
 * - 若有多个 valueFields：先将多字段求和到统一的 value，再按 xField 聚合
 * 当字段type为count时，根据横轴分类统计对应分类的数据
 */
const aggregateForPie = (
  data: ChartDataItem[],
  xField: string,
  valueFields: string[],
  yFields?: OptionFields[],
): Array<ChartDataItem & { [VALUE_FIELD]: number }> => {
  const temp: Record<string, number> = {}

  // 获取所有 count 类型的字段
  const countFields = valueFields.filter((field) => isCountField(field, yFields))

  // 计算 count 类型字段的分类统计数据
  const categoryCounts =
    countFields.length > 0 ? calculateCountByCategory(data, countFields, xField) : {}

  for (const row of data) {
    const key = String(row[xField])
    let sum = 0

    if (valueFields.length <= 1) {
      const field = valueFields[0] as string
      sum = getFieldValue(row, field, yFields, categoryCounts, xField)
    } else {
      for (const field of valueFields) {
        sum += getFieldValue(row, field, yFields, categoryCounts, xField)
      }
    }

    temp[key] = (temp[key] ?? 0) + sum
  }

  return Object.entries(temp).map(([k, v]) => ({ [xField]: k, [VALUE_FIELD]: v })) as Array<
    ChartDataItem & { [VALUE_FIELD]: number }
  >
}

// ---------------- 导出辅助函数 ----------------
export { isCountField, hasCountFields, areAllCountFields, calculateCountByCategory, getFieldValue }

// ---------------- Hook 核心 ----------------
export function useChartRender(
  config: Ref<ChartConfig>,
  data: Ref<ChartDataItem[] | undefined> = ref(getDefaultChartData()),
  chartContainer = ref<HTMLDivElement | null>(null),
  xFields?: Ref<OptionFields[] | undefined>,
  yFields?: Ref<OptionFields[] | undefined>,
) {
  let chartInstance: Chart | null = null
  const status = ref<ChartStatus>('loading')

  // 生成 G2 配置
  const buildChartSpec = (): ChartSpec => {
    const {
      subType,
      xField,
      valueFields,
      categoryField,
      categorySort,
      expandDuplicates,
      legend,
      label,
      xAxis,
      yAxis,
      grid,
      theme,
      title,
    } = unref(config)

    const currentData = unref(data) || []

    // 验证必要字段
    if (!valueFields || valueFields.length === 0) {
      throw new Error('valueFields is required')
    }
    if (!xField) {
      throw new Error('xField is required')
    }

    const base = subTypeMap[subType] || {}
    const isPieChart = isPieChartType(subType)
    const multiSeries = valueFields.length > 1
    const firstValueField = valueFields[0]!

    // ---------- 数据预处理 ----------
    let dataForSpec: ChartDataItem[] = currentData
    let yFieldName: string = firstValueField

    if (isPieChart) {
      // 聚合并计算整体百分比（以 xField 分类聚合）
      const aggregated = aggregateForPie(currentData, xField, valueFields, yFields?.value)
      const withPercent = calculatePercent(aggregated, VALUE_FIELD)
      dataForSpec = withPercent
      yFieldName = PERCENT_FIELD
    } else {
      if (multiSeries || expandDuplicates) {
        // 多序列或需要展开重复数据时，需要转换为长表格式
        let longData: Array<ChartDataItem & { [VALUE_FIELD]: number; [SERIES_FIELD]: string }>

        if (multiSeries) {
          // 多个值字段：宽转长，得到统一的 VALUE_FIELD 与 SERIES_FIELD
          longData = wideToLong(currentData, valueFields, yFields?.value, xField)
        } else if (expandDuplicates && valueFields[0]) {
          // 单个值字段但需要展开重复数据：为每行数据添加唯一标识
          longData = expandDuplicateData(currentData, valueFields[0], xField, yFields?.value)
        } else {
          longData = wideToLong(currentData, valueFields, yFields?.value, xField)
        }

        // 百分比柱状图：按 x 分组转百分比
        if (subType === 'bar_percent') {
          dataForSpec = calculatePercentByGroup(longData, VALUE_FIELD, xField)
          yFieldName = PERCENT_FIELD
        } else {
          dataForSpec = longData
          yFieldName = VALUE_FIELD
        }
      } else {
        // 单值字段：仅在百分比柱状图时转为百分比
        if (subType === 'bar_percent') {
          const percentData = calculatePercentByGroup(currentData, firstValueField, xField)
          dataForSpec = percentData
          yFieldName = PERCENT_FIELD
        } else {
          // 检查字段类型，如果是count类型，需要特殊处理
          if (isCountField(firstValueField, yFields?.value)) {
            // 如果是count类型，根据横轴分类统计每个分类下该字段非空值的行数
            const categoryCounts = calculateCountByCategory(currentData, [firstValueField], xField)
            const uniqueCategories = new Set<string>()

            // 获取所有唯一分类
            for (const row of currentData) {
              uniqueCategories.add(String(row[xField]))
            }

            // 创建一个去重后的数据集，每个分类只保留一行数据，避免label重复渲染
            dataForSpec = Array.from(uniqueCategories).map((category) => {
              // 找到该分类的第一行数据作为基础
              const baseRow = currentData.find((row) => String(row[xField]) === category) || {}
              return {
                ...baseRow,
                [xField]: category,
                [firstValueField]: categoryCounts[firstValueField]?.[category] || 0,
              }
            })
          } else {
            // 如果是value类型，使用原始数据
            dataForSpec = currentData
          }
          yFieldName = firstValueField
        }
      }
    }

    // ---------- 数据排序 ----------
    // 在所有数据预处理完成后，根据 categorySort 配置对数据进行排序
    if (categorySort && !isPieChart) {
      dataForSpec = sortDataByCategory(
        dataForSpec,
        xField,
        categorySort,
        valueFields,
        yFields?.value,
      )
    }

    // ---------- 编码构建 ----------
    // 使用子类型映射中定义的编码逻辑
    const baseEncode =
      typeof base.buildEncode === 'function'
        ? base.buildEncode(unref(config))
        : base.encode || { x: xField, y: yFieldName }

    // 合并编码配置
    const encode: Record<string, unknown> = { ...baseEncode }

    // 如果子类型映射没有定义颜色编码，则使用默认逻辑
    if (!encode.color) {
      if (isPieChart) {
        encode.color = xField
      } else if (multiSeries) {
        encode.color = SERIES_FIELD
      } else if (expandDuplicates) {
        // 展开重复数据时，不使用颜色编码，避免数据被合并
        // 所有数据使用相同的颜色
      } else if (categoryField) {
        encode.color = categoryField
      }
    }

    // 子元素（用于折线图等 view 组合）
    const children = base.buildChildren ? base.buildChildren(unref(config)) : base.children

    // ---------- 规格 ----------
    const spec: ChartSpec = {
      ...base,
      title: { title },
      autoFit: true,
      data: dataForSpec,
      encode,
      legend: legend.show
        ? {
            position: legend.position,
            // 对于多纵轴值的情况，使用字段对应的 label 作为图例标题
            ...(multiSeries ? {} : { label: getFieldLabel(firstValueField, yFields?.value) }),
            // 如果展开了重复数据，隐藏图例（因为每个数据行都有唯一的系列标识）
            ...(expandDuplicates && !multiSeries ? { show: false } : {}),
          }
        : false,
      tooltip: true,
      children,
    }

    // 处理动态转换
    if (typeof base.transform === 'function') {
      spec.transform = base.transform(unref(config))
    }

    // 百分比类图表：自定义 tooltip 百分比显示
    if (yFieldName === PERCENT_FIELD) {
      const items: Array<{ field: string; name: string; valueFormatter?: (v: number) => string }> =
        []
      items.push({
        field: xField,
        name: getFieldLabel(xField, xFields?.value) || String(xAxis.title ?? xField),
      })
      if (multiSeries) items.push({ field: SERIES_FIELD, name: '系列' })

      // 对于多纵轴值的情况，显示所有原始值字段
      if (multiSeries) {
        valueFields.forEach((field) => {
          items.push({ field, name: getFieldLabel(field, yFields?.value) || field })
        })
      } else {
        /* items.push({
          field: firstValueField,
          name:
            getFieldLabel(firstValueField, yFields?.value) ||
            String(yAxis.title ?? firstValueField),
        }) */
      }

      items.push({ field: PERCENT_FIELD, name: '占比', valueFormatter: formatPercent })
      spec.tooltip = { items }
    } else if (multiSeries || expandDuplicates) {
      // 多纵轴值或展开重复数据但非百分比图表，显示系列和值
      const items: Array<{ field: string; name: string; valueFormatter?: (v: unknown) => string }> =
        []

      // 添加横轴字段
      items.push({
        field: xField,
        name: getFieldLabel(xField, xFields?.value) || String(xAxis.title ?? xField),
      })

      if (multiSeries) {
        // 多纵轴值情况
        valueFields.forEach((field) => {
          items.push({ field, name: getFieldLabel(field, yFields?.value) || field })
        })
      } else if (expandDuplicates) {
        // 展开重复数据情况，显示原始横轴值、行号和值
        items.push({
          field: '_originalXField',
          name: getFieldLabel(xField, xFields?.value) || xField,
        })
        items.push({
          field: '_rowIndex',
          name: '数据行',
        })
        items.push({
          field: VALUE_FIELD,
          name: getFieldLabel(firstValueField, yFields?.value) || firstValueField,
        })
      }

      spec.tooltip = { items }
    }

    // 添加主题配置
    console.log('Theme value:', theme, typeof theme)
    console.log(
      'Available themes:',
      COLOR_THEMES.map((t) => ({ type: t.type, typeOf: typeof t.type })),
    )
    const themeColor = COLOR_THEMES.find((t) => t.type === theme)?.colors
    console.log('Found theme color:', themeColor)
    if (Array.isArray(themeColor)) {
      Object.assign(spec, { scale: { color: { range: themeColor } } })
    }

    // 饼图不需要轴配置
    if (!isPieChart) {
      const xAxisConfig = xAxis.show
        ? {
            title: xAxis.title || getFieldLabel(xField, xFields?.value),
            // 展开重复数据时，使用原始横轴值作为轴标签
            ...(expandDuplicates
              ? {
                  label: {
                    text: (d: { _originalXField?: string }) => d._originalXField || '',
                  },
                }
              : {}),
          }
        : false
      const yAxisConfig = yAxis.show
        ? {
            title:
              yAxis.title ||
              (multiSeries
                ? '值'
                : getFieldLabel(firstValueField, yFields?.value) || firstValueField),
            tickCount: yAxis.tickCount,
            ...(grid.show ? {} : { grid: false }),
          }
        : false

      spec.axis = {
        x: xAxisConfig,
        y: yAxisConfig,
      }
    }

    // 标签配置
    if (label.show) {
      if (isPieChart || yFieldName === PERCENT_FIELD) {
        // 饼图或百分比图：显示百分比
        Object.assign(spec, {
          label: {
            text: (d: { percent?: number }) => formatPercent(d?.percent ?? 0),
          },
        })
      } else if (multiSeries) {
        // 多纵轴值：显示值
        spec.labels = [
          {
            position: label.position,
            text: VALUE_FIELD,
          },
        ]
      } else if (expandDuplicates) {
        // 展开重复数据：显示值
        spec.labels = [
          {
            position: label.position,
            text: VALUE_FIELD,
          },
        ]
      } else {
        // 单纵轴值：显示对应的字段
        spec.labels = [
          {
            position: label.position,
            text: yFieldName,
          },
        ]
      }
    }

    return spec
  }

  // 渲染
  const render = () => {
    const currentData = unref(data)
    const currentConfig = unref(config)

    // 确保容器已挂载且有数据
    if (!chartContainer.value) {
      console.warn('Chart container not mounted yet')
      status.value = 'loading'
      return
    }

    if (!currentData?.length) {
      console.warn('No data to render')
      status.value = 'error'
      return
    }

    // 验证配置完整性
    if (!currentConfig || !currentConfig.xField || !currentConfig.valueFields?.length) {
      console.warn('Chart config incomplete:', currentConfig)
      status.value = 'loading'
      return
    }

    // 验证数据字段存在性
    const sampleData = currentData[0]
    if (sampleData && !sampleData[currentConfig.xField]) {
      console.warn(`Category field '${currentConfig.xField}' not found in data`)
      status.value = 'error'
      return
    }
    // 验证值字段是否存在
    // 但是对于 count 类型的字段，即使不存在也可以按横轴分类计算数据条数
    const isMulti = Array.isArray(currentConfig.valueFields) && currentConfig.valueFields.length > 1

    if (sampleData) {
      if (isMulti) {
        // 多值图表：检查每个非 count 类型的字段是否存在
        const missingFields = currentConfig.valueFields.filter(
          (field) => !sampleData[field] && !isCountField(field, yFields?.value),
        )
        if (missingFields.length > 0) {
          console.warn(`Value fields not found in data: ${missingFields.join(', ')}`)
          return
        }
      } else {
        // 单值图表：检查字段是否存在（count 类型除外）
        const field = currentConfig.valueFields[0]
        if (field && !sampleData[field] && !isCountField(field, yFields?.value)) {
          console.warn(`Value field '${field}' not found in data`)
          return
        }
      }
    }

    try {
      chartInstance = new Chart({
        container: chartContainer.value,
        autoFit: true,
      })

      const spec = buildChartSpec()

      // 验证 spec 的关键字段
      if (!spec.data || !('encode' in spec)) {
        throw new Error('Invalid chart specification')
      }

      chartInstance.options(spec)
      chartInstance.render()
    } catch (error) {
      console.error('Chart render error:', error, {
        config: currentConfig,
        data: currentData,
        container: chartContainer.value,
      })
      if (chartInstance) {
        chartInstance.destroy()
        chartInstance = null
      }
    }
  }

  // 监听变化自动更新
  watch(
    [config, data, xFields, yFields],
    () => {
      // 延迟一点确保 DOM 已挂载
      if (chartContainer.value) {
        render()
      }
    },
    { deep: true, immediate: false },
  )

  // 监听容器挂载
  watch(
    chartContainer,
    (newVal) => {
      if (newVal) {
        render()
      }
    },
    { immediate: true },
  )

  // 卸载时销毁
  onUnmounted(() => {
    if (chartInstance) {
      chartInstance.destroy()
      chartInstance = null
    }
  })

  return {
    chartContainer,
    render,
    destroy: () => {
      if (chartInstance) {
        chartInstance.destroy()
        chartInstance = null
      }
    },
  }
}
