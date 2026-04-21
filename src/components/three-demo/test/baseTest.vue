<template>
  <div class="three-demo">
    <div class="controls">
      <input type="file" @change="handleFileChange" accept=".glb,.gltf,.obj,.stl" />
      <button @click="toggleAutoRotate">自动旋转: {{ autoRotate ? 'ON' : 'OFF' }}</button>
      <button @click="resetCamera">重置视角</button>
    </div>
    <div ref="containerRef" class="canvas-container"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls';
import { addAxisLabels, addAxisTicks } from './testUtils';

const containerRef = ref<HTMLElement>();
const autoRotate = ref(false);

let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;
let controls: TrackballControls;
let currentModel: THREE.Group | null = null;
let renderMissions: (() => void)[] = [];
let animationId: number;

function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe2e3dd);

  // 配置相机
  camera = new THREE.PerspectiveCamera(
    75,
    containerRef.value!.clientWidth / containerRef.value!.clientHeight,
    0.1,
    1000,
  );
  camera.position.set(5, 5, 5);

  // 配置渲染器
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(containerRef.value!.clientWidth, containerRef.value!.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  containerRef.value!.appendChild(renderer.domElement);

  // 配置控制器
  controls = new TrackballControls(camera, renderer.domElement);
  controls.rotateSpeed = 3.0;
  controls.zoomSpeed = 1.2;
  controls.panSpeed = 0.8;

  // 添加坐标轴辅助器
  const axesHelper = new THREE.AxesHelper(50); // 长度为 5
  scene.add(axesHelper);
  // 标签
  addAxisLabels(scene, camera, renderMissions);
  // 刻度
  addAxisTicks(scene, 50, 5);

  window.addEventListener('resize', onWindowResize);
}

function setupLights() {
  // 1. 环境光 - 提供基础照明
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
  scene.add(ambientLight);

  // 2. 上方光源 - 从上方照射
  const topLight = new THREE.DirectionalLight(0xffffff, 0.7);
  topLight.position.set(0, 50, 0);
  topLight.target.position.set(0, 0, 0);
  scene.add(topLight);

  // 3. 下方光源 - 从下方照射
  const bottomLight = new THREE.DirectionalLight(0xffffff, 0.7);
  bottomLight.position.set(0, -50, 0);
  bottomLight.target.position.set(0, 0, 0);
  scene.add(bottomLight);

  // 4. 左侧光源 - 从左侧照射
  const leftLight = new THREE.DirectionalLight(0xffffff, 1.5);
  leftLight.position.set(-50, 0, 0);
  leftLight.target.position.set(0, 0, 0);
  scene.add(leftLight);

  // 5. 右侧光源 - 从右侧照射
  const rightLight = new THREE.DirectionalLight(0xffffff, 1.5);
  rightLight.position.set(50, 0, 0);
  rightLight.target.position.set(0, 0, 0);
  scene.add(rightLight);

  // 6. 前方光源 - 从前方照射（增强正面细节）
  const frontLight = new THREE.DirectionalLight(0xffffff, 3);
  frontLight.position.set(0, 0, 50);
  frontLight.target.position.set(0, 0, 0);
  scene.add(frontLight);

  // 7. 后方光源 - 从后方照射（增强背面细节）
  const backLight = new THREE.DirectionalLight(0xffffff, 1.5);
  backLight.position.set(0, 0, -50);
  backLight.target.position.set(0, 0, 0);
  scene.add(backLight);

  scene.add(new THREE.DirectionalLightHelper(backLight, 5, 0xff0000));
  scene.add(new THREE.DirectionalLightHelper(frontLight, 5, 0xff0000));
  scene.add(new THREE.DirectionalLightHelper(leftLight, 5, 0xff0000));
  scene.add(new THREE.DirectionalLightHelper(rightLight, 5, 0xff0000));
  scene.add(new THREE.DirectionalLightHelper(bottomLight, 5, 0xff0000));
  scene.add(new THREE.DirectionalLightHelper(topLight, 5, 0xff0000));
}

