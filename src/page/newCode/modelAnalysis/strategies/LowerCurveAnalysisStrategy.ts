import * as THREE from 'three';
import type { AnalysisData, MeasurementGroup, RenderType, ToothPoint } from '../types';
import { LabelRenderer } from '../renderers';
import { BaseAnalysisStrategy } from './base/BaseAnalysisStrategy';

/**
 * 下颌补偿曲线分析策略（Spee曲线）
 * 分析下颌牙齿的矢状补偿曲线
 * ⚠️ 只处理下颌牙齿，不处理上颌
 */
export class LowerCurveAnalysisStrategy extends BaseAnalysisStrategy {
  readonly id = 'spee-curve';
  readonly name = 'Spee曲线';
  readonly taskName = 'lower-curve';
  readonly renderType: RenderType = 'POINT_CURVE';
  // 存储可拖动的点位对象
  private draggablePoints: THREE.Mesh[] = [];

  /**
   * 渲染特定元素
   * Spee曲线分析：显示曲线、关键点和深度
   * ⚠️ 只处理下颌牙齿，不处理上颌
   */
  protected renderSpecificElements(data: AnalysisData): void {
    const { teeth_points, measurements } = data;

    if (!teeth_points || teeth_points.length === 0) return;

    // ⚠️ 只过滤下颌牙齿（FDI 31-48），排除上颌牙齿（FDI 11-28）
    const lowerTeethPoints = teeth_points;

    if (lowerTeethPoints.length === 0) {
      console.warn('⚠️ Spee曲线：未找到下颌牙齿数据');
      return;
    }

    // 渲染Spee曲线（只使用下颌牙齿数据）
    this.renderSpeeCurve(lowerTeethPoints, measurements);
  }

  /**
   * 渲染测量标注
   */
  protected renderMeasurements(measurements: Record<string, unknown>): void {
    if (!measurements) return;

    const curveDepth = (measurements.curve_depth_mm as number) || 0;
    const classification = (measurements.classification as string) || '正常';
    const diagnosis = (measurements.diagnosis as string) || '正常';

    // 创建统计信息面板
    const infoData = [
      { key: 'Spee曲线深度', value: `${curveDepth.toFixed(2)}mm` },
      { key: '分类', value: classification },
      { key: '诊断结果', value: diagnosis },
    ];

    const infoPanel = LabelRenderer.createInfoPanel(infoData, {
      position: new THREE.Vector3(0, 30, 0),
      fontSize: 14,
      backgroundColor: this.getCurveColor(curveDepth),
      fontColor: '#ffffff',
    });

    // this.group.add(infoPanel);
  }

  /**
   * 格式化测量数据为面板展示格式
   */
  protected formatMeasurements(measurements: Record<string, unknown>): MeasurementGroup[] {
    const curveDepth = (measurements.curve_depth_mm as number) || 0;
    const classification = (measurements.classification as string) || '正常';
    const diagnosis = (measurements.diagnosis as string) || '正常';
    const curvePoints = (measurements.curve_reference_teeth as number[]) || [];

    return [
      {
        groupName: 'Spee曲线分析',
        children: [
          {
            name: '曲线深度',
            value: `${curveDepth.toFixed(2)}mm`,
            result: this.evaluateCurveDepth(curveDepth),
          },
          {
            name: '分类',
            value: classification,
            result: classification.includes('正常') ? '正常' : '异常',
          },
          {
            name: '参考牙位',
            value:
              curvePoints.length > 0
                ? `${curvePoints[0]}-${curvePoints[curvePoints.length - 1]}`
                : '未指定',
            result: '范围',
          },
          {
            name: '诊断结果',
            value: diagnosis,
            result: diagnosis.includes('正常') ? '正常' : '需要关注',
          },
        ],
      },
    ];
  }

  // ==================== 私有辅助方法 ====================

