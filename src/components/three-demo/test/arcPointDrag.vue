<template>
  <div class="container">
    <div ref="canvasContainer" class="canvas-container"></div>
    
    <div class="info-panel">
      <p>绿色线: 曲线 | 红色球: 可拖动的点</p>
      <p>鼠标拖动红色球在曲线上移动</p>
    </div>

    <div class="control-panel">
      <label>选择曲线类型:</label>
      <div class="button-group">
        <button
          v-for="type in curveTypes"
          :key="type"
          @click="changeCurveType(type)"
          :class="{ active: currentCurveType === type }"
        >
          {{ type.charAt(0).toUpperCase() + type.slice(1) }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import * as THREE from 'three';

const canvasContainer = ref(null);
const currentCurveType = ref('catmull');
const curveTypes = ['catmull', 'bezier', 'quadratic', 'line'];

let scene, camera, renderer;
let point, curve;
let curvePoints = [];
let isDragging = false;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

const createCurve = (type) => {
  let newCurve;
  
  switch (type) {
    case 'catmull':
      const points1 = [
        new THREE.Vector3(-3, 0, 0),
        new THREE.Vector3(-1, 2, 0),
        new THREE.Vector3(1, -1, 0),
        new THREE.Vector3(3, 1, 0)
      ];
      newCurve = new THREE.CatmullRomCurve3(points1);
      break;
      
    case 'bezier':
      const bezierPoints = [
        new THREE.Vector3(-3, -1, 0),
        new THREE.Vector3(-1, 2, 0),
        new THREE.Vector3(1, 2, 0),
        new THREE.Vector3(3, -1, 0)
      ];
      newCurve = new THREE.CubicBezierCurve3(
        bezierPoints[0], bezierPoints[1],
        bezierPoints[2], bezierPoints[3]
      );
      break;
      
    case 'quadratic':
      const quadPoints = [
        new THREE.Vector3(-3, 0, 0),
        new THREE.Vector3(0, 3, 0),
        new THREE.Vector3(3, 0, 0)
      ];
      newCurve = new THREE.QuadraticBezierCurve3(
        quadPoints[0], quadPoints[1], quadPoints[2]
      );
      break;
      
    case 'line':
      newCurve = new THREE.LineCurve3(
        new THREE.Vector3(-3, 2, 0),
        new THREE.Vector3(3, -2, 0)
      );
      break;
      
    default:
      newCurve = new THREE.LineCurve3(
        new THREE.Vector3(-3, 0, 0),
        new THREE.Vector3(3, 0, 0)
      );
  }
  
  return newCurve;
};

const updateCurve = () => {
  // 移除旧曲线
  const oldLine = scene.getObjectByName('curveLine');
  if (oldLine) scene.remove(oldLine);

  // 创建新曲线
  curve = createCurve(currentCurveType.value);
  curvePoints = curve.getPoints(200);

  const curveGeometry = new THREE.BufferGeometry().setFromPoints(curvePoints);
  const curveMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 2 });
  const curveLine = new THREE.Line(curveGeometry, curveMaterial);
  curveLine.name = 'curveLine';
  scene.add(curveLine);

  // 移除旧点
  const oldPoint = scene.getObjectByName('draggablePoint');
  if (oldPoint) scene.remove(oldPoint);

  // 创建新点
  const pointGeometry = new THREE.SphereGeometry(0.15, 32, 32);
  const pointMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
  point = new THREE.Mesh(pointGeometry, pointMaterial);
  point.position.copy(curvePoints[0]);
  point.userData.curveParam = 0;
  point.name = 'draggablePoint';
  scene.add(point);
};

const onMouseDown = (e) => {
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObject(point);

  if (intersects.length > 0) {
    isDragging = true;
  }
};

const onMouseMove = (e) => {
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

  if (isDragging) {
    raycaster.setFromCamera(mouse, camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const intersection = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, intersection);

    // 找到曲线上最近的点
    let minDist = Infinity;
    let closestIndex = 0;

    curvePoints.forEach((curvePoint, index) => {
      const dist = intersection.distanceTo(curvePoint);
      if (dist < minDist) {
        minDist = dist;
        closestIndex = index;
      }
    });

    point.position.copy(curvePoints[closestIndex]);
    point.userData.curveParam = closestIndex / curvePoints.length;
  }
};

const onMouseUp = () => {
  isDragging = false;
};

const onWindowResize = () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
};

const changeCurveType = (type) => {
  currentCurveType.value = type;
  updateCurve();
};

const animate = () => {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
};

onMounted(() => {
  // 场景初始化
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x222222);

  // 相机设置
  camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.z = 8;

  // 渲染器设置
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  canvasContainer.value.appendChild(renderer.domElement);

  // 初始化曲线
  updateCurve();

  // 添加事件监听
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('resize', onWindowResize);

  // 开始动画循环
  animate();
});

onBeforeUnmount(() => {
  // 移除事件监听
  window.removeEventListener('mousedown', onMouseDown);
  window.removeEventListener('mousemove', onMouseMove);
  window.removeEventListener('mouseup', onMouseUp);
  window.removeEventListener('resize', onWindowResize);

  // 清理Three.js资源
  renderer.dispose();
  if (canvasContainer.value && renderer.domElement.parentNode === canvasContainer.value) {
    canvasContainer.value.removeChild(renderer.domElement);
  }
});
</script>

<style scoped>
.container {
  width: 100%;
  height: 100vh;
  margin: 0;
  padding: 0;
  position: relative;
  overflow: hidden;
}

.canvas-container {
  width: 100%;
  height: 100%;
}

.info-panel {
  position: absolute;
  top: 20px;
  left: 20px;
  color: #fff;
  font-size: 14px;
  background-color: rgba(0, 0, 0, 0.7);
  padding: 15px;
  border-radius: 5px;
  z-index: 10;
  margin: 0;
}

.info-panel p {
  margin: 5px 0;
}

.control-panel {
  position: absolute;
  bottom: 20px;
  left: 20px;
  background-color: rgba(0, 0, 0, 0.7);
  padding: 15px;
  border-radius: 5px;
  z-index: 10;
  color: #fff;
}

.control-panel label {
  display: block;
  margin-bottom: 10px;
}

.button-group {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.button-group button {
  padding: 8px 15px;
  background-color: #666;
  color: #fff;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  font-weight: normal;
  transition: all 0.3s;
}

.button-group button:hover {
  background-color: #777;
}

.button-group button.active {
  background-color: #00ff00;
  color: #000;
  font-weight: bold;
}
</style>