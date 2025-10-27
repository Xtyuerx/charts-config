<script setup lang="ts">
import { ref, computed, type Ref, watch } from 'vue'
import AddChart from '@/components/ChartConfigDialog/index.vue'
import type { ChartConfig, ChartDataItem } from '@/components/ChartConfigDialog/types'
import { useChartRender } from '@/components/ChartConfigDialog/useChartRender'

const dialogVisible = ref(false)
const chartConfig = ref<ChartConfig>()
const mainChartRef = ref<HTMLDivElement | null>(null)

const dataSource = ref([
  {
    label: '数据集',
    value: 0,
    tableData: [
      {
        name: 'London',
        genre: '运动',
        sold: 275,
      },
      {
        name: 'London',
        genre: '策略',
        sold: 115,
      },
      {
        name: 'London',
        genre: '射击',
        sold: 350,
      },
      {
        name: 'Berlin',
        genre: '运动',
        sold: 120,
      },
      {
        name: 'Berlin',
        genre: '策略',
        sold: 350,
      },
      {
        name: 'Berlin',
        genre: '射击',
        sold: 200,
      },
    ],
    columns: [
      {
        label: '类型',
        prop: 'genre',
      },
      {
        label: '销售量',
        prop: 'sold',
      },
    ],
  },
])

const currentTableData = computed<ChartDataItem[]>(
  () => dataSource.value?.[chartConfig.value?.dataSource || 0]?.tableData || [],
)

const { render } = useChartRender(chartConfig as Ref<ChartConfig>, currentTableData, mainChartRef)

watch(
  chartConfig,
  () => {
    render()
  },
  {
    deep: true,
  },
)
</script>

<template>
  <h1>You did it!</h1>
  <AddChart v-model:visible="dialogVisible" v-model:config="chartConfig" :dataSource="dataSource" />
  <el-button type="primary" @click="dialogVisible = true">添加图表</el-button>
  <div ref="mainChartRef" class="chart-container"></div>
</template>

<style scoped></style>
