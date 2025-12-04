<template>
  <div class="control-panel">
    <el-button type="primary" :icon="Edit" @click="handleToggle('number')"> 牙号 </el-button>
    <el-button type="primary" :icon="Edit" @click="handleToggle('width')"> 牙弓宽度分析 </el-button>
  </div>
</template>

<script setup lang="ts">
import { Edit } from '@element-plus/icons-vue'

const emit = defineEmits<{
  toggle: [type: 'number' | 'width']
}>()

const handleToggle = (type: 'number' | 'width') => {
  emit('toggle', type)
}
</script>

<style scoped lang="scss">
.control-panel {
  padding: 15px;
  display: flex;
  gap: 10px;
}
</style>
