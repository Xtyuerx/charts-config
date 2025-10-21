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
  ChartType,
  CheckedChartType,
  CheckedChartTypeItem,
  ColumnDef,
} from './types'

// ========================== 类型定义 ==========================
type ChartTypeIcon = typeof Histogram | typeof TrendCharts | typeof PieChart
type ChartTypeItemMap = Record<ChartType, ChartTypeItem<ChartTypeIcon>>

interface Props {
  visible: boolean // 是否显示弹窗
  current?: ChartType // 当前选中的图表类型
  tableData: Record<string, unknown>[]
  columns: ColumnDef[]
  xField?: string // 横轴字段
  yField?: string // 纵轴字段
}

// ========================== Props & Emits ==========================
const props = withDefaults(defineProps<Props>(), {
  visible: false,
  current: 'bar',
  tableData: () => [],
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

const COLOR_THEMES = [
  { name: '经典蓝绿黄红', colors: ['#1890ff', '#13c2c2', '#2fc25b', '#facc14', '#f04864'] },
  { name: '多彩鲜艳', colors: ['#722ed1', '#eb2f96', '#fa8c16', '#13c2c2', '#52c41a'] },
  { name: 'AntV 默认', colors: ['#5B8FF9', '#5AD8A6', '#5D7092', '#F6BD16', '#E8684A'] },
  { name: '森系绿灰', colors: ['#344E41', '#3A5A40', '#588157', '#A3B18A', '#DAD7CD'] },
  { name: '暖色沙漠', colors: ['#264653', '#2A9D8F', '#E9C46A', '#F4A261', '#E76F51'] },
]

// 默认配置
const DEFAULT_CONFIG: ChartConfig = {
  title: '示例图表',
  colors: COLOR_THEMES[0]?.colors || [],
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

const chartRef = ref<HTMLDivElement>()
let chartInstance: Chart | null = null
/* -------------------- 从表格生成字段候选 -------------------- */
const columns = computed<ColumnDef[]>(() => props.columns || [])
const tableData = computed<Props['tableData']>(() => props.tableData || [])

// 试探性判断数值列（尽量只保留能被解析为数字的字段）
const numericColumns = computed(() => {
  const cols = columns.value || []
  if (!tableData.value.length) return cols
  return cols.filter((c) => {
    // 检查前 10 条是否为数字
    const sample = tableData.value
      .slice(0, 10)
      .map((r) => r[c.prop])
      .filter((v) => v !== undefined && v !== null)
    if (!sample.length) return false
    return sample.every((v) => !Number.isNaN(Number(v)))
  })
})

const yFields = ref<{ prop: string; label?: string }[]>(
  props.yField
    ? [{ prop: props.yField, label: '' }]
    : numericColumns.value[0]
      ? [{ prop: numericColumns.value[0].prop, label: '' }]
      : [],
)
const selectedXField = ref<string>(props.xField || columns.value[0]?.prop || '')

// ---------------------- 双向绑定 ----------------------
const dialogVisible = computed({
  get: () => props.visible,
  set: (v: boolean) => emit('update:visible', v),
})

// ---------------------- 通用数据映射字段 ----------------------
const xField = computed(() => props.xField || 'x')
const yField = computed(() => props.yField || 'y')

// 将“宽表”转换为长表，为多纵字段分组显示 (series/value)
function wideToLong(
  data: Props['tableData'],
  xField: string,
  yFieldsList: { prop: string; label?: string }[],
) {
  const long: Props['tableData'] = []
  for (const row of data) {
    for (const y of yFieldsList) {
      const value = Number(row?.[y.prop])
      // 过滤非数值条目
      if (Number.isNaN(value)) continue
      long.push({
        [xField]: row[xField],
        series: y.label || y.prop,
        value,
        __raw: row,
      })
    }
  }
  return long
}

// 单系列数据：确保 color 字段存在
function ensureColorField(data: Props['tableData'], colorField: string) {
  if (!data.length) return data
  if (!Object.prototype.hasOwnProperty.call(data[0], colorField)) {
    return data.map((d) => ({ ...d, [colorField]: '__series__' }))
  }
  return data
}

// ========== 细粒度渲染映射表 ==========

function detectColorField(data: Props['tableData']): string {
  if (!data.length) return '__default'
  const first = data[0]
  const candidates = Object.keys(first || {}).filter(
    (k) => k !== xField.value && k !== yField.value,
  )
  return candidates[0] || '__default'
}
function prepareData(data: Props['tableData']): Props['tableData'] {
  const colorKey = detectColorField(data)
  if (colorKey === '__default') {
    return data.map((d) => ({ ...d, __default: '系列A' })) // 确保有 series 分组
  }
  return data
}

const RENDER_MAP: Record<
  CheckedChartType,
  (opts: {
    data: Props['tableData']
    xField: string
    yFieldsList: { prop: string; label?: string }[]
  }) => G2Spec
> = {
  bar_group: ({ data, xField, yFieldsList }) => {
    // 多纵字段 -> long format，并 color=series
    if (yFieldsList.length > 1) {
      const long = wideToLong(data, xField, yFieldsList)
      return {
        type: 'interval',
        data: long,
        encode: { x: xField, y: 'value', color: 'series' },
        adjust: [{ type: 'dodge', marginRatio: 0.2 }],
      }
    }
    // 单纵字段 -> 直接使用 y field prop
    const yProp = yFieldsList[0]?.prop || 'value'
    return {
      type: 'interval',
      data: ensureColorField(data, '__series__'),
      encode: { x: xField, y: yProp, color: '__series__' },
    }
  },
  bar_stacked: ({ data, xField, yFieldsList }) => {
    // 将宽表转换后 stack
    if (yFieldsList.length > 1) {
      const long = wideToLong(data, xField, yFieldsList)
      return {
        type: 'interval',
        data: long,
        encode: { x: xField, y: 'value', color: 'series' },
        transform: [{ type: 'stackY' }],
      }
    }
    const yProp = yFieldsList[0]?.prop || 'value'
    return {
      type: 'interval',
      data: data,
      encode: { x: xField, y: yProp, color: detectColorField(data) },
      transform: [{ type: 'stackY' }],
    }
  },
  bar_percent: ({ data, xField, yFieldsList }) => {
    if (yFieldsList.length > 1) {
      const long = wideToLong(data, xField, yFieldsList)
      return {
        type: 'interval',
        data: long,
        encode: { x: xField, y: 'value', color: 'series' },
        transform: [{ type: 'stackY', y: 'y1' }],
      }
    }
    const yProp = yFieldsList[0]?.prop || 'value'
    return {
      type: 'interval',
      data,
      encode: { x: xField, y: yProp, color: detectColorField(data) },
      transform: [{ type: 'stackY', y: 'y1' }],
    }
  },

  line: ({ data }) => ({
    type: 'line',
    data,
    encode: {
      x: xField.value,
      y: yField.value,
      color: detectColorField(data),
    },
    style: { lineWidth: 2 },
    interaction: { tooltip: true },
  }),
  line_smooth: ({ data }) => ({
    type: 'line',
    data,
    encode: {
      x: xField.value,
      y: yField.value,
      color: detectColorField(data),
    },
    style: { lineWidth: 2, shape: 'smooth' },
    interaction: { tooltip: true },
  }),

  pie: ({ data, xField, yFieldsList }) => {
    // 仅支持单一 y 字段或已转换的 long 格式
    if (yFieldsList.length > 1) {
      const long = wideToLong(data, xField, yFieldsList)
      return {
        type: 'interval',
        coordinate: { type: 'theta', radius: 0.8, innerRadius: 0 },
        data: long,
        transform: [{ type: 'stackY' }],
        encode: { y: 'value', color: 'series' },
      }
    }
    const yProp = yFieldsList[0]?.prop || 'value'
    return {
      type: 'interval',
      coordinate: { type: 'theta', radius: 0.8, innerRadius: 0 },
      data,
      transform: [{ type: 'stackY' }],
      encode: { y: yProp, color: detectColorField(data) },
    }
  },

  pie_donut: ({ data, xField, yFieldsList }) => {
    if (yFieldsList.length > 1) {
      const long = wideToLong(data, xField, yFieldsList)
      return {
        type: 'interval',
        coordinate: { type: 'theta', radius: 0.8, innerRadius: 0.5 },
        data: long,
        transform: [{ type: 'stackY' }],
        encode: { y: 'value', color: 'series' },
      }
    }
    const yProp = yFieldsList[0]?.prop || 'value'
    return {
      type: 'interval',
      coordinate: { type: 'theta', radius: 0.8, innerRadius: 0.5 },
      data,
      transform: [{ type: 'stackY' }],
      encode: { y: yProp, color: detectColorField(data) },
    }
  },
}

// ========== 渲染主函数 ==========
function renderChart() {
  if (!chartInstance) return
  // 数据来源优先 props.tableData，否则默认示例
  let data = tableData.value?.length ? tableData.value : getDefaultChartData()
  data = prepareData(data)
  // 如果单纵字段且字段不在原始数据中，尝试保留原样（有时候是 value 字段）
  // 处理 render 参数
  const x = selectedXField.value || columns.value[0]?.prop || 'x'
  const yList = yFields.value.length
    ? yFields.value
    : [{ prop: props.yField || 'value', label: props.yField || 'value' }]
  const typeKey = checkedCartType.value || 'bar_group'

  const renderFn = RENDER_MAP[typeKey]
  const childSpec = renderFn ? renderFn({ data, xField: x, yFieldsList: yList }) : null
  if (!childSpec) return

  // 基础 options
  const baseOptions: G2Spec = {
    title: chartConfig.value.title,
    legend: false,
    color: { range: chartConfig.value.colors },
    axis:
      chartType.value !== 'pie'
        ? {
            [x]: { title: chartConfig.value.xTitle },
            y: {
              title: chartConfig.value.yTitle,
              min: undefined,
              max: undefined,
              tickInterval: undefined,
              type: undefined,
            },
          }
        : false,
    tooltip: {
      items: [
        { channel: x, name: chartConfig.value.xTitle },
        { channel: yList[0]?.prop || 'value', name: chartConfig.value.yTitle },
      ],
    },
    coordinate: undefined,
    children: [childSpec],
    // grid lines control handled via axis styles in G2 spec; G2 Spec here is minimal — more customization may be required per G2 version
  }

  chartInstance.options(baseOptions)
  chartInstance.render()
}

/* -------------------- 初始化 chart -------------------- */
function initChart() {
  nextTick(() => {
    if (chartInstance) {
      chartInstance.destroy()
      chartInstance = null
    }
    chartInstance = new Chart({
      container: chartRef.value!,
      autoFit: true,
      height: 560,
    })
    renderChart()
  })
}

/* -------------------- 默认数据 (演示) -------------------- */
function getDefaultChartData(): Props['tableData'] {
  return [
    { genre: '2025-10-14', num1: 11, num2: 3 },
    { genre: '2025-10-23', num1: 1, num2: 4 },
    { genre: '2025-10-24', num1: 2, num2: 5 },
  ]
}

/* -------------------- 操作函数 -------------------- */
function handleChartTypeClick(type: ChartType) {
  chartType.value = type
  const firstType = CURRENT_CHART_MAP[type][0]?.name || 'bar_group'
  checkedCartType.value = firstType
  renderChart()
}

function handleCheckedChartType(type: CheckedChartType) {
  checkedCartType.value = type
  renderChart()
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
        yFields: yFields.value,
        xField: selectedXField.value,
      })
      handleClose()
    }
  })
}

