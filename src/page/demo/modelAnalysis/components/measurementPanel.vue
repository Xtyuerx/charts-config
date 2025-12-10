<template>
  <div class="panel-wrap">
    <div class="label_text">
      <div class="label">测量项</div>
      <div class="label_name">测量值</div>
      <div class="label_name">结论</div>
    </div>
    <div v-if="data && data.length > 0">
      <div v-for="group in data" :key="group.groupName" class="group-box">
        <div class="group-title">{{ group.groupName }}</div>
        <div
          class="row"
          v-for="item in group.children"
          :key="item.name"
          @click="$emit('rowClick', group)"
        >
          <div class="label">{{ item.name }}</div>
          <div class="value label_name">{{ item.value }}</div>
          <div class="result label_name">{{ item.result }}</div>
        </div>
      </div>
    </div>
    <div v-else class="empty-state">
      <p>请选择分析类型查看测量数据</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { MeasurementGroup } from '../types';

defineProps<{
  data: MeasurementGroup[] | null;
}>();
</script>

<style scoped>
.panel-wrap {
  padding: 14px;
  height: 100%;
  overflow-y: auto;
}

.label_text {
  display: flex;
  justify-content: space-between;
  align-content: center;
  padding-bottom: 8px;
  border-bottom: 1px solid #e4e7ed;
  margin-bottom: 8px;
  font-weight: 600;
  color: #303133;
}

.group-box {
  margin-bottom: 16px;
}

.group-title {
  font-size: 14px;
  font-weight: 600;
  margin: 12px 0 6px;
  color: #303133;
}

.row {
  display: flex;
  padding: 6px 4px;
  justify-content: space-between;
  cursor: pointer;
  transition: background 0.2s;
  border-radius: 4px;
}

.row:hover {
  background: #f5f8ff;
}

.label {
  width: 120px;
  font-size: 13px;
  color: #606266;
}

.value {
  color: #409eff;
  font-weight: 500;
}

.result {
  color: #777;
}

.label_name {
  width: 80px;
  text-align: center;
  font-size: 13px;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: #909399;
  font-size: 14px;
}

.empty-state p {
  margin: 0;
}

/* 滚动条样式 */
.panel-wrap::-webkit-scrollbar {
  width: 6px;
}

.panel-wrap::-webkit-scrollbar-thumb {
  background-color: rgba(0, 0, 0, 0.2);
  border-radius: 3px;
}

.panel-wrap::-webkit-scrollbar-thumb:hover {
  background-color: rgba(0, 0, 0, 0.3);
}
</style>
