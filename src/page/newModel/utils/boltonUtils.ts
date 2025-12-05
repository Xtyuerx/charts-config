import * as THREE from 'three';
import type { BoltonAnalysisData, BoltonToothPoint, ToothCentersMap } from '../types';

/**
 * 创建双箭头测量线
 * @param startPoint 起始点
 * @param endPoint 结束点
 * @param width 宽度值（单位：mm）
 * @param toothFdi 牙齿FDI编号
 * @returns 测量线组对象
 */
export function createDoubleArrowLine(
  startPoint: THREE.Vector3,
  endPoint: THREE.Vector3,
  width: number,
  toothFdi: number,
): THREE.Group {
  const group = new THREE.Group();
  group.name = `width_measurement_${toothFdi}`;

  // 计算方向和长度
  const direction = new THREE.Vector3().subVectors(endPoint, startPoint);
  const normalizedDir = direction.clone().normalize();

  // 1. 创建主线
  const lineGeometry = new THREE.BufferGeometry().setFromPoints([startPoint, endPoint]);
  const lineMaterial = new THREE.LineBasicMaterial({
    color: 0xff0000,
    linewidth: 2,
    depthTest: false,
  });
  const line = new THREE.Line(lineGeometry, lineMaterial);
  group.add(line);

  // 2. 箭头参数
  const arrowSize = 0.5; // 箭头大小
  const arrowAngle = Math.PI / 6; // 箭头角度（30度）

  // 3. 创建起点箭头（两个三角形）
  createArrowHead(startPoint, normalizedDir, arrowSize, arrowAngle, group, true);

  // 4. 创建终点箭头（两个三角形）
  createArrowHead(endPoint, normalizedDir, arrowSize, arrowAngle, group, false);

  // 5. 创建宽度标签
  const centerPoint = new THREE.Vector3().addVectors(startPoint, endPoint).multiplyScalar(0.5);
  const label = createMeasurementLabel(width.toFixed(2) + ' mm');
  label.position.copy(centerPoint);
  label.position.z += 1; // 稍微向上偏移
  group.add(label);

  return group;
}

/**
 * 创建箭头头部
 * @param point 箭头顶点位置
 * @param direction 主线方向
 * @param size 箭头大小
 * @param angle 箭头角度
 * @param parent 父对象
 * @param isStart 是否为起点（决定箭头方向）
 */
function createArrowHead(
  point: THREE.Vector3,
  direction: THREE.Vector3,
  size: number,
  angle: number,
  parent: THREE.Group,
  isStart: boolean,
): void {
  // 箭头朝外：起点箭头朝左，终点箭头朝右
  const arrowDir = isStart ? direction.clone().negate() : direction.clone();

  // 创建箭头的两条边
  // 计算垂直方向（在XY平面上）
  const perpendicular = new THREE.Vector3(-arrowDir.y, arrowDir.x, 0).normalize();

  // 箭头的两个端点
  const offset1 = new THREE.Vector3().addVectors(
    arrowDir.clone().multiplyScalar(-size * Math.cos(angle)),
    perpendicular.clone().multiplyScalar(size * Math.sin(angle)),
  );

  const offset2 = new THREE.Vector3().addVectors(
    arrowDir.clone().multiplyScalar(-size * Math.cos(angle)),
    perpendicular.clone().multiplyScalar(-size * Math.sin(angle)),
  );

  const arrowPoint1 = new THREE.Vector3().addVectors(point, offset1);
  const arrowPoint2 = new THREE.Vector3().addVectors(point, offset2);

  // 创建箭头的两条线
  const arrowLine1 = new THREE.BufferGeometry().setFromPoints([point, arrowPoint1]);
  const arrowLine2 = new THREE.BufferGeometry().setFromPoints([point, arrowPoint2]);

  const arrowMaterial = new THREE.LineBasicMaterial({
    color: 0xff0000,
    linewidth: 2,
    depthTest: false,
  });

  const arrow1 = new THREE.Line(arrowLine1, arrowMaterial);
  const arrow2 = new THREE.Line(arrowLine2, arrowMaterial);

  parent.add(arrow1);
  parent.add(arrow2);
}

/**
 * 创建测量标签
 * @param text 显示文本
 * @returns THREE.Sprite
 */
function createMeasurementLabel(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  // 绘制半透明背景
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 绘制边框
  ctx.strokeStyle = '#ff0000';
  ctx.lineWidth = 4;
  ctx.strokeRect(0, 0, canvas.width, canvas.height);

  // 绘制文字
  ctx.font = 'Bold 48px Arial';
  ctx.fillStyle = '#ff0000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(3, 1.5, 1);

  return sprite;
}

/**
 * 根据牙齿点云计算近远中边界点（横向）
 * @param toothPoints 牙齿的所有顶点坐标
 * @returns { mesial: Vector3, distal: Vector3 } 近中点和远中点
 */
