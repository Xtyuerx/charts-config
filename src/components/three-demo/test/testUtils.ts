import * as THREE from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader';
import { Text } from 'troika-three-text';

export async function loadTestResource(scene: THREE.Scene): Promise<THREE.Group> {
  const upper = 'public/test_resource/瑞通需求1126/20251114_0004_upper.stl';
  const lower = 'public/test_resource/瑞通需求1126/20251114_0004_lower.stl';
  const upper_only_tooth = 'public/test_resource/瑞通需求1126/20251114_0004_upper_only_tooth.stl';
  const lower_only_tooth = 'public/test_resource/瑞通需求1126/20251114_0004_lower_only_tooth.stl';
  const loader = new STLLoader();
  const upperGeometry = await loader.loadAsync(upper);
  const lowerGeometry = await loader.loadAsync(lower);
  const upperOnlyToothGeometry = await loader.loadAsync(upper_only_tooth);
  const lowerOnlyToothGeometry = await loader.loadAsync(lower_only_tooth);

  lowerGeometry.computeBoundingBox();

  const material = new THREE.MeshStandardMaterial({
    color: 0x7f434a,
    metalness: 0.4,
    roughness: 0.6,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 5,
    polygonOffsetUnits: 1,
  });

  const upperMesh = new THREE.Mesh(upperGeometry, material);
  const lowerMesh = new THREE.Mesh(lowerGeometry, material);

  const onlyToothMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 0.7,
    roughness: 0.7,
    side: THREE.DoubleSide,
  });

  const upperOnlyToothMesh = new THREE.Mesh(upperOnlyToothGeometry, onlyToothMaterial);
  const lowerOnlyToothMesh = new THREE.Mesh(lowerOnlyToothGeometry, onlyToothMaterial);

  const group = new THREE.Group();
  group.add(lowerMesh);
  group.add(upperMesh);
  group.add(lowerOnlyToothMesh);
  group.add(upperOnlyToothMesh);
  scene.add(group);
  return group;
}

export function addAxisTicks(scene, length = 50, step = 5) {
  const tickMaterial = new THREE.LineBasicMaterial({ color: 0x888888 });

  const makeTicks = axis => {
    const points = [] as any;
    for (let i = 0; i <= length; i += step) {
      if (axis === 'x') {
        points.push(new THREE.Vector3(i, -0.5, 0));
        points.push(new THREE.Vector3(i, 0.5, 0));
      }
      if (axis === 'y') {
        points.push(new THREE.Vector3(-0.5, i, 0));
        points.push(new THREE.Vector3(0.5, i, 0));
      }
      if (axis === 'z') {
        points.push(new THREE.Vector3(0, -0.5, i));
        points.push(new THREE.Vector3(0, 0.5, i));
      }
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    return new THREE.LineSegments(geometry, tickMaterial);
  };

  scene.add(makeTicks('x'));
  scene.add(makeTicks('y'));
  scene.add(makeTicks('z'));
}

export function addAxisLabels(scene, camera: THREE.Camera | null, renderMissions: (() => void)[] | null = null) {
  const labels = [
    { text: 'X', pos: [50, 0, 0], color: 'red' },
    { text: 'Y', pos: [0, 50, 0], color: 'green' },
    { text: 'Z', pos: [0, 0, 50], color: 'blue' },
  ];

  labels.forEach(l => {
    const label = new Text();
    label.text = l.text;
    label.fontSize = 4;
    label.color = l.color;
    label.position.set(...l.pos);
    scene.add(label);
    label.sync();
    // 始终朝向相机, 方向始终正对
    if (renderMissions && camera) {
      renderMissions.push(() => label.quaternion.copy(camera.quaternion));
    }
  });
}

export function buildBVHForMesh(mesh: THREE.Mesh): void {
    const geometry = mesh.geometry;
  
    // 确保几何体有索引（BVH 需要）
    if (!geometry.index) {
      console.warn('几何体没有索引，BVH 可能无法正常工作');
    }
  
    // 设置 BVH 相关方法
    geometry.computeBoundsTree = computeBoundsTree;
    geometry.disposeBoundsTree = disposeBoundsTree;
  
    // 构建 BVH 树
    console.log('开始构建 BVH...');
    const startTime = performance.now();
    geometry.computeBoundsTree();
    const buildTime = performance.now() - startTime;
    console.log(`BVH 构建完成，耗时: ${buildTime.toFixed(2)}ms`);
  
    // 启用加速射线检测（可选，用于更快的点击检测）
    if (geometry.boundsTree) {
      mesh.raycast = acceleratedRaycast;
    }
  }
