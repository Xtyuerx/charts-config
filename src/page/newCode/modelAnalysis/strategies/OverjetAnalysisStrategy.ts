import * as THREE from 'three';
import type { AnalysisData, MeasurementGroup, RenderType } from '../types';
import { LabelRenderer } from '../renderers';
import { BaseAnalysisStrategy } from './base/BaseAnalysisStrategy';

/**
 * 覆盖度分析策略
 * 分析前牙垂直覆盖关系
 */
export class OverjetAnalysisStrategy extends BaseAnalysisStrategy {
  readonly id = 'overjet';
  readonly name = '覆盖分析';
  readonly taskName = 'overjet';
  readonly renderType: RenderType = 'POINT_ONLY';

  // 存储可拖动的点位对象
  private draggablePoints: THREE.Mesh[] = [];
  // 切片配置（可根据需要调整）
  private readonly SLICE_CONFIG = {
    width: 30, // 切片宽度（竖立后是前后方向的深度）
    height: 30, // 切片高度（竖立后是垂直高度）
    opacity: 0.3, // 透明度
    borderOpacity: 0.9, // 边框透明度
  };

  /**
   * 重写点位渲染方法，根据上下颌显示不同颜色
   */
  protected renderPoints(teethPoints: import('../types').ToothPoint[]): void {
    const upperPoints = teethPoints.filter(p => this.isUpper(p.fdi));
    const lowerPoints = teethPoints.filter(p => this.isLower(p.fdi));
    // 1. 创建牙弓线（使用 teeth_points 数据）
    this.createArchWire();
    // 渲染上颌点位（#FEB5B5）
    this.createColoredPointMarkers(upperPoints, true);
    // 渲染下颌点位（#A49ED9）
    this.createColoredPointMarkers(lowerPoints, false);
  }

