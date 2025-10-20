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
          <div class="config-panel">
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
                    :key="item.label"
                    :class="['chart-type-item plain', { active: item.name === checkedCartType }]"
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
              <el-form-item prop="color" label="颜色">
                <el-color-picker v-model="chartConfig.color" show-alpha />
              </el-form-item>
              <el-form-item prop="showLegend" label="显示图例">
                <el-switch v-model="chartConfig.showLegend" />
              </el-form-item>
              <el-form-item prop="xTitle" label="横轴标题">
                <el-input v-model="chartConfig.xTitle" placeholder="请输入横轴标题" />
              </el-form-item>
              <el-form-item prop="yTitle" label="纵轴标题">
                <el-input v-model="chartConfig.yTitle" placeholder="请输入纵轴标题" />
              </el-form-item>
            </el-card>
          </div>
        </el-tab-pane>
        <el-tab-pane label="更多配置" name="advanced" />
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
import { Chart, type G2Spec } from '@antv/g2'
import { Histogram, TrendCharts, PieChart } from '@element-plus/icons-vue'
import type { FormInstance, FormRules } from 'element-plus'
import type {
  ChartConfig,
  ChartTypeItem,
  ChartDataItem,
  ChartType,
  CheckedChartType,
  CheckedChartTypeItem,
} from './types'

// ========================== 类型定义 ==========================
type ChartTypeIcon = typeof Histogram | typeof TrendCharts | typeof PieChart
type ChartTypeItemMap = Record<ChartType, ChartTypeItem<ChartTypeIcon>>

interface Props {
  visible: boolean // 是否显示弹窗
  current?: ChartType // 当前选中的图表类型
  tableData?: unknown[]
  columns?: { prop: string; label?: string }[]
  xField?: string // 横轴字段
  yField?: string // 纵轴字段
}

