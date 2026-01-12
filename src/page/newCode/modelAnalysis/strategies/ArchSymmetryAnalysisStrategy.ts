import * as THREE from 'three';
import type { AnalysisData, MeasurementGroup, RenderType } from '../types';
import { LabelRenderer, SliceRenderer } from '../renderers';
import { BaseAnalysisStrategy } from './base/BaseAnalysisStrategy';

/**
 * 牙弓对称性分析策略
 * 分析上下颌牙弓的左右对称性
 */
export class ArchSymmetryAnalysisStrategy extends BaseAnalysisStrategy {
  readonly id = 'arch-symmetry';
  readonly name = '牙弓对称性';
  readonly taskName = 'arch-symmetry';
  readonly renderType: RenderType = 'POINT_LINE';
  // 🔥 新增：存储可拖动的点位对象
  private draggablePoints: THREE.Mesh[] = [];
  // 🔥 新增：存储中线信息，用于重新计算距离
  private upperMidlineInfo: { start: THREE.Vector3; end: THREE.Vector3 } | null = null;
  private lowerMidlineInfo: { start: THREE.Vector3; end: THREE.Vector3 } | null = null;

  /**
   * 重写toggle方法，确保点位能正确跟随模型显示/隐藏
   */
  toggle(visible: boolean): void {
    super.toggle(visible);

    // 额外确保所有添加到mesh的子对象正确显隐
    if (this.context) {
      const meshes = [this.context.upperMeshLabel, this.context.lowerMeshLabel].filter(
        Boolean,
      ) as THREE.Mesh[];

      meshes.forEach(mesh => {
        mesh.children.forEach(child => {
          if (child.name.startsWith(`${this.taskName}_`)) {
            child.visible = visible;
            // 递归设置所有子对象的可见性
            child.traverse(subChild => {
              subChild.visible = visible;
            });
          }
        });
      });
    }
  }

  /**
   * 重写shouldRenderPoints方法，禁用BaseAnalysisStrategy的默认点位渲染
   * 我们使用自己的renderTeethPoints方法来渲染
   */
  protected shouldRenderPoints(): boolean {
    return false; // 禁用父类的自动点位渲染
  }

  /**
   * 重写addToMesh方法，确保点位可以被遮挡
   * 不修改材质的depthTest和depthWrite属性
   */
  protected addToMesh(object: THREE.Object3D, fdi: number): void {
    const isUpper = this.isUpper(fdi);
    const targetMesh = isUpper ? this.context.upperMeshLabel : this.context.lowerMeshLabel;

    if (!targetMesh) {
      console.warn(`⚠️ 目标 mesh 不存在: ${isUpper ? '上颌' : '下颌'}，FDI: ${fdi}`);
      return;
    }

    // 设置名称前缀，方便后续识别和清理
    if (!object.name.startsWith(this.taskName)) {
      object.name = `${this.taskName}_${object.name || 'object'}`;
    }

    // 不修改材质的深度测试属性，保持点位可以被模型遮挡
    // 只设置渲染顺序
    object.renderOrder = 1; // 使用较小的值，让点位在正常渲染顺序中

    targetMesh.add(object);
  }

  /**
   * 渲染特定元素
   * 牙弓对称性分析：显示中线、对称点和测量线
   */
  protected renderSpecificElements(data: AnalysisData): void {
    const { teeth_points, measurements } = data;

    if (!teeth_points || teeth_points.length === 0) return;

    console.log('🦷 牙弓对称性分析 - 开始渲染', teeth_points.length, '个点位');

    // 🔥 渲染上下颌中线点位和连线，并保存中线信息
    const { upperMidline, lowerMidline } = this.renderMidlinePoints(data);
    this.upperMidlineInfo = upperMidline;
    this.lowerMidlineInfo = lowerMidline;

    // 渲染牙齿点位（上下颌一起处理）- 可拖拽版本
    this.renderTeethPoints(teeth_points);

    // 🔥 渲染每颗牙齿到对称轴的垂线和距离
    if (upperMidline) {
      this.renderToothDistancesToMidline(teeth_points, upperMidline, true);
    }
    if (lowerMidline) {
      this.renderToothDistancesToMidline(teeth_points, lowerMidline, false);
    }
  }
  /**
   * 清理资源
   */
  cleanup(): void {
    this.draggablePoints = [];
    this.upperMidlineInfo = null;
    this.lowerMidlineInfo = null;
    super.cleanup();
  }