function addDefaultGeometry() {
  // 添加地面
  const groundGeometry = new THREE.PlaneGeometry(20, 20);
  const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x444444 });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -2;
  ground.receiveShadow = true;
  scene.add(ground);

  // 添加默认几何体
  const geometry = new THREE.BoxGeometry(2, 2, 2);
  const material = new THREE.MeshStandardMaterial({
    color: 0x4a90e2,
    metalness: 0.3,
    roughness: 0.7,
  });
  const cube = new THREE.Mesh(geometry, material);
  cube.position.set(0, 0, 0);
  cube.castShadow = true;
  const group = new THREE.Group();
  group.add(cube);
  scene.add(group);
  currentModel = group;
}

async function handleFileChange(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  // 移除旧模型（保留地面和默认立方体）
  if (currentModel) {
    const isDefaultCube =
      currentModel instanceof THREE.Mesh && currentModel.geometry instanceof THREE.BoxGeometry;
    if (!isDefaultCube) {
      scene.remove(currentModel);
      currentModel.traverse(child => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
    }
  }

  const fileName = file.name.toLowerCase();
  const url = URL.createObjectURL(file);

  try {
    const fileType = fileName.split('.').pop();
    switch (fileType) {
      case 'glb':
        await loadGLTF(url);
        break;
      case 'gltf':
        await loadGLTF(url);
        break;
      case 'obj':
        await loadOBJ(url);
        break;
      case 'stl':
        await loadstl(url);
        break;
      default:
        throw new Error('不支持的文件类型');
    }
  } catch (error) {
    console.error('加载模型失败:', error);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadGLTF(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(
      url,
      gltf => {
        const model = gltf.scene;
        model.traverse(child => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        // 居中模型
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        model.position.sub(center);

        scene.add(model);
        currentModel = model;
        resolve();
      },
      undefined,
      reject,
    );
  });
}

function loadOBJ(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const loader = new OBJLoader();
    loader.load(
      url,
      object => {
        object.traverse(child => {
          if (child instanceof THREE.Mesh) {
            child.material = new THREE.MeshStandardMaterial({
              color: 0x4a90e2,
              metalness: 0,
              roughness: 0.7,
            });
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        // 居中模型
        const box = new THREE.Box3().setFromObject(object);
        const center = box.getCenter(new THREE.Vector3());
        object.position.sub(center);

        scene.add(object);
        currentModel = object;
        resolve();
      },
      undefined,
      reject,
    );
  });
}

async function loadstl(url: string): Promise<void> {
  const loader = new STLLoader();
  const geometry: THREE.BufferGeometry = await loader.loadAsync(url);
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color: 0xe9eef6,
    metalness: 0.4,
    roughness: 0.6,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.add(mesh);
  scene.add(group);
  currentModel = group;
  fitCameraToObject(camera, group, controls);
}

function fitCameraToObject(
  camera: THREE.PerspectiveCamera,
  targetObject: THREE.Object3D,
  controls: TrackballControls,
  offset = 1.2,
) {
  const box = new THREE.Box3().setFromObject(targetObject);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());

  // 1. 计算所需距离
  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = camera.fov * (Math.PI / 180); // FOV转弧度
  let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));

  // 2. 应用偏移量 (Margin)
  cameraZ *= offset;

  // 3. 设置相机位置
  // 从中心点出发，沿 Z 轴负方向（默认视角方向）移动
  const newCameraPosition = center.clone();
  newCameraPosition.z += cameraZ;

  camera.position.copy(newCameraPosition);
  camera.lookAt(center);

  // 4. (可选) 更新控制器 target
  if (controls) {
    controls.target.copy(center);
    controls.update();
  }

  // 5. 更新矩阵
  camera.updateProjectionMatrix();
}

