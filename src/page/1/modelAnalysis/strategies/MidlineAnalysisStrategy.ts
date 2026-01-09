import * as THREE from 'three';
import type { AnalysisData, MeasurementGroup, RenderType, ToothPoint } from '../types';
import { LabelRenderer } from '../renderers';
import { BaseAnalysisStrategy } from './base/BaseAnalysisStrategy';

/**
 * 中线偏差分析策略
 * 分析上下颌中线与面部中线的偏差
 * 包含牙弓线、可拖拽控制点和垂直面
 *
 * 重要修复：统一使用getPointAt()进行投影计算
 * - 牙弓线使用TubeGeometry绘制，内部使用getPointAt()（弧长参数化）
 * - 所有投影方法现在都使用getPointAt()保持一致性
 * - 确保投影点在可见的牙弓线上，而不是数学意义上的曲线上
 */
export class MidlineAnalysisStrategy extends BaseAnalysisStrategy {
  readonly id = 'midline';
  readonly name = '中线关系';
  readonly taskName = 'midline-deviation';
  readonly renderType: RenderType = 'POINT_SLICE';

  // 切片配置（可根据需要调整）
  private readonly SLICE_CONFIG = {
    width: 30, // 切片宽度（竖立后是前后方向的深度）
    height: 30, // 切片高度（竖立后是垂直高度）
    opacity: 0.3, // 透明度
    borderOpacity: 0.9, // 边框透明度
  };

  // 牙弓线相关
  private controlPoint1: THREE.Mesh | null = null;
  private controlPoint2: THREE.Mesh | null = null;
  private plane1: THREE.Mesh | null = null;
  private plane2: THREE.Mesh | null = null;

  /**
   * 渲染流程（重写父类方法以添加拖拽控制）
   */
  render(data: AnalysisData): void {
    // 调用父类的渲染方法
    super.render(data);

    // 渲染完成后，注册可拖拽对象到场景管理器
    this.registerDraggableObjects();
  }

  /**
   * 注册可拖拽对象
   * 将控制点注册到场景管理器的拖拽控制系统
   */
  private registerDraggableObjects(): void {
    // 这个方法需要场景管理器的支持
    // 在实际使用时，可以通过context或全局访问
    // 暂时通过userData标记为可拖拽
    // 实际的拖拽注册会在外部完成
  }

  /**
   * 获取可拖拽对象列表
   * 供外部注册拖拽控制使用
   */
  public getDraggableObjects(): THREE.Object3D[] {
    const objects: THREE.Object3D[] = [];

    // 添加控制点（如果存在）
    if (this.controlPoint1) {
      objects.push(this.controlPoint1);
    }

    if (this.controlPoint2) {
      objects.push(this.controlPoint2);
    }

    // 添加所有可拖拽的投影点和采样点
    this.group.traverse(child => {
      if (child.userData?.isDraggable && child.userData?.constrainToCurve) {
        objects.push(child);
      }
    });

    // 也检查mesh标签中的可拖拽对象（包括投影点和采样点）
    if (this.context?.upperMeshLabel) {
      this.context.upperMeshLabel.traverse(child => {
        if (child.userData?.isDraggable && child.userData?.constrainToCurve) {
          objects.push(child);
        }
      });
    }

    if (this.context?.lowerMeshLabel) {
      this.context.lowerMeshLabel.traverse(child => {
        if (child.userData?.isDraggable && child.userData?.constrainToCurve) {
          objects.push(child);
        }
      });
    }

    // 统计不同类型的可拖拽对象
    const stats = {
      controlPoints: 0,
      nearestSamplePoints: 0,
      others: 0,
    };

    objects.forEach(obj => {
      if (obj.userData?.isSamplePoint) {
        stats.nearestSamplePoints++;
      } else if (obj.userData?.isControlPoint) {
        stats.controlPoints++;
      } else {
        stats.others++;
      }
    });
    return objects;
  }

