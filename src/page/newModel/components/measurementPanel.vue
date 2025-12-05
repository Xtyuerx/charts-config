<template>
  <div class="panel-wrap">
    <div class="label_text">
      <div class="label">测量项</div>
      <div class="label_name">测量值</div>
      <div class="label_name">结论</div>
    </div>
    <div v-for="group in data" :key="group.groupName" class="group-box">
      <div class="group-title">{{ group.groupName }}</div>
      <div
        class="row"
        v-for="item in group.children"
        :key="item.name"
        @click="$emit('rowClick', item)"
      >
        <div class="label">{{ item.name }}</div>
        <div class="value label_name">{{ item.value }}</div>
        <div class="result label_name">{{ item.result }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  data: any[];
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
}

.group-title {
  font-size: 14px;
  font-weight: 600;
  margin: 12px 0 6px;
}

.row {
  display: flex;
  padding: 6px 4px;
  justify-content: space-between;
  cursor: pointer;
  transition: background 0.2s;
}

.row:hover {
  background: #f5f8ff;
}

.label {
  width: 80px;
}
.value {
  color: #409eff;
}
.result {
  color: #777;
}
.label_name {
  width: 80px;
  text-align: center;
}
</style>