  /**
   * 重写点位渲染 - 将点位添加到下颌 mesh，跟随下颌显示/隐藏
   */
  /**
   * 重写点位渲染 - 创建可拖拽的点位
   */
  protected renderPoints(teethPoints: ToothPoint[]): void {
    // 清空之前的可拖拽点位
    this.draggablePoints = [];

    // 只渲染下颌点位
    const targetFDIs = [31, 41, 37, 47, 36, 46];
    const lowerPoints = teethPoints.filter(p => targetFDIs.includes(p.fdi));

    lowerPoints.forEach(p => {
      const color = 0xa49ed9;

      // 解析 point（可能是字符串或数组）
      let pointCoords: number[];
      if (typeof p.point === 'string') {
        pointCoords = JSON.parse(p.point) as number[];
      } else {
        pointCoords = p.point;
      }

      // 创建可拖拽的球体标记
      const draggableSphere = this.createDraggablePointMarker(
        new THREE.Vector3(pointCoords[0] ?? 0, pointCoords[1] ?? 0, pointCoords[2] ?? 0),
        color,
        0.5, // 稍微大一些便于拖拽
        p.fdi,
        p.type,
        p.type_cn,
        pointCoords as [number, number, number],
      );

      // 添加到下颌 mesh
      this.addToMesh(draggableSphere, p.fdi);

      // 添加到可拖拽点位数组
      this.draggablePoints.push(draggableSphere);
    });

    console.log(`✅ 创建了 ${this.draggablePoints.length} 个可拖拽点位`);
  }
  /**
   * 创建可拖拽的点位标记
   */
  /**
   * 创建可拖拽的点位标记
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
      opacity: 0.9,
    });

    const sphere = new THREE.Mesh(geometry, material);
    sphere.position.copy(position);
    sphere.name = `${this.taskName}_draggable_point_${fdi}_${type}`;

    // 设置用户数据，用于拖拽和数据保存
    sphere.userData = {
      isDraggable: true,
      isLowerCurvePoint: true,
      fdi,
      type,
      type_cn,
      originalPoint: [...originalPoint], // 保存原始坐标
    };

    return sphere;
  }
  /**
   * 处理点位拖拽时的更新
   * 当任何点位被拖拽时，重新计算并更新平面、连线等元素
   */
  public updateOnDrag(object: THREE.Object3D): void {
    if (!object.userData?.isLowerCurvePoint) return;

    // 更新点位的原始坐标数据
    if (object instanceof THREE.Mesh && object.userData.originalPoint) {
      const newPosition = object.position.clone();
      object.userData.originalPoint = [newPosition.x, newPosition.y, newPosition.z];
    }

    // 重新渲染平面、连线等元素
    this.updateVisualizationElements();
  }

  /**
   * 更新所有可视化元素（平面、连线等）
   */
  private updateVisualizationElements(): void {
    if (!this.data?.teeth_points) return;

    // 清理旧的可视化元素（保留点位）
    this.cleanupVisualizationElements();

    // 获取更新后的点位数据
    const updatedTeethPoints = this.getUpdatedTeethPointsData();

    // 重新渲染可视化元素
    this.renderCustomPlaneAndLines(updatedTeethPoints);
  }

