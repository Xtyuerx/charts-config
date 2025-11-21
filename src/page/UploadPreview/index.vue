<template>
  <div class="upload-preview">
    <el-button @click="handleChangeStatus">显示/隐藏</el-button>
    <UploadPreview ref="upLoadPreviewRef" />
  </div>
</template>

<script lang="ts" setup>
import { ref } from 'vue'
import UploadPreview from '@/components/UploadPreview/index.vue'

const upLoadPreviewRef = ref<InstanceType<typeof UploadPreview>>()

const handleChangeStatus = () => {
  upLoadPreviewRef.value?.changeStatus()
}
</script>
