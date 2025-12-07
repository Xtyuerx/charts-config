<template>
  <div class="oral-analysis-container">
    <!-- 顶部工具栏 -->
    <div class="toolbar">
      <div class="toolbar-left">
        <h2>口腔分析系统</h2>
        <span v-if="currentAnalysisName" class="current-analysis">
          当前: {{ currentAnalysisName }}
        </span>
      </div>

      <div class="toolbar-right">
        <!-- 视角切换 -->
        <el-radio-group v-model="currentView" size="small" @change="handleViewChange">
          <el-radio-button label="full">前双颌</el-radio-button>
          <el-radio-button label="upper">前上颌</el-radio-button>
          <el-radio-button label="lower">前下颌</el-radio-button>
          <el-radio-button label="upper_angle">上颌</el-radio-button>
          <el-radio-button label="lower_angle">下颌</el-radio-button>
          <el-radio-button label="left">左双颌</el-radio-button>
          <el-radio-button label="right">右双颌</el-radio-button>
        </el-radio-group>

        <!-- 显示/隐藏分析 -->
        <el-button
          v-if="currentAnalysisName"
          :type="isAnalysisVisible ? 'primary' : 'default'"
          size="small"
          @click="toggleDisplay"
        >
          {{ isAnalysisVisible ? '隐藏分析' : '显示分析' }}
        </el-button>
      </div>
    </div>

    <!-- 主内容区 -->
    <div class="main-content">
      <!-- 左侧：分析类型选择 -->
      <div class="sidebar">
        <el-card class="analysis-card" shadow="hover">
          <template #header>
            <span>分析类型</span>
          </template>

          <el-menu :default-active="currentAnalysisTask" @select="handleAnalysisSelect">
            <el-menu-item
              v-for="analysis in availableAnalyses"
              :key="analysis.id"
              :index="analysis.taskName"
            >
              <span>{{ analysis.name }}</span>
              <el-tag
                :type="getRenderTypeColor(analysis.renderType)"
                size="small"
                style="margin-left: 8px"
              >
                {{ getRenderTypeLabel(analysis.renderType) }}
              </el-tag>
            </el-menu-item>
          </el-menu>
        </el-card>
      </div>

      <!-- 中间：3D视图 -->
      <div class="viewer-container">
        <div ref="containerRef" class="three-container" :class="{ loading: isLoading }" />

        <!-- 加载状态 -->
        <div v-if="isLoading" class="loading-overlay">
          <el-progress type="circle" :percentage="loadProgress" :width="100" />
          <p>加载模型中...</p>
        </div>

        <!-- 错误提示 -->
        <el-alert v-if="error" :title="error" type="error" :closable="false" class="error-alert" />
      </div>

      <!-- 右侧：测量数据面板 -->
      <div class="measurement-panel">
        <el-card shadow="hover">
          <template #header>
            <span>测量数据</span>
          </template>

          <div v-if="measurementData && measurementData.length > 0">
            <div v-for="(group, index) in measurementData" :key="index" class="measurement-group">
              <h4 class="group-name">{{ group.groupName }}</h4>
              <el-descriptions :column="1" border size="small">
                <el-descriptions-item
                  v-for="(item, idx) in group.children"
                  :key="idx"
                  :label="item.name"
                >
                  <span class="value">{{ item.value }}</span>
                  <el-tag :type="getResultType(item.result)" size="small" style="margin-left: 8px">
                    {{ item.result }}
                  </el-tag>
                </el-descriptions-item>
              </el-descriptions>
            </div>
          </div>

          <el-empty v-else description="请选择分析类型" :image-size="100" />
        </el-card>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useScene } from './hooks/useScene'
import { useAnalysis } from './hooks/useAnalysis'
import type { RenderType } from './types'

// 场景管理
const {
  isLoading,
  loadProgress,
  initScene,
  loadModels,
  startAnimation,
  updateView,
  getRenderContext: getSceneRenderContext,
} = useScene()

// 分析管理
const {
  currentAnalysisName,
  measurementData,
  isAnalysisVisible,
  initAnalysis,
  loadDiagnosisData,
  switchTo,
  toggleDisplay,
  getAvailableAnalyses,
} = useAnalysis()

// 引用
const containerRef = ref<HTMLDivElement>()

// 状态
const currentView = ref('full')
const currentAnalysisTask = ref('')
const availableAnalyses = ref(getAvailableAnalyses())
const error = ref<string | null>(null)