  /**
   * 渲染测量标注
   */
  protected renderMeasurements(measurements: Record<string, unknown>): void {
    if (!measurements) return;

    const upperData = measurements.upper as Record<string, unknown>;
    const lowerData = measurements.lower as Record<string, unknown>;

    // 上颌信息面板
    if (upperData) {
      const symmetryIndex = (upperData.symmetry_index as number) || 0;
      const classification = (upperData.classification as string) || '对称';

      const upperPanel = LabelRenderer.createInfoPanel(
        [
          { key: '上颌对称性指数', value: symmetryIndex.toFixed(2) },
          { key: '分类', value: classification },
        ],
        {
          position: new THREE.Vector3(-25, 30, 0),
          fontSize: 13,
          backgroundColor: this.getSymmetryColor(symmetryIndex),
          fontColor: '#ffffff',
        },
      );
      // this.group.add(upperPanel)
    }

    // 下颌信息面板
    if (lowerData) {
      const symmetryIndex = (lowerData.symmetry_index as number) || 0;
      const classification = (lowerData.classification as string) || '对称';

      const lowerPanel = LabelRenderer.createInfoPanel(
        [
          { key: '下颌对称性指数', value: symmetryIndex.toFixed(2) },
          { key: '分类', value: classification },
        ],
        {
          position: new THREE.Vector3(25, 30, 0),
          fontSize: 13,
          backgroundColor: this.getSymmetryColor(symmetryIndex),
          fontColor: '#ffffff',
        },
      );
      // this.group.add(lowerPanel)
    }
  }