  /**
   * 渲染特定元素
   * 中线分析：显示面部中线、上下颌中线和偏差
   * 包含牙弓线、原始中线点、投影点和连接线
   */
  protected renderSpecificElements(data: AnalysisData): void {
    // 检查 context 是否已初始化
    if (!this.context) {
      console.warn('⚠️ 渲染上下文未初始化');
      return;
    }

    // 0. 清理之前的切片（确保不重复）
    this.clearExistingSlices();

    // 1. 创建牙弓线（使用 teeth_points 数据）
    this.createArchWire();

    if (!this.archWire) {
      console.warn('⚠️ 牙弓线创建失败，无法进行投影计算');
      return;
    }

    // 2. 提取并渲染中线点位
    const upperPoints = this.extractMidlinePoints(data, true);
    const lowerPoints = this.extractMidlinePoints(data, false);

    // 3. 渲染上颌中线点位和最近采样点
    if (upperPoints && upperPoints.length > 0) {
      this.renderMidlinePointsAndSlices(upperPoints, true);
    } else {
      console.warn('⚠️ 未找到上颌中线点位数据');
    }

    // 4. 渲染下颌中线点位和最近采样点
    if (lowerPoints && lowerPoints.length > 0) {
      this.renderMidlinePointsAndSlices(lowerPoints, false);
    } else {
      console.warn('⚠️ 未找到下颌中线点位数据');
    }

    // 5. 渲染偏差指示（可选）
    // this.renderDeviationIndicators(measurements);
  }

  /**
   * 根据中线点，计算真正用于切片的牙弓线点（保留原方法作为备用）
   */
  private projectPointToArchLine(
    point: THREE.Vector3,
    archPoints: THREE.Vector3[],
  ): {
    projectedPoint: THREE.Vector3;
    segmentIndex: number;
    distance: number;
  } {
    let minDistance = Infinity;
    let closestPoint = new THREE.Vector3();
    let closestSegmentIndex = -1;

    for (let i = 0; i < archPoints.length - 1; i++) {
      const A = archPoints[i];
      const B = archPoints[i + 1];

      const candidate = this.closestPointOnSegment(point, A, B);
      const dist = candidate.distanceTo(point);

      if (dist < minDistance) {
        minDistance = dist;
        closestPoint = candidate;
        closestSegmentIndex = i;
      }
    }

    return {
      projectedPoint: closestPoint,
      segmentIndex: closestSegmentIndex,
      distance: minDistance,
    };
  }
  private closestPointOnSegment(
    P: THREE.Vector3,
    A: THREE.Vector3,
    B: THREE.Vector3,
  ): THREE.Vector3 {
    const AB = new THREE.Vector3().subVectors(B, A);
    const AP = new THREE.Vector3().subVectors(P, A);

    const abLenSq = AB.lengthSq();
    if (abLenSq === 0) return A.clone();

    const t = AP.dot(AB) / abLenSq;
    const clampedT = Math.max(0, Math.min(1, t));

    return new THREE.Vector3().addVectors(A, AB.multiplyScalar(clampedT));
  }

  /**
   * 渲染测量标注
   */
  protected renderMeasurements(measurements: Record<string, unknown>): void {
    if (!measurements) return;

    const upperDeviation = (measurements.upper_deviation_mm as number) || 0;
    const lowerDeviation = (measurements.lower_deviation_mm as number) || 0;
    const diagnosis = (measurements.diagnosis as string) || '正常';

    // 创建统计信息面板
    const infoData = [
      {
        key: '上颌中线偏差',
        value: `${Math.abs(upperDeviation).toFixed(2)}mm ${this.getDirectionLabel(upperDeviation)}`,
      },
      {
        key: '下颌中线偏差',
        value: `${Math.abs(lowerDeviation).toFixed(2)}mm ${this.getDirectionLabel(lowerDeviation)}`,
      },
      { key: '诊断结果', value: diagnosis },
    ];

    const infoPanel = LabelRenderer.createInfoPanel(infoData, {
      position: new THREE.Vector3(0, 35, 0),
      fontSize: 14,
      backgroundColor: this.getDeviationColorString(
        Math.max(Math.abs(upperDeviation), Math.abs(lowerDeviation)),
      ),
      fontColor: '#ffffff',
    });

    // this.group.add(infoPanel)
  }
  private getCategory(category: string): string {
    return category === 'right' ? '右偏' : category === 'left' ? '左偏' : '中性';
  }

