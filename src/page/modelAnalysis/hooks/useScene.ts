import { ref, onUnmounted } from 'vue';
import * as THREE from 'three';
import { SceneManager, ModelManager } from '../core';
import type { STLModelsConfig, JsonURLConfig } from '../types';

/**
 * 场景管理 Hook
 * 封装场景的初始化、模型加载、动画控制等功能
 */
export function useScene() {
  const sceneManager = SceneManager.getInstance();
  const isLoading = ref(false);
  const loadProgress = ref(0);
  const error = ref<string | null>(null);

  /**
   * 初始化场景
   */
  const initScene = (container: HTMLDivElement) => {
    try {
      console.log('🎬 初始化场景...');
      const context = sceneManager.init(container);
      console.log('✅ 场景初始化完成');
      return context;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '场景初始化失败';
      error.value = errorMsg;
      console.error('❌ 场景初始化失败:', err);
      throw err;
    }
  };

  /**
   * 加载模型
   */
  const loadModels = async (config: STLModelsConfig, josnURLConfig: JsonURLConfig) => {
    isLoading.value = true;
    loadProgress.value = 0;
    error.value = null;

    try {
      console.log('📦 开始加载模型...');

      const scene = sceneManager.getScene();
      const modelManager = new ModelManager(scene);

      // 加载标签数据（可选）
      const { labelsUpper, labelsLower } = await modelManager.loadLabelsData(josnURLConfig);
      loadProgress.value = 30;

      // 加载所有模型
      const result = await modelManager.loadAllModels(config, labelsUpper, labelsLower);
      loadProgress.value = 100;

      console.log('✅ 模型加载完成');

      // 将模型网格设置到渲染上下文中
      const renderContext = sceneManager.getRenderContext();
      renderContext.setMeshes({
        upperMesh: result.upperMesh,
        lowerMesh: result.lowerMesh,
        upperMeshLabel: result.upperMeshLabel,
        lowerMeshLabel: result.lowerMeshLabel,
      });

      // 设置牙齿中心点到渲染上下文
      renderContext.setToothCenters({
        centersUpper: result.centersUpper,
        centersLower: result.centersLower,
      });

      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '模型加载失败';
      error.value = errorMsg;
      console.error('❌ 模型加载失败:', err);
      throw err;
    } finally {
      isLoading.value = false;
    }
  };

  /**
   * 开始动画循环
   */
  const startAnimation = () => {
    sceneManager.startAnimation();
    console.log('▶️ 动画循环已启动');
  };

  /**
   * 初始化拖拽控制
   */
  const setupDragControls = () => {
    sceneManager.setupDragControls();
    console.log('🎯 拖拽控制已初始化');
  };

  /**
   * 添加可拖拽对象
   */
  const addDraggableObject = (object: THREE.Object3D) => {
    sceneManager.addDraggableObject(object);
  };

  /**
   * 移除可拖拽对象
   */
  const removeDraggableObject = (object: THREE.Object3D) => {
    sceneManager.removeDraggableObject(object);
  };

  /**
   * 停止动画循环
   */
  const stopAnimation = () => {
    sceneManager.stopAnimation();
    console.log('⏸️ 动画循环已停止');
  };

  /**
   * 切换视角
   */
  const updateView = (viewKey: string) => {
    const context = sceneManager.getRenderContext();
    const meshes = context.getAllMeshes();
    sceneManager.updateView(viewKey, meshes);
    console.log(`👁️ 切换视角: ${viewKey}`);
  };

  /**
   * 窗口大小调整
   */
  const handleResize = () => {
    sceneManager.handleResize();
  };

  /**
   * 获取场景对象
   */
  const getScene = () => sceneManager.getScene();

  /**
   * 获取相机对象
   */
  const getCamera = () => sceneManager.getCamera();

  /**
   * 获取渲染器对象
   */
  const getRenderer = () => sceneManager.getRenderer();

  /**
   * 获取控制器对象
   */
  const getControls = () => sceneManager.getControls();

  /**
   * 获取渲染上下文
   */
  const getRenderContext = () => sceneManager.getRenderContext();

  /**
   * 清理资源
   */
  const cleanup = () => {
    stopAnimation();
    sceneManager.dispose();
    console.log('🧹 场景资源已清理');
  };

  // 组件卸载时自动清理
  onUnmounted(() => {
    cleanup();
  });

  return {
    // 状态
    isLoading,
    loadProgress,
    error,

    // 方法
    initScene,
    loadModels,
    startAnimation,
    stopAnimation,
    setupDragControls,
    addDraggableObject,
    removeDraggableObject,
    updateView,
    handleResize,
    cleanup,

    // 获取器
    getScene,
    getCamera,
    getRenderer,
    getControls,
    getRenderContext,
  };
}
