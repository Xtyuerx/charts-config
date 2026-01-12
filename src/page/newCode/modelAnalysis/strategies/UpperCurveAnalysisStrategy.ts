import * as THREE from 'three';
import type { AnalysisData, MeasurementGroup, RenderType, ToothPoint } from '../types';
import { LabelRenderer } from '../renderers';
import { BaseAnalysisStrategy } from './base/BaseAnalysisStrategy';

/**
 * 上颌补偿曲线分析策略
 * 分析上颌牙齿的补偿曲线
 * ⚠️ 只处理上颌牙齿，不处理下颌
 */
export class UpperCurveAnalysisStrategy extends BaseAnalysisStrategy {
  readonly id = 'upper-curve';
  readonly name = '上颌补偿曲线';
  readonly taskName = 'upper-curve';
  readonly renderType: RenderType = 'POINT_CURVE';
  // 存储可拖动的点位对象
  private draggablePoints: THREE.Mesh[] = [];

  /**
   * 渲染特定元素
   * 上颌补偿曲线分析：显示曲线、关键点和曲率
   * ⚠️ 只处理上颌牙齿，不处理下颌
   */
  protected renderSpecificElements(data: AnalysisData): void {
    const { teeth_points, measurements } = data;

    if (!teeth_points || teeth_points.length === 0) return;

    // ⚠️ 只过滤上颌牙齿（FDI 11-28），排除下颌牙齿（FDI 31-48）
    const upperTeethPoints = teeth_points;

    if (upperTeethPoints.length === 0) {
      console.warn('⚠️ 上颌补偿曲线：未找到上颌牙齿数据');
      this.renderCurveFromTeeth(upperTeethPoints, measurements);
      return;
    }

    // 渲染上颌补偿曲线（只使用上颌牙齿数据）
    this.renderUpperCurve(upperTeethPoints, measurements);
  }

  /**
   * 渲染测量标注
   */
  protected renderMeasurements(measurements: Record<string, unknown>): void {
    if (!measurements) return;

    const curvature = (measurements.curvature as number) || 0;
    const classification = (measurements.classification as string) || '正常';
    const diagnosis = (measurements.diagnosis as string) || '正常';

    // 创建统计信息面板
    const infoData = [
      { key: '曲线曲率', value: curvature.toFixed(3) },
      { key: '分类', value: classification },
      { key: '诊断结果', value: diagnosis },
    ];

    const infoPanel = LabelRenderer.createInfoPanel(infoData, {
      position: new THREE.Vector3(0, 30, 0),
      fontSize: 14,
      backgroundColor: this.getCurveColor(curvature),
      fontColor: '#ffffff',
    });

    // this.group.add(infoPanel);
  }

