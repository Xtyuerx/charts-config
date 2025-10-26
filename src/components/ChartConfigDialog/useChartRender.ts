// components/ChartConfigDialog/hooks/useChartRender.ts
import { ref, watch, onUnmounted } from 'vue'
import { Chart, type Data } from '@antv/g2'
import type { ChartConfig, ChartSubType, ChartSpec, ChartDataItem } from './types'

// ---------------- 子类型映射 ----------------
const subTypeMap: Record<ChartSubType, ChartSpec> = {
  // 柱状图
  bar_group: { type: 'interval' },
  bar_stacked: { type: 'interval', transform: [{ type: 'stackY' }] },
  bar_percent: { type: 'interval', transform: [{ type: 'stackY' }] },

  // 折线图
  line: { type: 'line' },
  line_smooth: { type: 'line', style: { shape: 'smooth' } },

  // 饼图
  pie: {
    type: 'interval',
    coordinate: { type: 'theta', innerRadius: 0 },
    buildEncode: (cfg) => ({
      color: cfg.categoryField,
    }),
  },
  pie_donut: {
    type: 'interval',
    coordinate: { type: 'theta', innerRadius: 0.6 },
    buildEncode: (cfg) => ({
      color: cfg.categoryField,
    }),
  },
}

/**
 * 获取默认图表数据
 */
const getDefaultChartData = (): ChartDataItem[] => {
  return [
    { genre: '类别A', value: 11, series: '系列1' },
    { genre: '类别B', value: 1, series: '系列1' },
    { genre: '类别C', value: 2, series: '系列1' },
    { genre: '类别A', value: 3, series: '系列2' },
    { genre: '类别B', value: 3, series: '系列2' },
    { genre: '类别C', value: 4, series: '系列2' },
  ]
}

// ---------------- Hook 核心 ----------------
export function useChartRender(config: ChartConfig, data: Data = getDefaultChartData()) {
  const chartContainer = ref<HTMLDivElement | null>(null)
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
    } = config

    const base = subTypeMap[subType] || {}

    const encode = base.buildEncode
      ? base.buildEncode(config)
      : {
          x: categoryField,
          y: valueFields[0],
          color: colorField ?? categoryField,
        }

    const spec: ChartSpec = {
      ...base,
      data,
      theme,
      encode,
      legend: legend.show ? { position: legend.position } : false,
      axis: {
        x: xAxis.show ? { title: xAxis.title } : false,
        y: yAxis.show ? { title: yAxis.title, tickCount: yAxis.tickCount } : false,
      },
      tooltip: true,
    }

    if (label.show) spec.title = { position: label.position }
    if (!grid.show && spec.axis && typeof spec.axis === 'object' && 'y' in spec.axis) {
      spec.axis.y.grid = null
    }

    return spec
  }

  // 渲染
  const render = () => {
    console.log('render', config, chartContainer, chartInstance)
    if (!chartContainer.value || !data?.length) return
    if (chartInstance) chartInstance.destroy()

    chartInstance = new Chart({
      container: chartContainer.value,
      autoFit: true,
    })

    const spec = buildChartSpec()
    chartInstance.options(spec)
    chartInstance.render()
  }

  // 监听变化自动更新
  watch(
    () => [config, data],
    () => render(),
    { deep: true, immediate: true },
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
