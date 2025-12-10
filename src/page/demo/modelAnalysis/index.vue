<template>
  <div>
    <!-- 顶部工具栏 -->
    <div class="header" style="display: flex; justify-content: space-between; align-items: center">
      <div style="display: flex; align-items: center">
        <el-page-header @back="router.go(-1)" />
        <div class="topBtns">
          <el-radio-group v-model="topRadio" size="mini" @change="handleAnalysisSelect">
            <el-radio-button
              v-for="analysis in availableAnalyses"
              :key="analysis.id"
              :label="analysis.name"
              :value="analysis.radioValue"
            />
          </el-radio-group>
        </div>
      </div>
      <div style="display: flex">
        <el-button @click="handleAIReset">AI重置</el-button>
        <el-button type="primary">保存</el-button>
      </div>
    </div>

    <!-- 主内容区 -->
    <div class="content">
      <!-- 视角切换标签 -->
      <div class="content_name">
        <span
          v-for="item in viewLabels"
          :key="item.type"
          :class="item.type == selectedViewType ? 'selcet_label' : ''"
          @click="handleViewChange(item)"
        >
          {{ item.label }}
        </span>
      </div>

      <!-- 3D模型容器 -->
      <div ref="containerRef" class="container"></div>

      <!-- 加载状态 -->
      <div v-if="isLoading" class="loading-overlay">
        <el-progress type="circle" :percentage="loadProgress" :width="100" />
        <p>加载模型中...</p>
      </div>

      <!-- 收起后显示的浮动按钮 -->
      <div class="float-btn" v-if="!visible" @click="togglePanel">
        <el-icon><ArrowLeftBold /></el-icon>
      </div>

      <!-- 固定在右侧的整个模块 -->
      <div class="right-wrapper" :class="{ hidden: !visible }">
        <!-- 收起小按钮（贴在面板左侧） -->
        <div class="collapse-btn" v-if="visible" @click="togglePanel">
          <el-icon><ArrowRightBold /></el-icon>
        </div>

        <!-- 测量数据面板 -->
        <MeasurementPanel :data="measurementData" @rowClick="onRowClick" />
      </div>
      <div v-if="isShowItem" class="right_text">
        <div class="text_name">{{ itemText.name }}</div>
        <div class="text_content">
          <div class="content_item select_item"><span>左侧</span><span>远近</span></div>
          <div class="content_item"><span>右侧</span><span>远近</span></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ArrowLeftBold, ArrowRightBold } from '@element-plus/icons-vue';
import ModelAnalysisController from '@/api/system/ModelAnalysisController.ts';
import { useScene } from './hooks/useScene';
import { useAnalysis } from './hooks/useAnalysis';
import { VIEW_LABELS } from './constants';
import MeasurementPanel from './components/measurementPanel.vue';
import type { ViewLabel, JsonURLConfig } from './types';

const router = useRouter();
const route = useRoute();

// 场景管理
const {
  isLoading,
  loadProgress,
  initScene,
  loadModels,
  startAnimation,
  updateView,
  getRenderContext: getSceneRenderContext,
  cleanup,
} = useScene();

// 分析管理
const {
  measurementData,
  initAnalysis,
  loadDiagnosisData,
  loadToothNumbersFromCenters,
  switchTo,
  getAvailableAnalyses,
} = useAnalysis();

// 引用
const containerRef = ref<HTMLDivElement>();

// 状态
const topRadio = ref('');
const visible = ref(false);
const viewLabels = ref<ViewLabel[]>(VIEW_LABELS);
const selectedViewType = ref(0);
const availableAnalyses = ref(getAvailableAnalyses());

const isShowItem = ref(false);
const itemText = ref('');
const detailParams = ref({});

/**
 * 初始化
 */