  /**
   * 格式化测量数据为面板展示格式
   */
  protected formatMeasurements(measurements: Record<string, unknown>): MeasurementGroup[] {
    const upperData = measurements.upper as Record<string, unknown>;
    const lowerData = measurements.lower as Record<string, unknown>;

    const groups: MeasurementGroup[] = [];

    // 上颌对称性
    if (upperData) {
      const symmetryIndex = (upperData.symmetry_index as number) || 0;
      const classification = (upperData.classification as string) || '对称';
      const leftDeviation = (upperData.left_deviation_mm as number) || 0;
      const rightDeviation = (upperData.right_deviation_mm as number) || 0;

      groups.push({
        groupName: '上颌牙弓对称性',
        children: [
          {
            name: '对称性指数',
            value: symmetryIndex.toFixed(2),
            result: this.evaluateSymmetry(symmetryIndex),
          },
          {
            name: '分类',
            value: classification,
            result: classification.includes('对称') ? '正常' : '异常',
          },
          {
            name: '左侧偏差',
            value: `${Math.abs(leftDeviation).toFixed(2)}mm`,
            result: '测量值',
          },
          {
            name: '右侧偏差',
            value: `${Math.abs(rightDeviation).toFixed(2)}mm`,
            result: '测量值',
          },
        ],
      });
    }

    // 下颌对称性
    if (lowerData) {
      const symmetryIndex = (lowerData.symmetry_index as number) || 0;
      const classification = (lowerData.classification as string) || '对称';
      const leftDeviation = (lowerData.left_deviation_mm as number) || 0;
      const rightDeviation = (lowerData.right_deviation_mm as number) || 0;

      groups.push({
        groupName: '下颌牙弓对称性',
        children: [
          {
            name: '对称性指数',
            value: symmetryIndex.toFixed(2),
            result: this.evaluateSymmetry(symmetryIndex),
          },
          {
            name: '分类',
            value: classification,
            result: classification.includes('对称') ? '正常' : '异常',
          },
          {
            name: '左侧偏差',
            value: `${Math.abs(leftDeviation).toFixed(2)}mm`,
            result: '测量值',
          },
          {
            name: '右侧偏差',
            value: `${Math.abs(rightDeviation).toFixed(2)}mm`,
            result: '测量值',
          },
        ],
      });
    }

    return groups;
  }
  /**
   * 直接渲染所有牙齿点位（可拖拽版本）
   */
  private renderTeethPoints(teethPoints: AnalysisData['teeth_points']): void {
    if (!teethPoints) return;

    console.log(`📊 开始渲染 ${teethPoints.length} 个点位（可拖拽）`);

    // 上下颌点位颜色
    const upperColor = 0xfeb5b5; // 上颌：浅粉色 #FEB5B5
    const lowerColor = 0xa49ed9; // 下颌：浅紫色 #A49ED9

    let upperCount = 0;
    let lowerCount = 0;

    // 直接遍历所有点位
    teethPoints.forEach((point, index) => {
      const { fdi, point: coords, type, type_cn } = point;
      const position = new THREE.Vector3(...coords);
      const isUpper = this.isUpper(fdi);

      // 根据上下颌选择颜色
      const pointColor = isUpper ? upperColor : lowerColor;

      // 🔥 创建可拖拽的点标记
      const marker = this.createDraggablePointMarker(
        position,
        pointColor,
        0.8,
        fdi,
        type,
        type_cn,
        coords,
      );
      marker.name = `point_${index}`;

      // 添加到可拖拽点位数组
      this.draggablePoints.push(marker);

      this.addToMesh(marker, fdi);

      if (isUpper) {
        upperCount++;
      } else {
        lowerCount++;
      }
    });
  }
  /**
   * 创建可拖拽的点标记
   */
  private createDraggablePointMarker(
    position: THREE.Vector3,
    color: number,
    size: number,
    fdi: number,
    type: string,
    type_cn: string,
    originalPoint: [number, number, number],
  ): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(size, 16, 16);
    const material = new THREE.MeshPhongMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.3,
      transparent: true,
      opacity: 0.8,
      depthTest: false,
      depthWrite: false,
    });

    const sphere = new THREE.Mesh(geometry, material);
    sphere.position.copy(position);
    sphere.name = 'point_marker';

    // 🔥 设置 userData，支持拖拽
    sphere.userData = {
      fdi: fdi,
      type: type,
      type_cn: type_cn,
      originalPoint: [...originalPoint] as [number, number, number],
      isArchSymmetryPoint: true,
      strategy: this,
      draggable: true,
    };

    return sphere;
  }
  /**
   * 处理点位拖拽时的更新
   * 当任何牙弓对称性点位被拖拽时，重新计算并更新垂线和距离标签
   */
  public updateOnDrag(object: THREE.Object3D): void {
    if (!object.userData?.isArchSymmetryPoint) return;

    // 更新点位的原始坐标数据
    if (object instanceof THREE.Mesh && object.userData.originalPoint) {
      const newPosition = object.position.clone();
      object.userData.originalPoint = [newPosition.x, newPosition.y, newPosition.z];
    }

    // 重新渲染垂线和距离标签
    this.updateDistanceLines();
  }

  /**
   * 更新所有垂线和距离标签
   */
  private updateDistanceLines(): void {
    if (!this.data?.teeth_points) return;

    // 清理旧的垂线和标签（保留点位和中线）
    this.cleanupDistanceLinesOnly();

    // 获取更新后的点位数据
    const updatedTeethPoints = this.getUpdatedTeethPoints();

    // 重新渲染垂线
    if (this.upperMidlineInfo) {
      this.renderToothDistancesToMidline(updatedTeethPoints, this.upperMidlineInfo, true);
    }
    if (this.lowerMidlineInfo) {
      this.renderToothDistancesToMidline(updatedTeethPoints, this.lowerMidlineInfo, false);
    }
  }
  /**
   * 只清理垂线和距离标签，保留点位和中线
   */
  private cleanupDistanceLinesOnly(): void {
    if (!this.context) return;

    const meshes = [
      this.context.upperMesh,
      this.context.lowerMesh,
      this.context.upperMeshLabel,
      this.context.lowerMeshLabel,
    ].filter(Boolean) as THREE.Mesh[];

    meshes.forEach(mesh => {
      const toRemove: THREE.Object3D[] = [];
      mesh.children.forEach(child => {
        // 只清理垂线和距离标签
        if (
          child.name.startsWith(`${this.taskName}_perpendicular_`) ||
          child.name.startsWith(`${this.taskName}_distance_label_`)
        ) {
          toRemove.push(child);
        }
      });

      toRemove.forEach(child => {
        mesh.remove(child);
        if (child instanceof THREE.Line) {
          child.geometry?.dispose();
          if (child.material && !Array.isArray(child.material)) {
            child.material.dispose();
          }
        } else if (child instanceof THREE.Sprite) {
          const material = child.material as THREE.SpriteMaterial;
          if (material.map) {
            material.map.dispose();
          }
          material.dispose();
        }
      });
    });
  }
  /**
   * 获取更新后的点位数据（从可拖拽点位中）
   */
  private getUpdatedTeethPoints(): Array<{
    fdi: number;
    type: string;
    type_cn: string;
    point: [number, number, number];
  }> {
    const updatedPoints: Array<{
      fdi: number;
      type: string;
      type_cn: string;
      point: [number, number, number];
    }> = [];

    this.draggablePoints.forEach(sphere => {
      if (sphere.userData?.fdi && sphere.userData?.type) {
        const currentPosition = sphere.position;
        updatedPoints.push({
          fdi: sphere.userData.fdi,
          type: sphere.userData.type,
          type_cn: sphere.userData.type_cn,
          point: [currentPosition.x, currentPosition.y, currentPosition.z],
        });
      }
    });

    return updatedPoints;
  }

  /**
   * 获取移动后的点位数据（供外部调用）
   * 返回符合 ToothPoint 格式的数据，保持与初始格式完全一致
   */
  public getUpdatedPoints(): Array<import('../types').ToothPoint> {
    return this.draggablePoints.map(point => {
      const fdi = point.userData.fdi as number;
      const type = point.userData.type as string;
      const type_cn = point.userData.type_cn as string;
      const currentPos = point.position;

      return {
        fdi,
        type,
        type_cn,
        // 返回当前位置坐标，保持数据精度
        point: [
          Number(currentPos.x.toFixed(4)),
          Number(currentPos.y.toFixed(4)),
          Number(currentPos.z.toFixed(4)),
        ] as [number, number, number],
      };
    });
  }

  /**
   * 获取所有可拖动对象（供 SceneManager 注册）
   */
  public getDraggableObjects(): THREE.Mesh[] {
    return this.draggablePoints;
  }
  /**
   * 渲染上下颌中线点位和连线
   * renderMidlinePoints(data: AnalysisData): {
  upperMidline: { start: THREE.Vector3; end: THREE.Vector3 } | null
  lowerMidline: { start: THREE.Vector3; end: THREE.Vector3 } | null

   */
  private renderMidlinePoints(data: AnalysisData): {
    upperMidline: { start: THREE.Vector3; end: THREE.Vector3 } | null;
    lowerMidline: { start: THREE.Vector3; end: THREE.Vector3 } | null;
  } {
    console.log('🔍 查找中线点位数据...');

    // 尝试多种可能的字段名
    const possibleUpperFields = [
      'upper_midline_points',
      'upper_midline_point',
      'upperMidlinePoints',
      'upperMidlinePoint',
    ];

    const possibleLowerFields = [
      'lower_midline_points',
      'lower_midline_point',
      'lowerMidlinePoints',
      'lowerMidlinePoint',
    ];

    let upperMidlinePoints = null;
    let lowerMidlinePoints = null;

    // 1. 先在 data 根级别查找
    for (const field of possibleUpperFields) {
      if (data[field]) {
        console.log(`✅ 在 data.${field} 找到上颌中线数据`);
        upperMidlinePoints = this.extractMidlinePoints(data, field);
        if (upperMidlinePoints) break;
      }
    }

    for (const field of possibleLowerFields) {
      if (data[field]) {
        console.log(`✅ 在 data.${field} 找到下颌中线数据`);
        lowerMidlinePoints = this.extractMidlinePoints(data, field);
        if (lowerMidlinePoints) break;
      }
    }

    // 2. 如果根级别没找到，尝试在 measurements.upper 和 measurements.lower 中查找
    if (!upperMidlinePoints && data.measurements) {
      const upperData = data.measurements.upper as Record<string, unknown>;
      if (upperData) {
        for (const field of ['midline_points', 'midline_point', 'points']) {
          if (upperData[field]) {
            console.log(`✅ 在 measurements.upper.${field} 找到上颌中线数据`);
            upperMidlinePoints = this.extractMidlinePointsFromValue(upperData[field]);
            if (upperMidlinePoints) break;
          }
        }
      }
    }

    if (!lowerMidlinePoints && data.measurements) {
      const lowerData = data.measurements.lower as Record<string, unknown>;
      if (lowerData) {
        for (const field of ['midline_points', 'midline_point', 'points']) {
          if (lowerData[field]) {
            console.log(`✅ 在 measurements.lower.${field} 找到下颌中线数据`);
            lowerMidlinePoints = this.extractMidlinePointsFromValue(lowerData[field]);
            if (lowerMidlinePoints) break;
          }
        }
      }
    }

    console.log('📍 上颌中线点位:', upperMidlinePoints?.length || 0, '个');
    console.log('📍 下颌中线点位:', lowerMidlinePoints?.length || 0, '个');
    let upperMidlineInfo: { start: THREE.Vector3; end: THREE.Vector3 } | null = null;
    let lowerMidlineInfo: { start: THREE.Vector3; end: THREE.Vector3 } | null = null;

    // 渲染上颌中线
    if (upperMidlinePoints && upperMidlinePoints.length >= 2) {
      upperMidlineInfo = this.renderMidlineLine(upperMidlinePoints, 0x4caf50, true);
    }

    // 渲染下颌中线
    if (lowerMidlinePoints && lowerMidlinePoints.length >= 2) {
      lowerMidlineInfo = this.renderMidlineLine(lowerMidlinePoints, 0x2196f3, false);
    }
    return {
      upperMidline: upperMidlineInfo,
      lowerMidline: lowerMidlineInfo,
    };
  }
  /**
   * 提取中线点位数据
   * 支持多种数据格式
   */
  /**
   * 提取中线点位数据
   * 支持多种数据格式
   */
  private extractMidlinePoints(
    data: AnalysisData,
    fieldName: string,
  ): Array<{ point: [number, number, number] }> | null {
    const fieldValue = data[fieldName];
    return this.extractMidlinePointsFromValue(fieldValue);
  }
  /**
   * 从值中提取中线点位（通用方法）
   */
  private extractMidlinePointsFromValue(
    fieldValue: any,
  ): Array<{ point: [number, number, number] }> | null {
    if (!fieldValue) {
      return null;
    }

    // 情况1: 是包含多个点位对象的数组 [{point: [x,y,z]}, ...]
    if (Array.isArray(fieldValue) && fieldValue.length > 0) {
      const firstItem = fieldValue[0];

      // 🔥 新增：检查是否是 {point1: [...], point2: [...]} 格式
      if (firstItem && typeof firstItem === 'object') {
        // 查找所有以 "point" 开头的键
        const pointKeys = Object.keys(firstItem).filter(key => key.startsWith('point'));

        if (pointKeys.length > 0) {
          console.log(`✅ 识别为 {point1, point2, ...} 格式，找到 ${pointKeys.length} 个键`);

          // 提取所有点位
          const points: Array<{ point: [number, number, number] }> = [];

          fieldValue.forEach((item: any, index: number) => {
            // 获取当前对象中所有 pointN 键
            const keys = Object.keys(item).filter(k => k.startsWith('point'));
            keys.forEach(key => {
              const coords = item[key];
              if (Array.isArray(coords) && coords.length >= 2) {
                points.push({
                  point: [coords[0], coords[1], coords[2] !== undefined ? coords[2] : 0] as [
                    number,
                    number,
                    number,
                  ],
                });
                console.log(
                  `  📍 提取点位: ${key} = [${coords[0].toFixed(2)}, ${coords[1].toFixed(2)}, ${
                    coords[2]?.toFixed(2) || 0
                  }]`,
                );
              }
            });
          });

          if (points.length > 0) {
            console.log(`✅ 成功提取 ${points.length} 个点位`);
            return points;
          }
        }

        // 标准格式：检查是否有 point 字段
        if ('point' in firstItem) {
          console.log('✅ 识别为标准点位对象数组格式 [{point: [...]}]');
          return fieldValue as Array<{ point: [number, number, number] }>;
        }
      }

      // 检查是否是纯坐标数组 [[x1,y1,z1], [x2,y2,z2], ...]
      if (Array.isArray(firstItem) && firstItem.length >= 2) {
        console.log('✅ 识别为纯坐标数组格式 [[x,y,z], ...]');
        return fieldValue.map((coords: number[]) => ({
          point: [coords[0], coords[1], coords[2] !== undefined ? coords[2] : 0] as [
            number,
            number,
            number,
          ],
        }));
      }

      // 检查是否所有元素都是数字（单个坐标点）[x, y, z]
      if (fieldValue.every((v: any) => typeof v === 'number')) {
        console.log('✅ 识别为单个坐标点格式 [x, y, z]');
        return [
          {
            point: [
              fieldValue[0],
              fieldValue[1],
              fieldValue[2] !== undefined ? fieldValue[2] : 0,
            ] as [number, number, number],
          },
        ];
      }
    }

    // 情况2: 单个点位对象 {point: [x,y,z]}
    if (fieldValue && typeof fieldValue === 'object' && !Array.isArray(fieldValue)) {
      // 检查是否有 point 字段
      if ('point' in fieldValue) {
        console.log('✅ 识别为单个点位对象格式 {point: [x,y,z]}');
        return [fieldValue as { point: [number, number, number] }];
      }

      // 尝试直接作为坐标使用（如果有 x, y, z 字段）
      if ('x' in fieldValue && 'y' in fieldValue) {
        console.log('✅ 识别为 {x, y, z} 对象格式');
        return [
          {
            point: [
              fieldValue.x as number,
              fieldValue.y as number,
              (fieldValue.z as number) || 0,
            ] as [number, number, number],
          },
        ];
      }
    }

    console.warn(`❌ 中线点位数据格式不支持`);
    return null;
  }

  /**
   * 渲染中线连线
   * @param points 中线点位数组
   * @param color 线条颜色
   * @param isUpper 是否为上颌
   */
  /**
   * 渲染中线连线
   * @returns 返回中线的起点和终点
   */
  private renderMidlineLine(
    points: Array<{ point: [number, number, number] }>,
    color: number,
    isUpper: boolean,
  ): { start: THREE.Vector3; end: THREE.Vector3 } | null {
    if (points.length < 2) return null;

    const jawLabel = isUpper ? '上颌' : '下颌';
    console.log(`🎨 渲染${jawLabel}中线: ${points.length}个点位`);

    // 创建线段的点位数组
    const linePoints: THREE.Vector3[] = [];

    // 渲染每个中线点位
    points.forEach((p, index) => {
      const position = new THREE.Vector3(...p.point);
      linePoints.push(position);

      // 创建点标记（较小的球体）
      const marker = this.createPointMarkerUnscaled(position, color, 0.5);
      marker.name = `midline_point_${isUpper ? 'upper' : 'lower'}_${index}`;

      const defaultFdi = isUpper ? 11 : 41;
      this.addToMesh(marker, defaultFdi);
    });

    // 创建连接所有点位的线段
    if (linePoints.length >= 2) {
      const lineGeometry = new THREE.BufferGeometry().setFromPoints(linePoints);
      const lineMaterial = new THREE.LineBasicMaterial({
        color: color,
        linewidth: 3,
        opacity: 0.8,
        transparent: true,
      });

      const line = new THREE.Line(lineGeometry, lineMaterial);
      line.name = `${this.taskName}_midline_${isUpper ? 'upper' : 'lower'}`;
      line.renderOrder = 2;

      const defaultFdi = isUpper ? 11 : 41;
      const targetMesh = isUpper ? this.context.upperMeshLabel : this.context.lowerMeshLabel;

      if (targetMesh) {
        targetMesh.add(line);
      }

      console.log(`✅ ${jawLabel}中线渲染完成`);

      // 返回中线的起点和终点
      return {
        start: linePoints[0],
        end: linePoints[linePoints.length - 1],
      };
    }

    return null;
  }
  /**
   * 渲染每颗牙齿质心到对称轴的垂线和距离标注
   */
  private renderToothDistancesToMidline(
    teethPoints: AnalysisData['teeth_points'],
    midline: { start: THREE.Vector3; end: THREE.Vector3 },
    isUpper: boolean,
  ): void {
    if (!teethPoints) return;

    const jawLabel = isUpper ? '上颌' : '下颌';
    console.log(`📏 渲染${jawLabel}牙齿到中线的距离`);

    // 过滤出对应颌位的牙齿
    const jawTeeth = teethPoints.filter(p => (isUpper ? this.isUpper(p.fdi) : this.isLower(p.fdi)));

    // 按FDI分组，计算每颗牙的质心
    const toothCenters = this.calculateToothCenters(jawTeeth);

    // 为每颗牙齿绘制垂线和距离标注
    toothCenters.forEach(({ fdi, center }) => {
      // 计算点到中线的垂足和距离
      const { footPoint, distance } = this.calculatePerpendicularToLine(
        center,
        midline.start,
        midline.end,
      );

      // 绘制从质心到垂足的垂线（虚线）
      this.renderPerpendicularLine(center, footPoint, fdi, isUpper);

      // 在垂线中点添加距离标注
      this.renderDistanceLabel(center, footPoint, distance, fdi, isUpper);
    });

    console.log(`✅ ${jawLabel}共渲染 ${toothCenters.length} 条垂线`);
  }
  /**
   * 按FDI分组计算每颗牙齿的质心
   */
  private calculateToothCenters(
    teethPoints: AnalysisData['teeth_points'],
  ): Array<{ fdi: number; center: THREE.Vector3 }> {
    const centersByFdi = new Map<number, THREE.Vector3[]>();

    // 按FDI分组收集点位
    teethPoints.forEach(p => {
      if (!centersByFdi.has(p.fdi)) {
        centersByFdi.set(p.fdi, []);
      }
      centersByFdi.get(p.fdi)!.push(new THREE.Vector3(...p.point));
    });

    // 计算每颗牙的质心
    const centers: Array<{ fdi: number; center: THREE.Vector3 }> = [];
    centersByFdi.forEach((points, fdi) => {
      const center = new THREE.Vector3();
      points.forEach(p => center.add(p));
      center.divideScalar(points.length);
      centers.push({ fdi, center });
    });

    return centers.sort((a, b) => a.fdi - b.fdi);
  }
  /**
   * 计算点到直线的垂足和距离
   */
  private calculatePerpendicularToLine(
    point: THREE.Vector3,
    lineStart: THREE.Vector3,
    lineEnd: THREE.Vector3,
  ): { footPoint: THREE.Vector3; distance: number } {
    // 直线方向向量
    const lineDir = new THREE.Vector3().subVectors(lineEnd, lineStart).normalize();

    // 从直线起点到目标点的向量
    const pointVector = new THREE.Vector3().subVectors(point, lineStart);

    // 投影长度
    const projectionLength = pointVector.dot(lineDir);

    // 垂足点 = 起点 + 方向 * 投影长度
    const footPoint = lineStart.clone().add(lineDir.multiplyScalar(projectionLength));

    // 距离 = 点到垂足的距离
    const distance = point.distanceTo(footPoint);

    return { footPoint, distance };
  }

  /**
   * 渲染从质心到对称轴的垂线（虚线）
   */
  private renderPerpendicularLine(
    start: THREE.Vector3,
    end: THREE.Vector3,
    fdi: number,
    isUpper: boolean,
  ): void {
    const points = [start, end];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);

    // 使用虚线材质
    const material = new THREE.LineDashedMaterial({
      color: 0xff9800, // 橙色
      linewidth: 1,
      dashSize: 0.5,
      gapSize: 0.3,
      opacity: 0.6,
      transparent: true,
    });

    const line = new THREE.Line(geometry, material);
    line.computeLineDistances(); // 虚线必须调用
    line.name = `${this.taskName}_perpendicular_${fdi}`;
    line.renderOrder = 3;

    this.addToMesh(line, fdi);
  }

  /**
   * 渲染距离标注（在垂线中点）
   */
  private renderDistanceLabel(
    start: THREE.Vector3,
    end: THREE.Vector3,
    distance: number,
    fdi: number,
    isUpper: boolean,
  ): void {
    // 计算垂线中点
    const midPoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);

    // 稍微偏移标签位置，避免遮挡线条
    const offset = new THREE.Vector3(0, isUpper ? 1 : -1, 0);
    const labelPosition = midPoint.clone().add(offset);

    // 创建距离标签
    const distanceText = `${distance.toFixed(2)}mm`;
    const label = this.createDistanceLabelSprite(distanceText, labelPosition);
    label.name = `${this.taskName}_distance_label_${fdi}`;

    this.addToMesh(label, fdi);
  }

  /**
   * 创建距离标签 Sprite
   */
  /**
   * 创建距离标签 Sprite（使用与牙弓宽度分析相同的样式）
   */
  private createDistanceLabelSprite(text: string, position: THREE.Vector3): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建canvas context');

    // 🔥 使用更大的 canvas 尺寸以支持更大的标签
    canvas.width = 512;
    canvas.height = 256;

    // 计算背景区域（保持比例）
    const bgWidth = 472; // 512 - 40 (左右各20边距)
    const bgHeight = 136; // 256 - 120 (上下各60边距)
    const bgX = 20;
    const bgY = 60;

    // 绘制背景
    context.fillStyle = 'rgba(0, 0, 0, 0.7)';
    context.roundRect(bgX, bgY, bgWidth, bgHeight, 12);
    context.fill();

    // 绘制边框
    context.strokeStyle = '#60a5fa';
    context.lineWidth = 3; // 稍微粗一点的边框
    context.roundRect(bgX, bgY, bgWidth, bgHeight, 12);
    context.stroke();

    // 🔥 使用更大的字体
    context.fillStyle = '#ffffff';
    context.font = 'bold 48px Arial'; // 从 36px 增加到 48px
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, canvas.width / 2, canvas.height / 2);

    // 创建纹理和 Sprite
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);

    // 🔥 使用更大的缩放比例
    sprite.scale.set(7, 3.5, 1); // 从 (5, 2.5, 1) 增加到 (7, 3.5, 1)
    sprite.renderOrder = 1000;

    sprite.userData = { text };
    return sprite;
  }

  /**
   * 创建不缩放的点标记
   * 启用深度测试，使点位可以被模型遮挡
   */
  private createPointMarkerUnscaled(
    position: THREE.Vector3,
    color: number,
    size: number,
  ): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(size, 16, 16);
    const material = new THREE.MeshPhongMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.3,
      // 启用深度测试，使点位可以被模型正常遮挡
      depthTest: false,
      depthWrite: false,
    });

    const sphere = new THREE.Mesh(geometry, material);
    sphere.position.copy(position);
    sphere.name = 'point_marker';

    // 🔥 设置 userData，明确标识这不是可拖拽的点位
    sphere.userData = {
      isArchSymmetryPoint: true,
      draggable: true,
    };

    return sphere;
  }
  /**
   * 根据对称性指数获取颜色
   */
  private getSymmetryColor(index: number): string {
    if (index >= 0.9) return '#22c55e'; // 绿色 - 良好对称
    if (index >= 0.7) return '#ff9800'; // 橙色 - 轻度不对称
    return '#ff0000'; // 红色 - 明显不对称
  }

  /**
   * 根据偏差大小获取颜色
   */
  private getDeviationColor(deviation: number): number {
    const absDev = Math.abs(deviation);
    if (absDev <= 1.0) return 0x22c55e; // 绿色 - 正常
    if (absDev <= 2.0) return 0xff9800; // 橙色 - 轻度偏差
    return 0xff0000; // 红色 - 明显偏差
  }

  /**
   * 评估对称性
   */
  private evaluateSymmetry(index: number): string {
    if (index >= 0.9) return '良好对称';
    if (index >= 0.7) return '轻度不对称';
    return '明显不对称';
  }

  // 以下方法已禁用，不会渲染额外的点位

  // private renderPointsToPlaneDistances(...) { }
  // private calculateAndRenderDistances(...) { }
  // private renderPerpendicularPlane(...) { }
  // private renderProjectionLine(...) { }
  // private renderDistanceLabel(...) { }
}
