<template>
  <el-dialog v-model="dialogVisible" title="图表配置" width="80%" @close="handleClose">
    <el-form
      ref="configFormRef"
      label-position="top"
      class="chart-config-layout"
      :model="chartConfig"
      :rules="rules"
    >
      <!-- 左侧配置面板 -->
      <el-tabs v-model="activeTab" class="mb-10">
        <el-tab-pane label="基础配置" name="basic">
          <el-card shadow="hover" class="mb-10">
            <template #header>
              <div class="card-header">
                <span>图表类型</span>
              </div>
            </template>
            <div class="chart-type-group mb-10">
              <div
                v-for="item in chartTypes"
                :key="item.name"
                :class="['chart-type-item', { active: item.name === chartType }]"
                @click="handleChartTypeClick(item.name)"
              >
                <el-icon><component :is="item.icon" /></el-icon>
                <span>{{ item.label }}</span>
              </div>
            </div>
            <div class="checked-chart-type">
              <div class="mb-10">{{ chartTypesMap[chartType].label }}类型</div>
              <div class="chart-type-group">
                <div
                  v-for="item in currentChartTypes"
                  :key="item.name"
                  :class="['chart-type-item plain', { active: item.name === checkedChartType }]"
                  @click="handleCheckedChartType(item.name)"
                >
                  <img :src="item.imageURL" alt="" class="chart-type-image" />
                  <span>{{ item.label }}</span>
                </div>
              </div>
            </div>
          </el-card>

          <el-card shadow="hover">
            <template #header>
              <div class="card-header"><span>数据配置</span></div>
            </template>
            <el-form-item prop="title" label="标题">
              <el-input v-model="chartConfig.title" placeholder="请输入图表标题" />
            </el-form-item>
            <el-form-item label="颜色主题">
              <el-select
                v-model="chartConfig.colors"
                placeholder="请选择主题颜色"
                style="width: 100%"
              >
                <el-option
                  v-for="theme in COLOR_THEMES"
                  :key="theme.name"
                  :label="theme.name"
                  :value="theme.colors"
                >
                  <div class="color-option">
                    <div
                      v-for="c in theme.colors"
                      :key="c"
                      class="color-swatch"
                      :style="{ backgroundColor: c }"
                    />
                    <span class="theme-name">{{ theme.name }}</span>
                  </div>
                </el-option>
              </el-select>
            </el-form-item>
          </el-card>
        </el-tab-pane>
        <el-tab-pane label="更多配置" name="more">
          <el-collapse v-model="activeCollapse">
            <!-- 图例配置 -->
            <el-collapse-item name="legend">
              <template #title>
                <div class="collapse-title">
                  <span>图例</span>
                  <el-switch v-model="chartConfig.legend.show" />
                </div>
              </template>
              <el-form-item label="图例位置">
                <el-select
                  v-model="chartConfig.legend.position"
                  :disabled="!chartConfig.legend.show"
                >
                  <el-option label="靠上" value="top" />
                  <el-option label="靠下" value="bottom" />
                  <el-option label="靠左" value="left" />
                  <el-option label="靠右" value="right" />
                  <el-option label="右上" value="right-top" />
                </el-select>
              </el-form-item>
            </el-collapse-item>
            <!-- 数据标签 -->
            <el-collapse-item name="label">
              <template #title>
                <div class="collapse-title">
                  <span>数据标签</span>
                  <el-switch v-model="chartConfig.label.show" />
                </div>
              </template>
              <el-form-item label="标签位置">
                <el-select v-model="chartConfig.label.position" :disabled="!chartConfig.label.show">
                  <el-option label="居中" value="center" />
                  <el-option label="数据标签内" value="inside" />
                  <el-option label="数据标签外" value="outside" />
                  <el-option label="轴内侧" value="inner" />
                </el-select>
              </el-form-item>
            </el-collapse-item>
            <!-- 横坐标轴 -->
            <el-collapse-item name="xAxis">
              <template #title>
                <div class="collapse-title">
                  <span>横坐标轴</span>
                  <el-switch v-model="chartConfig.xAxis.show" />
                </div>
              </template>
              <el-form-item label="标题">
                <el-input v-model="chartConfig.xAxis.title" :disabled="!chartConfig.xAxis.show" />
              </el-form-item>
            </el-collapse-item>
            <!-- 纵坐标轴 -->
            <el-collapse-item name="yAxis">
              <template #title>
                <div class="collapse-title">
                  <span>纵坐标轴</span>
                  <el-switch v-model="chartConfig.yAxis.show" />
                </div>
              </template>
              <el-form-item label="标题">
                <el-input v-model="chartConfig.yAxis.title" :disabled="!chartConfig.yAxis.show" />
              </el-form-item>
              <el-form-item label="最小边界值">
                <el-input-number
                  v-model="chartConfig.yAxis.min"
                  :disabled="!chartConfig.yAxis.show"
                />
              </el-form-item>
              <el-form-item label="最大边界值">
                <el-input-number
                  v-model="chartConfig.yAxis.max"
                  :disabled="!chartConfig.yAxis.show"
                />
              </el-form-item>
              <el-form-item label="间距">
                <el-input-number
                  v-model="chartConfig.yAxis.interval"
                  :disabled="!chartConfig.yAxis.show"
                />
              </el-form-item>
              <el-form-item label="刻度数">
                <el-input-number
                  v-model="chartConfig.yAxis.tickCount"
                  :disabled="!chartConfig.yAxis.show"
                />
              </el-form-item>
            </el-collapse-item>
            <!-- 网格线 -->
            <el-collapse-item name="grid" disabled>
              <template #title>
                <div class="collapse-title">
                  <span>网格线</span>
                  <el-switch v-model="chartConfig.grid.show" />
                </div>
              </template>
            </el-collapse-item>
          </el-collapse>
        </el-tab-pane>
      </el-tabs>
      <!-- 右侧预览 -->
      <div class="preview-panel">
        <div ref="chartRef" class="chart-container"></div>
      </div>
    </el-form>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="handleClose">取消</el-button>
        <el-button type="primary" @click="handleConfirm">确定</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script lang="ts" setup>