  /**
   * 创建指定颜色的点位标记
   */
  private createColoredPointMarkers(
    midlinePoints: AnalysisData['teeth_points'],
    isUpper: boolean,
  ): void {
    if (!midlinePoints || midlinePoints.length === 0) return;

    const jawType = isUpper ? '上颌' : '下颌';

    // 确定颜色
    const samplePointColor = isUpper ? 0xfeb5b5 : 0xa49ed9; // 采样点颜色：上颌绿色，下颌青色

    // 根据 isUpper 直接获取目标 mesh
    const targetMesh = isUpper ? this.context.upperMeshLabel : this.context.lowerMeshLabel;

    if (!targetMesh) {
      return;
    }

    // 为每个原始中线点找到对应的最近采样点
    midlinePoints.forEach((point, index) => {
      // 尝试标准化数据格式
      const normalizedPoint = this.normalizePointData(point, index + 1);

      if (!normalizedPoint) {
        console.warn(`⚠️ ${jawType}中线点${index + 1}: 数据格式无效`, point);
        return;
      }

      const pointCoords = normalizedPoint.point;
      const originalCenter = new THREE.Vector3(pointCoords[0], pointCoords[1], pointCoords[2]);

      // 1. 创建原始中线点球体标记
      // const originalSphere = this.createMidlinePointSphere(
      //   originalCenter,
      //   originalColor,
      //   `${this.taskName}_original_midline_point_${jawType}_${index}`,
      //   0.8,
      // );
      // targetMesh.add(originalSphere);

      // 2. 🔥 找到距离这个原始点最近的采样点（在牙弓线上采样）
      const nearestSamplePoint = this.findNearestSamplePoint(originalCenter, jawType, index);

      if (nearestSamplePoint) {
        // 使用原始位置（不进行坐标转换）
        const samplePosition = nearestSamplePoint.position.clone();

        // 创建可拖拽的采样点球体（使用原始位置）
        const nearestSphere = this.createDraggableSamplePointSphere(
          samplePosition, // 使用原始位置
          samplePointColor,
          `${this.taskName}_sample_point_${jawType}_${index}`,
          0.8, // 合适的半径
          nearestSamplePoint.t,
          originalCenter,
          jawType,
          index,
          1.0,
          point, // 传入原始的 ToothPoint 数据
        );
        // 添加到策略组
        this.group.add(nearestSphere);
        this.draggablePoints.push(nearestSphere);

        // 🔥 在采样点位置创建切片（也添加到策略组保持坐标系一致）
        const sliceColor = isUpper ? 0xfeb5b5 : 0xa49ed9; // 上颌红色，下颌蓝色
        const sliceGroup = this.createMidlineSlice(
          samplePosition,
          index,
          sliceColor,
          isUpper,
          nearestSamplePoint.t, // 传递t参数用于计算切片方向
        );
        this.group.add(sliceGroup); // 添加到策略组而不是targetMesh，保持坐标系一致

        // 恢复切片的深度测试，使其能被模型遮挡
        this.enableDepthTestForSlice(sliceGroup);
      } else {
        console.warn(`⚠️ ${jawType} 中线点 ${index + 1}: 未找到最近采样点`);
      }
    });
  }
  /**
   * 标准化点位数据格式
   * 支持多种可能的数据格式
   */
  private normalizePointData(
    point: any,
    index: number,
  ): { point: [number, number, number] } | null {
    // 格式1: {fdi: 11, type: "...", point: [x, y, z]}
    if (point?.point && Array.isArray(point.point) && point.point.length >= 3) {
      return { point: [point.point[0], point.point[1], point.point[2]] };
    }

    // 格式2: [x, y, z] - 直接是坐标数组
    if (Array.isArray(point) && point.length >= 3) {
      return { point: [point[0], point[1], point[2]] };
    }

    // 格式3: {x: 1, y: 2, z: 3} - 对象格式
    if (point && typeof point === 'object' && 'x' in point && 'y' in point && 'z' in point) {
      return { point: [point.x, point.y, point.z] };
    }

    // 格式4: {position: [x, y, z]} 或 {coordinate: [x, y, z]}
    if (point?.position && Array.isArray(point.position) && point.position.length >= 3) {
      return { point: [point.position[0], point.position[1], point.position[2]] };
    }

    // 格式5: {coordinate: [x, y, z]}
    if (point?.coordinate && Array.isArray(point.coordinate) && point.coordinate.length >= 3) {
      return { point: [point.coordinate[0], point.coordinate[1], point.coordinate[2]] };
    }

    // 格式6: {pos: [x, y, z]}
    if (point?.pos && Array.isArray(point.pos) && point.pos.length >= 3) {
      return { point: [point.pos[0], point.pos[1], point.pos[2]] };
    }

    // 格式7: 检查是否有任何数组类型的属性
    if (point && typeof point === 'object') {
      const keys = Object.keys(point);
      for (const key of keys) {
        const value = point[key];
        if (Array.isArray(value) && value.length >= 3) {
          return { point: [value[0], value[1], value[2]] };
        }
      }
    }

    return null;
  }
  /**
   * 🔥 在牙弓线上找到距离原始中线点最近的点
   * 直接返回投影点，简化逻辑
   */
  private findNearestSamplePoint(
    originalPoint: THREE.Vector3,
    jawType: string,
    pointIndex: number,
  ): {
    position: THREE.Vector3;
    t: number;
    distance: number;
    sampleIndex: number;
  } | null {
    if (!this.archWire?.curve) {
      console.warn('⚠️ 牙弓线曲线不存在，无法找到最近采样点');
      return null;
    }

    const curve = this.archWire.curve;
    const divisions = 20000; // 采样密度
    let minDistance = Infinity;
    let nearestSamplePoint: THREE.Vector3 | null = null;
    let nearestT = 0;
    let nearestSampleIndex = 0;

    // 在牙弓线上采样，找到距离原始点最近的点
    for (let i = 0; i <= divisions; i++) {
      const t = i / divisions;
      const samplePosition = curve.getPointAt(t);
      const distance = originalPoint.distanceTo(samplePosition);

      if (distance < minDistance) {
        minDistance = distance;
        nearestSamplePoint = samplePosition.clone();
        nearestT = t;
        nearestSampleIndex = i;
      }
    }

    if (!nearestSamplePoint) {
      console.warn(`⚠️ 未找到 ${jawType} 中线点 ${pointIndex + 1} 的最近采样点`);
      return null;
    }

    // 🔥 确保采样点位置的精确性：重新从曲线获取位置
    const exactPosition = curve.getPointAt(nearestT);
    const positionDiff = nearestSamplePoint.distanceTo(exactPosition);

    // 🔥 使用精确位置确保采样点在牙弓线上
    if (positionDiff > 0.001) {
      console.warn(`⚠️ 采样点位置不精确，使用精确位置`);
      nearestSamplePoint.copy(exactPosition);
    }

    return {
      position: nearestSamplePoint,
      t: nearestT,
      distance: minDistance,
      sampleIndex: nearestSampleIndex,
    };
  }