  /**
   * 清理可视化元素（保留点位）
   */
  private cleanupVisualizationElements(): void {
    const meshes = [this.context.upperMeshLabel, this.context.lowerMeshLabel, this.group].filter(
      Boolean,
    ) as THREE.Object3D[];

    meshes.forEach(mesh => {
      const childrenToRemove: THREE.Object3D[] = [];

      mesh.children.forEach(child => {
        if (child.name.startsWith(`${this.taskName}_`) && !child.name.includes('draggable_point')) {
          // 保留可拖拽点位
          childrenToRemove.push(child);
        }
      });

      childrenToRemove.forEach(child => {
        mesh.remove(child);
        // 清理材质和几何体
        if (child instanceof THREE.Mesh) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach(mat => mat.dispose());
            } else {
              child.material.dispose();
            }
          }
        }
      });
    });
  }

  /**
   * 获取更新后的点位数据（从可拖拽点位中）
   */
  private getUpdatedTeethPointsData(): Array<{
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
          point: [
            Number(currentPosition.x.toFixed(4)),
            Number(currentPosition.y.toFixed(4)),
            Number(currentPosition.z.toFixed(4)),
          ],
        });
      }
    });

    return updatedPoints;
  }

  /**
   * 获取移动后的点位数据（供外部调用）
   * 返回符合 ToothPoint 格式的数据，保持与初始格式完全一致
   */
  public getUpdatedPoints(): Array<ToothPoint> {
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
   * 重写清理方法，确保正确清理可拖拽点位
   */
  cleanup(): void {
    // 清理可拖拽点位
    this.draggablePoints.forEach(point => {
      if (point.geometry) point.geometry.dispose();
      if (point.material) {
        if (Array.isArray(point.material)) {
          point.material.forEach(mat => mat.dispose());
        } else {
          point.material.dispose();
        }
      }
    });
    this.draggablePoints = [];

    // 调用父类清理方法
    super.cleanup();
  }

  /**
   * 渲染Spee曲线
   * ⚠️ 只处理下颌牙齿数据
   */
  private renderSpeeCurve(
    teethPoints: AnalysisData['teeth_points'],
    measurements: Record<string, unknown> | undefined,
  ): void {
    if (!measurements) return;

    // ⚠️ 确保只使用下颌牙齿数据
    const lowerTeethPoints = teethPoints.filter(p => p.fdi >= 31 && p.fdi <= 48);

    if (lowerTeethPoints.length === 0) {
      console.warn('⚠️ Spee曲线：未找到下颌牙齿数据');
      return;
    }

    const curveData = measurements.curve_data as Array<number[]>;
    const curveDepth = (measurements.curve_depth_mm as number) || 0;
    console.log('curveData', curveData);
    console.log(curveDepth, 'curveDepth');
    if (!curveData || curveData.length === 0) {
      // 如果没有曲线数据，使用参考牙位生成曲线（只使用下颌数据）
      this.renderCurveFromTeeth(lowerTeethPoints, measurements);
      return;
    }

    // 将曲线数据转换为Three.js坐标（不缩放，使用原始坐标）
    const curvePoints = curveData.map(
      point => new THREE.Vector3(point[0] || 0, point[1] || 0, point[2] || 0),
    );

    console.log('🔵 LowerCurve - 曲线点数:', curvePoints.length);
    if (curvePoints.length < 2) {
      console.warn('⚠️ LowerCurve - 曲线点数不足，至少需要2个点');
      return;
    }

    // 根据深度选择颜色
    const color = this.getCurveColorNum(curveDepth);

    // 使用CatmullRomCurve3创建平滑曲线
    const curve = new THREE.CatmullRomCurve3(curvePoints);
    curve.closed = false;
    curve.curveType = 'catmullrom';
    curve.tension = 0.5;

    // 使用TubeGeometry创建有厚度的曲线（参考牙弓线样式）
    const tubeGeometry = new THREE.TubeGeometry(
      curve,
      64, // tubularSegments
      0.3, // radius - 曲线粗细
      8, // radialSegments
      false, // closed
    );
  }

  /**
   * 从牙齿点位生成曲线
   * ⚠️ 只处理下颌牙齿，不处理上颌
   */
  private renderCurveFromTeeth(
    teethPoints: AnalysisData['teeth_points'],
    measurements: Record<string, unknown>,
  ): void {
    // ⚠️ 重要：只过滤下颌牙齿点位（FDI 31-48），完全排除上颌（FDI 11-28）
    const lowerTeethPoints = teethPoints.filter(p => p.fdi >= 31 && p.fdi <= 48);

    if (lowerTeethPoints.length === 0) {
      console.warn('⚠️ Spee曲线：未找到下颌牙齿点位');
      return;
    }

    // 使用下颌所有牙位：47->46->45->44->43->42->41->31->32->33->34->35->36->37 (不连接47和37)
    const referenceFDIs = [47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37];
    const pointsMap = new Map<number, THREE.Vector3>();

    // 提取每颗牙齿的中心点（使用原始坐标，不缩放）- 只从下颌牙齿中提取
    referenceFDIs.forEach(fdi => {
      const toothPoints = lowerTeethPoints.filter(p => p.fdi === fdi);
      if (toothPoints.length > 0) {
        // 计算中心点，使用原始坐标（与点位渲染保持一致）
        const sum = toothPoints.reduce(
          (acc, p) => {
            const pointCoords = typeof p.point === 'string' ? JSON.parse(p.point) : p.point;
            acc.x += pointCoords[0] || 0;
            acc.y += pointCoords[1] || 0;
            acc.z += pointCoords[2] || 0;
            return acc;
          },
          { x: 0, y: 0, z: 0 },
        );

        const center = new THREE.Vector3(
          sum.x / toothPoints.length,
          sum.y / toothPoints.length,
          sum.z / toothPoints.length,
        );

        pointsMap.set(fdi, center);
      }
    });

    if (pointsMap.size < 3) {
      console.warn('Spee曲线：找不到足够的参考牙位点，需要至少3个点');
      return;
    }
    this.renderCustomPlaneAndLines(teethPoints);
  }
  /**
   * 渲染基于特定牙位的平面和连线
   * 31和41的Z轴平均值与47和37的Z轴平均值形成平面
   * 37-31连线，47-41连线
   */
  /**
   * 渲染基于特定牙位的平面和连线
   */
  private renderCustomPlaneAndLines(teethPoints: AnalysisData['teeth_points']): void {
    // 只处理下颌牙齿
    const lowerTeethPoints = teethPoints.filter(p => p.fdi >= 31 && p.fdi <= 48);

    if (lowerTeethPoints.length === 0) {
      console.warn('⚠️ 未找到下颌牙齿点位');
      return;
    }

    // 目标牙位：31, 41, 37, 47, 36, 46
    const targetFDIs = [31, 41, 37, 47, 36, 46];
    const pointsMap = new Map<number, THREE.Vector3>();

    // 提取每颗牙齿的中心点
    targetFDIs.forEach(fdi => {
      const toothPoints = lowerTeethPoints.filter(p => p.fdi === fdi);
      if (toothPoints.length > 0) {
        // 计算中心点
        const sum = toothPoints.reduce(
          (acc, p) => {
            const pointCoords = typeof p.point === 'string' ? JSON.parse(p.point) : p.point;
            acc.x += pointCoords[0] || 0;
            acc.y += pointCoords[1] || 0;
            acc.z += pointCoords[2] || 0;
            return acc;
          },
          { x: 0, y: 0, z: 0 },
        );

        const center = new THREE.Vector3(
          sum.x / toothPoints.length,
          sum.y / toothPoints.length,
          sum.z / toothPoints.length,
        );

        pointsMap.set(fdi, center);
      }
    });

    // 检查是否找到所有必需的点位
    const requiredPoints = [31, 41, 37, 47, 36, 46];
    const missingPoints = requiredPoints.filter(fdi => !pointsMap.has(fdi));
    if (missingPoints.length > 0) {
      console.warn(`⚠️ 缺少牙位点位: ${missingPoints.join(', ')}`);
      return;
    }

    const point31 = pointsMap.get(31)!;
    const point41 = pointsMap.get(41)!;
    const point37 = pointsMap.get(37)!;
    const point47 = pointsMap.get(47)!;
    const point36 = pointsMap.get(36)!;
    const point46 = pointsMap.get(46)!;

    // 1. 渲染31和41的平均点位
    this.renderAveragePoint31_41(point31, point41);

    // 2. 根据31-41平均点位和47、37点位生成平面
    this.renderTrianglePlaneFrom3Points(point31, point41, point37, point47);

    // 3. 绘制连线：37-31 和 47-41
    this.renderConnectionLines(point37, point31, point47, point41);

    // 4. 渲染36和46垂直于平面的线
    this.renderPerpendicularLinesToPlane(point31, point37, point41, point47, point36, point46);
  }
  /**
   * 获取模型边界框
   */
  private getModelBounds(): { min: THREE.Vector3; max: THREE.Vector3 } | null {
    const lowerMesh = this.context.lowerMeshLabel;
    if (!lowerMesh) {
      console.warn('⚠️ 未找到下颌模型');
      return null;
    }

    // 计算模型的边界框
    const box = new THREE.Box3().setFromObject(lowerMesh);

    if (box.isEmpty()) {
      console.warn('⚠️ 模型边界框为空');
      return null;
    }

    return {
      min: box.min.clone(),
      max: box.max.clone(),
    };
  }

  /**
   * 渲染连线：37-31 和 47-41
   */
  private renderConnectionLines(
    point37: THREE.Vector3,
    point31: THREE.Vector3,
    point47: THREE.Vector3,
    point41: THREE.Vector3,
  ): void {
    const lowerMesh = this.context.lowerMeshLabel;

    // 37-31连线
    const line1Geometry = new THREE.BufferGeometry().setFromPoints([point37, point31]);
    const line1Material = new THREE.LineBasicMaterial({
      color: 0x00bfff, // 红色
      linewidth: 3,
    });
    const line1 = new THREE.Line(line1Geometry, line1Material);
    line1.name = `${this.taskName}_line_37_31`;

    // 47-41连线
    const line2Geometry = new THREE.BufferGeometry().setFromPoints([point47, point41]);
    const line2Material = new THREE.LineBasicMaterial({
      color: 0x00bfff, // 蓝色
      linewidth: 3,
    });
    const line2 = new THREE.Line(line2Geometry, line2Material);
    line2.name = `${this.taskName}_line_47_41`;

    // 添加到下颌模型
    if (lowerMesh) {
      lowerMesh.add(line1);
      lowerMesh.add(line2);
    } else {
      this.group.add(line1);
      this.group.add(line2);
      console.warn('⚠️ 未找到下颌mesh，连线添加到group');
    }
  }

  /**
   * 计算指定位置的Z坐标，确保后牙区域（47-37之间）保持水平
   */
  private calculateZAtPositionWithHorizontalBack(
    x: number,
    y: number,
    frontCenter: THREE.Vector3,
    backCenter: THREE.Vector3,
    point37: THREE.Vector3,
    point47: THREE.Vector3,
  ): number {
    // 定义前后方向的向量（从前中心到后中心）
    const frontToBackDirection = new THREE.Vector3()
      .subVectors(backCenter, frontCenter)
      .normalize();

    // 定义左右方向的向量（从37到47）
    const leftToRightDirection = new THREE.Vector3().subVectors(point47, point37).normalize();

    // 计算目标点相对于前中心的向量
    const targetVector = new THREE.Vector3(x - frontCenter.x, y - frontCenter.y, 0);

    // 计算目标点在前后方向上的投影
    const frontBackProjection = targetVector.dot(frontToBackDirection);

    // 计算前后中心点之间的距离
    const frontBackDistance = frontCenter.distanceTo(
      new THREE.Vector3(backCenter.x, backCenter.y, frontCenter.z),
    );

    // 计算前后插值比例（0=前中心，1=后中心）
    let frontBackRatio = 0;
    if (frontBackDistance > 0) {
      frontBackRatio = Math.max(0, Math.min(1, frontBackProjection / frontBackDistance));
    }

    // 在前后方向上插值Z坐标
    const interpolatedZ = frontCenter.z + (backCenter.z - frontCenter.z) * frontBackRatio;

    // 在后牙区域（接近backCenter的区域），Z值保持为backCenter.z
    // 在前牙区域，使用插值结果
    const backRegionThreshold = 0.7; // 当frontBackRatio > 0.7时认为是后牙区域

    if (frontBackRatio > backRegionThreshold) {
      // 后牙区域：使用固定的后牙Z值，不受左右位置影响
      return backCenter.z;
    } else {
      // 前牙和中间区域：使用插值结果
      return interpolatedZ;
    }
  }
  /**
   * 渲染31和41的平均点位标记
   */
  private renderAveragePoint31_41(point31: THREE.Vector3, point41: THREE.Vector3): void {
    // 计算31和41的XYZ平均值
    const averagePoint = new THREE.Vector3(
      (point31.x + point41.x) / 2,
      (point31.y + point41.y) / 2,
      (point31.z + point41.z) / 2,
    );

    // 创建球体几何体作为点位标记
    const geometry = new THREE.SphereGeometry(0.5, 16, 16);
    const material = new THREE.MeshPhongMaterial({
      color: 0xffff00, // 黄色
      emissive: 0x00ff00,
      emissiveIntensity: 0.4,
      transparent: true,
      opacity: 0.8,
    });

    const sphere = new THREE.Mesh(geometry, material);
    sphere.position.copy(averagePoint);
    sphere.name = `${this.taskName}_average_point_31_41`;

    // 添加到下颌模型
    const lowerMesh = this.context.lowerMeshLabel;
    if (lowerMesh) {
      lowerMesh.add(sphere);
      console.log('✅ 31和41平均点位标记已添加（绿色球体）');
    } else {
      this.group.add(sphere);
      console.warn('⚠️ 未找到下颌mesh，平均点位添加到group');
    }
  }
  /**
   * 根据31-41平均点位和47、37点位生成三角形平面
   */
  private renderTrianglePlaneFrom3Points(
    point31: THREE.Vector3,
    point41: THREE.Vector3,
    point37: THREE.Vector3,
    point47: THREE.Vector3,
  ): void {
    // 计算31和41的平均点
    const averagePoint31_41 = new THREE.Vector3(
      (point31.x + point41.x) / 2,
      (point31.y + point41.y) / 2,
      (point31.z + point41.z) / 2,
    );

    // 创建扩展平面
    this.createExtendedPlaneFromThreePoints(averagePoint31_41, point37, point47);
  }
  private createExtendedPlaneFromThreePoints(
    point1: THREE.Vector3,
    point2: THREE.Vector3,
    point3: THREE.Vector3,
  ): void {
    // 获取模型边界框
    const modelBounds = this.getModelBounds();
    if (!modelBounds) {
      console.warn('⚠️ 无法获取模型边界框');
      return;
    }

    // 计算平面的法向量
    const v1 = new THREE.Vector3().subVectors(point2, point1);
    const v2 = new THREE.Vector3().subVectors(point3, point1);
    const normal = new THREE.Vector3().crossVectors(v1, v2).normalize();

    // 计算平面方程: ax + by + cz + d = 0
    const d = -normal.dot(point1);

    // 创建覆盖整个模型的大平面
    const planeWidth = modelBounds.max.x - modelBounds.min.x;
    const planeHeight = modelBounds.max.y - modelBounds.min.y;
    const planeCenterX = (modelBounds.max.x + modelBounds.min.x) / 2;
    const planeCenterY = (modelBounds.max.y + modelBounds.min.y) / 2;

    // 创建平面的四个顶点，Z坐标根据平面方程计算
    const halfWidth = planeWidth / 2;
    const halfHeight = planeHeight / 2;

    const topLeftZ = this.calculateZFromPlaneEquation(
      planeCenterX - halfWidth,
      planeCenterY + halfHeight,
      normal,
      d,
    );
    const topRightZ = this.calculateZFromPlaneEquation(
      planeCenterX + halfWidth,
      planeCenterY + halfHeight,
      normal,
      d,
    );
    const bottomLeftZ = this.calculateZFromPlaneEquation(
      planeCenterX - halfWidth,
      planeCenterY - halfHeight,
      normal,
      d,
    );
    const bottomRightZ = this.calculateZFromPlaneEquation(
      planeCenterX + halfWidth,
      planeCenterY - halfHeight,
      normal,
      d,
    );

    // 创建扩展平面几何体
    const extendedGeometry = new THREE.BufferGeometry();

    const vertices = new Float32Array([
      // 第一个三角形
      planeCenterX - halfWidth,
      planeCenterY + halfHeight,
      topLeftZ,
      planeCenterX + halfWidth,
      planeCenterY + halfHeight,
      topRightZ,
      planeCenterX - halfWidth,
      planeCenterY - halfHeight,
      bottomLeftZ,

      // 第二个三角形
      planeCenterX + halfWidth,
      planeCenterY + halfHeight,
      topRightZ,
      planeCenterX + halfWidth,
      planeCenterY - halfHeight,
      bottomRightZ,
      planeCenterX - halfWidth,
      planeCenterY - halfHeight,
      bottomLeftZ,
    ]);

    const uvs = new Float32Array([0, 1, 1, 1, 0, 0, 1, 1, 1, 0, 0, 0]);

    extendedGeometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    extendedGeometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    extendedGeometry.computeVertexNormals();

    // 创建半透明材质
    const extendedMaterial = new THREE.MeshPhongMaterial({
      color: '#E7E7E7', // 白色
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const extendedMesh = new THREE.Mesh(extendedGeometry, extendedMaterial);
    extendedMesh.name = `${this.taskName}_extended_plane_from_three_points`;

    // 添加到下颌模型
    const lowerMesh = this.context.lowerMeshLabel;
    if (lowerMesh) {
      lowerMesh.add(extendedMesh);
    } else {
      this.group.add(extendedMesh);
    }
  }
  /**
   * 渲染36和46号牙位垂直于平面的线
   * 从36和46号牙位沿平面法向量方向绘制垂直线到平面
   */
  private renderPerpendicularLinesToPlane(
    point31: THREE.Vector3,
    point37: THREE.Vector3,
    point41: THREE.Vector3,
    point47: THREE.Vector3,
    point36: THREE.Vector3,
    point46: THREE.Vector3,
  ): void {
    // 计算平面（基于31-41平均点、37点、47点）
    const averagePoint31_41 = new THREE.Vector3(
      (point31.x + point41.x) / 2,
      (point31.y + point41.y) / 2,
      (point31.z + point41.z) / 2,
    );

    // 计算平面的法向量
    const v1 = new THREE.Vector3().subVectors(point37, averagePoint31_41);
    const v2 = new THREE.Vector3().subVectors(point47, averagePoint31_41);
    const planeNormal = new THREE.Vector3().crossVectors(v1, v2).normalize();

    // 计算平面方程: ax + by + cz + d = 0
    const d = -planeNormal.dot(averagePoint31_41);

    // 1. 计算36号牙位到平面的垂直投影
    const projectionPoint36 = this.calculatePointProjectionOnPlane(point36, planeNormal, d);
    this.renderPerpendicularLineToPlane(point36, projectionPoint36, '36垂直于平面', 0x00bfff); // 红色

    // 2. 计算46号牙位到平面的垂直投影
    const projectionPoint46 = this.calculatePointProjectionOnPlane(point46, planeNormal, d);
    this.renderPerpendicularLineToPlane(point46, projectionPoint46, '46垂直于平面', 0x00bfff); // 蓝色
  }

  /**
   * 计算点在平面上的垂直投影
   * @param point 要投影的点
   * @param planeNormal 平面法向量（已标准化）
   * @param d 平面方程常数项
   * @returns 投影点坐标
   */
  private calculatePointProjectionOnPlane(
    point: THREE.Vector3,
    planeNormal: THREE.Vector3,
    d: number,
  ): THREE.Vector3 {
    // 计算点到平面的距离
    // 距离公式: distance = (ax + by + cz + d) / sqrt(a² + b² + c²)
    // 由于法向量已标准化，分母为1
    const distanceToPlane =
      planeNormal.x * point.x + planeNormal.y * point.y + planeNormal.z * point.z + d;

    // 计算投影点：原点 - 距离 * 法向量
    const projectionPoint = point.clone().sub(planeNormal.clone().multiplyScalar(distanceToPlane));

    return projectionPoint;
  }

  /**
   * 渲染垂直于平面的线
   */
  private renderPerpendicularLineToPlane(
    startPoint: THREE.Vector3,
    endPoint: THREE.Vector3,
    lineName: string,
    color: number,
  ): void {
    // 创建线条几何体
    const lineGeometry = new THREE.BufferGeometry().setFromPoints([startPoint, endPoint]);
    const lineMaterial = new THREE.LineBasicMaterial({
      color: color,
      linewidth: 4, // 稍微粗一些以便区分
    });
    const line = new THREE.Line(lineGeometry, lineMaterial);
    line.name = `${this.taskName}_${lineName.replace(/\s+/g, '_')}`;

    // 添加到下颌模型
    const lowerMesh = this.context.lowerMeshLabel;
    if (lowerMesh) {
      lowerMesh.add(line);
    } else {
      this.group.add(line);
    }
  }
  /**
   * 根据平面方程计算指定XY坐标的Z值
   * 平面方程: ax + by + cz + d = 0
   * 解出: z = -(ax + by + d) / c
   */
  private calculateZFromPlaneEquation(
    x: number,
    y: number,
    normal: THREE.Vector3,
    d: number,
  ): number {
    if (Math.abs(normal.z) < 0.0001) {
      // 如果平面几乎垂直于Z轴，返回一个默认值
      console.warn('⚠️ 平面几乎垂直，使用默认Z值');
      return 0;
    }

    return -(normal.x * x + normal.y * y + d) / normal.z;
  }
  /**
   * 根据曲线深度获取颜色（字符串）
   */
  private getCurveColor(depth: number): string {
    const absDepth = Math.abs(depth);
    if (absDepth <= 1.5) return '#22c55e'; // 绿色 - 正常
    if (absDepth <= 3.0) return '#ff9800'; // 橙色 - 轻度
    return '#ff0000'; // 红色 - 明显
  }

  /**
   * 根据曲线深度获取颜色（数值）
   */
  private getCurveColorNum(depth: number): number {
    const absDepth = Math.abs(depth);
    if (absDepth <= 1.5) return 0x22c55e; // 绿色
    if (absDepth <= 3.0) return 0xff9800; // 橙色
    return 0xff0000; // 红色
  }

  /**
   * 评估曲线深度
   */
  private evaluateCurveDepth(depth: number): string {
    const absDepth = Math.abs(depth);
    if (absDepth <= 1.5) return '正常';
    if (absDepth <= 3.0) return '轻度加深';
    return '明显加深';
  }
}
