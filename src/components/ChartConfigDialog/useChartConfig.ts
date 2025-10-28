import { ref } from 'vue'
import type { ChartConfig } from './types'
import { DEFAULT_CONFIG } from './constants'
const chartConfig = ref<ChartConfig>(DEFAULT_CONFIG)

export function useChartConfig(defaultConfig: ChartConfig = DEFAULT_CONFIG) {
  chartConfig.value = defaultConfig
  const setConfig = (config: ChartConfig) => {
    chartConfig.value = config
  }
  return {
    chartConfig,
    setConfig,
    reset: () => (chartConfig.value = { ...DEFAULT_CONFIG }),
  }
}