import { ref, reactive, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { Chart } from '@antv/g2'
import { Histogram, TrendCharts, PieChart } from '@element-plus/icons-vue'
import type { FormInstance, FormRules } from 'element-plus'
import type {
  ChartConfig,
  ChartTypeItem,
  ChartType,
  CheckedChartType,
  CheckedChartTypeItem,
  ColumnDef,
} from './types'

// ========================== 常量定义 ==========================
const CHART_TYPES: ChartTypeItem<ChartTypeIcon>[] = [
  { name: 'bar', label: '柱状图', icon: Histogram },
  { name: 'line', label: '折线图', icon: TrendCharts },
  { name: 'pie', label: '饼图', icon: PieChart },
]

const COLOR_THEMES = [
  { name: '经典蓝绿黄红', colors: ['#1890ff', '#13c2c2', '#2fc25b', '#facc14', '#f04864'] },
  { name: '多彩鲜艳', colors: ['#722ed1', '#eb2f96', '#fa8c16', '#13c2c2', '#52c41a'] },
  { name: 'AntV 默认', colors: ['#5B8FF9', '#5AD8A6', '#5D7092', '#F6BD16', '#E8684A'] },
  { name: '森系绿灰', colors: ['#344E41', '#3A5A40', '#588157', '#A3B18A', '#DAD7CD'] },
  { name: '暖色沙漠', colors: ['#264653', '#2A9D8F', '#E9C46A', '#F4A261', '#E76F51'] },
]

const CURRENT_CHART_MAP: Record<ChartType, CheckedChartTypeItem[]> = {
  bar: [
    {
      label: '分组柱状图',
      name: 'bar_group',
      imageURL: new URL('@/assets/images/bar_group.png', import.meta.url).href,
    },
    {
      label: '堆积柱状图',
      name: 'bar_stacked',
      imageURL: new URL('@/assets/images/bar_stacked.png', import.meta.url).href,
    },
    {
      label: '百分比堆积柱状图',
      name: 'bar_percent',
      imageURL: new URL('@/assets/images/bar_stacked.png', import.meta.url).href,
    },
  ],
  line: [
    {
      label: '折线图',
      name: 'line',
      imageURL: new URL('@/assets/images/line.png', import.meta.url).href,
    },
    {
      label: '平滑折线图',
      name: 'line_smooth',
      imageURL: new URL('@/assets/images/line_smooth.png', import.meta.url).href,
    },
  ],
  pie: [
    {
      label: '饼图',
      name: 'pie',
      imageURL: new URL('@/assets/images/pie.png', import.meta.url).href,
    },
    {
      label: '环形图',
      name: 'pie_donut',
      imageURL: new URL('@/assets/images/pie_donut.png', import.meta.url).href,
    },
  ],
}

const DEFAULT_CONFIG: ChartConfig = {
  title: '示例图表',
  type: 'bar',
  colors: COLOR_THEMES[0]?.colors || [],
  showLegend: true,
  xTitle: '分类',
  yTitle: '数量',
  legend: {
    show: true,
    position: 'top',
  },
  label: {
    show: true,
    position: 'center',
  },
  xAxis: {
    show: true,
    title: '分类',
  },
  yAxis: {
    show: true,
    title: '数量',
  },
  grid: {
    show: true,
  },
}

// ========================== 类型定义 ==========================
type ChartTypeIcon = typeof Histogram | typeof TrendCharts | typeof PieChart
type ChartTypeItemMap = Record<ChartType, ChartTypeItem<ChartTypeIcon>>

interface Props {
  visible: boolean
  config: ChartConfig
  dataSource: {
    label: string
    tableData: Record<string, unknown>[]
    columns: ColumnDef[]
  }[]
}

// ========================== Props & Emits ==========================
const props = withDefaults(defineProps<Props>(), {
  visible: false,
  config: () => DEFAULT_CONFIG,
  dataSource: () => [
    {
      label: '数据集',
      tableData: [],
      columns: [],
    },
  ],
  xField: 'genre',
  yField: 'sold',
})

const emit = defineEmits<{
  'update:visible': [value: boolean]
  confirm: [
    payload: {
      config: ChartConfig
      chartType: ChartType
      checkedType: CheckedChartType
      yFields: { prop: string; label?: string }[]
      xField: string
    },
  ]
}>()

// ========================== 响应式状态 ==========================
const activeTab = ref<'basic' | 'advanced'>('basic')
const chartType = ref<ChartType>(props.config.type)
const checkedChartType = ref<CheckedChartType>('bar_group')
const chartConfig = ref<ChartConfig>({ ...DEFAULT_CONFIG })
const chartRef = ref<HTMLDivElement>()
const configFormRef = ref<FormInstance>()
const activeCollapse = ref(['legend', 'label', 'xAxis', 'grid']) // 默认展开所有

let chartInstance: Chart | null = null

// ========================== 计算属性 ==========================
const chartTypesMap = computed<ChartTypeItemMap>(() =>
  CHART_TYPES.reduce((acc, cur) => ({ ...acc, [cur.name]: cur }), {} as ChartTypeItemMap),
)

const chartTypes = CHART_TYPES

const currentChartTypes = computed(() => CURRENT_CHART_MAP[chartType.value])

const columns = computed<ColumnDef[]>(() => props.dataSource[0]?.columns || [])
const tableData = computed<Props['dataSource'][0]['tableData']>(
  () => props.dataSource[0]?.tableData || [],
)

const numericColumns = computed(() => {
  const cols = columns.value || []
  if (!tableData.value.length) return cols
  return cols.filter((c) => {
    const sample = tableData.value
      .slice(0, 10)
      .map((r) => r[c.prop])
      .filter((v) => v !== undefined && v !== null)
    if (!sample.length) return false
    return sample.every((v) => !Number.isNaN(Number(v)))
  })
})

const yFields = ref<{ prop: string; label?: string }[]>([])
const selectedXField = ref<string>(props.dataSource[0]?.xField || columns.value[0]?.prop || '')

const dialogVisible = computed({
  get: () => props.visible,
  set: (v: boolean) => emit('update:visible', v),
})

// ========================== 表单验证规则 ==========================
const rules = reactive<FormRules<ChartConfig>>({
  title: {
    required: true,
    message: '请输入图表标题',
    trigger: 'blur',
  },
  colors: {
    required: true,
    message: '请选择图表颜色',
    trigger: 'change',
  },
  showLegend: {
    required: true,
    message: '请选择是否显示图例',
    trigger: 'change',
  },
  xTitle: {
    required: true,
    message: '请输入横轴标题',
    trigger: 'blur',
  },
  yTitle: {
    required: true,
    message: '请输入纵轴标题',
    trigger: 'blur',
  },
})

// ========================== 数据转换函数 ==========================
/**
 * 将宽表数据转换为长表格式
 */
const wideToLong = (
  data: Props['tableData'],
  xField: string,
  yFieldsList: { prop: string; label?: string }[],
): Props['tableData'] => {
  const longData: Props['tableData'] = []

  for (const row of data) {
    for (const yField of yFieldsList) {
      const value = Number(row?.[yField.prop])
      if (Number.isNaN(value)) continue

      longData.push({
        [xField]: row[xField],
        series: yField.label || yField.prop,
        value,
        __raw: row,
      })
    }
  }

  return longData
}

/**
 * 确保数据包含颜色字段
 */
const ensureColorField = (data: Props['tableData'], colorField: string): Props['tableData'] => {
  if (!data.length) return data
  if (!Object.prototype.hasOwnProperty.call(data[0], colorField)) {
    return data.map((d) => ({ ...d, [colorField]: '默认系列' }))
  }
  return data
}

/**
 * 检测数据中的颜色字段
 */
const detectColorField = (data: Props['tableData']): string => {
  if (!data.length) return 'series'
  const first = data[0]
  const candidates = Object.keys(first || {}).filter(
    (k) => k !== 'x' && k !== 'y' && k !== 'value' && k !== '__raw',
  )
  return candidates[0] || 'series'
}

/**
 * 准备图表数据
 */
const prepareChartData = (): Props['tableData'] => {
  const sourceData = tableData.value?.length ? tableData.value : getDefaultChartData()

  // 对于多Y字段的情况，转换为长表格式
  if (yFields.value.length > 1) {
    return wideToLong(sourceData, selectedXField.value, yFields.value)
  }

  // 单Y字段，确保有颜色字段
  return ensureColorField(sourceData, detectColorField(sourceData))
}

// ========================== 图表渲染函数 ==========================
/**
 * 初始化图表实例
 */
const initChart = () => {
  if (!chartRef.value) return

  // 销毁旧实例
  if (chartInstance) {
    chartInstance.destroy()
  }

  // 创建新实例
  chartInstance = new Chart({
    container: chartRef.value,
    autoFit: true,
    height: 560,
  })
}

/**
 * 创建柱状图配置
 */
const createBarChartSpec = (data: Props['tableData']) => {
  const xField = selectedXField.value
  const colorField = detectColorField(data)

  const baseSpec = {
    type: 'interval' as const,
    data,
    encode: {
      x: xField,
      y: yFields.value[0]?.prop || 'value',
      color: colorField,
    },
  }

  switch (checkedChartType.value) {
    case 'bar_group':
      return {
        ...baseSpec,
        adjust: [{ type: 'dodge' as const, marginRatio: 0.2 }],
      }
    case 'bar_stacked':
      return {
        ...baseSpec,
        transform: [{ type: 'stackY' as const }],
      }
    case 'bar_percent':
      return {
        ...baseSpec,
        transform: [{ type: 'stackY' as const }],
        scale: { y: { domain: [0, 1] } },
      }
    default:
      return baseSpec
  }
}

/**
 * 创建折线图配置
 */
const createLineChartSpec = (data: Props['tableData']) => {
  const xField = selectedXField.value
  const colorField = detectColorField(data)

  const baseSpec = {
    type: 'line' as const,
    data,
    encode: {
      x: xField,
      y: yFields.value[0]?.prop || 'value',
      color: colorField,
    },
    style: { lineWidth: 2 },
  }

  if (checkedChartType.value === 'line_smooth') {
    return {
      ...baseSpec,
      style: { ...baseSpec.style, shape: 'smooth' as const },
    }
  }
}

/**
 * 创建饼图配置
 */
const createPieChartSpec = (data: Props['tableData']) => {
  const innerRadius = checkedChartType.value === 'pie_donut' ? 0.5 : 0

  return {
    type: 'interval' as const,
    data,
    coordinate: { type: 'theta' as const, innerRadius },
    transform: [{ type: 'stackY' as const }],
    encode: {
      y: yFields.value[0]?.prop || 'value',
      color: detectColorField(data),
    },
  }
}

/**
 * 渲染图表
 */
const renderChart = () => {
  initChart()

  const data = prepareChartData()

  // 根据图表类型创建对应的配置
  let childSpec
  switch (chartType.value) {
    case 'bar':
      childSpec = createBarChartSpec(data)
      break
    case 'line':
      childSpec = createLineChartSpec(data)
      break
    case 'pie':
      childSpec = createPieChartSpec(data)
      break
    default:
      childSpec = createBarChartSpec(data)
  }

  // 基础配置
  const baseOptions = {
    title: chartConfig.value.title,
    data,
    color: {
      range: chartConfig.value.colors,
    },
    children: [childSpec],
  }

  // 添加坐标轴配置（饼图不需要坐标轴）
  if (chartType.value !== 'pie') {
    Object.assign(baseOptions, {
      axis: {
        x: { title: chartConfig.value.xTitle },
        y: { title: chartConfig.value.yTitle },
      },
    })
  }

  // 设置图例
  if (chartConfig.value.showLegend) {
    Object.assign(baseOptions, {
      legend: { color: {} },
    })
  }

  chartInstance?.options(baseOptions)
  chartInstance?.render()
}

/**
 * 获取默认图表数据
 */
const getDefaultChartData = (): Props['tableData'] => {
  return [
    { genre: '类别A', value: 11, series: '系列1' },
    { genre: '类别B', value: 1, series: '系列1' },
    { genre: '类别C', value: 2, series: '系列1' },
    { genre: '类别A', value: 3, series: '系列2' },
    { genre: '类别B', value: 3, series: '系列2' },
    { genre: '类别C', value: 4, series: '系列2' },
  ]
}

/**
 * 初始化Y字段
 */
const initializeYFields = () => {
  if (numericColumns.value.length > 0) {
    yFields.value = [{ prop: numericColumns.value[0]?.prop || 'value', label: '' }]
  } else if (columns.value.length > 0) {
    yFields.value = [{ prop: columns.value[0]?.prop || 'value', label: '' }]
  } else {
    yFields.value = []
  }
}

// ========================== 事件处理函数 ==========================
const handleChartTypeClick = (type: ChartType) => {
  chartType.value = type
  checkedChartType.value = CURRENT_CHART_MAP[type][0]?.name || 'bar_group'
  nextTick(() => renderChart())
}

const handleCheckedChartType = (type: CheckedChartType) => {
  checkedChartType.value = type
  nextTick(() => renderChart())
}

const handleClose = () => {
  emit('update:visible', false)
}

const handleConfirm = () => {
  configFormRef.value?.validate((valid) => {
    if (valid) {
      emit('confirm', {
        config: chartConfig.value,
        chartType: chartType.value,
        checkedType: checkedChartType.value,
        yFields: yFields.value,
        xField: selectedXField.value,
      })
      handleClose()
    }
  })
}

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      // 重置配置
      chartConfig.value = { ...DEFAULT_CONFIG }
      chartType.value = props.current
      selectedXField.value = props.xField || columns.value[0]?.prop || ''
      initializeYFields()

      // 延迟初始化图表，确保DOM已渲染
      nextTick(() => {
        renderChart()
      })
    } else {
      // 销毁图表实例
      if (chartInstance) {
        chartInstance.destroy()
        chartInstance = null
      }
    }
  },
  { immediate: true },
)

