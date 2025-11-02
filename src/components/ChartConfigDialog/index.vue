<template>
  <el-dialog
    v-model="dialogVisible"
    title="图表配置"
    width="80%"
    align-center
    destroy-on-close
    @close="handleClose"
    @closed="reset"
  >
    <el-form
      ref="configFormRef"
      label-position="top"
      class="chart-config-layout"
      :model="chartConfig"
      :rules="rules"
    >
      <!-- 左侧配置面板 -->
      <ConfigForm />
      <!-- 右侧预览 -->
      <ChartPanel />
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
import { ref, reactive, computed, provide, watch } from 'vue'
import type { FormInstance, FormRules } from 'element-plus'
import { DEFAULT_CONFIG } from './constants'
import ConfigForm from './ConfigForm.vue'
import ChartPanel from './ChartPanel.vue'
import { useChartConfig } from './useChartConfig'
import type { ChartConfig, Props, OptionFields } from './types'

const { setConfig, chartConfig, reset } = useChartConfig()

// ========================== Props & Emits ==========================
const props = withDefaults(defineProps<Props>(), {
  visible: false,
  config: () => DEFAULT_CONFIG,
  dataSource: () => [],
  dataSourceFields: () => [
    {
      text: '数据集',
      label: '数据集',
      key: 'dataset',
      value: 0,
    },
  ],
  xAxisFields: () => [],
  yAxisFields: () => [],
})

const emit = defineEmits<{
  'update:visible': [value: boolean]
  dataSourceChange: [value: OptionFields]
  confirm: [value: ChartConfig]
}>()

const onDataSourceChange = (value: OptionFields) => {
  emit('dataSourceChange', value)
}

provide('dataSource', computed(() => props.dataSource))
provide('dataSourceFields', computed(() => props.dataSourceFields))
provide('xAxisFields', computed(() => props.xAxisFields))
provide('yAxisFields', computed(() => props.yAxisFields))
provide('onDataSourceChange', onDataSourceChange)

// ========================== 响应式状态 ==========================
const configFormRef = ref<FormInstance>()

// ========================== 计算属性 ==========================
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
  theme: {
    required: true,
    message: '请选择图表颜色',
    trigger: 'change',
  },
  legend: {
    required: true,
    message: '请选择是否显示图例',
    trigger: 'change',
  },
  xAxis: {
    required: true,
    message: '请输入横轴标题',
    trigger: 'blur',
  },
  yAxis: {
    required: true,
    message: '请输入纵轴标题',
    trigger: 'blur',
  },
})

const handleClose = () => {
  emit('update:visible', false)
}

const handleConfirm = () => {
  configFormRef.value?.validate((valid) => {
    if (valid) {
      console.log('chartConfig.value', chartConfig.value)
      emit('confirm', chartConfig.value)
      handleClose()
    }
  })
}

watch(
  () => props.config,
  (newVal) => {
    setConfig(newVal)
  },
  {
    deep: true,
  },
)
</script>

<style lang="scss" scoped>
.chart-config-layout {
  display: flex;
  gap: 20px;
  height: 800px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
}
</style>