// 模型配置
const modelConfig = {
  upper: '/models/upper.stl',
  upper_only_tooth: '/models/upper_only_tooth.stl',
  lower: '/models/lower.stl',
  lower_only_tooth: '/models/lower_only_tooth.stl',
}

/**
 * 初始化
 */
onMounted(async () => {
  try {
    if (!containerRef.value) {
      throw new Error('容器元素未找到')
    }

    console.log('🚀 开始初始化口腔分析系统...')

    // 1. 初始化场景
    initScene(containerRef.value)

    // 2. 加载模型
    await loadModels(modelConfig)

    // 3. 初始化分析系统
    const context = getSceneRenderContext()
    initAnalysis(context)

    // 4. 加载诊断数据
    await loadDiagnosisData('/points/stl_all_demo.json')

    // 5. 开始动画循环
    startAnimation()

    console.log('✅ 口腔分析系统初始化完成')
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : '系统初始化失败'
    error.value = errorMsg
    console.error('❌ 系统初始化失败:', err)
  }
})

/**
 * 处理分析类型选择
 */
const handleAnalysisSelect = (taskName: string) => {
  console.log(`👆 用户选择分析: ${taskName}`)
  currentAnalysisTask.value = taskName
  switchTo(taskName)
}

/**
 * 处理视角切换
 */
const handleViewChange = (viewKey: string) => {
  console.log(`👁️ 用户切换视角: ${viewKey}`)
  updateView(viewKey)
}

/**
 * 获取渲染类型颜色
 */
const getRenderTypeColor = (renderType: RenderType) => {
  const colorMap = {
    POINT_ONLY: 'info',
    POINT_LINE: 'success',
    POINT_SLICE: 'warning',
    POINT_CURVE: 'danger',
  }
  return colorMap[renderType] || 'info'
}

/**
 * 获取渲染类型标签
 */
const getRenderTypeLabel = (renderType: RenderType) => {
  const labelMap = {
    POINT_ONLY: '点',
    POINT_LINE: '线',
    POINT_SLICE: '面',
    POINT_CURVE: '曲线',
  }
  return labelMap[renderType] || renderType
}

/**
 * 获取结果类型
 */
const getResultType = (result: string) => {
  if (result.includes('正常')) return 'success'
  if (result.includes('异常') || result.includes('偏离')) return 'danger'
  if (result.includes('轻度')) return 'warning'
  return 'info'
}
</script>

<style scoped>
.oral-analysis-container {
  width: 100%;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: #f5f5f5;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  background-color: #ffffff;
  border-bottom: 1px solid #e0e0e0;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.toolbar-left h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: #333;
}

.current-analysis {
  padding: 4px 12px;
  background-color: #e3f2fd;
  border-radius: 4px;
  font-size: 14px;
  color: #1976d2;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.main-content {
  flex: 1;
  display: flex;
  gap: 16px;
  padding: 16px;
  overflow: hidden;
}

.sidebar {
  width: 280px;
  overflow-y: auto;
}

.analysis-card {
  height: 100%;
}

.viewer-container {
  flex: 1;
  position: relative;
  background-color: #ffffff;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.three-container {
  width: 100%;
  height: 100%;
}

.three-container.loading {
  opacity: 0.5;
}

.loading-overlay {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  z-index: 10;
}

.loading-overlay p {
  margin: 0;
  font-size: 16px;
  color: #666;
}

.error-alert {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  max-width: 80%;
  z-index: 20;
}

.measurement-panel {
  width: 320px;
  overflow-y: auto;
}

.measurement-group {
  margin-bottom: 24px;
}

.measurement-group:last-child {
  margin-bottom: 0;
}

.group-name {
  margin: 0 0 12px 0;
  font-size: 16px;
  font-weight: 600;
  color: #333;
}

.value {
  font-weight: 500;
  color: #1976d2;
}

/* 滚动条样式 */
.sidebar::-webkit-scrollbar,
.measurement-panel::-webkit-scrollbar {
  width: 6px;
}

.sidebar::-webkit-scrollbar-thumb,
.measurement-panel::-webkit-scrollbar-thumb {
  background-color: rgba(0, 0, 0, 0.2);
  border-radius: 3px;
}

.sidebar::-webkit-scrollbar-thumb:hover,
.measurement-panel::-webkit-scrollbar-thumb:hover {
  background-color: rgba(0, 0, 0, 0.3);
}
</style>
