<template>
  <el-button @click="changeStatus">显示/隐藏</el-button>
  <div class="upload-preview">
    <el-upload
      :auto-upload="false"
      :show-file-list="true"
      :limit="6"
      list-type="picture-card"
      :on-change="handleChange"
    >
      <el-icon><Plus /></el-icon>
    </el-upload>
    <h1>自定义预览区域</h1>
    <div class="preview-container">
      <div class="preview-item" v-for="item in previewList" :key="item.uid">
        <div class="preview-item-name">
          {{ item.name }}
        </div>
        <div class="preview-item-preview">
          <img :src="item.url" alt="item.name" />
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref } from 'vue'
import { ElMessage, type UploadProps, type UploadUserFile } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
const previewList = ref<UploadUserFile[]>([])

const handleChange: UploadProps['onChange'] = (file) => {
  console.log(file)
  previewList.value.push(file)
}

const changeStatus = () => {
  ElMessage({
    message: 'Congrats, this is a success message.',
    type: 'success',
  })
  console.log('changeStatus')
}

defineExpose({
  changeStatus,
})
</script>

<style scoped>
.upload-preview {
  width: 100%;
}
.preview-container {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.preview-item {
  width: 100px;
  height: 100px;
}
.preview-item-name {
  font-size: 12px;
  color: #333;
  text-align: center;
  margin-bottom: 5px;
}
.preview-item-preview {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.preview-item-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