onMounted(async () => {
  try {
    if (!containerRef.value) {
      throw new Error('容器元素未找到');
    }

    console.log('🚀 开始初始化口腔分析系统...');

    // 1. 初始化场景
    initScene(containerRef.value);

    // 2. 加载模型（包含牙齿中心点提取）
    // const modelResult = await loadModels(modelConfig);

    // 3. 设置初始视角（重要！）
    updateView('full');

    // 4. 初始化分析系统
    const context = getSceneRenderContext();
    initAnalysis(context);
    const query = route.query;
    detailParams.value = query;
    const stlFileList = JSON.parse(query.stlFileList);
    console.log(stlFileList, 'stlFileList');
    const params = {
      businessId: query.id,
      analysisType: 2,
      caseCode: query.code,
      upperStlUrl: stlFileList.STL_UPPER_DENTAL_ARCH[0].fileUrl,
      lowerStlUrl: stlFileList.STL_LOWER_DENTAL_ARCH[0].fileUrl,
    };
    // let params = {
    //   businessId: '2512001230',
    //   analysisType: 2,
    //   caseCode: '1996390639587037184',
    //   upperStlUrl:
    //     'http://175.154.206.51:9000/ds-dev/attachment/2025/08/f7af906f9a3b4089a76c6e2d40333ad9.stl?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=minioadmin%2F20251202%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20251202T010859Z&X-Amz-Expires=604800&X-Amz-SignedHeaders=host&X-Amz-Signature=76b41cf1397fa4fa01b699270492d2f686505009dc4d7466347a175a0021b0a9',
    //   lowerStlUrl:
    //     'http://175.154.206.51:9000/ds-dev/attachment/2025/08/bd22978dc62e45e29ec6070563c5e375.stl?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=minioadmin%2F20251202%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20251202T010859Z&X-Amz-Expires=604800&X-Amz-SignedHeaders=host&X-Amz-Signature=97c05e1fd46ad7358a239d78dd3cf99542a4b32a11c78f0ce98edd69bd153d38',
    // };
    getStlList(params);
    // 5. 加载诊断数据
    // await loadDiagnosisData('/points/stl_all_demo.json');

    // 6. 从模型中提取的中心点生成牙号数据
    // if (modelResult) {
    //   loadToothNumbersFromCenters(modelResult.centersUpper, modelResult.centersLower);
    // }

    // 7. 开始动画循环
    startAnimation();

    console.log('✅ 口腔分析系统初始化完成');
  } catch (err) {
    console.error('❌ 系统初始化失败:', err);
  }
});

onUnmounted(() => {
  cleanup();
});

//初始数据
const StlId = ref('');
const getStlList = async (params: any) => {
  ModelAnalysisController.getStlData(params).then(async res => {
    const data = JSON.parse(res.data?.modifyAnalysisData);
    console.log(data, 'data111111111111111111111');
    const { basic_algorithm_info } = data;
    const {
      lower_only_tooth_json,
      upper_only_tooth_json,
      upper_stl,
      lower_stl,
      upper_only_tooth_stl,
      lower_only_tooth_stl,
    } = basic_algorithm_info?.stl || {};
    StlId.value = res.data.id;
    // dataList.value = data.pathology_results;
    // console.log(data, 'data');
    // getConclusionsText();
    // 模型配置
    const modelConfig = {
      upper: upper_stl,
      upper_only_tooth: upper_only_tooth_stl,
      lower: lower_stl,
      lower_only_tooth: lower_only_tooth_stl,
    };
    const josnURLConfig: JsonURLConfig = {
      lower_only_tooth_json,
      upper_only_tooth_json,
    };
    const modelResult = await loadModels(modelConfig, josnURLConfig);
    await loadDiagnosisData(data);
    if (modelResult) {
      loadToothNumbersFromCenters(modelResult.centersUpper, modelResult.centersLower);
    }
  });
};

// AI重置
const handleAIReset = () => {
  console.log(detailParams.value, 'detailParams.value');
  let params = {
    id: StlId.value,
    analysisType: 2,
    businessId: detailParams.value.id,
    caseCode: detailParams.value.code,
    upperStlUrl: JSON.parse(detailParams.value.stlFileList).STL_UPPER_DENTAL_ARCH[0].fileUrl,
    lowerStlUrl: JSON.parse(detailParams.value.stlFileList).STL_LOWER_DENTAL_ARCH[0].fileUrl,
  };

  ModelAnalysisController.getStlReset(params).then(async res => {
    console.log(res, 'res');
    const data = JSON.parse(res.data?.modifyAnalysisData);
    console.log(data, '重置后的数据');
    const { basic_algorithm_info } = data;
    const {
      lower_only_tooth_json,
      upper_only_tooth_json,
      upper_stl,
      lower_stl,
      upper_only_tooth_stl,
      lower_only_tooth_stl,
    } = basic_algorithm_info?.stl || {};
    StlId.value = res.data.id;
    // dataList.value = data.pathology_results;
    // console.log(data, 'data');
    // getConclusionsText();
    // 模型配置
    const modelConfig = {
      upper: upper_stl,
      upper_only_tooth: upper_only_tooth_stl,
      lower: lower_stl,
      lower_only_tooth: lower_only_tooth_stl,
    };
    const josnURLConfig: JsonURLConfig = {
      lower_only_tooth_json,
      upper_only_tooth_json,
    };
    const modelResult = await loadModels(modelConfig, josnURLConfig);
    await loadDiagnosisData(data);
    if (modelResult) {
      loadToothNumbersFromCenters(modelResult.centersUpper, modelResult.centersLower);
    }
  });
};

