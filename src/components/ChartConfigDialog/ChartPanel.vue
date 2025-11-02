<template>
  <div ref="chartContainer" class="chart-container"></div>
</template>

<script lang="ts" setup>
import { inject, ref } from 'vue'
import { useChartRender } from './useChartRender'
import { useChartConfig } from './useChartConfig'
import type { Props } from './types'

const { chartConfig } = useChartConfig()

const dataSource = inject<Props['dataSource']>('dataSource')
const xAxisFields = inject<Props['xAxisFields']>('xAxisFields')
const yAxisFields = inject<Props['yAxisFields']>('yAxisFields')

const chartContainer = ref<HTMLDivElement | null>(null)

useChartRender(chartConfig, ref(dataSource), chartContainer, ref(xAxisFields), ref(yAxisFields))
</script>

<style scoped>
.chart-container {
  flex: 1;
  background: #fafafa;
  border-radius: 4px;
  padding: 20px;
}
</style>
