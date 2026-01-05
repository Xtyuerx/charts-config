<template>
  <div v-loading="LoadingStatus" element-loading-text="加载中...">
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
        <el-button type="primary" @click="handleSave">保存</el-button>
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
      <!-- <div class="edit-btn" @click="handleEdit">编辑点位</div> -->
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
        <MeasurementPanel :data="allMeasurementDataList" @rowClick="onRowClick" />
      </div>
      <div v-if="isShowItem" class="right_text">
        <div class="text_name">{{ itemText.name }}</div>
        <div class="text_content" v-if="itemText.task_name == 'overbite'">
          <div class="content_item select_item">
            <span>下前牙牙冠高度</span><span>{{ itemText.H_total }}</span>
          </div>
          <div class="content_item">
            <span>垂直覆盖距离</span><span>{{ itemText.H_overlap }}</span>
          </div>
          <div class="content_item">
            <span> 覆盖率</span><span>{{ itemText.ratio }}</span>
          </div>
          <div class="content_item">
            <span>结果</span><span>{{ itemText.diagnosis }}</span>
          </div>
        </div>
        <div class="text_content" v-if="itemText.task_name == 'midline-deviation'">
          <div class="content_item select_item">
            <span>上中线分析</span><span>{{ getCategory(itemText.upper_midline?.category) }}</span>
          </div>
          <div class="content_item">
            <span>下中线分析</span><span>{{ getCategory(itemText.lower_midline?.category) }}</span>
          </div>
          <div class="content_item">
            <span> 上下中线偏差的差值</span
            ><span>{{ itemText.upper_to_lower_difference_mm.toFixed(2) }}</span>
          </div>
          <div class="content_item">
            <span>阈值</span><span>{{ itemText.threshold_mm }}</span>
          </div>
        </div>
        <div class="text_content" v-if="itemText.task_name == 'occlusal-relationship'">
          <div class="content_item select_item">
            <span>右侧尖牙</span><span>{{ itemText.left_side.canine_relationship }}</span>
          </div>
          <div class="content_item">
            <span>右侧磨牙</span><span>{{ itemText.left_side.molar_relationship }}</span>
          </div>
          <div class="content_item">
            <span> 左侧尖牙</span><span>{{ itemText.right_side.canine_relationship }}</span>
          </div>
          <div class="content_item">
            <span>左侧磨牙</span><span>{{ itemText.right_side.canine_relationship }}</span>
          </div>
        </div>
        <div class="text_content" v-if="itemText.task_name == 'crossbite'">
          <div class="content_item">
            <span>异常</span><span>{{ itemText.diagnosis }} </span>
          </div>
          <div
            class="content_item"
            v-if="itemText.locking.pairs.length > 0"
            v-for="pair in itemText.locking.pairs"
          >
            <span>FDI牙位</span><span>上颌{{ pair.upper_fdi }}--下颌{{ pair.lower_fdi }} </span>
          </div>
          <div
            class="content_item"
            v-if="itemText.anterior.pairs.length > 0"
            v-for="pair in itemText.anterior.pairs"
          >
            <span>FDI牙位</span><span>上颌{{ pair.upper_fdi }}--下颌{{ pair.lower_fdi }} </span>
          </div>
        </div>
        <div class="text_content" v-if="itemText.task_name == 'arch-symmetry'">
          <div class="content_item select_item">
            <span>上牙弓左侧</span><span>{{ itemText.upper.pairs['16-26'].left_dist }}</span>
          </div>
          <div class="content_item">
            <span>上牙弓右侧</span><span>{{ itemText.upper.pairs['16-26'].right_dist }}</span>
          </div>
          <div class="content_item">
            <span>下牙弓左侧</span><span>{{ itemText.lower.pairs['36-46'].left_dist }}</span>
          </div>
          <div class="content_item">
            <span>上牙弓右侧</span><span>{{ itemText.lower.pairs['36-46'].right_dist }}</span>
          </div>
        </div>
        <div class="text_content" v-if="itemText.task_name == 'bolton'">
          <div class="content_item select_item">
            <span>前牙比</span><span>{{ itemText.all_ratio_percent }}</span>
          </div>
          <div class="content_item">
            <span>全牙比 </span><span>{{ itemText.all_ratio_percent }}</span>
          </div>
          <div class="content_item">
            <span> 上颌3-3总宽度 </span><span>{{ itemText.upper_front_sum }}</span>
          </div>
          <div class="content_item">
            <span>下颌3-3总宽度 </span><span>{{ itemText.lower_front_sum }}</span>
          </div>
          <div class="content_item">
            <span>上颌6-6总宽度 </span><span>{{ itemText.upper_all_sum }}</span>
          </div>
          <div class="content_item">
            <span>下颌6-6总宽度 </span><span>{{ itemText.lower_all_sum }}</span>
          </div>
          <div class="jaw-table">
            <div v-for="jaw in jawList" :key="jaw.title" class="jaw-block">
              <div class="jaw-title">{{ jaw.title }}</div>

              <div class="jaw-row" v-for="(row, i) in jaw.rows" :key="i">
                <div class="cell">
                  <span class="tooth">{{ row[0].tooth }}</span>
                  <span class="value">{{ row[0].value.toFixed(2) }}</span>
                </div>

                <div class="cell">
                  <span class="tooth">{{ row[1].tooth }}</span>
                  <span class="value">{{ row[1].value.toFixed(2) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="text_content" v-if="itemText.task_name == 'tooth-crowding-degree'">
          <div class="content_item select_item">
            <span>结论</span><span>{{ itemText.upper_jaw.grade }}</span>
          </div>
          <div class="content_item">
            <span>上颌牙量与骨量的实际差值</span
            ><span>{{ itemText.upper_jaw.discrepancy_mm }}</span>
          </div>
          <div class="content_item">
            <span> 上颌牙齿宽度总和/牙量</span
            ><span>{{ itemText.upper_jaw.tooth_widths_sum_mm }}</span>
          </div>
          <div class="content_item">
            <span>上颌牙弓弧形长度/骨量</span><span>{{ itemText.upper_jaw.arch_length_mm }}</span>
          </div>
          <div class="content_item select_item">
            <span>结论</span><span>{{ itemText.lower_jaw.grade }}</span>
          </div>
          <div class="content_item">
            <span>下颌牙量与骨量的实际差值</span
            ><span>{{ itemText.lower_jaw.discrepancy_mm }}</span>
          </div>
          <div class="content_item">
            <span> 下颌牙齿宽度总和/牙量</span
            ><span>{{ itemText.lower_jaw.tooth_widths_sum_mm }}</span>
          </div>
          <div class="content_item">
            <span>下颌牙弓弧形长度/骨量</span><span>{{ itemText.lower_jaw.arch_length_mm }}</span>
          </div>
        </div>

        <div class="text_content" v-if="itemText.task_name == 'tooth-gap'">
          <div class="content_item select_item">
            <span>上颌间隙</span><span>{{ itemText.upper_jaw.grade }}</span>
          </div>
          <div class="content_item">
            <span>上颌总间隙数量</span><span>{{ itemText.upper_jaw.total_gaps }}</span>
          </div>
          <div class="content_item">
            <span> 上颌总间隙尺寸</span><span>{{ itemText.total_gap_size_mm }}</span>
          </div>
          <div class="content_item select_item">
            <span>下颌间隙</span><span>{{ itemText.lower_jaw.grade }}</span>
          </div>
          <div class="content_item">
            <span>下颌总间隙数量</span><span>{{ itemText.lower_jaw.total_gaps }}</span>
          </div>
          <div class="content_item">
            <span> 下颌总间隙尺寸</span><span>{{ itemText.lower_jaw.total_gap_size_mm }}</span>
          </div>
        </div>
        <div class="text_content" v-if="itemText.task_name == 'upper-curve'">
          <div class="content_item select_item">
            <span>左侧</span><span>{{ itemText.left.curve_type }}</span>
          </div>
          <div class="content_item select_item">
            <span>右侧</span><span>{{ itemText.right.curve_type }}</span>
          </div>
        </div>
        <div class="text_content" v-if="itemText.task_name == 'lower-curve'">
          <div class="content_item select_item">
            <span>左侧</span><span>{{ itemText.left.classification }}</span>
          </div>
          <div class="content_item">
            <span>左侧曲深</span><span>{{ itemText.left.depth_mm }}</span>
          </div>
          <div class="content_item select_item">
            <span>右侧</span><span>{{ itemText.right.classification }}</span>
          </div>
          <div class="content_item">
            <span>右侧曲深</span><span>{{ itemText.right.depth_mm }}</span>
          </div>
        </div>
        <div class="text_content" v-if="itemText.task_name == 'overjet'">
          <div class="content_item select_item">
            <span>结论</span><span>{{ itemText.diagnosis }}</span>
          </div>
          <div class="content_item">
            <span>覆盖值</span><span>{{ itemText.avg_overjet }}</span>
          </div>
        </div>
        <div class="text_content" v-if="itemText.task_name == 'arch-width'">
          <div class="content_item select_item">
            <span>结论</span><span>{{ itemText.diagnosis }}</span>
          </div>
          <div class="content_item">
            <span>上颌 3-3 宽度</span><span>{{ itemText.upper_arch.canine_width_3_3.width }}</span>
          </div>
          <div class="content_item">
            <span> 上颌 6-6 宽度</span><span>{{ itemText.upper_arch.molar_width_6_6.width }}</span>
          </div>
          <div class="content_item">
            <span>下颌 3-3 宽度</span><span>{{ itemText.lower_arch.canine_width_3_3.width }}</span>
          </div>
          <div class="content_item">
            <span> 下颌 6-6 宽度</span><span>{{ itemText.lower_arch.molar_width_6_6.width }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ArrowLeftBold, ArrowRightBold } from '@element-plus/icons-vue';
import { fa } from 'element-plus/es/locale';
import * as THREE from 'three';
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
  adjustCameraToFaceFrontTeeth,
  flipCameraDirection,
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
  getCurrentTaskName,
  getCurrentUpdatedPoints,
} = useAnalysis();

// 引用
const containerRef = ref<HTMLDivElement>();

const allMeasurementDataList = ref<MeasurementGroup[]>([]);

// 状态
const topRadio = ref('');
const visible = ref(true);
const viewLabels = ref<ViewLabel[]>(VIEW_LABELS);
const selectedViewType = ref(0);
const availableAnalyses = ref(getAvailableAnalyses());

const isShowItem = ref(false);
const itemText = ref({});
const detailParams = ref({});
const LoadingStatus = ref(false);
const analysisData = ref([]);
const jawList = ref([]);

/**
 * 初始化
 */
onMounted(async () => {
  try {
    if (!containerRef.value) {
      throw new Error('容器元素未找到');
    }

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
    const params = {
      businessId: query.id,
      analysisType: 2,
      caseCode: query.code,
      upperStlUrl: stlFileList.STL_UPPER_DENTAL_ARCH[0].fileUrl,
      lowerStlUrl: stlFileList.STL_LOWER_DENTAL_ARCH[0].fileUrl,
    };
    getStlList(params);
    // 5. 加载诊断数据
    // await loadDiagnosisData('/points/stl_all_demo.json');

    // 6. 从模型中提取的中心点生成牙号数据
    // if (modelResult) {
    //   loadToothNumbersFromCenters(modelResult.centersUpper, modelResult.centersLower);
    // }

    // 7. 开始动画循环
    startAnimation();
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
  LoadingStatus.value = true;
  ModelAnalysisController.getStlData(params).then(async res => {
    LoadingStatus.value = false;
    const data = JSON.parse(res.data?.modifyAnalysisData);
    analysisData.value = data.pathology_results;
    allMeasurementDataList.value = formatReportFromJson(data.pathology_results);
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

      // 根据前牙位置自动调整相机，让FDI 11、21、31、41正对相机
      const allToothCenters: { fdi: number; center: THREE.Vector3 }[] = [];
      if (modelResult.centersUpper) {
        Object.entries(modelResult.centersUpper).forEach(([fdi, center]) => {
          allToothCenters.push({ fdi: Number(fdi), center });
        });
      }
      if (modelResult.centersLower) {
        Object.entries(modelResult.centersLower).forEach(([fdi, center]) => {
          allToothCenters.push({ fdi: Number(fdi), center });
        });
      }
      adjustCameraToFaceFrontTeeth(allToothCenters);
    }
  });
};

// AI重置
const handleAIReset = () => {
  LoadingStatus.value = true;

  // 保存当前的任务名称，以便重置后重新渲染
  const currentTaskName = getCurrentTaskName();

  let params = {
    id: StlId.value,
    analysisType: 2,
    businessId: detailParams.value.id,
    caseCode: detailParams.value.code,
    upperStlUrl: JSON.parse(detailParams.value.stlFileList).STL_UPPER_DENTAL_ARCH[0].fileUrl,
    lowerStlUrl: JSON.parse(detailParams.value.stlFileList).STL_LOWER_DENTAL_ARCH[0].fileUrl,
  };

  ModelAnalysisController.getStlReset(params).then(async res => {
    LoadingStatus.value = false;
    const data = JSON.parse(res.data?.modifyAnalysisData);
    console.log(data, '重置后的数据');
    analysisData.value = data.pathology_results;
    allMeasurementDataList.value = formatReportFromJson(data.pathology_results);

    // 重新加载诊断数据
    await loadDiagnosisData(data);

    // 如果之前有显示某个分析，重新切换到该分析以刷新视图
    if (currentTaskName) {
      switchTo(currentTaskName);
    }
  });
};

// 编辑
// const handleEdit = () => {
//   console.log(analysisData.value, '编辑');
// };
//保存
const handleSave = () => {
  // LoadingStatus.value = true;
  // 获取当前任务名称
  const currentTaskName = getCurrentTaskName();

  // 获取更新后的点位数据（仅对拥挤度分析和覆合分析有效）
  const updatedData = getCurrentUpdatedPoints();
  if (updatedData) {
    console.log('📍 更新后的点位数据:', updatedData);
  }
  let params;
  // 🔥 根据分析类型处理不同的数据格式
  if (currentTaskName === 'midline-deviation') {
    // 中线分析：数据格式为 { upper_midline_point: [x,y,z], lower_midline_point: [x,y,z] }
    console.log('📍 中线分析更新后的数据:', updatedData);

    params = {
      id: StlId.value,
      analysisType: 2,
      threeDTaskCode: currentTaskName,
      businessId: detailParams.value.id,
      caseCode: detailParams.value.code,
      upperStlUrl: JSON.parse(detailParams.value.stlFileList).STL_UPPER_DENTAL_ARCH[0].fileUrl,
      lowerStlUrl: JSON.parse(detailParams.value.stlFileList).STL_LOWER_DENTAL_ARCH[0].fileUrl,
      // 🔥 直接使用中线分析的数据格式
      updatedJson: JSON.stringify(updatedData),
    };
  } else {
    const teeth_points = updatedData;
    params = {
      id: StlId.value,
      analysisType: 2,
      threeDTaskCode: currentTaskName,
      businessId: detailParams.value.id,
      caseCode: detailParams.value.code,
      upperStlUrl: JSON.parse(detailParams.value.stlFileList).STL_UPPER_DENTAL_ARCH[0].fileUrl,
      lowerStlUrl: JSON.parse(detailParams.value.stlFileList).STL_LOWER_DENTAL_ARCH[0].fileUrl,
      updatedJson: JSON.stringify({ teeth_points }),
    };
  }

  ModelAnalysisController.getStlSave(params).then(async res => {
    LoadingStatus.value = false;
    const data = JSON.parse(res.data?.modifyAnalysisData);
    console.log(data, '保存后的数据');
    analysisData.value = data.pathology_results;
    allMeasurementDataList.value = formatReportFromJson(data.pathology_results);

    // 重新加载诊断数据
    await loadDiagnosisData(data);

    // 重新渲染当前分析以刷新视图
    // if (currentTaskName) {
    //   switchTo(currentTaskName);
    // }
  });
};

const getCategory = (category: string) => {
  return category === 'right' ? '右偏' : category === 'left' ? '左偏' : '居中';
};
const upperPairs: [number, number][] = [
  [11, 21],
  [12, 22],
  [13, 23],
  [14, 24],
  [15, 25],
  [16, 26],
  [17, 27],
  [18, 28],
];

const lowerPairs: [number, number][] = [
  [41, 31],
  [42, 32],
  [43, 33],
  [44, 34],
  [45, 35],
  [46, 36],
  [47, 37],
  [48, 38],
];
function buildJawData(width: Record<number, number>): JawData[] {
  const buildRows = (pairs: [number, number][]) =>
    pairs.map(([left, right]) => [
      {
        tooth: left,
        value: Number(width[left]?.toFixed(2) ?? 0),
      },
      {
        tooth: right,
        value: Number(width[right]?.toFixed(2) ?? 0),
      },
    ]);
  return [
    { title: '上颌', rows: buildRows(upperPairs) },
    { title: '下颌', rows: buildRows(lowerPairs) },
  ];
}
function formatReportFromJson(fullData: any) {
  const pathology = fullData || [];
  const report: any[] = [];

  /** 中线（midline-deviation） **/
  const mid = pathology.find(x => x.task_name === 'midline-deviation');
  if (mid) {
    const m = mid.diagnosis_result.measurements;
    report.push({
      title: '中线关系',
      task_name: 'midline-deviation',
      items: [
        {
          label: '上中线',
          value: getCategory(m.upper_midline.category),
        },
        {
          label: '下中线',
          value: getCategory(m.lower_midline.category),
        },
      ],
    });
  }
  /** 覆合（overbite） **/
  const overbite = pathology.find(x => x.task_name === 'overbite');
  if (overbite) {
    const m = overbite.diagnosis_result.measurements;
    report.push({
      title: '覆𬌗',
      task_name: 'overbite',
      items: [
        {
          label: '覆合',
          value: m.severity,
        },
      ],
    });
  }

  /** 覆盖（overjet） **/
  const overjet = pathology.find(x => x.task_name === 'overjet');
  if (overjet) {
    const m = overjet.diagnosis_result.measurements;
    report.push({
      title: '覆盖',
      task_name: 'overjet',
      items: [
        {
          label: '覆盖',
          value: m.severity,
        },
      ],
    });
  }
  /** 磨牙/尖牙关系（occlusal-relationship） **/
  const occ = pathology.find(x => x.task_name === 'occlusal-relationship');
  if (occ) {
    const m = occ.diagnosis_result.measurements;

    report.push({
      title: '磨牙关系',
      task_name: 'occlusal-relationship',
      items: [
        {
          label: '左侧',
          value: m.left_side.molar_relationship,
        },
        {
          label: '右侧',
          value: m.right_side.molar_relationship,
        },
      ],
    });

    report.push({
      title: '尖牙关系',
      task_name: 'occlusal-relationship',
      items: [
        {
          label: '左侧',
          value: m.left_side.canine_relationship,
        },
        {
          label: '右侧',
          value: m.right_side.canine_relationship,
        },
      ],
    });
  }
  /**锁颌反颌（crossbite） **/
  const crossbite = pathology.find(x => x.task_name === 'crossbite');
  if (crossbite) {
    const m = crossbite.diagnosis_result.measurements;
    report.push({
      title: '锁𬌗与反𬌗',
      task_name: 'crossbite',
      items: [
        {
          label: '锁𬌗与反𬌗',
          value: m.diagnosis,
        },
      ],
    });
  }
  /** 拥挤度（tooth-crowding-degree） **/
  const crowd = pathology.find(x => x.task_name === 'tooth-crowding-degree');
  if (crowd) {
    const m = crowd.diagnosis_result.measurements;
    report.push({
      title: '拥挤度',
      task_name: 'tooth-crowding-degree',
      items: [
        { label: '上颌', value: m.upper_jaw.grade },
        { label: '下颌', value: m.lower_jaw.grade },
      ],
    });
  }
  /**牙齿间隙（tooth-gap） **/
  const tog = pathology.find(x => x.task_name === 'tooth-gap');
  if (tog) {
    const m = tog.diagnosis_result.measurements;
    report.push({
      title: '牙齿间隙',
      task_name: 'tooth-gap',
      items: [
        {
          label: '上颌',
          value: m.upper_jaw.grade,
        },
        {
          label: '下颌',
          value: m.lower_jaw.grade,
        },
      ],
    });
  }
  /** Bolton（bolton） **/
  const bolton = pathology.find(x => x.task_name === 'bolton');
  if (bolton) {
    const m = bolton.diagnosis_result.measurements;
    report.push({
      title: 'Bolton比',
      task_name: 'bolton',
      items: [
        {
          label: '全牙比',
          value: `${m.all_ratio_percent.toFixed(2)} %`,
        },
        {
          label: '前牙比',
          value: `${m.front_ratio_percent.toFixed(2)} %`,
        },
      ],
    });
  }
  /** 牙弓宽度（arch-width） **/
  const arw = pathology.find(x => x.task_name === 'arch-width');
  if (arw) {
    const m = arw.diagnosis_result.measurements;
    report.push({
      title: '牙弓宽度',
      task_name: 'arch-width',
      items: [
        {
          label: '牙弓宽度',
          value: m.severity,
        },
      ],
    });
  }

  /** 牙弓测量（arch-symmetry） **/
  const arch = pathology.find(x => x.task_name === 'arch-symmetry');
  if (arch) {
    const m = arch.diagnosis_result.measurements;
    report.push({
      title: '牙弓对称性',
      task_name: 'arch-symmetry',
      items: [
        { label: '上颌牙弓形状', value: m.shape_upper },
        { label: '下颌牙弓形状', value: m.shape_lower },
      ],
    });
  }

  /** Spee 曲线（spee-curve） **/
  const spee = pathology.find(x => x.task_name === 'lower-curve');
  if (spee) {
    const m = spee.diagnosis_result.measurements;
    report.push({
      title: 'Spee曲线',
      task_name: 'lower-curve',
      items: [
        { label: '左侧', value: m.left.classification },
        { label: '右侧', value: m.right.classification },
      ],
    });
  }

  /** 上颌补偿曲线（upper-curve） **/
  const upc = pathology.find(x => x.task_name === 'upper-curve');
  if (upc) {
    const m = upc.diagnosis_result.measurements;
    report.push({
      title: '上颌补偿曲线',
      task_name: 'upper-curve',
      items: [
        {
          label: '左侧',
          value: m.left.curve_type,
        },
        {
          label: '右侧',
          value: m.right.curve_type,
        },
      ],
    });
  }

  return report;
}

/**
 * 处理分析类型选择
 */
const handleAnalysisSelect = (value: string) => {
  // 根据 radioValue 找到对应的策略
  const analysis = availableAnalyses.value.find(a => a.radioValue === value);
  if (analysis) {
    switchTo(analysis.taskName);
    visible.value = false; // 自动展开右侧面板
  }
};

/**
 * 处理视角切换
 */
const handleViewChange = (item: ViewLabel) => {
  selectedViewType.value = item.type;
  updateView(item.key);
};

const onRowClick = (row: any) => {
  visible.value = false;
  analysisData.value.forEach(item => {
    if (item.task_name === row.task_name) {
      itemText.value = item.diagnosis_result.measurements;
      itemText.value.task_name = row.task_name;
      itemText.value.name = row.title;
      isShowItem.value = true;
      if (itemText.value.width) {
        jawList.value = buildJawData(itemText.value.width);
      }
    }
  });
};

/**
 * 切换右侧面板显示/隐藏
 */
const togglePanel = () => {
  visible.value = !visible.value;
  isShowItem.value = false;
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
  height: calc(100vh - 200px);
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
// 编辑
.edit-btn {
  position: absolute;
  bottom: 8%;
  left: 10%;
  transform: translate(-50%, -50%);
  width: 150px;
  height: 50px;
  background-color: #285e50;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  transition: all 0.3s;
  z-index: 100;
  font-size: 14px;
  font-weight: 600;
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
  background-color: #6fc232;
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
  background-color: #6fc232;
}
.right_text {
  background-color: #fff;
  width: 350px;
  max-height: 460px;
  overflow-y: auto;
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
.jaw-block {
  margin-bottom: 16px;
}

.jaw-title {
  color: #285e50;
  font-weight: 500;
  margin-bottom: 8px;
}

.jaw-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border-top: 1px solid #eee;
}

.cell {
  display: flex;
  justify-content: space-between;
  padding: 6px 12px;
  border-right: 1px solid #eee;
}

.cell:last-child {
  border-right: none;
}

.tooth {
  color: #333;
}

.value {
  color: #285e50;
}
</style>
