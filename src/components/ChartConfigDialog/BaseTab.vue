<template>
  <el-card shadow="hover" class="mb-10">
    <template #header>
      <div class="card-header">
        <span>图表类型</span>
      </div>
    </template>
    <div class="chart-type-group mb-10">
      <div
        v-for="item in CHART_TYPES"
        :key="item.name"
        :class="['chart-type-item', { active: item.name === chartMainType }]"
        @click="handleChartTypeClick(item.name)"
      >
        <el-icon><component :is="item.icon" /></el-icon>
        <span>{{ item.label }}</span>
      </div>
    </div>
    <div class="checked-chart-type">
      <div class="mb-10">{{ chartTypesMap[chartMainType]?.label }}类型</div>
      <div class="chart-type-group">
        <div
          v-for="item in currentChartTypes"
          :key="item.name"
          :class="['chart-type-item plain', { active: item.name === chartConfig.subType }]"
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
    <el-form-item prop="theme" label="颜色主题">
      <el-select v-model="chartConfig.theme" placeholder="请选择主题颜色" style="width: 100%">
        <el-option
          v-for="theme in COLOR_THEMES"
          :key="theme.type"
          :label="theme.name"
          :value="theme.type"
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
    <!-- 数据源 -->
    <el-form-item prop="dataSource" label="数据源">
      <el-select
        v-model="chartConfig.dataSource"
        placeholder="请选择数据源"
        style="width: 100%"
        @change="handleDataSourceChange"
      >
        <el-option
          v-for="item in dataSourceFields"
          :key="item.value"
          :label="item.label"
          :value="item.value"
        />
      </el-select>
    </el-form-item>
    <!-- 纵轴 -->
    <el-form-item prop="valueFields" label="纵轴（值）">
      <el-select
        v-model="chartConfig.valueFields"
        placeholder="请选择纵轴字段"
        multiple
        @change="handleValueFieldsChange"
      >
        <el-option
          v-for="item in yAxisFields"
          :key="item.value"
          :label="item.label"
          :value="item.value"
        />
      </el-select>
      <el-radio-group v-model="chartConfig.categorySort" style="margin-left: 10px">
        <el-radio label="asc">顺序</el-radio>
        <el-radio label="desc">倒序</el-radio>
      </el-radio-group>
    </el-form-item>
    <!-- 横轴 -->
    <el-form-item prop="xField" label="横轴" @change="handleXFieldChange">
      <el-select v-model="chartConfig.xField" placeholder="请选择横轴字段" style="width: 100%">
        <el-option
          v-for="item in xAxisFields"
          :key="item.value"
          :label="item.label"
          :value="item.value"
        />
      </el-select>
    </el-form-item>
    <!-- 展开重复数据选项 -->
    <el-form-item prop="expandDuplicates" label="数据展示">
      <el-switch
        v-model="chartConfig.expandDuplicates"
        active-text="展开重复数据"
        inactive-text="合并相同数据"
      />
      <div class="field-help-text">
        开启后，相同的数据行会展开为多个柱子显示；关闭后，相同数据会合并为一个柱子
      </div>
    </el-form-item>
  </el-card>
</template>

<style scoped>
.field-help-text {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
  line-height: 1.4;
}
</style>

<script lang="ts" setup>
import { computed, inject, type Ref } from 'vue'
import { type ElSelect } from 'element-plus'
import { COLOR_THEMES, CHART_TYPES, CURRENT_CHART_MAP, type ChartTypeIcon } from './constants'
import { useChartConfig } from './useChartConfig'
import { getChartTypeBySubType } from './utils'
import type { ChartMainType, ChartTypeItem, ChartSubType, Props, OptionFields } from './types'

const dataSourceFields = inject<Ref<Props['dataSourceFields']>>('dataSourceFields')
const xAxisFields = inject<Ref<Props['xAxisFields']>>('xAxisFields')
const yAxisFields = inject<Ref<Props['yAxisFields']>>('yAxisFields')
const onDataSourceChange = inject<(data: OptionFields | undefined) => void>('onDataSourceChange')
const onYFieldsChange = inject<(value: OptionFields[] | undefined) => void>('onYFieldsChange')
const onXFieldsChange = inject<(value: OptionFields | undefined) => void>('onXFieldsChange')
const { chartConfig } = useChartConfig()

type ChartTypeItemMap = Record<ChartMainType, ChartTypeItem<ChartTypeIcon>>

const chartTypesMap = computed<ChartTypeItemMap>(() =>
  CHART_TYPES.reduce((acc, cur) => ({ ...acc, [cur.name]: cur }), {} as ChartTypeItemMap),
)

const chartMainType = computed<ChartMainType>(
  () => chartConfig.value.type ?? getChartTypeBySubType(chartConfig.value.subType),
)

// ========================== 事件处理函数 ==========================
const handleChartTypeClick = (type: ChartMainType) => {
  chartConfig.value.type = type
  chartConfig.value.subType = CURRENT_CHART_MAP[type][0]?.name || 'bar_group'
}

const handleCheckedChartType = (type: ChartSubType) => {
  chartConfig.value.subType = type
}

const currentChartTypes = computed(() => CURRENT_CHART_MAP[chartConfig.value.type])

const handleDataSourceChange = (value: string) => {
  const current = dataSourceFields?.value?.find((item) => item.value === value)
  onDataSourceChange?.(current)
}

const handleValueFieldsChange = (value: string[]) => {
  const current = yAxisFields?.value?.filter((item) => value.includes(item.value as string))
  onYFieldsChange?.(current)
}

const handleXFieldChange = (value: string) => {
  const current = xAxisFields?.value?.find((item) => item.value === value)
  onXFieldsChange?.(current)
}
</script>

<style lang="scss" scoped>
.mb-10 {
  margin-bottom: 10px;
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
