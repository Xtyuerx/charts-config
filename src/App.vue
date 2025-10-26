<script setup lang="ts">
import { ref } from 'vue'
import AddChart from '@/components/ChartConfigDialog/index.vue'
import type { ChartConfig } from '@/components/ChartConfigDialog/types'
import { DEFAULT_CONFIG } from '@/components/ChartConfigDialog/constants'
const dialogVisible = ref(false)
const chartConfig = ref<ChartConfig>(DEFAULT_CONFIG)
const dataSource = ref([
  {
    label: '数据集',
    value: 0,
    tableData: [
      {
        genre: 'Sports',
        sold: 275,
      },
      {
        genre: 'Strategy',
        sold: 115,
      },
      {
        genre: 'Action',
        sold: 120,
      },
      {
        genre: 'Shooter',
        sold: 350,
      },
      {
        genre: 'Other',
        sold: 150,
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
</script>

<template>
  <h1>You did it!</h1>
  <AddChart v-model:visible="dialogVisible" v-model:config="chartConfig" :dataSource="dataSource" />
  <el-button type="primary" @click="dialogVisible = true">添加图表</el-button>
</template>

<style scoped></style>