  /**
   * 格式化测量数据为面板展示格式
   */
  protected formatMeasurements(measurements: Record<string, unknown>): MeasurementGroup[] {
    const curvature = (measurements.curvature as number) || 0;
    const classification = (measurements.classification as string) || '正常';
    const diagnosis = (measurements.diagnosis as string) || '正常';
    const curvePoints = (measurements.curve_reference_teeth as number[]) || [];

    return [
      {
        groupName: '上颌补偿曲线分析',
        children: [
          {
            name: '曲线曲率',
            value: curvature.toFixed(3),
            result: this.evaluateCurveDepth(curvature),
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
   * 重写点位渲染 - 创建可拖拽的点位
   */
  protected renderPoints(teethPoints: ToothPoint[]): void {
    // 清空之前的可拖拽点位
    this.draggablePoints = [];

    // 只渲染上颌点位：11, 21, 17, 27, 16, 26 (对应下颌的 31, 41, 37, 47, 36, 46)
    const targetFDIs = [11, 21, 17, 27, 16, 26];
    const upperPoints = teethPoints.filter(p => targetFDIs.includes(p.fdi));

    upperPoints.forEach(p => {
      const color = 0xfeb5b5; // 上颌颜色

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

      // 添加到上颌 mesh
      this.addToMesh(draggableSphere, p.fdi);

      // 添加到可拖拽点位数组
      this.draggablePoints.push(draggableSphere);
    });

    console.log(`✅ 创建了 ${this.draggablePoints.length} 个可拖拽点位`);
  }

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
      isUpperCurvePoint: true, // 改为上颌标识
      fdi,
      type,
      type_cn,
      originalPoint: [...originalPoint], // 保存原始坐标
      strategy: this, // 添加这一行
    };

    return sphere;
  }

  /**
   * 处理点位拖拽时的更新
   * 当任何点位被拖拽时，重新计算并更新平面、连线等元素
   */
  public updateOnDrag(object: THREE.Object3D): void {
    if (!object.userData?.isUpperCurvePoint) return; // 改为上颌标识

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
   * 渲染基于特定牙位的平面和连线
   */
  private renderCustomPlaneAndLines(teethPoints: AnalysisData['teeth_points']): void {
    // 目标牙位：11, 21, 17, 27, 16, 26
    const targetFDIs = [11, 21, 17, 27, 16, 26];
    const pointsMap = new Map<number, THREE.Vector3>();

    // 直接从可拖拽点位获取当前位置
    this.draggablePoints.forEach(sphere => {
      const fdi = sphere.userData?.fdi as number;
      if (targetFDIs.includes(fdi)) {
        pointsMap.set(fdi, sphere.position.clone());
      }
    });

    // 如果可拖拽点位不足，则从传入的数据中补充
    if (pointsMap.size < targetFDIs.length) {
      const upperTeethPoints = teethPoints.filter(p => p.fdi >= 11 && p.fdi <= 28);

      targetFDIs.forEach(fdi => {
        if (!pointsMap.has(fdi)) {
          const toothPoints = upperTeethPoints.filter(p => p.fdi === fdi);
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
        }
      });
    }

    // 检查是否找到所有必需的点位
    const requiredPoints = [11, 21, 17, 27, 16, 26];
    const missingPoints = requiredPoints.filter(fdi => !pointsMap.has(fdi));
    if (missingPoints.length > 0) {
      console.warn(`⚠️ 缺少牙位点位: ${missingPoints.join(', ')}`);
      return;
    }

    const point11 = pointsMap.get(11)!;
    const point21 = pointsMap.get(21)!;
    const point17 = pointsMap.get(17)!;
    const point27 = pointsMap.get(27)!;
    const point16 = pointsMap.get(16)!;
    const point26 = pointsMap.get(26)!;

    // 1. 渲染11和21的平均点位
    this.renderAveragePoint11_21(point11, point21);

    // 2. 根据11-21平均点位和17、27点位生成平面
    this.renderTrianglePlaneFrom3Points(point11, point21, point17, point27);

    // 3. 绘制连线：17-11 和 27-21
    this.renderConnectionLines(point17, point11, point27, point21);

    // 4. 渲染16和26垂直于平面的线
    this.renderPerpendicularLinesToPlane(point11, point17, point21, point27, point16, point26);
  }

  /**
   * 渲染11和21的平均点位标记
   */
  private renderAveragePoint11_21(point11: THREE.Vector3, point21: THREE.Vector3): void {
    // 计算11和21的XYZ平均值
    const averagePoint = new THREE.Vector3(
      (point11.x + point21.x) / 2,
      (point11.y + point21.y) / 2,
      (point11.z + point21.z) / 2,
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
    sphere.name = `${this.taskName}_average_point_11_21`;

    // 添加到上颌模型
    const upperMesh = this.context.upperMeshLabel;
    if (upperMesh) {
      upperMesh.add(sphere);
      console.log('✅ 11和21平均点位标记已添加（绿色球体）');
    } else {
      this.group.add(sphere);
      console.warn('⚠️ 未找到上颌mesh，平均点位添加到group');
    }
  }

  /**
   * 渲染连线：17-11 和 27-21
   */
  private renderConnectionLines(
    point17: THREE.Vector3,
    point11: THREE.Vector3,
    point27: THREE.Vector3,
    point21: THREE.Vector3,
  ): void {
    const upperMesh = this.context.upperMeshLabel;

    // 17-11连线
    const line1Geometry = new THREE.BufferGeometry().setFromPoints([point17, point11]);
    const line1Material = new THREE.LineBasicMaterial({
      color: 0x00bfff, // 蓝色
      linewidth: 3,
    });
    const line1 = new THREE.Line(line1Geometry, line1Material);
    line1.name = `${this.taskName}_line_17_11`;

    // 27-21连线
    const line2Geometry = new THREE.BufferGeometry().setFromPoints([point27, point21]);
    const line2Material = new THREE.LineBasicMaterial({
      color: 0x00bfff, // 蓝色
      linewidth: 3,
    });
    const line2 = new THREE.Line(line2Geometry, line2Material);
    line2.name = `${this.taskName}_line_27_21`;

    // 添加到上颌模型
    if (upperMesh) {
      upperMesh.add(line1);
      upperMesh.add(line2);
    } else {
      this.group.add(line1);
      this.group.add(line2);
      console.warn('⚠️ 未找到上颌mesh，连线添加到group');
    }
  }

  /**
   * 渲染16和26号牙位垂直于平面的线
   * 从16和26号牙位沿平面法向量方向绘制垂直线到平面
   */
  private renderPerpendicularLinesToPlane(
    point11: THREE.Vector3,
    point17: THREE.Vector3,
    point21: THREE.Vector3,
    point27: THREE.Vector3,
    point16: THREE.Vector3,
    point26: THREE.Vector3,
  ): void {
    // 计算平面（基于11-21平均点、17点、27点）
    const averagePoint11_21 = new THREE.Vector3(
      (point11.x + point21.x) / 2,
      (point11.y + point21.y) / 2,
      (point11.z + point21.z) / 2,
    );

    // 计算平面的法向量
    const v1 = new THREE.Vector3().subVectors(point17, averagePoint11_21);
    const v2 = new THREE.Vector3().subVectors(point27, averagePoint11_21);
    const planeNormal = new THREE.Vector3().crossVectors(v1, v2).normalize();

    // 计算平面方程: ax + by + cz + d = 0
    const d = -planeNormal.dot(averagePoint11_21);

    // 1. 计算16号牙位到平面的垂直投影
    const projectionPoint16 = this.calculatePointProjectionOnPlane(point16, planeNormal, d);
    this.renderPerpendicularLineToPlane(point16, projectionPoint16, '16垂直于平面', 0x00bfff);

    // 2. 计算26号牙位到平面的垂直投影
    const projectionPoint26 = this.calculatePointProjectionOnPlane(point26, planeNormal, d);
    this.renderPerpendicularLineToPlane(point26, projectionPoint26, '26垂直于平面', 0x00bfff);
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

    // 添加到上颌模型
    const upperMesh = this.context.upperMeshLabel;
    if (upperMesh) {
      upperMesh.add(line);
    } else {
      this.group.add(line);
      console.warn('⚠️ 未找到上颌mesh，连线添加到group');
    }
  }

  /**
   * 根据11-21平均点位和17、27点位生成三角形平面
   */
  private renderTrianglePlaneFrom3Points(
    point11: THREE.Vector3,
    point21: THREE.Vector3,
    point17: THREE.Vector3,
    point27: THREE.Vector3,
  ): void {
    // 计算11和21的平均点
    const averagePoint11_21 = new THREE.Vector3(
      (point11.x + point21.x) / 2,
      (point11.y + point21.y) / 2,
      (point11.z + point21.z) / 2,
    );

    // 创建扩展平面
    this.createExtendedPlaneFromThreePoints(averagePoint11_21, point17, point27);
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
      color: 0x00bfff, // 蓝色
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const extendedMesh = new THREE.Mesh(extendedGeometry, extendedMaterial);
    extendedMesh.name = `${this.taskName}_extended_plane_from_three_points`;

    // 添加到上颌模型
    const upperMesh = this.context.upperMeshLabel;
    if (upperMesh) {
      upperMesh.add(extendedMesh);
    } else {
      this.group.add(extendedMesh);
    }
  }

  /**
   * 获取模型边界框
   */
  private getModelBounds(): { min: THREE.Vector3; max: THREE.Vector3 } | null {
    const upperMesh = this.context.upperMeshLabel;
    if (!upperMesh) {
      console.warn('⚠️ 未找到上颌模型');
      return null;
    }

    // 计算模型的边界框
    const box = new THREE.Box3().setFromObject(upperMesh);

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
   * 渲染UpperCurve曲线
   * ⚠️ 只处理上颌牙齿数据
   */
  private renderUpperCurve(
    teethPoints: AnalysisData['teeth_points'],
    measurements: Record<string, unknown> | undefined,
  ): void {
    if (!measurements) return;

    // ⚠️ 确保只使用上颌牙齿数据（FDI 11-28）
    const upperTeethPoints = teethPoints.filter(p => p.fdi >= 11 && p.fdi <= 28);

    if (upperTeethPoints.length === 0) {
      console.warn('⚠️ UpperCurve曲线：未找到上颌牙齿数据');
      return;
    }

    const curveData = measurements.curve_data as Array<number[]>;
    const curveDepth = (measurements.curve_depth_mm as number) || 0;

    if (!curveData || curveData.length === 0) {
      // 如果没有曲线数据，使用参考牙位生成曲线（只使用上颌数据）
      this.renderCurveFromTeeth(upperTeethPoints, measurements);
      return;
    }

    // 将曲线数据转换为Three.js坐标（保持缩放）
    const curvePoints = curveData.map(
      point => new THREE.Vector3(point[0] || 0, point[1] || 0, point[2] || 0),
    );

    console.log('🔵 UpperCurve - 曲线点数:', curvePoints.length);
    if (curvePoints.length < 2) {
      console.warn('⚠️ UpperCurve - 曲线点数不足，至少需要2个点');
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

    const curveMaterial = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.3,
      metalness: 0.6,
      depthTest: false, // 不进行深度测试，始终显示在前面
      transparent: true,
      opacity: 0.9,
    });

    const curveLine = new THREE.Mesh(tubeGeometry, curveMaterial);
    curveLine.renderOrder = 999; // 最后渲染，确保不被遮挡
    curveLine.name = `${this.taskName}_upper_curve`;

    // 添加到上颌模型
    const upperMesh = this.context.upperMeshLabel;
    if (upperMesh) {
      upperMesh.add(curveLine);
    } else {
      this.group.add(curveLine);
    }

    // 渲染最深点
    this.renderDeepestPoint(curvePoints, curveDepth);
  }

  /**
   * 从牙齿点位生成曲线
   * ⚠️ 只处理上颌牙齿，不处理下颌
   */
  private renderCurveFromTeeth(
    teethPoints: AnalysisData['teeth_points'],
    measurements: Record<string, unknown>,
  ): void {
    // ⚠️ 重要：只过滤上颌牙齿点位（FDI 11-28）
    const upperTeethPoints = teethPoints.filter(p => p.fdi >= 11 && p.fdi <= 28);

    if (upperTeethPoints.length === 0) {
      console.warn('⚠️ UpperCurve曲线：未找到上颌牙齿点位');
      return;
    }

    // 使用上颌所有牙位：17->16->15->14->13->12->11->21->22->23->24->25->26->27 (不连接17和27)
    const referenceFDIs = [17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27];
    const pointsMap = new Map<number, THREE.Vector3>();

    // 提取每颗牙齿的中心点（使用原始坐标，不缩放）- 只从上颌牙齿中提取
    referenceFDIs.forEach(fdi => {
      const toothPoints = upperTeethPoints.filter(p => p.fdi === fdi);
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
      console.warn('UpperCurve曲线：找不到足够的参考牙位点，需要至少3个点');
      return;
    }

    // 渲染平面和连线
    this.renderCustomPlaneAndLines(teethPoints);
  }

  /**
   * 渲染最深点
   * ⚠️ 添加到上颌模型，跟随上颌显示/隐藏
   */
  private renderDeepestPoint(curvePoints: THREE.Vector3[], depth: number): void {
    if (curvePoints.length === 0) return;

    // 找到Z坐标最大的点（上颌最深点，向上凸）
    const deepestPoint = curvePoints.reduce((highest, point) =>
      point.z > highest.z ? point : highest,
    );

    const upperMesh = this.context.upperMeshLabel;

    // 高亮最深点
    const geometry = new THREE.SphereGeometry(1.5, 16, 16);
    const material = new THREE.MeshPhongMaterial({
      color: 0xff0000,
      emissive: 0xff0000,
      emissiveIntensity: 0.4,
    });
    const deepestMarker = new THREE.Mesh(geometry, material);
    deepestMarker.position.copy(deepestPoint);
    deepestMarker.name = `${this.taskName}_deepest_point`;

    // ⚠️ 添加到上颌模型
    if (upperMesh) {
      upperMesh.add(deepestMarker);
    } else {
      this.group.add(deepestMarker);
    }

    // 添加深度标签
    const depthLabel = LabelRenderer.createLabel(`深度: ${depth.toFixed(2)}mm`, {
      position: deepestPoint.clone().add(new THREE.Vector3(0, 3, 0)),
      fontSize: 11,
      backgroundColor: '#ff0000',
      fontColor: '#ffffff',
    });
    depthLabel.name = `${this.taskName}_depth_label`;
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
