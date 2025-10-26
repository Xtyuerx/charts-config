<template>
  <el-tabs v-model="activeTab">
    <el-tab-pane label="基础配置" name="basic">
      <DataTab />
    </el-tab-pane>

    <el-tab-pane label="更多配置" name="more">
      <MoreConfigTab />
    </el-tab-pane>
  </el-tabs>
</template>

<script lang="ts" setup>
import { ref } from 'vue'
import DataTab from './BaseTab.vue'
import MoreConfigTab from './MoreConfigTab.vue'

const activeTab = ref('basic')
</script>
<style lang="scss" scoped>
:deep(.el-tabs__content) {
  width: 400px;
  overflow-y: auto;
}
</style>
