// components/ChartConfigDialog/hooks/useChartRender.ts
import { ref, watch, onUnmounted, type Ref, unref } from 'vue'
import { Chart } from '@antv/g2'
import type { ChartConfig, ChartSubType, ChartSpec, ChartDataItem } from './types'

// ---------------- 常量定义 ----------------
const PERCENT_FIELD = 'percent'
const PERCENT_DECIMAL_PLACES = 2

// ---------------- 子类型映射 ----------------
const subTypeMap: Record<ChartSubType, ChartSpec> = {
  // 柱状图
  bar_group: {
    type: 'interval',
    buildEncode: (cfg) => ({
      x: cfg.categoryField,
      y: cfg.valueFields[0],
    }),
    transform: [{ type: 'dodgeX' }],
  },
  bar_stacked: {
    type: 'interval',
    transform: [{ type: 'stackY' }],
    buildEncode: (cfg) => ({
      x: cfg.categoryField,
      y: cfg.valueFields[0],
    }),
  },
  bar_percent: {
    type: 'interval',
    transform: [{ type: 'stackY' }],
    buildEncode: (cfg) => ({
      x: cfg.categoryField,
      y: PERCENT_FIELD,
    }),
  },

  // 折线图
  line: {
    type: 'view',
    buildEncode: (cfg) => ({
      x: cfg.categoryField,
      y: cfg.valueFields[0],
    }),
    style: { lineWidth: 2 },
    buildChildren: (cfg) => [
      { type: 'line', labels: [{ text: 'sold', style: { dx: -10, dy: -12 } }] },
      {
        type: 'point',
        style: { fill: 'white' },
        tooltip: {
          title: cfg.yAxis.title,
          items: [
            { field: cfg.categoryField, name: cfg.xAxis.title },
            { field: cfg.valueFields[0], name: cfg.yAxis.title },
          ],
        },
      },
    ],
  },
  line_smooth: {
    type: 'view',
    buildEncode: (cfg) => ({
      x: cfg.categoryField,
      y: cfg.valueFields[0],
      shape: 'smooth',
    }),
    style: { lineWidth: 2 },
    buildChildren: (cfg) => [
      { type: 'line', labels: [{ text: 'sold', style: { dx: -10, dy: -12 } }] },
      {
        type: 'point',
        style: { fill: 'white' },
        tooltip: {
          title: cfg.yAxis.title,
          items: [
            { field: cfg.categoryField, name: cfg.xAxis.title },
            { field: cfg.valueFields[0], name: cfg.yAxis.title },
          ],
        },
      },
    ],
  },

  // 饼图
  pie: {
    type: 'interval',
    coordinate: { type: 'theta', innerRadius: 0 },
    buildEncode: (cfg) => ({
      y: PERCENT_FIELD,
      color: cfg.categoryField,
    }),
    transform: [{ type: 'stackY' }],
  },
  pie_donut: {
    type: 'interval',
    coordinate: { type: 'theta', innerRadius: 0.6 },
    buildEncode: (cfg) => ({
      y: PERCENT_FIELD,
      color: cfg.categoryField,
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
      categoryField,
      valueFields,
      colorField,
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
    if (!categoryField) {
      throw new Error('categoryField is required')
    }

    const base = subTypeMap[subType] || {}
    const isPieChart = isPieChartType(subType)
    const valueField = valueFields[0]!

    const encode = base.buildEncode
      ? base.buildEncode(unref(config))
      : {
          x: categoryField,
          y: valueField,
        }

    const children = base.buildChildren ? base.buildChildren(unref(config)) : base.children

    if (colorField && !isPieChart) {
      encode.color = colorField
    }

    // 饼图数据预处理：计算百分比
    const processedData = calculatePercent(currentData, valueField)

    const spec: ChartSpec = {
      ...base,
      title: {
        title,
      },
      autoFit: true,
      data: processedData,
      encode,
      legend: legend.show ? { position: legend.position } : false,
      tooltip: {
        items: [
          { field: categoryField, name: xAxis.title },
          { field: valueField, name: yAxis.title },
        ],
      },
      children,
    }

    // 饼图特殊配置
    if (encode.y === PERCENT_FIELD) {
      spec.tooltip = {
        items: [
          { field: categoryField, name: xAxis.title },
          { field: valueField, name: yAxis.title },
          {
            field: PERCENT_FIELD,
            name: '占比',
            valueFormatter: formatPercent,
          },
        ],
      }
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
      if (isPieChart) {
        // 饼图标签显示百分比
        Object.assign(spec, {
          label: {
            text: (d: { percent?: number }) => formatPercent(d?.percent ?? 0),
          },
        })
      } else {
        spec.labels = [
          {
            position: label.position,
            text:
              encode.y === PERCENT_FIELD
                ? (d: { percent?: number }) => formatPercent(d?.percent ?? 0)
                : valueField,
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
    if (!currentConfig || !currentConfig.categoryField || !currentConfig.valueFields?.length) {
      console.warn('Chart config incomplete:', currentConfig)
      return
    }

    // 验证数据字段存在性
    const sampleData = currentData[0]
    if (sampleData && !sampleData[currentConfig.categoryField]) {
      console.warn(`Category field '${currentConfig.categoryField}' not found in data`)
      return
    }
    if (sampleData && currentConfig.valueFields[0] && !sampleData[currentConfig.valueFields[0]]) {
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