function calculateToothBoundaries(
  toothPoints: Float32Array,
): { mesial: THREE.Vector3; distal: THREE.Vector3 } | null {
  if (!toothPoints || toothPoints.length < 3) {
    return null;
  }

  // 计算牙齿的横向边界（X轴方向）
  let minX = Infinity;
  let maxX = -Infinity;
  const mesialPoint = new THREE.Vector3();
  const distalPoint = new THREE.Vector3();

  // 遍历所有点找到X轴的最小值和最大值
  for (let i = 0; i < toothPoints.length; i += 3) {
    const x = toothPoints[i] || 0;
    const y = toothPoints[i + 1] || 0;
    const z = toothPoints[i + 2] || 0;

    if (x < minX) {
      minX = x;
      mesialPoint.set(x, y, z);
    }
    if (x > maxX) {
      maxX = x;
      distalPoint.set(x, y, z);
    }
  }

  return { mesial: mesialPoint, distal: distalPoint };
}

/**
 * 根据Bolton数据和STL牙齿点云渲染所有牙齿的宽度测量线
 * @param boltonData Bolton分析数据
 * @param toothPointsData 每颗牙齿的点云数据（从renderPointsFromJson获取）
 * @param toothCenters 每颗牙齿的中心点
 * @param scene 场景对象
 * @param parentMesh 父网格对象（用于获取变换）
 * @returns 所有测量线组成的组
 */
export function renderBoltonWidthMeasurementsFromSTL(
  boltonData: BoltonAnalysisData,
  toothPointsData: Record<number, Float32Array>,
  toothCenters: ToothCentersMap,
  scene: THREE.Scene,
  parentMesh: THREE.Mesh,
): THREE.Group {
  const measurementsGroup = new THREE.Group();
  measurementsGroup.name = 'bolton_width_measurements';

  const { measurements } = boltonData;
  const widthData = measurements?.width || {};
  console.log(toothPointsData, toothCenters, widthData, '1234567887777777777');
  console.log('可用的牙齿点云数据:', Object.keys(toothPointsData));
  console.log('可用的牙齿中心点:', Object.keys(toothCenters));
  console.log('Bolton宽度数据:', Object.keys(widthData));

  // 为每颗有宽度数据的牙齿创建测量线
  Object.keys(widthData).forEach(fdiStr => {
    const fdi = Number(fdiStr);
    const width = widthData[fdi];
    const toothPoints = toothPointsData[fdi];
    const toothCenter = toothCenters[fdi];

    if (!toothPoints || !toothCenter) {
      console.warn(`牙齿 ${fdi} 缺少点云数据或中心点，跳过`);
      return;
    }

    // 计算牙齿的近远中边界点
    const boundaries = calculateToothBoundaries(toothPoints);
    if (!boundaries) {
      console.warn(`无法计算牙齿 ${fdi} 的边界点，跳过`);
      return;
    }

    // 创建测量线
    const measurementLine = createDoubleArrowLine(
      boundaries.mesial,
      boundaries.distal,
      width || 0,
      fdi,
    );
    measurementsGroup.add(measurementLine);
  });

  // 添加到父网格（继承父网格的变换）
  parentMesh.add(measurementsGroup);

  console.log(`已创建 ${measurementsGroup.children.length} 个牙齿宽度测量线`);

  return measurementsGroup;
}

/**
 * 根据Bolton数据渲染所有牙齿的宽度测量线（原始方法，使用Bolton提供的坐标）
 * @param boltonData Bolton分析数据
 * @param scene 场景对象
 * @param parentGroup 父组对象（可选）
 * @returns 所有测量线组成的组
 */
export function renderBoltonWidthMeasurements(
  boltonData: BoltonAnalysisData,
  scene: THREE.Scene,
  parentGroup?: THREE.Group,
): THREE.Group {
  const measurementsGroup = new THREE.Group();
  measurementsGroup.name = 'bolton_width_measurements';

  const { teeth_points, measurements } = boltonData;
  const widthData = measurements?.width || {};

  // 按牙齿FDI分组边界点
  const toothBoundaries: Record<number, { mesial?: THREE.Vector3; distal?: THREE.Vector3 }> = {};

  teeth_points.forEach((point: BoltonToothPoint) => {
    const { fdi, type, point: coords } = point;
    const position = new THREE.Vector3(coords[0], coords[1], coords[2]);

    if (!toothBoundaries[fdi]) {
      toothBoundaries[fdi] = {};
    }

    if (type === 'boundary_mesial') {
      toothBoundaries[fdi].mesial = position;
    } else if (type === 'boundary_distal') {
      toothBoundaries[fdi].distal = position;
    }
  });

  // 为每颗有完整边界点的牙齿创建测量线
  Object.keys(toothBoundaries).forEach(fdiStr => {
    const fdi = Number(fdiStr);
    const boundary = toothBoundaries[fdi];
    const width = widthData[fdi];

    if (boundary && boundary.mesial && boundary.distal && width !== undefined) {
      const measurementLine = createDoubleArrowLine(boundary.mesial, boundary.distal, width, fdi);
      measurementsGroup.add(measurementLine);
    }
  });

  if (parentGroup) {
    parentGroup.add(measurementsGroup);
  } else {
    scene.add(measurementsGroup);
  }

  console.log(`已创建 ${Object.keys(toothBoundaries).length} 个牙齿宽度测量线`);

  return measurementsGroup;
}

/**
 * 切换Bolton宽度测量线的显示
 * @param scene 场景对象
 * @param visible 是否显示
 */
export function toggleBoltonMeasurements(scene: THREE.Scene, visible: boolean): void {
  const measurementGroup = scene.getObjectByName('bolton_width_measurements');
  if (measurementGroup) {
    measurementGroup.visible = visible;
  }
}
