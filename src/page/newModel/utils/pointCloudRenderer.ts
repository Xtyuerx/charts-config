import * as THREE from 'three';
import type { ToothCentersMap } from '../types';

/**
 * 渲染结果
 */
export interface RenderPointsResult {
  toothCenters: ToothCentersMap;
  toothPointsData: Record<number, Float32Array>;
}

/**
 * 根据labels数组渲染点云到STL模型上
 * @param geometry STL模型的几何体
 * @param labelsArray labels数组，长度与STL顶点数一致
 * @param parentMesh 父网格对象
 * @returns 每颗牙齿的中心点映射和点云数据
 */
export function renderPointsFromJson(
  geometry: THREE.BufferGeometry,
  labelsArray: number[],
  parentMesh: THREE.Mesh,
): RenderPointsResult | null {
  const positions = geometry.getAttribute('position');

  if (!positions) {
    console.error('几何体没有position属性');
    return null;
  }

  const vertexCount = positions.count;
  console.log(positions, 'positions');
  if (labelsArray.length !== vertexCount) {
    console.warn(`Labels数组长度(${labelsArray.length})与STL顶点数(${vertexCount})不匹配`);
  }

  const groupedByTooth: Record<number, Float32Array> = {};
  const pointsPerTooth: Record<number, number> = {};
  const toothCenters: Record<number, THREE.Vector3> = {};

  // 统计每个牙齿编号的点数
  for (let i = 0; i < Math.min(vertexCount, labelsArray.length); i++) {
    const toothLabel = labelsArray[i];
    if (toothLabel === undefined) continue;

    if (!pointsPerTooth[toothLabel]) {
      pointsPerTooth[toothLabel] = 0;
      toothCenters[toothLabel] = new THREE.Vector3(0, 0, 0);
    }
    pointsPerTooth[toothLabel]++;
  }

  // 为每个牙齿编号分配数组
  Object.keys(pointsPerTooth).forEach(label => {
    const labelNum = Number(label);
    const count = pointsPerTooth[labelNum];
    if (count !== undefined) {
      groupedByTooth[labelNum] = new Float32Array(count * 3);
    }
  });

  // 临时索引记录器
  const tempIndices: Record<number, number> = {};
  Object.keys(pointsPerTooth).forEach(label => {
    tempIndices[Number(label)] = 0;
  });

  // 将顶点坐标按牙齿编号分组，同时计算中心点
  for (let i = 0; i < Math.min(vertexCount, labelsArray.length); i++) {
    const toothLabel = labelsArray[i];
    if (toothLabel === undefined) continue;

    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);

    const idx = tempIndices[toothLabel];
    if (idx === undefined) continue;

    const group = groupedByTooth[toothLabel];
    if (!group) continue;

    group[idx] = x;
    group[idx + 1] = y;
    group[idx + 2] = z;

    // 累加坐标用于计算中心点
    const center = toothCenters[toothLabel];
    if (center) {
      center.x += x;
      center.y += y;
      center.z += z;
    }

    const newIdx = tempIndices[toothLabel];
    if (newIdx !== undefined) {
      tempIndices[toothLabel] = newIdx + 3;
    }
  }

  // 计算每颗牙齿的平均中心点
  Object.keys(toothCenters).forEach(label => {
    const toothLabel = Number(label);
    const center = toothCenters[toothLabel];
    const count = pointsPerTooth[toothLabel];
    if (center && count) {
      center.x /= count;
      center.y /= count;
      center.z /= count;
    }
  });

  return {
    toothCenters,
    toothPointsData: groupedByTooth,
  };
}