/**
 * 处理分析类型选择
 */
const handleAnalysisSelect = (value: string) => {
  // 根据 radioValue 找到对应的策略
  const analysis = availableAnalyses.value.find(a => a.radioValue === value);
  if (analysis) {
    console.log(`👆 用户选择分析: ${analysis.name}`);
    switchTo(analysis.taskName);
    visible.value = true; // 自动展开右侧面板
  }
};

/**
 * 处理视角切换
 */
const handleViewChange = (item: ViewLabel) => {
  selectedViewType.value = item.type;
  updateView(item.key);
  console.log(`👁️ 用户切换视角: ${item.label}`);
};

const onRowClick = (row: any) => {
  isShowItem.value = true;
  visible.value = false;
  console.log('父组件接收到子组件点击', row);
};

/**
 * 切换右侧面板显示/隐藏
 */
const togglePanel = () => {
  visible.value = !visible.value;
};
</script>

<style scoped lang="scss">
.header {
  padding: 10px 20px;
  background-color: #fff;
  border-bottom: 1px solid #dcdfe6;
}

.topBtns {
  margin-left: 20px;
}

.content {
  position: relative;
  height: calc(100vh - 60px);
  background-color: #f5f7fa;
  overflow: hidden;
}

.content_name {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 10px;
  z-index: 10;
  background-color: rgba(255, 255, 255, 0.9);
  padding: 8px 12px;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.content_name span {
  padding: 4px 12px;
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.3s;
  font-size: 14px;
  color: #606266;
}

.content_name span:hover {
  background-color: #ecf5ff;
  color: #285e50;
}

.selcet_label {
  background-color: #285e50 !important;
  color: #fff !important;
}

.container {
  width: 100%;
  height: 100%;
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
  background-color: rgba(255, 255, 255, 0.9);
  padding: 30px;
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
}

.loading-overlay p {
  margin: 0;
  font-size: 16px;
  color: #666;
}

/* 右侧面板相关样式 */
.float-btn {
  position: absolute;
  top: 50%;
  right: 0;
  transform: translateY(-50%);
  width: 40px;
  height: 100px;
  background-color: #285e50;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-radius: 8px 0 0 8px;
  box-shadow: -2px 0 8px rgba(0, 0, 0, 0.1);
  transition: all 0.3s;
  z-index: 100;
}

.float-btn:hover {
  background-color: #66b1ff;
}

.right-wrapper {
  position: absolute;
  top: 0;
  right: 0;
  height: 100%;
  width: 400px;
  background-color: #fff;
  box-shadow: -2px 0 8px rgba(0, 0, 0, 0.1);
  transition: transform 0.3s ease;
  z-index: 99;
}

.right-wrapper.hidden {
  transform: translateX(100%);
}

.collapse-btn {
  position: absolute;
  left: -40px;
  top: 50%;
  transform: translateY(-50%);
  width: 40px;
  height: 100px;
  background-color: #285e50;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-radius: 8px 0 0 8px;
  transition: all 0.3s;
}

.collapse-btn:hover {
  background-color: #66b1ff;
}
.right_text {
  background-color: #fff;
  width: 350px;
  // min-height: 400px;
  position: absolute;
  top: 20px;
  right: 0px;
  border-radius: 8px;
  .text_name {
    text-align: center;
    height: 50px;
    line-height: 50px;
    font-size: 14px;
    font-weight: 600;
  }
  .text_content {
    padding: 10px 20px;
    box-sizing: border-box;
    font-size: 14px;
    border-bottom: 1px solid #ddd;
    border-top: 1px solid #ddd;
    .content_item {
      height: 56px;
      line-height: 56px;
      display: flex;
      justify-content: space-around;
      align-items: center;
      text-align: center;
      border-radius: 5px;
      margin: 5px 0;
    }
    .select_item {
      border: 1px solid #285e50;
      color: #285e50;
    }
  }
  .refer_text {
    padding: 10px 20px;
    box-sizing: border-box;
    font-size: 14px;
  }
}
</style>