/* 增/删 纵轴字段 */
function addYField() {
  const candidate = numericColumns.value[0]?.prop || columns.value[0]?.prop || ''
  yFields.value.push({ prop: candidate, label: '' })
}

function removeYField(idx: number) {
  yFields.value.splice(idx, 1)
}

/* -------------------- 交互/监听 -------------------- */
watch(
  () => props.visible,
  (v) => {
    if (v) {
      // 初始化默认值
      chartConfig.value = { ...DEFAULT_CONFIG }
      chartType.value = props.current || 'bar'
      selectedXField.value = props.xField || columns.value[0]?.prop || ''
      if (!yFields.value.length && numericColumns.value.length) {
        yFields.value = [{ prop: numericColumns.value[0]?.prop || '', label: '' }]
      }
      nextTick(() => initChart())
    } else {
      // visible -> false 时销毁实例以释放资源
      chartInstance?.destroy()
      chartInstance = null
    }
  },
  { immediate: true },
)

watch(
  [
    () => props.tableData,
    () => props.columns,
    yFields,
    selectedXField,
    checkedCartType,
    chartConfig,
  ],
  () => {
    // 数据或配置变化时重新渲染
    if (props.visible) nextTick(() => renderChart())
  },
  { deep: true },
)

onBeforeUnmount(() => {
  chartInstance?.destroy()
})
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
</style>
