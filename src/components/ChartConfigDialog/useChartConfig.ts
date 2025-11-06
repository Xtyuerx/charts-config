import { ref } from 'vue'
import type { ChartConfig } from './types'
import { DEFAULT_CONFIG } from './constants'
import { cloneDeep } from 'lodash'
const chartConfig = ref<ChartConfig>(DEFAULT_CONFIG)

export function useChartConfig() {
  const setConfig = (config: ChartConfig) => {
    chartConfig.value = cloneDeep(config)
  }
  return {
    chartConfig,
    setConfig,
    reset: () => (chartConfig.value = cloneDeep({ ...DEFAULT_CONFIG })),
  }
}