function toggleAutoRotate() {
  autoRotate.value = !autoRotate.value;
  controls.noRotate = !autoRotate.value;
}

function resetCamera() {
  if(!currentModel) return;
  focusCameraOnObject(currentModel, camera, controls);
}

function focusCameraOnObject(object: THREE.Object3D, camera: THREE.PerspectiveCamera, controls: TrackballControls) {
  // 1. 计算包围盒
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  // 2. 模型最大尺寸
  const maxDim = Math.max(size.x, size.y, size.z);

  // 3. 根据相机视角计算理想距离
  // camera.fov 是垂直 FOV（以角度计算）
  const fov = camera.fov * (Math.PI / 180);
  let cameraDistance = (maxDim / 2) / Math.tan(fov / 2);

  // 再加一点 padding，让模型不贴边太紧
  cameraDistance *= 1.5;

  // 4. 设置相机位置（可按你喜欢的方向）
  camera.position.set(
    center.x + cameraDistance,
    center.y + cameraDistance * 0.6,
    center.z + cameraDistance,
  );
  // 相机上是z轴方向
  camera.up.set(0, 0, 1);

  // 5. 让相机对准模型中心
  camera.lookAt(center);

  // 6. 修正 OrbitControls 的中心点
  controls.target.copy(center);
  controls.update();
}

function onWindowResize() {
  if (!containerRef.value) return;
  camera.aspect = containerRef.value.clientWidth / containerRef.value.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(containerRef.value.clientWidth, containerRef.value.clientHeight);
}

function animate() {
  animationId = requestAnimationFrame(animate);
  renderMissions.forEach(mission => {
    mission();
  });
  controls.update();
  renderer.render(scene, camera);
}

import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { loadTestResource } from './testUtils';
function setupOutlineEffect(renderer, scene, camera, meshesToOutline) {
    
    // 1. 创建 EffectComposer
    const composer = new EffectComposer(renderer);

    // 2. 添加 RenderPass (将场景渲染到 composer)
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    // 3. 创建 OutlinePass
    const outlinePass = new OutlinePass(
        new THREE.Vector2(window.innerWidth, window.innerHeight), 
        scene, 
        camera
    );

    // 4. 配置 OutlinePass 参数来达到平滑效果
    outlinePass.edgeStrength = 4.0;      // 轮廓强度，提高清晰度
    outlinePass.edgeGlow = 1.5;          // **发光/柔和度：增加此值可使边缘更平滑 (重点)**
    outlinePass.edgeThickness = 1.5;     // 轮廓线条粗细
    
    // 轮廓颜色可以根据需要调整
    outlinePass.visibleEdgeColor.set(0x000000); // 描边颜色（黑色或其他与牙齿区分的颜色）
    outlinePass.hiddenEdgeColor.set(0x000000);  // 隐藏边缘颜色
    outlinePass.pulsePeriod = 0; // 不闪烁

    // 5. 设置需要描边的 Mesh
    outlinePass.selectedObjects = meshesToOutline;
    
    composer.addPass(outlinePass);

    // 返回 composer
    return composer;
}

onMounted(async () => {
  initScene();
  setupLights();
  animate();
  const group = await loadTestResource(scene);
  currentModel = group;
  fitCameraToObject(camera, group, controls);
});

onBeforeUnmount(() => {
  if (animationId) cancelAnimationFrame(animationId);
  if (renderer) renderer.dispose();
  renderMissions = [];
});
</script>

<style scoped>
.three-demo {
  width: 100%;
  height: 100vh;
  display: flex;
  flex-direction: column;
}

.controls {
  padding: 10px;
  background: #333;
  display: flex;
  gap: 10px;
  align-items: center;
}

.controls input[type='file'] {
  color: white;
}

.controls button {
  padding: 8px 16px;
  background: #4a90e2;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.controls button:hover {
  background: #357abd;
}

.canvas-container {
  flex: 1;
  width: 100%;
  overflow: hidden;
}
</style>
