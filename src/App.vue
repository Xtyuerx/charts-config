<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
import AddChart from '@/components/ChartConfigDialog/index.vue'
import type { ChartConfig, OptionFields } from '@/components/ChartConfigDialog/types'
import { useChartRender } from '@/components/ChartConfigDialog/useChartRender'
import { DEFAULT_CONFIG } from '@/components/ChartConfigDialog/constants'
import { generateChartId } from '@/components/ChartConfigDialog/utils'

// mock远程数据
const originData = {
  /* 数据源下拉 */
  dataSourceFields: [
    {
      text: 'dataSource1',
      label: '数据源1',
      key: 'axis1',
      value: 100,
    },
    {
      text: 'dataSource2',
      label: '数据源2',
      key: 'axis2',
      value: 200,
    },
  ],
  /* 横轴下拉 */
  xAxisFields: [
    {
      text: 'xAxis1',
      label: '横轴1',
      key: 'axis1',
      value: 'xAxis1',
    },
    {
      text: 'xAxis2',
      label: '横轴2',
      key: 'axis2',
      value: 'xAxis2',
    },
  ],
  /* 纵轴下拉 */
  yAxisFields: [
    {
      text: 'yAxis1',
      label: '纵轴1',
      key: 'axis1',
      value: 'yAxis1',
    },
    {
      text: 'yAxis2',
      label: '纵轴2',
      key: 'axis2',
      value: 'yAxis2',
    },
  ],
  /* 数据源 */
  dataSource: [
    {
      xAxis1: 100,
      xAxis2: 123,
      yAxis1: 100,
      yAxis2: 213,
    },
    {
      xAxis1: 300,
      xAxis2: 532,
      yAxis1: 300,
      yAxis2: 444,
    },
    {
      xAxis1: 500,
      xAxis2: 653,
      yAxis1: 500,
      yAxis2: 111,
    },
    {
      xAxis1: 700,
      xAxis2: 853,
      yAxis1: 700,
      yAxis2: 122,
    },
  ],
}

const dialogVisible = ref(false)
const chartConfigs = ref<ChartConfig[]>([])
const chartRefs = ref<HTMLDivElement[]>([])
const currentChartIndex = ref(0)
const chartInstances = ref<Map<string, { render: () => void; destroy: () => void }>>(new Map())

const dataSource = ref(originData.dataSource)
const dataSourceFields = ref<OptionFields[]>(originData.dataSourceFields)

const xAxisFields = ref<OptionFields[]>(originData.xAxisFields)

const yAxisFields = ref<OptionFields[]>(originData.yAxisFields)

// 编辑图表配置
const showEditChart = (config: ChartConfig, index: number) => {
  currentChartIndex.value = index
  chartConfigs.value[index] = { ...config }
  dialogVisible.value = true
}

// 添加新图表
const addChart = (config?: ChartConfig) => {
  const newConfig = config
    ? { ...config, id: config.id || generateChartId() }
    : { ...DEFAULT_CONFIG, id: generateChartId() }
  if (config?.id === newConfig.id) {
    // 如果是编辑已存在的图表，更新配置
    const index = chartConfigs.value.findIndex((c) => c.id === config.id)
    if (index !== -1) {
      chartConfigs.value[index] = newConfig
    }
  } else {
    // 如果是新增图表，添加到数组
    chartConfigs.value.push(newConfig)
  }

  nextTick(() => {
    renderChart(newConfig.id)
  })
}

// 删除图表
const removeChart = (chartId?: string) => {
  if (!chartId) return
  const index = chartConfigs.value.findIndex((config) => config.id === chartId)
  if (index !== -1) {
    // 先销毁图表实例
    const instance = chartInstances.value.get(chartId)
    if (instance) {
      instance.destroy()
      chartInstances.value.delete(chartId)
    }

    // 从数组中移除配置
    chartConfigs.value.splice(index, 1)

    // 清理对应的DOM引用
    chartRefs.value.splice(index, 1)
  }
}

