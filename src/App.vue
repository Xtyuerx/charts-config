<script setup lang="ts">
import { ref } from 'vue'
import AddChart from '@/components/AddChart/index.vue'
const dialogVisible = ref(false)
</script>

<template>
  <h1>You did it!</h1>
  <AddChart v-model:visible="dialogVisible" />
  <el-button type="primary" @click="dialogVisible = true">添加图表</el-button>
</template>

<style scoped></style>