  /**
   * 格式化测量数据为面板展示格式
   */
  protected formatMeasurements(measurements: Record<string, unknown>): MeasurementGroup[] {
    const upperMidline = measurements.upper_midline as { category: string };
    const lowerMidline = measurements.lower_midline as { category: string };
    const upperToLowerDiff = measurements.upper_to_lower_difference_mm as number;
    const threshold = measurements.threshold_mm as number;

    return [
      {
        groupName: '上中线偏差分析',
        children: [
          {
            name: '分类',
            value: this.getCategory(upperMidline?.category || ''),
            result: '',
          },
        ],
      },
      {
        groupName: '下中线偏差分析',
        children: [
          {
            name: '分类',
            value: this.getCategory(lowerMidline?.category || ''),
            result: '',
          },
        ],
      },
      {
        groupName: '上下中线偏差差值',
        children: [
          {
            name: '差值',
            value: `${upperToLowerDiff?.toFixed(2) || '0.00'}mm`,
            result: '',
          },
          {
            name: '阈值',
            value: `${threshold?.toFixed(2) || '0.00'}mm`,
            result: '',
          },
        ],
      },
    ];
  }

  /**
   * 处理对象拖拽事件
   * @param object 被拖拽的对象
   * @param newPosition 新位置
   */
  public onObjectDrag(object: THREE.Object3D, newPosition: THREE.Vector3): void {
    if (object.userData?.constrainToCurve && object.userData?.onDrag) {
      // 调用对象特定的拖拽处理函数
      object.userData.onDrag(newPosition);
    } else {
      console.warn(`⚠️ 对象不支持曲线约束或缺少拖拽处理函数`);
    }
  }

  /**
   * 更新垂直面的位置和方向
   * 当控制点被拖拽时调用
   * 平面只做平移，不旋转（始终保持垂直方向）
   * @param controlPointId 控制点ID
   * @param newPosition 拖拽后的新位置（可选，如果不提供则使用控制点当前位置）
   */
  public updatePlane(controlPointId: number, newPosition?: THREE.Vector3): void {
    if (!this.archWire) return;

    const controlPoint = controlPointId === 1 ? this.controlPoint1 : this.controlPoint2;
    const plane = controlPointId === 1 ? this.plane1 : this.plane2;

    if (!controlPoint || !plane) return;

    // 如果提供了新位置，先约束到曲线上
    if (newPosition) {
      const constrainedData = this.constrainPointToCurveOld(newPosition);
      controlPoint.position.copy(constrainedData.position);
      controlPoint.userData.t = constrainedData.t;
    }

    // 只更新平面位置（不更新旋转，保持垂直方向）
    plane.position.copy(controlPoint.position);
  }

  /**
   * 将点约束到曲线上（原方法，用于控制点）
   * 找到曲线上距离给定点最近的点
   * 使用getPointAt保持与牙弓线绘制的一致性
   * @param point 要约束的点
   * @returns 曲线上最近的点和对应的 t 值
   */
  private constrainPointToCurveOld(point: THREE.Vector3): { position: THREE.Vector3; t: number } {
    if (!this.archWire) {
      return { position: point.clone(), t: 0.5 };
    }

    const curve = this.archWire.curve;
    let minDistance = Infinity;
    let closestT = 0.5;
    let closestPoint = point.clone();

    // 在曲线上采样，找到最近的点
    // 使用getPointAt保持与TubeGeometry一致的参数化
    const samples = 100;
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const curvePoint = curve.getPointAt(t); // 使用getPointAt保持一致性
      const distance = point.distanceTo(curvePoint);

      if (distance < minDistance) {
        minDistance = distance;
        closestT = t;
        closestPoint = curvePoint;
      }
    }