// 渲染单个图表
const renderChart = (chartId?: string) => {
  if (!chartId) return
  const config = chartConfigs.value.find((c) => c.id === chartId)
  if (!config) return

  const index = chartConfigs.value.findIndex((c) => c.id === chartId)
  const chartContainer = chartRefs.value[index]

  if (!chartContainer) return

  // 先销毁之前的图表实例
  const existingInstance = chartInstances.value.get(chartId)
  if (existingInstance) {
    existingInstance.destroy()
  }

  const { render, destroy } = useChartRender(
    ref(config),
    dataSource,
    ref(chartContainer),
    xAxisFields,
    yAxisFields,
  )

  try {
    render()
    // 保存图表实例以便后续管理
    chartInstances.value.set(chartId, { render, destroy })
  } catch (error) {
    console.error(`渲染图表 ${chartId} 失败:`, error)
  }
}

// 重新渲染所有图表
const renderAllCharts = () => {
  chartConfigs.value.forEach((config) => {
    if (config.id) {
      renderChart(config.id)
    }
  })
}

// 处理图表配置确认
const handleConfirm = (config: ChartConfig) => {
  console.log('config', config)
  addChart(config)
}

const handleDataSourceChange = (data: OptionFields) => {
  console.log('data', data)
  // TODO 处理数据源变化
  xAxisFields.value = originData.xAxisFields
  yAxisFields.value = originData.yAxisFields
  console.log('xAxisFields', xAxisFields.value, 'yAxisFields', yAxisFields.value)
  // TODO: 请求数据源对应的数据
  dataSource.value = originData.dataSource
}

onMounted(() => {
  // 初始渲染所有图表
  nextTick(() => {
    renderAllCharts()
  })
})
</script>

<template>
  <div class="app-container">
    <h1>智能图表系统</h1>

    <!-- 图表管理工具栏 -->
    <div class="chart-toolbar">
      <el-button type="primary" @click="dialogVisible = true">添加图表</el-button>
      <el-button @click="addChart()">添加默认图表</el-button>
      <span class="chart-count">当前图表数量: {{ chartConfigs.length }}</span>
    </div>

    <!-- 图表配置对话框 -->
    <AddChart
      v-model:visible="dialogVisible"
      :config="chartConfigs[currentChartIndex]"
      :data-source="dataSource"
      :data-source-fields="dataSourceFields"
      :x-axis-fields="xAxisFields"
      :y-axis-fields="yAxisFields"
      @confirm="handleConfirm"
      @dataSourceChange="handleDataSourceChange"
    />

    <!-- 图表容器 -->
    <div class="charts-container">
      <div v-for="(config, index) in chartConfigs" :key="config.id" class="chart-item">
        <div class="chart-header">
          <h3>{{ config.title || `图表 ${index + 1}` }}</h3>
          <div class="chart-actions">
            <el-button size="small" @click="renderChart(config.id)">刷新</el-button>
            <el-button size="small" @click="showEditChart(config, index)">编辑</el-button>
            <el-button size="small" type="danger" @click="removeChart(config.id)">删除</el-button>
          </div>
        </div>
        <div ref="chartRefs" :data-chart-id="config.id" class="chart-container"></div>
      </div>
    </div>

    <!-- 空状态提示 -->
    <div v-if="chartConfigs.length === 0" class="empty-state">
      <p>暂无图表，点击上方按钮添加图表</p>
    </div>
  </div>
</template>

<style scoped>
.app-container {
  padding: 20px;
  max-width: 1200px;
  margin: 0 auto;
}

.chart-toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 24px;
  padding: 16px;
  background: #f5f7fa;
  border-radius: 8px;
}

.chart-count {
  margin-left: auto;
  color: #606266;
  font-size: 14px;
}

.charts-container {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(500px, 1fr));
  gap: 24px;
  margin-bottom: 24px;
}

.chart-item {
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  overflow: hidden;
  background: white;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
}

.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  background: #f8f9fa;
  border-bottom: 1px solid #e4e7ed;
}

.chart-header h3 {
  margin: 0;
  color: #303133;
  font-size: 16px;
  font-weight: 600;
}

.chart-actions {
  display: flex;
  gap: 8px;
}

.chart-container {
  height: 400px;
  padding: 16px;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: #909399;
  background: #f8f9fa;
  border-radius: 8px;
  border: 1px dashed #dcdfe6;
}

.empty-state p {
  margin: 0;
  font-size: 16px;
}

@media (max-width: 768px) {
  .charts-container {
    grid-template-columns: 1fr;
  }

  .chart-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .chart-count {
    margin-left: 0;
    text-align: center;
  }
}
</style>
