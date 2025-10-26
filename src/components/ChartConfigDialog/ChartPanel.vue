<template>
  <div ref="chartContainer" class="chart-container"></div>
</template>

<script lang="ts" setup>
import { inject, onMounted, computed } from 'vue'
import { useChartRender } from './useChartRender'
import { useChartConfig } from './useChartConfig'
import type { Props, ChartDataItem } from './types'

const { chartConfig } = useChartConfig()

const dataSource = inject<Props['dataSource']>('dataSource')

const tableData = computed<ChartDataItem[]>(
  () => dataSource?.[chartConfig.value.dataSource]?.tableData || [],
)

const { chartContainer, render } = useChartRender(chartConfig.value, tableData)

onMounted(() => {
  render()
})
</script>

<style scoped>
.chart-container {
  flex: 1;
  background: #fafafa;
  border-radius: 4px;
  padding: 20px;
}
</style>
