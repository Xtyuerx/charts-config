<template>
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
        <el-select v-model="chartConfig.legend.position" :disabled="!chartConfig.legend.show">
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
        <el-input-number v-model="chartConfig.yAxis.min" :disabled="!chartConfig.yAxis.show" />
      </el-form-item>
      <el-form-item label="最大边界值">
        <el-input-number v-model="chartConfig.yAxis.max" :disabled="!chartConfig.yAxis.show" />
      </el-form-item>
      <el-form-item label="间距">
        <el-input-number v-model="chartConfig.yAxis.interval" :disabled="!chartConfig.yAxis.show" />
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
</template>

<script lang="ts" setup>
import { ref } from 'vue'
import { useChartConfig } from './useChartConfig'

const { chartConfig } = useChartConfig()

const activeCollapse = ref(['legend', 'label'])
</script>

<style lang="scss" scoped>
:deep(.el-collapse-item__header) {
  gap: 10px;
}
.collapse-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
</style>
