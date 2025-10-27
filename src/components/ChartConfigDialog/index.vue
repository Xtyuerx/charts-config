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
import type { ChartConfig, Props } from './types'

const { setConfig, chartConfig, reset } = useChartConfig()

// ========================== Props & Emits ==========================
const props = withDefaults(defineProps<Props>(), {
  visible: false,
  config: () => DEFAULT_CONFIG,
  dataSource: () => [
    {
      label: '数据集',
      value: 0,
      tableData: [],
      columns: [],
    },
  ],
  xField: 'genre',
  yField: 'sold',
})

const emit = defineEmits<{
  'update:visible': [value: boolean]
  confirm: [value: ChartConfig]
}>()

provide('dataSource', props.dataSource)

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
