import * as THREE from 'three';
import type { AnalysisData, MeasurementGroup, RenderType } from '../types';
import { LabelRenderer } from '../renderers';
import { BaseAnalysisStrategy } from './base/BaseAnalysisStrategy';

/**
 * 咬合关系分析策略
 * 分析尖牙关系和磨牙关系
 */
export class OcclusionAnalysisStrategy extends BaseAnalysisStrategy {
  readonly id = 'occlusion';
  readonly name = '咬合关系';
  readonly taskName = 'occlusal-relationship';
  readonly renderType: RenderType = 'POINT_SLICE';
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
   * 渲染特定元素
   * 咬合关系分析：显示尖牙和磨牙的咬合关系
   */
  protected renderSpecificElements(data: AnalysisData): void {
    console.log('🚀 咬合关系 - renderSpecificElements 被调用');
    const { teeth_points, measurements } = data;

    console.log('📊 咬合关系 - teeth_points数量:', teeth_points?.length);
    console.log('📊 咬合关系 - measurements:', measurements);

    if (!teeth_points || teeth_points.length === 0) {
      console.warn('⚠️ 咬合关系 - 没有牙齿点位数据');
      return;
    }

    if (!measurements) {
      console.warn('⚠️ 咬合关系 - 没有测量数据');
      return;
    }
    // 1. 创建牙弓线（使用 teeth_points 数据）
    this.createArchWire();

    // 从teeth_points中提取尖牙和磨牙的FDI
    const canineTeeth = this.extractTeethByType(teeth_points, [
      'midpoint_canine_premolar',
      'canine_cusp',
    ]);
    const molarTeeth = this.extractTeethByType(teeth_points, ['cusp_mb', 'mesial_buccal_groove']);

    console.log('🦷 提取的尖牙:', canineTeeth);
    console.log('🦷 提取的磨牙:', molarTeeth);
    this.createColoredPointMarkers(canineTeeth.points);
    this.createColoredPointMarkers(molarTeeth.points);
  }
  /**
   * 创建指定颜色的点位标记
   * 根据FDI编码自动确定颜色：上颌0xfeb5b5，下颌0xa49ed9
   */
  private createColoredPointMarkers(midlinePoints: AnalysisData['teeth_points']): void {
    if (!midlinePoints || midlinePoints.length === 0) return;

    // 为每个原始中线点找到对应的最近采样点
    midlinePoints.forEach((point, index) => {
      // 尝试标准化数据格式
      const normalizedPoint = this.normalizePointData(point, index + 1);

      if (!normalizedPoint) {
        console.warn(`⚠️ 点位${index + 1}: 数据格式无效`, point);
        return;
      }

      // 🔥 根据FDI编码判断上下颌
      const isUpper = this.isUpper(point.fdi);
      const jawType = isUpper ? '上颌' : '下颌';

      // 🔥 根据FDI编码确定颜色
      const samplePointColor = isUpper ? 0xfeb5b5 : 0xa49ed9; // 上颌粉色，下颌紫色
      const sliceColor = isUpper ? 0xfeb5b5 : 0xa49ed9; // 切片使用相同颜色

      // 根据 isUpper 直接获取目标 mesh
      const targetMesh = isUpper ? this.context.upperMeshLabel : this.context.lowerMeshLabel;

      if (!targetMesh) {
        console.warn(`⚠️ 目标 mesh 不存在: ${jawType}，FDI: ${point.fdi}`);
        return;
      }

      const pointCoords = normalizedPoint.point;
      const originalCenter = new THREE.Vector3(pointCoords[0], pointCoords[1], pointCoords[2]);

      // 🔥 找到距离这个原始点最近的采样点（在牙弓线上采样）
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

        // 🔥 在采样点位置创建切片（使用相同颜色）
        const sliceGroup = this.createMidlineSlice(
          samplePosition,
          index,
          sliceColor, // 使用与点位相同的颜色
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
   * 渲染测量标注
   */
  protected renderMeasurements(measurements: Record<string, unknown>): void {
    if (!measurements) return;

    const leftSide = measurements.left_side as Record<string, unknown>;
    const rightSide = measurements.right_side as Record<string, unknown>;

    // 左侧关系信息面板
    if (leftSide) {
      const canineRel = (leftSide.canine_relationship as string) || '未知';
      const molarRel = (leftSide.molar_relationship as string) || '未知';

      const leftPanel = LabelRenderer.createInfoPanel(
        [
          { key: '左侧咬合关系', value: '' },
          { key: '尖牙', value: canineRel },
          { key: '磨牙', value: molarRel },
        ],
        {
          position: new THREE.Vector3(-25, 30, 0),
          fontSize: 13,
          backgroundColor: this.getClassificationColor(canineRel),
          fontColor: '#ffffff',
        },
      );
      // this.group.add(leftPanel)
    }

    // 右侧关系信息面板
    if (rightSide) {
      const canineRel = (rightSide.canine_relationship as string) || '未知';
      const molarRel = (rightSide.molar_relationship as string) || '未知';

      const rightPanel = LabelRenderer.createInfoPanel(
        [
          { key: '右侧咬合关系', value: '' },
          { key: '尖牙', value: canineRel },
          { key: '磨牙', value: molarRel },
        ],
        {
          position: new THREE.Vector3(25, 30, 0),
          fontSize: 13,
          backgroundColor: this.getClassificationColor(canineRel),
          fontColor: '#ffffff',
        },
      );
      // this.group.add(rightPanel)
    }
  }
  /**
   * 重写shouldRenderPoints方法，禁用BaseAnalysisStrategy的默认点位渲染
   * 我们使用自己的createColoredPointMarkers方法来渲染
   */
  protected shouldRenderPoints(): boolean {
    return false; // 禁用父类的自动点位渲染
  }
  /**
   * 格式化测量数据为面板展示格式
   */
  protected formatMeasurements(measurements: Record<string, unknown>): MeasurementGroup[] {
    const leftSide = measurements.left_side as Record<string, unknown>;
    const rightSide = measurements.right_side as Record<string, unknown>;

    const groups: MeasurementGroup[] = [];

    // 左侧咬合关系
    if (leftSide) {
      const canineRel = (leftSide.canine_relationship as string) || '未知';
      const molarRel = (leftSide.molar_relationship as string) || '未知';

      groups.push({
        groupName: '左侧咬合关系',
        children: [
          {
            name: '尖牙关系',
            value: canineRel,
            result: this.evaluateClassification(canineRel),
          },
          {
            name: '磨牙关系',
            value: molarRel,
            result: this.evaluateClassification(molarRel),
          },
        ],
      });
    }

    // 右侧咬合关系
    if (rightSide) {
      const canineRel = (rightSide.canine_relationship as string) || '未知';
      const molarRel = (rightSide.molar_relationship as string) || '未知';

      groups.push({
        groupName: '右侧咬合关系',
        children: [
          {
            name: '尖牙关系',
            value: canineRel,
            result: this.evaluateClassification(canineRel),
          },
          {
            name: '磨牙关系',
            value: molarRel,
            result: this.evaluateClassification(molarRel),
          },
        ],
      });
    }

    return groups;
  }

  // ==================== 私有辅助方法 ====================

  /**
   * 从teeth_points中提取特定类型的牙齿
   * @param teethPoints 所有牙齿点位
   * @param types 点位类型（字符串或字符串数组）
   * @returns 左右侧的牙齿FDI号码
   */
  private extractTeethByType(
    teethPoints: AnalysisData['teeth_points'],
    types: string | string[],
  ): { left: number[]; right: number[] } {
    const typeArray = Array.isArray(types) ? types : [types];
    const fdis = new Set<number>();
    const points: string[] = [];
    console.log(typeArray, 'typeArray111111');
    // 提取所有符合类型的牙齿FDI
    teethPoints.forEach(point => {
      if (typeArray.includes(point.type)) {
        fdis.add(point.fdi);
        points.push(point);
      }
    });

    // 按左右侧分组
    const left: number[] = [];
    const right: number[] = [];

    fdis.forEach(fdi => {
      // FDI编码规则：13, 23 (上尖牙), 33, 43 (下尖牙)
      // 第二位数字：1-3为右侧，4-6为左侧（从医生角度看）
      // 实际上：x3为右侧尖牙，x3为左侧尖牙
      const secondDigit = fdi % 10;
      if (secondDigit >= 4 && secondDigit <= 8) {
        // 左侧（医生视角）：x4-x8
        left.push(fdi);
      } else {
        // 右侧（医生视角）：x1-x3
        right.push(fdi);
      }
    });

    return { left, right, points };
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

      // 🔥 根据点位在牙弓上的位置来确定切片方向
      // 判断是否在左侧（基于X坐标）
      const isLeftSide = center.x < 0;

      // 🔥 使用更稳定的法线计算方法
      let normal: THREE.Vector3;
      if (isLeftSide) {
        // 左侧：确保切片向内倾斜
        normal = new THREE.Vector3(-tangent.y, tangent.x, 0).normalize();
      } else {
        // 右侧：确保切片向内倾斜
        normal = new THREE.Vector3(tangent.y, -tangent.x, 0).normalize();
      }

      // 🔥 添加额外的角度调整，避免过度倾斜
      const maxTiltAngle = Math.PI / 6; // 最大倾斜30度
      const currentAngle = Math.atan2(normal.y, normal.x);
      const clampedAngle = Math.max(-maxTiltAngle, Math.min(maxTiltAngle, currentAngle));

      normal.set(Math.cos(clampedAngle), Math.sin(clampedAngle), 0);

      plane.lookAt(center.clone().add(normal));
      plane.rotateX(Math.PI / 2);
    } else {
      // 默认方向：竖直站立
      plane.rotation.x = Math.PI / 2;
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
      opacity: 1,
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
   * 创建咬合切面
   * 为每个咬合点创建一个垂直切面（使用 unscaled 坐标）
   */
  private createOcclusionSlice(center: THREE.Vector3, fdi: number, color: number): THREE.Group {
    const group = new THREE.Group();
    group.name = `occlusion_slice_group_${fdi}`;
    group.position.copy(center); // group 放在 center 位置

    // 判断是左侧还是右侧（根据FDI编码规则）
    const isLeft = (fdi >= 20 && fdi <= 29) || (fdi >= 30 && fdi <= 39);

    // 切面尺寸 - 增大尺寸以便更容易看到
    const width = 15;
    const height = 20;

    // 创建平面几何
    const geometry = new THREE.PlaneGeometry(width, height);

    // 创建材质 - 提高不透明度，让切面更明显
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.4, // 从0.25提高到0.4
      side: THREE.DoubleSide,
    });

    const plane = new THREE.Mesh(geometry, material);
    plane.position.set(0, 0, 0); // 相对于 group 的原点
    plane.renderOrder = -1;
    plane.name = `occlusion_slice_${fdi}`;

    // 设置切面朝向（垂直方向）
    // 绕 X 轴旋转 90 度使其竖立
    plane.rotation.x = Math.PI / 2;

    // 根据左右侧微调旋转角度
    if (isLeft) {
      plane.rotation.y = Math.PI / 6; // 向左倾斜 30 度
    } else {
      plane.rotation.y = -Math.PI / 6; // 向右倾斜 30 度
    }

    group.add(plane);

    // 创建边框
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
      linewidth: 2,
      transparent: true,
      opacity: 0.8, // 从0.6提高到0.8，让边框更明显
      depthWrite: true,
    });

    const border = new THREE.Line(borderGeometry, borderMaterial);
    border.position.set(0, 0, 0); // 相对于 group 的原点
    border.rotation.x = Math.PI / 2;
    border.name = `occlusion_slice_border_${fdi}`;

    // 根据左右侧微调旋转角度
    if (isLeft) {
      border.rotation.y = Math.PI / 6;
    } else {
      border.rotation.y = -Math.PI / 6;
    }

    group.add(border);

    return group;
  }

  /**
   * 创建虚线（不应用缩放）
   */
  private createDashedLineUnscaled(
    start: THREE.Vector3,
    end: THREE.Vector3,
    color: number,
    lineWidth = 2,
  ): THREE.Line {
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    const material = new THREE.LineDashedMaterial({
      color,
      linewidth: lineWidth,
      dashSize: 1.0, // 增加虚线段长度
      gapSize: 0.5, // 增加间隔
      transparent: true,
      opacity: 0.8,
    });
    const line = new THREE.Line(geometry, material);
    line.computeLineDistances(); // 虚线需要计算距离
    line.renderOrder = -1; // 确保在最前面渲染
    return line;
  }

  /**
   * 根据咬合关系获取颜色（数值）
   */
  private getRelationshipColor(relationship: string): number {
    // 中性关系（正常）
    if (
      relationship.includes('中性') ||
      relationship.includes('I类') ||
      relationship.includes('正常')
    ) {
      return 0x22c55e; // 绿色
    }
    // 远中关系（II类）
    if (relationship.includes('远中') || relationship.includes('II类')) {
      return 0xff9800; // 橙色
    }
    // 近中关系（III类）
    if (relationship.includes('近中') || relationship.includes('III类')) {
      return 0xff6b6b; // 红色
    }
    return 0x9e9e9e; // 灰色（未知）
  }

  /**
   * 根据分类获取颜色（字符串）- 用于信息面板
   */
  private getClassificationColor(classification: string): string {
    if (
      classification.includes('I类') ||
      classification.includes('正常') ||
      classification.includes('中性')
    ) {
      return '#22c55e';
    }
    if (classification.includes('II类') || classification.includes('远中')) return '#ff9800';
    if (classification.includes('III类') || classification.includes('近中')) return '#ff6b6b';
    return '#9e9e9e';
  }

  /**
   * 评估分类
   */
  private evaluateClassification(classification: string): string {
    if (
      classification.includes('I类') ||
      classification.includes('正常') ||
      classification.includes('中性')
    ) {
      return '正常';
    }
    return '需要关注';
  }
}