// 监听配置变化
watch(
  [() => chartConfig.value],
  () => {
    if (props.visible) {
      nextTick(() => {
        renderChart()
      })
    }
  },
  { deep: true },
)
onBeforeUnmount(() => {
  if (chartInstance) {
    chartInstance.destroy()
    chartInstance = null
  }
})
</script>

<style lang="scss" scoped>
.mb-10 {
  margin-bottom: 10px;
}
:deep(.el-collapse-item__header) {
  gap: 10px;
}
:deep(.el-tabs__content) {
  width: 400px;
  overflow-y: auto;
}

.chart-config-layout {
  display: flex;
  gap: 20px;
  height: 800px;
}
.preview-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.chart-container {
  flex: 1;
  background-color: #fafafa;
  border-radius: 4px;
  padding: 20px;
}
.chart-type-group {
  display: flex;
  align-items: center;
  gap: 10px;
  .chart-type-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 5px 10px;
    border-radius: 4px;
    cursor: pointer;
    transition: background-color 0.3s;
    &:hover {
      background-color: #e6f7ff;
    }
    &.active {
      background-color: rgba($color: #1890ff, $alpha: 0.2);
      color: #1890ff;
    }
    &.plain {
      background-color: transparent;
      border: 1px solid #eee;
      transition: border-color 0.3s;
      &:hover {
        border: 1px solid #ccc;
      }
      &.active {
        border-color: #1890ff;
      }
    }
    .chart-type-image {
      width: 80px;
      height: 40px;
    }
  }
}
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.dialog-footer {
  display: flex;
  justify-content: flex-end;
}

.color-option {
  display: flex;
  align-items: center;
  gap: 6px;
}
.color-swatch {
  width: 18px;
  height: 18px;
  border-radius: 3px;
  border: 1px solid #ccc;
}
.theme-name {
  margin-left: 8px;
  font-size: 13px;
  color: #555;
}
.collapse-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
</style>
