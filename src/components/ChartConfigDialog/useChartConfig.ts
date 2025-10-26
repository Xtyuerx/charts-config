import { ref } from 'vue'
import type { ChartConfig } from './types'
import { DEFAULT_CONFIG } from './constants'

export function useChartConfig(defaultConfig: ChartConfig = DEFAULT_CONFIG) {
  const chartConfig = ref<ChartConfig>(defaultConfig)
  const setConfig = (config: ChartConfig) => {
    chartConfig.value = config
  }
  return {
    chartConfig,
    setConfig,
    reset: () => (chartConfig.value = { ...DEFAULT_CONFIG }),
  }
}
