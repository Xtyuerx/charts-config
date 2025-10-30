// components/ChartConfigDialog/hooks/useChartRender.ts
import { ref, watch, onUnmounted, type Ref, unref } from 'vue'
import { Chart } from '@antv/g2'
import type { ChartConfig, ChartSubType, ChartSpec, ChartDataItem } from './types'

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
    buildEncode: (cfg) => ({
      x: cfg.xField,
      y: cfg.valueFields[0],
    }),
    transform: [{ type: 'dodgeX' }],
  },
  bar_stacked: {
    type: 'interval',
    transform: [{ type: 'stackY' }],
    buildEncode: (cfg) => ({
      x: cfg.xField,
      y: cfg.valueFields[0],
    }),
  },
  bar_percent: {
    type: 'interval',
    transform: [{ type: 'stackY' }],
    buildEncode: (cfg) => ({
      x: cfg.xField,
      y: PERCENT_FIELD,
    }),
  },

  // 折线图
  line: {
    type: 'view',
    buildEncode: (cfg) => ({
      x: cfg.xField,
      y: cfg.valueFields[0],
    }),
    style: { lineWidth: 2 },
    buildChildren: () => [{ type: 'line' }, { type: 'point', style: { fill: 'white' } }],
  },
  line_smooth: {
    type: 'view',
    buildEncode: (cfg) => ({
      x: cfg.xField,
      y: cfg.valueFields[0],
    }),
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
 * 判断是否为饼图类型
 */
const isPieChartType = (subType: ChartSubType): boolean => {
  return subType === 'pie' || subType === 'pie_donut'
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
 */
const wideToLong = (
  data: ChartDataItem[],
  xField: string,
  valueFields: string[],
): Array<ChartDataItem & { [VALUE_FIELD]: number; [SERIES_FIELD]: string }> => {
  const result: Array<ChartDataItem & { [VALUE_FIELD]: number; [SERIES_FIELD]: string }> = []
  for (const row of data) {
    for (const field of valueFields) {
      const raw = Number(row[field] ?? 0)
      const value = Number.isFinite(raw) ? raw : 0
      result.push({ ...row, [VALUE_FIELD]: value, [SERIES_FIELD]: field, [xField]: row[xField] })
    }
  }
  return result
}

/**
 * 针对已为长表的数据，按组（如 xField）计算百分比字段
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
    return { ...row, [PERCENT_FIELD]: percent }
  })
}

/**
 * 聚合饼图数据：
 * - 若只有一个 valueField：先按 xField 聚合求和
 * - 若有多个 valueFields：先将多字段求和到统一的 value，再按 xField 聚合
 */
const aggregateForPie = (
  data: ChartDataItem[],
  xField: string,
  valueFields: string[],
): Array<ChartDataItem & { [VALUE_FIELD]: number }> => {
  const temp: Record<string, number> = {}
  for (const row of data) {
    const key = String(row[xField])
    let sum = 0
    if (valueFields.length <= 1) {
      const field = valueFields[0] as string
      const raw = Number(row[field] ?? 0)
      sum = Number.isFinite(raw) ? raw : 0
    } else {
      for (const f of valueFields) {
        const raw = Number(row[f] ?? 0)
        sum += Number.isFinite(raw) ? raw : 0
      }
    }
    temp[key] = (temp[key] ?? 0) + sum
  }
  return Object.entries(temp).map(([k, v]) => ({ [xField]: k, [VALUE_FIELD]: v })) as Array<
    ChartDataItem & { [VALUE_FIELD]: number }
  >
}

// ---------------- Hook 核心 ----------------
export function useChartRender(
  config: Ref<ChartConfig>,
  data: Ref<ChartDataItem[]> = ref(getDefaultChartData()),
  chartContainer = ref<HTMLDivElement | null>(null),
) {
  let chartInstance: Chart | null = null

  // 生成 G2 配置
  const buildChartSpec = (): ChartSpec => {
    const {
      subType,
      xField,
      valueFields,
      categoryField,
      legend,
      label,
      xAxis,
      yAxis,
      grid,
      theme,
      title,
    } = unref(config)

    const currentData = unref(data)

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
      const aggregated = aggregateForPie(currentData, xField, valueFields)
      const withPercent = calculatePercent(aggregated, VALUE_FIELD)
      dataForSpec = withPercent
      yFieldName = PERCENT_FIELD
    } else {
      if (multiSeries) {
        // 宽转长，得到统一的 VALUE_FIELD 与 SERIES_FIELD
        const longData = wideToLong(currentData, xField, valueFields)
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
          dataForSpec = currentData
          yFieldName = firstValueField
        }
      }
    }

    // ---------- 编码构建 ----------
    const encode: Record<string, unknown> = {
      x: xField,
      y: yFieldName,
    }
    if (isPieChart) {
      encode.color = xField
    } else if (multiSeries) {
      encode.color = SERIES_FIELD
    } else if (categoryField) {
      encode.color = categoryField
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
      legend: legend.show ? { position: legend.position } : false,
      tooltip: true,
      children,
    }

    // 百分比类图表：自定义 tooltip 百分比显示
    if (yFieldName === PERCENT_FIELD) {
      const items: Array<{ field: string; name: string; valueFormatter?: (v: number) => string }> =
        []
      items.push({ field: xField, name: String(xAxis.title ?? xField) })
      if (multiSeries) items.push({ field: SERIES_FIELD, name: '系列' })
      items.push({ field: firstValueField, name: String(yAxis.title ?? firstValueField) })
      items.push({ field: PERCENT_FIELD, name: '占比', valueFormatter: formatPercent })
      spec.tooltip = { items }
    }

    // 添加主题配置
    if (theme && Array.isArray(theme.colors)) {
      Object.assign(spec, { scale: { color: { range: theme.colors } } })
    }

    // 饼图不需要轴配置
    if (!isPieChart) {
      const xAxisConfig = xAxis.show ? { title: xAxis.title } : false
      const yAxisConfig = yAxis.show
        ? {
            title: yAxis.title,
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
      } else {
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
      return
    }

    if (!currentData?.length) {
      console.warn('No data to render')
      return
    }

    // 验证配置完整性
    if (!currentConfig || !currentConfig.xField || !currentConfig.valueFields?.length) {
      console.warn('Chart config incomplete:', currentConfig)
      return
    }

    // 验证数据字段存在性
    const sampleData = currentData[0]
    if (sampleData && !sampleData[currentConfig.xField]) {
      console.warn(`Category field '${currentConfig.xField}' not found in data`)
      return
    }
    const isMulti = Array.isArray(currentConfig.valueFields) && currentConfig.valueFields.length > 1
    if (
      !isMulti &&
      sampleData &&
      currentConfig.valueFields[0] &&
      !sampleData[currentConfig.valueFields[0]]
    ) {
      console.warn(`Value field '${currentConfig.valueFields[0]}' not found in data`)
      return
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
    [config.value, data.value],
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