  /**
   * 创建可拖拽的采样点球体
   * 简化版本：直接展示，只能在牙弓线上滑动
   */
  private createDraggableSamplePointSphere(
    position: THREE.Vector3,
    color: number,
    name: string,
    radius: number,
    initialT: number,
    originalPoint: THREE.Vector3,
    jawType: string,
    pointIndex: number,
    opacity = 1.0,
    originalToothPoint?: import('../types').ToothPoint, // 新增参数：原始点位数据
  ): THREE.Mesh {
    // 使用合适的球体尺寸和材质
    const geometry = new THREE.SphereGeometry(radius, 32, 32);
    const material = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: opacity,
      depthTest: false, // 启用深度测试，让球体能被模型遮挡
      depthWrite: false, // 禁用深度写入，避免遮挡其他对象
    });

    const sphere = new THREE.Mesh(geometry, material);
    sphere.position.copy(position);
    sphere.name = name;
    sphere.visible = true;
    sphere.renderOrder = 1001; // 稍高的渲染顺序，确保在模型之后但仍参与深度测试
    sphere.frustumCulled = false; // 禁用视锥体剔除

    // 🔥 强制设置球体属性
    sphere.matrixAutoUpdate = true;
    sphere.castShadow = false;
    sphere.receiveShadow = false;
    // 设置拖拽数据：只能在牙弓线上滑动
    sphere.userData = {
      isDraggable: true,
      constrainToCurve: true,
      curveT: initialT,
      curveReference: this.archWire?.curve,
      originalPoint: originalPoint, // 初始的原始点位置
      jawType: jawType,
      pointIndex: pointIndex,
      isSamplePoint: true,
      draggable: true,
      onDrag: (newPosition: THREE.Vector3) => this.constrainSamplePointToCurve(sphere, newPosition),

      // 🔥 保存原始的 ToothPoint 数据，用于重构输出格式
      originalToothPoint: originalToothPoint,

      // 🔥 新增：存储用于计算最终原始点位的信息
      initialSamplePosition: position.clone(), // 初始采样点位置
      currentSamplePosition: position.clone(), // 当前采样点位置
      calculatedOriginalPosition: originalPoint.clone(), // 计算后的原始点位置
    };

    return sphere;
  }
  /**
   * 将采样点约束到曲线上（拖拽时调用）
   * 简化版本：直接在策略组坐标系中处理
   */
  // 在 constrainSamplePointToCurve 方法中添加原始点位更新
  private constrainSamplePointToCurve(sphere: THREE.Mesh, dragPosition: THREE.Vector3): void {
    if (!this.archWire?.curve) {
      console.warn('⚠️ 牙弓线曲线不存在，无法约束采样点');
      return;
    }

    const curve = this.archWire.curve;
    let minDistance = Infinity;
    let closestT = 0;
    const closestPoint = new THREE.Vector3();

    // 直接在策略组坐标系中找到最近点（简化处理）
    const samples = 20000;
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const curvePoint = curve.getPointAt(t);
      const distance = dragPosition.distanceTo(curvePoint);

      if (distance < minDistance) {
        minDistance = distance;
        closestT = t;
        closestPoint.copy(curvePoint);
      }
    }

    // 直接更新球体位置
    sphere.position.copy(closestPoint);
    sphere.userData.curveT = closestT;

    // 🔥 更新采样点的计算数据
    sphere.userData.currentSamplePosition = closestPoint.clone();

    // 🔥 计算新的原始点位置（基于采样点的移动）
    const newOriginalPosition = this.calculateOriginalPositionFromSample(
      sphere.userData.originalPoint,
      sphere.userData.initialSamplePosition,
      closestPoint,
    );
    sphere.userData.calculatedOriginalPosition = newOriginalPosition;

    // 更新连接线
    const originalPoint = sphere.userData.originalPoint as THREE.Vector3;
    this.updateSamplePointLines(sphere, originalPoint, closestPoint);

    // 更新对应的切片位置和方向
    this.updateSamplePointSlice(sphere, closestPoint, closestT);
  }
  /**
   * 更新采样点对应的切片位置和方向
   */
  private updateSamplePointSlice(
    sampleSphere: THREE.Mesh,
    newPosition: THREE.Vector3,
    curveT: number,
  ): void {
    const jawTypeChinese = sampleSphere.userData.jawType; // '上颌' 或 '下颌'
    const pointIndex = sampleSphere.userData.pointIndex;

    // 🔥 将中文 jawType 转换为英文格式，匹配切片组命名
    const jawTypeEnglish = jawTypeChinese === '上颌' ? 'upper' : 'lower';
    const sliceGroupName = `${this.taskName}_midline_slice_group_${jawTypeEnglish}_${pointIndex}`;

    // 在策略组中查找对应的切片组
    let sliceGroup: THREE.Group | null = null;
    this.group.traverse(child => {
      if (child.name === sliceGroupName && child instanceof THREE.Group) {
        sliceGroup = child;
      }
    });

    if (!sliceGroup) {
      console.warn(`⚠️ 未找到切片组: ${sliceGroupName}`);
      return;
    }

    // 更新切片组的位置
    sliceGroup.position.copy(newPosition);

    // 更新切片平面的方向（如果有牙弓线切线信息）
    if (this.archWire?.curve) {
      const curve = this.archWire.curve;
      const tangent = curve.getTangentAt(curveT);
      const normal = new THREE.Vector3(-tangent.y, tangent.x, 0).normalize();

      // 找到切片平面和边框，更新它们的方向
      sliceGroup.traverse(child => {
        if (child instanceof THREE.Mesh && child.name.includes('midline_slice_')) {
          // 更新平面方向
          const plane = child;
          plane.lookAt(newPosition.clone().add(normal));
          plane.rotateX(Math.PI / 2);

          // 找到对应的边框并同步旋转
          sliceGroup.traverse(borderChild => {
            if (borderChild instanceof THREE.Line && borderChild.name.includes('slice_border_')) {
              borderChild.setRotationFromQuaternion(plane.quaternion);
            }
          });
        }
      });
    }
  }
  /**
   * 更新采样点相关的连接线
   */
  private updateSamplePointLines(
    sampleSphere: THREE.Mesh,
    originalPoint: THREE.Vector3,
    newSamplePosition: THREE.Vector3,
  ): void {
    const sphereName = sampleSphere.name;
    const jawType = sampleSphere.userData.jawType;
    const pointIndex = sampleSphere.userData.pointIndex;
    const lineName = `${this.taskName}_connection_line_${jawType}_${pointIndex}`;

    // 在策略组中查找连接线（因为现在都添加到策略组了）
    this.group.traverse(child => {
      if (child.name === lineName && child instanceof THREE.Line) {
        this.doUpdateSampleConnectionLine(child, originalPoint, newSamplePosition, lineName);
      }
    });
  }
  /**
   * 执行采样点连接线更新
   */
  private doUpdateSampleConnectionLine(
    connectionLine: THREE.Line,
    originalPoint: THREE.Vector3,
    newSamplePosition: THREE.Vector3,
    lineName: string,
  ): void {
    if (!connectionLine.geometry || !connectionLine.geometry.attributes.position) {
      console.warn(`⚠️ 连接线几何体或位置属性不存在`);
      return;
    }

    const positions = connectionLine.geometry.attributes.position;

    // 更新几何体的顶点位置
    positions.setXYZ(0, originalPoint.x, originalPoint.y, originalPoint.z);
    positions.setXYZ(1, newSamplePosition.x, newSamplePosition.y, newSamplePosition.z);
    positions.needsUpdate = true;

    // 强制重新计算边界框
    if (connectionLine.geometry.boundingBox) {
      connectionLine.geometry.computeBoundingBox();
    }
    if (connectionLine.geometry.boundingSphere) {
      connectionLine.geometry.computeBoundingSphere();
    }
  }
  /**
   * 获取所有可拖动对象
   * 供 SceneManager 注册拖拽控制使用
   */

  public getDraggableObjects(): THREE.Mesh[] {
    return this.draggablePoints;
  }
  /**
   * 获取移动后的点位数据
   * 返回符合 ToothPoint 格式的数据，并包含原始位置和移动状态信息
   */
  public getUpdatedPoints(): Array<
    import('../types').ToothPoint & {
      originalPoint: [number, number, number];
      hasMoved: boolean;
    }
  > {
    return this.draggablePoints.map(point => {
      // 🔥 对于覆合分析的采样点，使用不同的数据结构
      if (point.userData.isSamplePoint) {
        const jawType = point.userData.jawType as string;
        const pointIndex = point.userData.pointIndex as number;
        const originalPos = point.userData.originalPosition || point.userData.initialSamplePosition;
        const currentSamplePos = point.position; // 当前采样点位置

        // 🔥 关键修改：获取计算后的原始点位置（移动后采样点对应的原始点位）
        const calculatedOriginalPos =
          point.userData.calculatedOriginalPosition || point.userData.originalPoint;

        // 🔥 重新构造原始输入数据中对应的点位信息
        // 需要从 userData 中获取原始的 ToothPoint 信息
        const originalToothPoint = point.userData.originalToothPoint;

        return {
          // 🔥 保持与原始输入数据完全一致的格式
          fdi: originalToothPoint?.fdi || (jawType === '上颌' ? 11 : 41), // 使用原始的 fdi 或默认值
          type: originalToothPoint?.type || 'incisal_edge', // 使用原始的 type 或默认值
          type_cn: originalToothPoint?.type_cn || '切端', // 使用原始的 type_cn 或默认值

          // 🔥 返回计算后的原始点位坐标，而不是采样点坐标
          point: [
            Number(calculatedOriginalPos.x.toFixed(4)),
            Number(calculatedOriginalPos.y.toFixed(4)),
            Number(calculatedOriginalPos.z.toFixed(4)),
          ] as [number, number, number],
        };
      }

      // 原有的逻辑（如果有其他类型的可拖拽点）
      const fdi = point.userData.fdi as number;
      const type = point.userData.pointType as string;
      const type_cn = point.userData.pointTypeCn as string;
      const originalPos = point.userData.originalPosition as THREE.Vector3;
      const currentPos = point.position;

      return {
        fdi: fdi || 0,
        type: type || 'unknown',
        type_cn: type_cn || '未知点位',
        point: [
          Number(currentPos.x.toFixed(4)),
          Number(currentPos.y.toFixed(4)),
          Number(currentPos.z.toFixed(4)),
        ] as [number, number, number],
      };
    });
  }
  /**
   * 根据采样点的移动计算对应的原始点位置
   */
  private calculateOriginalPositionFromSample(
    initialOriginalPoint: THREE.Vector3,
    initialSamplePosition: THREE.Vector3,
    currentSamplePosition: THREE.Vector3,
  ): THREE.Vector3 {
    // 方案1：直接使用采样点位置作为新的原始点位置
    return currentSamplePosition.clone();
  }
  // 添加拖动更新回调方法
  public updateOnDrag(object: THREE.Object3D): void {
    // 覆合分析可以在这里添加拖动时的实时更新逻辑
    // 例如更新参考线等
  }

  // 添加清理方法
  cleanup(): void {
    // 清理可拖动点位
    this.draggablePoints = [];

    // 调用基类清理方法
    super.cleanup();
  }
  /**
   * 创建中线切片
   * 切片应该垂直于牙弓，通过中线点位
   */
  private createMidlineSlice(
    center: THREE.Vector3,
    index: number,
    color: number,
    isUpper: boolean,
    curveT?: number, // 可选的t参数，用于计算切片方向
  ): THREE.Group {
    const jawType = isUpper ? 'upper' : 'lower';
    const group = new THREE.Group();
    group.name = `${this.taskName}_midline_slice_group_${jawType}_${index}`;

    // 设置group位置为点位中心
    group.position.copy(center);

    // 使用配置的切片尺寸
    const { width, height, opacity } = this.SLICE_CONFIG;

    // 创建平面几何
    const geometry = new THREE.PlaneGeometry(width, height);

    // 创建材质
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
    });

    const plane = new THREE.Mesh(geometry, material);

    // 切片位置相对于group中心
    // 默认在中心点，可以根据需要偏移
    plane.position.set(0, 0, 0);
    plane.renderOrder = -1;
    plane.name = `${this.taskName}_midline_slice_${jawType}_${index}`;

    // 设置切面朝向：垂直于牙弓线切线方向
    if (curveT !== undefined && this.archWire?.curve) {
      // 计算牙弓线在该点的切线方向
      const tangent = this.archWire.curve.getTangentAt(curveT);

      // 计算垂直于切线的方向（在XY平面内）
      const normal = new THREE.Vector3(-tangent.y, tangent.x, 0).normalize();

      // 让切片面向该法线方向
      plane.lookAt(center.clone().add(normal));

      // 然后绕局部X轴旋转90度让它竖立
      plane.rotateX(Math.PI / 2);
    } else {
      // 默认方向：竖直站立
      plane.rotation.x = Math.PI / 2; // 绕X轴旋转90度，让平面竖立
      plane.rotation.y = 0;
      plane.rotation.z = 0;
    }

    group.add(plane);

    // 创建边框（与平面相同的朝向）
    const borderPoints = [
      new THREE.Vector3(-width / 2, -height / 2, 0),
      new THREE.Vector3(width / 2, -height / 2, 0),
      new THREE.Vector3(width / 2, height / 2, 0),
      new THREE.Vector3(-width / 2, height / 2, 0),
      new THREE.Vector3(-width / 2, -height / 2, 0),
    ];

    const borderGeometry = new THREE.BufferGeometry().setFromPoints(borderPoints);
    const borderMaterial = new THREE.LineBasicMaterial({
      color,
      linewidth: 1, // 🔥 减小线宽，避免过粗
      transparent: true,
      opacity: this.SLICE_CONFIG.borderOpacity,
      depthWrite: false, // 🔥 禁用深度写入，避免遮挡问题
      depthTest: true, // 启用深度测试
    });

    const border = new THREE.Line(borderGeometry, borderMaterial);
    border.position.set(0, 0, 0);
    // 边框与平面保持完全相同的旋转
    border.setRotationFromQuaternion(plane.quaternion); // 使用与平面相同的四元数旋转
    border.name = `${this.taskName}_midline_slice_border_${jawType}_${index}`;

    group.add(border);

    return group;
  }

  /**
   * 为切片启用深度测试，使其能被模型遮挡
   */
  private enableDepthTestForSlice(sliceGroup: THREE.Group): void {
    sliceGroup.traverse(child => {
      // 重置渲染顺序，使用正常的渲染流程
      child.renderOrder = 0;

      if ('material' in child) {
        const material = (child as THREE.Mesh | THREE.Line).material;
        if (material) {
          if (Array.isArray(material)) {
            material.forEach(mat => {
              mat.depthTest = true; // 启用深度测试，可被模型遮挡
              mat.depthWrite = true; // 写入深度缓冲
            });
          } else {
            material.depthTest = true;
            material.depthWrite = true;
          }
        }
      }
    });
  }

  /**
   * 渲染特定元素
   * 覆盖度分析主要渲染：切端点之间的垂直参考线
   */
  protected renderSpecificElements(data: AnalysisData): void {
    const { teeth_points } = data;

    if (!teeth_points || teeth_points.length === 0) return;

    // 找到所有切端点和龈缘点
    const incisalPoints = teeth_points.filter(p => p.type === 'incisal_edge');
    const gingivaPoints = teeth_points.filter(p => p.type === 'gingiva_margin');

    // 为每对点添加垂直参考线（虚线）
    incisalPoints.forEach(ip => {
      const gp = gingivaPoints.find(g => g.fdi === ip.fdi);
      if (gp) {
        // 根据上下颌选择颜色：上颌 #FEB5B5，下颌 #A49ED9
        const isUpper = this.isUpper(ip.fdi);
        const lineColor = isUpper ? 0xfeb5b5 : 0xa49ed9;

        // 创建虚线连接（使用 unscaled 坐标）
        const startVec = new THREE.Vector3(ip.point[0], ip.point[1], ip.point[2]);
        const endVec = new THREE.Vector3(gp.point[0], gp.point[1], gp.point[2]);
        const line = this.createDashedLineUnscaled(startVec, endVec, lineColor, 1);
        line.name = `overjet_line_${ip.fdi}`;
        this.addToMesh(line, ip.fdi); // 添加到对应的 mesh，线条会随模型隐藏而隐藏
      }
    });
  }

  /**
   * 创建虚线（不应用缩放）
   */
  private createDashedLineUnscaled(
    start: THREE.Vector3,
    end: THREE.Vector3,
    color: number,
    lineWidth = 1,
  ): THREE.Line {
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    const material = new THREE.LineDashedMaterial({
      color,
      linewidth: lineWidth,
      dashSize: 0.5,
      gapSize: 0.3,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    const line = new THREE.Line(geometry, material);
    line.computeLineDistances(); // 虚线需要计算距离
    return line;
  }

  /**
   * 渲染测量标注
   */
  protected renderMeasurements(measurements: Record<string, unknown>): void {
    if (!measurements) return;

    // 解析测量数据
    const H_total = (measurements.H_total as number) || 0;
    const H_overlap = (measurements.H_overlap as number) || 0;
    const diagnosis = (measurements.diagnosis as string) || '正常';

    // 创建信息面板
    const labelData = [
      { key: 'H总', value: `${H_total.toFixed(2)}mm` },
      { key: '重叠', value: `${H_overlap.toFixed(2)}mm` },
      { key: '诊断', value: diagnosis },
    ];

    const infoPanel = LabelRenderer.createInfoPanel(labelData, {
      position: new THREE.Vector3(0, 30, 0),
      fontSize: 14,
      backgroundColor: '#285e50',
      fontColor: '#ffffff',
    });

    // this.group.add(infoPanel)

    // 如果有异常，添加警告标签
    if (diagnosis.includes('深覆') || diagnosis.includes('异常')) {
      const warningLabel = LabelRenderer.createLabel('⚠️ 注意', {
        position: new THREE.Vector3(0, 35, 0),
        fontSize: 12,
        backgroundColor: '#ff6b6b',
        fontColor: '#ffffff',
      });
      // this.group.add(warningLabel)
    }
  }

  /**
   * 格式化测量数据为面板展示格式
   */
  protected formatMeasurements(measurements: Record<string, unknown>): MeasurementGroup[] {
    const diagnosis = measurements.diagnosis as string;
    const pairDetails = (measurements.pair_details as Record<string, unknown>[]) || [];

    return [
      {
        groupName: '覆盖测量',
        groupResult: diagnosis,
        children: [
          {
            name: '11-41',
            value: `${pairDetails[0].overjet.toFixed(2)}mm`,
          },
          {
            name: '21-31',
            value: `${pairDetails[1].overjet.toFixed(2)}mm`,
          },
          {
            name: '平均覆盖值',
            value: `${measurements.avg_overjet.toFixed()}mm`,
          },
        ],
      },
    ];
  }
}