    // 在找到的最近点附近进行更精细的搜索
    const refineRange = 1 / samples;
    const refineSteps = 20;
    for (let i = 0; i <= refineSteps; i++) {
      const t = Math.max(
        0,
        Math.min(1, closestT - refineRange + (i / refineSteps) * refineRange * 2),
      );
      const curvePoint = curve.getPointAt(t); // 使用getPointAt保持一致性
      const distance = point.distanceTo(curvePoint);

      if (distance < minDistance) {
        minDistance = distance;
        closestT = t;
        closestPoint = curvePoint;
      }
    }

    return { position: closestPoint, t: closestT };
  }

  /**
   * 根据偏差大小获取颜色（字符串）
   */
  private getDeviationColorString(deviation: number): string {
    const absDev = Math.abs(deviation);
    if (absDev <= 1.0) return '#22c55e'; // 绿色
    if (absDev <= 2.0) return '#ff9800'; // 橙色
    return '#ff0000'; // 红色
  }

  /**
   * 获取方向标签
   */
  private getDirectionLabel(deviation: number): string {
    if (Math.abs(deviation) < 0.5) return '(居中)';
    return deviation > 0 ? '(右偏)' : '(左偏)';
  }

  /**
   * 提取中线点位数据
   * upper_midline_point/lower_midline_point 可能是坐标数组 [x, y, z]
   */
  private extractMidlinePoints(data: AnalysisData, isUpper: boolean): ToothPoint[] | null {
    const fieldName = isUpper ? 'upper_midline_point' : 'lower_midline_point';
    const jawType = isUpper ? '上颌' : '下颌';

    const fieldValue = data[fieldName];
    if (Array.isArray(fieldValue) && fieldValue.length >= 2) {
      // 检查是否所有元素都是数字（说明是坐标数组）
      const allNumbers = fieldValue.every(v => typeof v === 'number');

      if (allNumbers) {
        // 确保是3D坐标，如果只有2个数字，补充z=0
        const coords: [number, number, number] =
          fieldValue.length === 2
            ? [fieldValue[0], fieldValue[1], 0]
            : [fieldValue[0], fieldValue[1], fieldValue[2] || 0];

        // 构造一个 ToothPoint 对象
        const point: ToothPoint = {
          fdi: isUpper ? 11 : 41, // 使用默认的中切牙编号
          type: 'midline_point',
          type_cn: '中线点',
          point: coords,
        };

        return [point];
      }
    }

    // 情况2: 是包含多个点位对象的数组
    if (Array.isArray(fieldValue) && fieldValue.length > 0) {
      const firstItem = fieldValue[0];
      if (firstItem && typeof firstItem === 'object' && 'point' in firstItem) {
        return fieldValue as ToothPoint[];
      }
    }

    // 情况3: 是单个点位对象
    if (fieldValue && typeof fieldValue === 'object' && !Array.isArray(fieldValue)) {
      return [fieldValue] as ToothPoint[];
    }

    // 情况4: 尝试从 measurements 中获取
    if (data.measurements) {
      const midlineKey = isUpper ? 'upper_midline' : 'lower_midline';
      const midlineData = data.measurements[midlineKey] as any;

      if (midlineData?.point && Array.isArray(midlineData.point)) {
        const coords = midlineData.point as [number, number, number];
        const point: ToothPoint = {
          fdi: isUpper ? 11 : 41,
          type: 'midline_point',
          type_cn: '中线点',
          point: coords,
        };
        return [point];
      }
    }

    return null;
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
   * 渲染中线点位并找到牙弓线上距离最近的采样点
   * 为每个原始中线点找到对应的最近采样点，采样点本身就在曲线上
   */
  private renderMidlinePointsAndSlices(
    midlinePoints: AnalysisData['teeth_points'],
    isUpper: boolean,
  ): void {
    if (!midlinePoints || midlinePoints.length === 0) return;

    const jawType = isUpper ? '上颌' : '下颌';

    // 确定颜色
    const originalColor = isUpper ? 0xfd7676 : 0x4169e1; // 原始点颜色：上颌红色，下颌蓝色
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
        );
        // 添加到策略组
        this.group.add(nearestSphere);

        // 🔥 在采样点位置创建切片（也添加到策略组保持坐标系一致）
        const sliceColor = isUpper ? 0xfd7676 : 0x4169e1; // 上颌红色，下颌蓝色
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

    console.log(`🔄 采样点已约束到牙弓线: t=${closestT.toFixed(3)}`, {
      采样点位置: closestPoint.toArray().map(v => v.toFixed(2)),
      计算的原始点位置: newOriginalPosition.toArray().map(v => v.toFixed(2)),
    });
  }
  /**
   * 根据采样点的移动计算对应的原始点位置
   */

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
  /**
   * 根据采样点的移动更新原始点位的计算数据（不改变视觉位置）
   */
  private updateOriginalPointPosition(
    sampleSphere: THREE.Mesh,
    newSamplePosition: THREE.Vector3,
    curveT: number,
  ): void {
    const jawType = sampleSphere.userData.jawType;
    const pointIndex = sampleSphere.userData.pointIndex;
    const originalPointName = `${this.taskName}_original_midline_point_${jawType}_${pointIndex}`;

    // 计算新的原始点位置（可以根据业务逻辑调整）
    const newOriginalPosition = newSamplePosition.clone();

    // 查找原始点位球体，只更新数据，不更新视觉位置
    const meshes = [this.context?.upperMeshLabel, this.context?.lowerMeshLabel].filter(Boolean);

    for (const mesh of meshes) {
      mesh?.traverse(child => {
        if (child.name === originalPointName && child instanceof THREE.Mesh) {
          // 🔥 关键修改：不更新视觉位置，只更新数据
          // child.position.copy(newOriginalPosition); // ❌ 删除这行，避免视觉移动

          // ✅ 只更新userData中的计算数据
          if (!child.userData) child.userData = {};
          child.userData.hasMoved = true;
          child.userData.originalPosition =
            child.userData.originalPosition || child.position.clone(); // 保存初始位置
          child.userData.calculatedPosition = newOriginalPosition.clone(); // 计算后的位置
          child.userData.linkedSamplePosition = newSamplePosition.clone();
          child.userData.curveT = curveT;
          child.userData.lastUpdateTime = Date.now();
        }
      });
    }
  }
  /**
   * 获取移动后的中线点位数据
   * 从采样点位获取计算后的原始点位数据
   */
  public getUpdatedPoints(): {
    upper_midline_point?: [number, number, number];
    lower_midline_point?: [number, number, number];
  } {
    const result: {
      upper_midline_point?: [number, number, number];
      lower_midline_point?: [number, number, number];
    } = {};

    // 🔥 从策略组中的采样点获取数据，而不是从原始点位球体
    this.group.traverse(child => {
      if (child.name.includes('sample_point') && child instanceof THREE.Mesh) {
        const userData = child.userData;
        if (userData && userData.isSamplePoint) {
          const jawType = userData.jawType; // '上颌' 或 '下颌'
          const fieldName = jawType === '上颌' ? 'upper_midline_point' : 'lower_midline_point';

          // 获取计算后的原始点位置
          const calculatedPosition = userData.calculatedOriginalPosition || userData.originalPoint;

          result[fieldName] = [
            Number(calculatedPosition.x.toFixed(4)),
            Number(calculatedPosition.y.toFixed(4)),
            Number(calculatedPosition.z.toFixed(4)),
          ];

          console.log(`📍 ${jawType}中线点最终位置 (从采样点获取):`, {
            字段名: fieldName,
            采样点位置: child.position.toArray().map(v => v.toFixed(3)),
            计算的原始点位置: result[fieldName],
            点位索引: userData.pointIndex,
          });
        }
      }
    });

    console.log('📊 中线分析最终保存数据 (基于采样点):', result);
    return result;
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
   * 创建中线点球体标记
   */
  private createMidlinePointSphere(
    position: THREE.Vector3,
    color: number,
    name: string,
    radius = 0.8,
  ): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(radius, 32, 32);
    const material = new THREE.MeshPhongMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.3,
      transparent: true,
      opacity: 0.8,
    });
    const sphere = new THREE.Mesh(geometry, material);
    sphere.position.copy(position);
    sphere.name = name;
    return sphere;
  }

  /**
   * 更新投影连接线
   */
  private updateProjectionLines(projectedSphere: THREE.Mesh): void {
    const sphereName = projectedSphere.name;
    const lineName = sphereName.replace('projected_midline_point', 'projection_line');

    // 在整个场景中查找连接线（扩大搜索范围）
    let connectionLineFound = false;

    // 先在相同父对象中查找
    const parent = projectedSphere.parent;
    if (parent) {
      parent.traverse(child => {
        if (child.name === lineName && child instanceof THREE.Line) {
          this.doUpdateConnectionLine(child, projectedSphere, lineName);
          connectionLineFound = true;
        }
      });
    }

    // 如果在父对象中没找到，在整个场景中查找
    if (!connectionLineFound && this.context?.scene) {
      this.context.scene.traverse(child => {
        if (child.name === lineName && child instanceof THREE.Line) {
          this.doUpdateConnectionLine(child, projectedSphere, lineName);
          connectionLineFound = true;
        }
      });
    }

    if (!connectionLineFound) {
      console.warn(`⚠️ 未找到连接线: ${lineName}`);
      // 列出所有可能的连接线名称
      if (parent) {
        const allLines: string[] = [];
        parent.traverse(child => {
          if (child instanceof THREE.Line) {
            allLines.push(child.name);
          }
        });
      }
    }
  }

  /**
   * 执行连接线更新
   */
  private doUpdateConnectionLine(
    connectionLine: THREE.Line,
    projectedSphere: THREE.Mesh,
    lineName: string,
  ): void {
    if (!connectionLine.geometry || !connectionLine.geometry.attributes.position) {
      console.warn(`⚠️ 连接线几何体或位置属性不存在`);
      return;
    }

    const positions = connectionLine.geometry.attributes.position;

    // 获取原始点位置
    const startPoint = new THREE.Vector3();
    if (connectionLine.userData?.originalPointRef) {
      startPoint.copy(connectionLine.userData.originalPointRef.position);
    } else {
      // 如果没有保存的引用，使用当前的第一个点
      startPoint.fromBufferAttribute(positions, 0);
    }

    // 更新终点位置为投影球体的当前位置
    const endPoint = projectedSphere.position;

    // 更新几何体的顶点位置
    positions.setXYZ(0, startPoint.x, startPoint.y, startPoint.z);
    positions.setXYZ(1, endPoint.x, endPoint.y, endPoint.z);
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
   * 创建投影连接线
   */
  private createProjectionLine(
    startPoint: THREE.Vector3,
    endPoint: THREE.Vector3,
    name: string,
    color = 0xffffff,
    linewidth = 2,
    opacity = 0.6,
  ): THREE.Line {
    const points = [startPoint, endPoint];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: color,
      transparent: true,
      opacity: opacity,
      depthTest: false,
      depthWrite: false,
    });
    const line = new THREE.Line(geometry, material);
    line.name = name;
    line.renderOrder = 1000;
    return line;
  }

  /**
   * 清理现有的切片，避免重复显示
   */
  private clearExistingSlices(): void {
    const slicesToRemove: THREE.Object3D[] = [];

    // 遍历策略组，找到所有切片相关对象
    this.group.traverse(child => {
      if (child.name.includes('midline_slice')) {
        slicesToRemove.push(child);
      }
    });

    // 移除找到的切片
    slicesToRemove.forEach(slice => {
      this.group.remove(slice);

      // 释放资源
      if (slice instanceof THREE.Mesh) {
        slice.geometry?.dispose();
        if (Array.isArray(slice.material)) {
          slice.material.forEach(m => m.dispose());
        } else if (slice.material) {
          slice.material.dispose();
        }
      }
    });
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
}
