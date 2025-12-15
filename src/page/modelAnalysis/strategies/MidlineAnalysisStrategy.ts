import * as THREE from 'three';
import type { AnalysisData, MeasurementGroup, RenderType, ToothPoint } from '../types';
import { LabelRenderer } from '../renderers';
import { BaseAnalysisStrategy } from './base/BaseAnalysisStrategy';

/**
 * 中线偏差分析策略
 * 分析上下颌中线与面部中线的偏差
 * 包含牙弓线、可拖拽控制点和垂直面
 */
export class MidlineAnalysisStrategy extends BaseAnalysisStrategy {
  readonly id = 'midline';
  readonly name = '中线关系';
  readonly taskName = 'midline-deviation';
  readonly renderType: RenderType = 'POINT_SLICE';

  // 切片配置（可根据需要调整）
  private readonly SLICE_CONFIG = {
    width: 15, // 切片宽度（竖立后是前后方向的深度）
    height: 20, // 切片高度（竖立后是垂直高度）
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

    if (this.controlPoint1) {
      objects.push(this.controlPoint1);
    }

    if (this.controlPoint2) {
      objects.push(this.controlPoint2);
    }

    return objects;
  }

  /**
   * 渲染特定元素
   * 中线分析：显示面部中线、上下颌中线和偏差
   * 包含牙弓线、可拖拽控制点和垂直面
   */
  protected renderSpecificElements(data: AnalysisData): void {
    // 检查 context 是否已初始化
    if (!this.context) {
      return;
    }

    // if (!teeth_points || teeth_points.length === 0) return;

    // 1. 创建牙弓线（使用 teeth_points 数据）
    // this.createArchWire();

    // 2. 创建两个可拖拽控制点（使用11号和21号牙的实际点位）
    // this.createDraggableControlPoints(teeth_points);

    // 3. 创建垂直于牙弓线的两个面
    // this.createVerticalPlanes();

    // 4. 提取并渲染中线点位
    const upperPoints = this.extractMidlinePoints(data, true);
    const lowerPoints = this.extractMidlinePoints(data, false);

    // 5. 渲染上颌中线点位和切片
    if (upperPoints && upperPoints.length > 0) {
      this.renderMidlinePointsAndSlices(upperPoints, true);
    }

    // 6. 渲染下颌中线点位和切片
    if (lowerPoints && lowerPoints.length > 0) {
      this.renderMidlinePointsAndSlices(lowerPoints, false);
    }

    // 7. 渲染偏差指示（可选）
    // this.renderDeviationIndicators(measurements);
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
   * 创建两个可拖拽控制点
   * 使用11号和21号牙齿的实际点位
   */
  private createDraggableControlPoints(teethPoints: AnalysisData['teeth_points']): void {
    if (!this.archWire || !teethPoints) return;

    const { curve, group } = this.archWire;

    // 获取11号牙（右上中切牙）的点位
    const tooth11Points = teethPoints.filter(p => p.fdi === 11);
    // 获取21号牙（左上中切牙）的点位
    const tooth21Points = teethPoints.filter(p => p.fdi === 21);

    let pos1: THREE.Vector3;
    let t1: number;
    let pos2: THREE.Vector3;
    let t2: number;

    if (tooth11Points.length > 0 && tooth21Points.length > 0) {
      // 直接使用接口返回的11号和21号牙的点位，不进行计算和约束
      const point11 = tooth11Points[0].point;
      const point21 = tooth21Points[0].point;

      // 创建 Vector3 对象，使用原始坐标
      pos1 = new THREE.Vector3(point11[0], point11[1], point11[2]);
      pos2 = new THREE.Vector3(point21[0], point21[1], point21[2]);

      // 只获取 t 值用于记录，但不改变位置
      const constrained11 = this.constrainPointToCurve(pos1);
      const constrained21 = this.constrainPointToCurve(pos2);
      t1 = constrained11.t;
      t2 = constrained21.t;
    } else {
      // 如果没有找到11号和21号牙的数据，使用默认位置作为备用
      t1 = 0.3;
      pos1 = curve.getPointAt(t1);
      t2 = 0.7;
      pos2 = curve.getPointAt(t2);
    }

    // 创建第一个控制点（11号牙位置）
    this.controlPoint1 = this.createControlPoint(pos1, t1, 1);
    group.add(this.controlPoint1);

    // 创建第二个控制点（21号牙位置）
    this.controlPoint2 = this.createControlPoint(pos2, t2, 2);
    group.add(this.controlPoint2);

    // 将控制点添加到场景管理器的可拖拽对象列表
    // 注意：需要在使用时通过 SceneManager 来添加
    // 这里我们存储引用，在后面通过其他方式注册
  }

  /**
   * 创建单个控制点
   */
  private createControlPoint(position: THREE.Vector3, t: number, id: number): THREE.Mesh {
    const sphereGeo = new THREE.SphereGeometry(0.8, 16, 16);
    const sphereMat = new THREE.MeshBasicMaterial({
      color: 0xff6b6b,
      depthTest: false,
      transparent: true,
      opacity: 0.8,
    });
    const sphere = new THREE.Mesh(sphereGeo, sphereMat);
    sphere.renderOrder = 1000;

    sphere.position.copy(position);
    sphere.userData.isMidlineControlPoint = true;
    sphere.userData.controlPointId = id;
    sphere.userData.t = t;
    sphere.userData.strategy = this;
    sphere.name = `midline_control_point_${id}`;

    return sphere;
  }

  /**
   * 创建垂直于牙弓线的两个面
   */
  private createVerticalPlanes(): void {
    if (!this.controlPoint1 || !this.controlPoint2 || !this.archWire) return;

    // 创建第一个面
    this.plane1 = this.createVerticalPlane(this.controlPoint1, 1);
    this.group.add(this.plane1);

    // 创建第二个面
    this.plane2 = this.createVerticalPlane(this.controlPoint2, 2);
    this.group.add(this.plane2);
  }

  /**
   * 创建单个垂直面
   * 平面始终保持垂直方向（不随曲线旋转），只跟随控制点平移
   */
  private createVerticalPlane(controlPoint: THREE.Mesh, id: number): THREE.Mesh {
    const planeWidth = 30;
    const planeHeight = 50;

    // 创建平面几何体
    const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);

    // 创建材质
    const material = new THREE.MeshBasicMaterial({
      color: id === 1 ? 0x00ff00 : 0x0000ff,
      opacity: 0.2,
      transparent: true,
      side: THREE.DoubleSide,
    });

    const plane = new THREE.Mesh(geometry, material);
    plane.renderOrder = -1;

    // 设置平面位置
    plane.position.copy(controlPoint.position);
    plane.position.x = 40;

    // 平面保持垂直方向（不旋转）
    // 默认情况下，PlaneGeometry 的法线沿着 Z 轴
    // 我们需要让它垂直于 XZ 平面（即沿着 Y 轴方向竖立）
    // 绕 X 轴旋转 90 度
    plane.rotation.x = Math.PI / 2;

    plane.userData.controlPointId = id;
    plane.name = `midline_vertical_plane_${id}`;

    return plane;
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
      const constrainedData = this.constrainPointToCurve(newPosition);
      controlPoint.position.copy(constrainedData.position);
      controlPoint.userData.t = constrainedData.t;
    }