// ========================== Props & Emits ==========================
const props = withDefaults(defineProps<Props>(), {
  visible: false,
  current: 'bar',
  data: () => [],
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

// ========================== 状态与映射 ==========================
const chartTypesMap = computed<ChartTypeItemMap>(() =>
  chartTypes.reduce((acc, cur) => ({ ...acc, [cur.name]: cur }), {} as ChartTypeItemMap),
)

const CHART_TYPES: ChartTypeItem<ChartTypeIcon>[] = [
  { name: 'bar', label: '柱状图', icon: Histogram },
  { name: 'line', label: '折线图', icon: TrendCharts },
  { name: 'pie', label: '饼图', icon: PieChart },
]

// 默认配置
const DEFAULT_CONFIG: ChartConfig = {
  title: '示例图表',
  color: '#1890ff',
  showLegend: true,
  xTitle: '分类',
  yTitle: '数量',
}

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

const chartTypes = CHART_TYPES
const activeTab = ref<'basic' | 'advanced' | 'preview'>('basic')
const chartType = ref<ChartType>(props.current || 'bar')
const currentChartTypes = computed(() => CURRENT_CHART_MAP[chartType.value])
const checkedCartType = ref<CheckedChartType>('bar_group')
const chartConfig = ref<ChartConfig>({ ...DEFAULT_CONFIG })

// 表单
const configFormRef = ref<FormInstance>()
const rules = reactive<FormRules<ChartConfig>>({
  title: {
    required: true,
    message: '请输入图表标题',
    trigger: 'blur',
  },
  color: {
    required: true,
    message: '请输入图表颜色',
    trigger: 'blur',
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

// 初始化组件状态
const initComponentState = () => {
  // 重置为默认配置
  chartConfig.value = { ...DEFAULT_CONFIG }

  // 设置当前图表类型
  chartType.value = props.current || 'bar'

  // 设置默认选中的具体图表类型
  const firstType = CURRENT_CHART_MAP[chartType.value][0] || { name: 'bar_group' }
  checkedCartType.value = firstType.name

  // 重置标签页
  activeTab.value = 'basic'
}

const chartRef = ref<HTMLDivElement>()
let chartInstance: Chart | null = null

// ---------------------- 双向绑定 ----------------------
const dialogVisible = computed({
  get: () => props.visible,
  set: (v: boolean) => emit('update:visible', v),
})

// ---------------------- 通用数据映射字段 ----------------------
const xField = computed(() => props.xField || 'x')
const yField = computed(() => props.yField || 'y')

// ========================== 渲染逻辑 ==========================
function handleChartTypeClick(type: ChartType) {
  chartType.value = type
  // 默认选中当前图表类型的第一个具体类型
  const firstType = CURRENT_CHART_MAP[type][0] || { name: 'bar_group' }
  checkedCartType.value = firstType.name
  renderChart()
}

function handleCheckedChartType(type: CheckedChartType) {
  checkedCartType.value = type
}

function handleClose() {
  emit('update:visible', false)
}

function handleConfirm() {
  configFormRef.value?.validate((valid) => {
    if (valid) {
      emit('confirm', {
        config: chartConfig.value,
        chartType: chartType.value,
        checkedType: checkedCartType.value,
        // yField: yField.value,
        // xField: xField.value,
      })
      handleClose()
    }
  })
}

// ========== 细粒度渲染映射表 ==========

function detectColorField(data: ChartDataItem[]): string {
  if (!data.length) return '__default'
  const first = data[0]
  const candidates = Object.keys(first || {}).filter(
    (k) => k !== xField.value && k !== yField.value,
  )
  return candidates[0] || '__default'
}

function prepareData(data: ChartDataItem[]): ChartDataItem[] {
  const colorKey = detectColorField(data)
  if (colorKey === '__default') {
    return data.map((d) => ({ ...d, __default: '系列A' }))
  }
  return data
}

const RENDER_MAP: Record<CheckedChartType, (data: ChartDataItem[]) => G2Spec> = {
  bar_group: (data) => ({
    type: 'interval',
    data,
    encode: {
      x: xField.value,
      y: yField.value,
      color: detectColorField(data),
    },
  }),
  bar_stacked: (data) => ({
    type: 'interval',
    autoFit: true,
    data,
    encode: {
      x: xField.value,
      y: yField.value,
      color: detectColorField(data),
    },
    transform: [{ type: 'stackY' }],
    interaction: { elementHighlight: { background: true } },
  }),
  bar_percent: (data) => ({
    type: 'interval',
    data,
    encode: {
      x: xField.value,
      y: yField.value,
      color: detectColorField(data),
    },
    transform: [{ type: 'stackY', y: 'y1' }],
  }),
  line: (data) => ({
    type: 'line',
    data,
    encode: {
      x: xField.value,
      y: yField.value,
      color: detectColorField(data),
      shape: 'line',
    },
    style: { lineWidth: 2 },
  }),
  line_smooth: (data) => ({
    type: 'line',
    data,
    encode: {
      x: xField.value,
      y: yField.value,
      color: detectColorField(data),
      shape: 'smooth',
    },
    style: { lineWidth: 2 },
  }),
  pie: (data) => ({
    type: 'interval',
    coordinate: { type: 'theta', radius: 0.8 },
    data,
    transform: [{ type: 'stackY' }],
    encode: {
      y: yField.value,
      // color: detectColorField(data),
    },
  }),
  pie_donut: (data) => ({
    type: 'interval',
    coordinate: { type: 'theta', radius: 0.8, innerRadius: 0.5 },
    data,
    transform: [{ type: 'stackY' }],
    encode: {
      y: yField.value,
      // color: detectColorField(data),
    },
  }),
}

// ========== 渲染主函数 ==========
function renderChart(): void {
  if (!chartInstance) return

  let data = props.data?.length ? props.data : getDefaultChartData()
  data = prepareData(data) // 确保多维字段存在

  const type = checkedCartType.value as CheckedChartType
  const renderOption = RENDER_MAP[type]?.(data)
  if (!renderOption) return

  const baseOptions: G2Spec = {
    title: chartConfig.value.title,
    legend: chartConfig.value.showLegend ? {} : false,
    axis:
      chartType.value !== 'pie'
        ? {
            x: { title: chartConfig.value.xTitle },
            y: { title: chartConfig.value.yTitle },
          }
        : false,
    tooltip: {
      items: [
        { channel: xField.value, name: chartConfig.value.xTitle },
        { channel: yField.value, name: chartConfig.value.yTitle },
      ],
    },
    children: [renderOption],
  }

  chartInstance.options(baseOptions)
  chartInstance.render()
}

// ========== 默认数据 ==========
function getDefaultChartData(): ChartDataItem[] {
  return [
    { genre: 'Sports', sold: 275, series: 'A' },
    { genre: 'Strategy', sold: 115, series: 'B' },
    { genre: 'Action', sold: 120, series: 'A' },
    { genre: 'Shooter', sold: 350, series: 'B' },
    { genre: 'Other', sold: 150, series: 'A' },
    { genre: 'Others', sold: 150, series: 'B' },
  ]
}

function initChart() {
  nextTick(() => {
    chartInstance = new Chart({
      container: chartRef.value!,
      autoFit: true,
      height: 680,
    })
    renderChart()
  })
}

onBeforeUnmount(() => chartInstance?.destroy())

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      initComponentState()
      initChart()
    }
  },
)

watch(
  [() => props.visible, checkedCartType, chartConfig],
  ([visible]) => {
    if (visible) nextTick(() => renderChart())
  },
  { deep: true },
)
</script>

<style lang="scss" scoped>
.mb-10 {
  margin-bottom: 10px;
}
.chart-config-layout {
  display: flex;
  gap: 20px;
  height: 800px;
}
.config-panel {
  width: 400px;
  overflow-y: auto;
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
</style>