    // 只更新平面位置（不更新旋转，保持垂直方向）
    plane.position.copy(controlPoint.position);
  }

  /**
   * 将点约束到曲线上
   * 找到曲线上距离给定点最近的点
   * @param point 要约束的点
   * @returns 曲线上最近的点和对应的 t 值
   */
  private constrainPointToCurve(point: THREE.Vector3): { position: THREE.Vector3; t: number } {
    if (!this.archWire) {
      return { position: point.clone(), t: 0.5 };
    }

    const curve = this.archWire.curve;
    let minDistance = Infinity;
    let closestT = 0.5;
    let closestPoint = point.clone();

    // 在曲线上采样，找到最近的点
    // 采样数量越多，精度越高，但计算量也越大
    const samples = 100;
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const curvePoint = curve.getPointAt(t);
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
      const curvePoint = curve.getPointAt(t);
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
   * 渲染单个颌的中线
   */
  private renderJawMidline(
    midlinePoint: AnalysisData['lower_midline_point'] | AnalysisData['upper_midline_point'],
    jawData: Record<string, unknown> | undefined,
    isUpper: boolean,
  ): void {
    if (!jawData || !midlinePoint) return;

    const midlinePosition = (jawData.midline_position_mm as number) || 0;
    const midlinePoints = (jawData.midline_reference_teeth as number[]) || [];

    if (midlinePoints.length < 2) return;

    // 确保 midlinePoint 是数组
    const pointsArray = Array.isArray(midlinePoint) ? midlinePoint : [midlinePoint];

    // 找到中切牙的点
    const tooth1Points = pointsArray.filter(p => p.fdi === midlinePoints[0]);
    const tooth2Points = pointsArray.filter(p => p.fdi === midlinePoints[1]);

    if (tooth1Points.length === 0 || tooth2Points.length === 0) return;

    // 计算两颗中切牙的中心点（使用 unscaled）
    const center1 = this.calculatePointsCenterUnscaled(tooth1Points.map(p => p.point));
    const center2 = this.calculatePointsCenterUnscaled(tooth2Points.map(p => p.point));

    // 计算中点（中线位置）- unscaled 方式
    const midPoint = this.getMidPointUnscaled(center1.toArray(), center2.toArray());

    // 根据偏差选择颜色
    const colorNum = this.getDeviationColor(Math.abs(midlinePosition));
    const colorStr = this.getDeviationColorString(Math.abs(midlinePosition));

    // 渲染中线（垂直线）- 使用 unscaled
    const lineStart = midPoint.clone().add(new THREE.Vector3(0, -10, 0));
    const lineEnd = midPoint.clone().add(new THREE.Vector3(0, 10, 0));
    const midline = this.createLineUnscaled(lineStart, lineEnd, colorNum, 3);
    midline.name = `${isUpper ? 'upper' : 'lower'}_midline`;

    const firstFdi = midlinePoints[0];
    if (firstFdi !== undefined) {
      this.addToMesh(midline, isUpper ? firstFdi : midlinePoints[1] ?? firstFdi); // 添加到对应 mesh
    }

    // 渲染中点标记 - 使用 unscaled
    const marker = this.createSphereMarker(midPoint, colorNum, 1.2);
    marker.name = `${isUpper ? 'upper' : 'lower'}_midline_marker`;

    if (firstFdi !== undefined) {
      this.addToMesh(marker, isUpper ? firstFdi : midlinePoints[1] ?? firstFdi); // 添加到对应 mesh
    }

    // 渲染中线标签
    const jawType = isUpper ? '上颌' : '下颌';
    const midlineLabel = LabelRenderer.createLabel(`${jawType}中线`, {
      position: midPoint.clone().add(new THREE.Vector3(0, isUpper ? 12 : -12, 0)),
      fontSize: 11,
      backgroundColor: colorStr,
      fontColor: '#ffffff',
    });
    midlineLabel.name = `${isUpper ? 'upper' : 'lower'}_midline_label`;

    if (firstFdi !== undefined) {
      this.addToMesh(midlineLabel, isUpper ? firstFdi : midlinePoints[1] ?? firstFdi); // 添加到对应 mesh
    }

    // 如果有明显偏差，渲染偏差指示线（跨颌元素，添加到 this.group）
    if (Math.abs(midlinePosition) > 0.5) {
      const facialMidPoint = new THREE.Vector3(0, midPoint.y, midPoint.z);

      // 创建偏差线（使用 LineCurve3）
      const deviationCurve = new THREE.LineCurve3(facialMidPoint, midPoint);
      const deviationGeometry = new THREE.BufferGeometry().setFromPoints(
        deviationCurve.getPoints(2),
      );
      const deviationMaterial = new THREE.LineBasicMaterial({
        color: 0xff0000,
        linewidth: 2,
        depthTest: false,
        depthWrite: false,
        transparent: true,
      });
      const deviationLine = new THREE.Line(deviationGeometry, deviationMaterial);
      deviationLine.name = `${isUpper ? 'upper' : 'lower'}_deviation_line`;
      deviationLine.renderOrder = 999;
      this.group.add(deviationLine); // 跨颌元素，添加到主 group

      // 添加偏差数值标签
      const deviationMid = this.getMidPointUnscaled(facialMidPoint.toArray(), midPoint.toArray());
      const deviationValueLabel = LabelRenderer.createLabel(
        `${Math.abs(midlinePosition).toFixed(2)}mm`,
        {
          position: deviationMid.clone().add(new THREE.Vector3(0, 3, 0)),
          fontSize: 10,
          backgroundColor: '#ff0000',
          fontColor: '#ffffff',
        },
      );
      deviationValueLabel.name = `${isUpper ? 'upper' : 'lower'}_deviation_label`;
      this.group.add(deviationValueLabel); // 跨颌元素，添加到主 group
    }
  }

  /**
   * 渲染偏差指示器
   */
  private renderDeviationIndicators(measurements: Record<string, unknown> | undefined): void {
    if (!measurements) return;

    const upperDeviation = (measurements.upper_deviation_mm as number) || 0;
    const lowerDeviation = (measurements.lower_deviation_mm as number) || 0;

    // 如果有偏差，在合适位置添加方向箭头
    if (Math.abs(upperDeviation) > 1.0 || Math.abs(lowerDeviation) > 1.0) {
      // 可以添加额外的视觉指示器
      // 例如：在参考面上标注偏差方向
    }
  }

  /**
   * 根据偏差大小获取颜色（数值）
   */
  private getDeviationColor(deviation: number): number {
    const absDev = Math.abs(deviation);
    if (absDev <= 1.0) return 0x22c55e; // 绿色 - 正常
    if (absDev <= 2.0) return 0xff9800; // 橙色 - 轻度偏差
    return 0xff0000; // 红色 - 明显偏差
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
    const jawType = isUpper ? '上颌' : '下颌';
    const fieldName = isUpper ? 'upper_midline_point' : 'lower_midline_point';

    const fieldValue = data[fieldName];

    // 情况1: 是坐标数组 [x, y] 或 [x, y, z]
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
   * 渲染中线点位和切片
   */
  private renderMidlinePointsAndSlices(
    midlinePoints: AnalysisData['teeth_points'],
    isUpper: boolean,
  ): void {
    if (!midlinePoints || midlinePoints.length === 0) return;

    // 确定颜色
    const color = isUpper ? 0xfd7676 : 0x4169e1; // 上颌红色，下颌蓝色
    const jawType = isUpper ? '上颌' : '下颌';

    // 根据 isUpper 直接获取目标 mesh
    const targetMesh = isUpper ? this.context.upperMeshLabel : this.context.lowerMeshLabel;

    if (!targetMesh) {
      return;
    }

    // 为每个点位创建球体标记和切片
    midlinePoints.forEach((point, index) => {
      // 尝试标准化数据格式
      const normalizedPoint = this.normalizePointData(point, index + 1);

      if (!normalizedPoint) {
        return;
      }

      const pointCoords = normalizedPoint.point;
      const center = new THREE.Vector3(pointCoords[0], pointCoords[1], pointCoords[2]);

      // 1. 创建球体标记
      const geometry = new THREE.SphereGeometry(0.8, 32, 32);
      const material = new THREE.MeshPhongMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.3,
        transparent: true,
        opacity: 0.8,
      });
      const sphere = new THREE.Mesh(geometry, material);
      sphere.position.copy(center);
      sphere.name = `${this.taskName}_midline_point_${jawType}_${index}`;

      // 直接添加到对应的 mesh（不通过 fdi 判断）
      targetMesh.add(sphere);

      // 2. 创建切片
      const sliceGroup = this.createMidlineSlice(center, index, color, isUpper);
      targetMesh.add(sliceGroup);

      // 恢复切片的深度测试，使其能被模型遮挡
      this.enableDepthTestForSlice(sliceGroup);
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

    // 设置切面朝向
    // 中线切片应该垂直站立，穿过牙齿（像图二那样）
    // PlaneGeometry 默认在XY平面，法线沿Z轴
    // 需要绕X轴旋转90度让它竖立起来
    plane.rotation.x = Math.PI / 2; // 绕X轴旋转90度，让平面竖立（垂直于地面）
    plane.rotation.y = 0; // 面向前后方向
    plane.rotation.z = 0; // 不绕Z轴旋转

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
      linewidth: 2,
      transparent: true,
      opacity: this.SLICE_CONFIG.borderOpacity,
      depthWrite: true,
    });

    const border = new THREE.Line(borderGeometry, borderMaterial);
    border.position.set(0, 0, 0);
    // 边框与平面保持相同的旋转（垂直站立）
    border.rotation.x = Math.PI / 2; // 与平面相同，竖立起来
    border.rotation.y = 0;
    border.rotation.z = 0;
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
