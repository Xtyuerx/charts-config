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

  /**
   * 渲染特定元素
   * Spee曲线分析：显示曲线、关键点和深度
   * ⚠️ 只处理下颌牙齿，不处理上颌
   */
  protected renderSpecificElements(data: AnalysisData): void {
    const { teeth_points, measurements } = data;

    if (!teeth_points || teeth_points.length === 0) return;

    // ⚠️ 只过滤下颌牙齿（FDI 31-48），排除上颌牙齿（FDI 11-28）
    const lowerTeethPoints = teeth_points.filter(p => p.fdi >= 31 && p.fdi <= 48);

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
  protected renderPoints(teethPoints: ToothPoint[]): void {
    // 只渲染下颌点位
    const lowerPoints = teethPoints.filter(p => this.isLower(p.fdi));

    lowerPoints.forEach(p => {
      const color = this.getPointColor(p.type);

      // 解析 point（可能是字符串或数组）
      let pointCoords: number[];
      if (typeof p.point === 'string') {
        pointCoords = JSON.parse(p.point) as number[];
      } else {
        pointCoords = p.point;
      }

      // 创建球体作为点标记
      const geometry = new THREE.SphereGeometry(0.5, 16, 16);
      const material = new THREE.MeshPhongMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.3,
      });
      const sphere = new THREE.Mesh(geometry, material);

      // 不应用缩放，因为 mesh 本身已经有缩放了
      sphere.position.set(pointCoords[0] ?? 0, pointCoords[1] ?? 0, pointCoords[2] ?? 0);
      sphere.name = `${this.taskName}_point_${p.fdi}_${p.type}`;

      // 添加到下颌 mesh
      this.addToMesh(sphere, p.fdi);
    });
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

    // const curveMaterial = new THREE.MeshStandardMaterial({
    //   color,
    //   roughness: 0.3,
    //   metalness: 0.6,
    //   depthTest: false, // 不进行深度测试，始终显示在前面
    //   transparent: true,
    //   opacity: 0.9,
    // });

    // const curveLine = new THREE.Mesh(tubeGeometry, curveMaterial);
    // curveLine.renderOrder = 999; // 最后渲染，确保不被遮挡
    // curveLine.name = `${this.taskName}_spee_curve`;

    // 添加到下颌模型
    // const lowerMesh = this.context.lowerMeshLabel;
    // if (lowerMesh) {
    //   lowerMesh.add(curveLine);
    // } else {
    //   this.group.add(curveLine);
    // }

    // 渲染最深点
    // this.renderDeepestPoint(curvePoints, curveDepth);
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

    const curveDepth = (measurements.curve_depth_mm as number) || 0;

    // 1. 渲染贴合点位的白色透明平面（先画平面）
    this.renderFullLowerJawPlane(pointsMap, lowerTeethPoints);

    // 2. 渲染平滑曲线（曲线在平面上方，贴合所有点位）
    this.renderSpeeConnectionLine(pointsMap, referenceFDIs);

    // 3. 渲染关键点标记（只标记4个下颌关键点：37, 47, 31, 41）
    // const keyFDIs = [37, 47, 31, 41];
    // const keyPointsMap = new Map<number, THREE.Vector3>();
    // keyFDIs.forEach(fdi => {
    //   const point = pointsMap.get(fdi);
    //   if (point) keyPointsMap.set(fdi, point);
    // });
    // this.renderKeyPoints(keyPointsMap, keyFDIs);

    // // 4. 渲染最深点
    // const allPoints = Array.from(pointsMap.values());
    // this.renderDeepestPoint(allPoints, curveDepth);
  }

  /**
   * 渲染Spee曲线连接线
   * 连接下颌所有牙位：47->46->...->41->31->...->37 (不连接47和37，不闭合)
   * ⚠️ 添加到下颌模型，跟随下颌显示/隐藏
   */
  private renderSpeeConnectionLine(pointsMap: Map<number, THREE.Vector3>, fdis: number[]): void {
    // 按照指定顺序获取点位
    const orderedPoints: THREE.Vector3[] = [];

    fdis.forEach(fdi => {
      const point = pointsMap.get(fdi);
      if (point) {
        orderedPoints.push(point);
      }
    });

    if (orderedPoints.length < 2) return;

    // 绘制更平滑的曲线，确保完美贴合所有点位
    // 使用 chordal 类型和较小的 tension 值来更好地贴合点位
    const curve = new THREE.CatmullRomCurve3(orderedPoints, false, 'chordal', 0.3);
    const curveGeometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(200));
    const curveMaterial = new THREE.LineBasicMaterial({
      color: 0x00ff00, // 绿色线条
      linewidth: 3,
    });
    const curveLine = new THREE.Line(curveGeometry, curveMaterial);
    curveLine.name = `${this.taskName}_spee_curve_line`;

    // ⚠️ 添加到下颌模型，而不是group
    const lowerMesh = this.context.lowerMeshLabel;
    if (lowerMesh) {
      lowerMesh.add(curveLine);
      console.log('✅ Spee曲线已添加到下颌模型');
    } else {
      this.group.add(curveLine);
      console.warn('⚠️ 未找到下颌mesh，Spee曲线添加到group');
    }
  }

  /**
   * 渲染水平白色透明平面
   * 平面在 XY 平面上（在下颌 mesh 的局部坐标系中，Z轴垂直向上）
   * 铺满整个下颌，贴近所有牙齿点位
   */
  private renderFullLowerJawPlane(
    pointsMap: Map<number, THREE.Vector3>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    allTeethPoints: AnalysisData['teeth_points'],
  ): void {
    if (pointsMap.size < 3) return;

    // 获取所有点位
    const allPoints = Array.from(pointsMap.values());

    // 计算X、Y范围（在下颌mesh局部坐标系中，XY是水平面）
    const margin = 5;
    const minX = Math.min(...allPoints.map(p => p.x)) - margin;
    const maxX = Math.max(...allPoints.map(p => p.x)) + margin;
    const minY = Math.min(...allPoints.map(p => p.y)) - margin;
    const maxY = Math.max(...allPoints.map(p => p.y)) + margin;

    // Z坐标：使用所有点位的最大Z值（最靠近咬合面）
    const planeZ = Math.max(...allPoints.map(p => p.z));

    // 计算平面尺寸
    const planeWidth = maxX - minX;
    const planeHeight = maxY - minY;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    // 使用 PlaneGeometry 创建平面（默认在XY平面上）
    const planeGeometry = new THREE.PlaneGeometry(planeWidth, planeHeight, 50, 50);

    // 创建白色透明材质
    const planeMaterial = new THREE.MeshPhongMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const planeMesh = new THREE.Mesh(planeGeometry, planeMaterial);
    planeMesh.name = `${this.taskName}_spee_full_lower_plane`;

    // 设置平面位置（在XY平面上，Z坐标固定）
    planeMesh.position.set(centerX, centerY, planeZ);

    // 添加到下颌模型
    const lowerMesh = this.context.lowerMeshLabel;
    if (lowerMesh) {
      lowerMesh.add(planeMesh);
      console.log('✅ Spee水平平面已添加到下颌模型，位置:', planeMesh.position);
    } else {
      this.group.add(planeMesh);
      console.warn('⚠️ 未找到下颌mesh，Spee平面添加到分析group');
    }

    // 添加平面边框
    const edgePoints = [
      new THREE.Vector3(minX, minY, planeZ),
      new THREE.Vector3(maxX, minY, planeZ),
      new THREE.Vector3(maxX, maxY, planeZ),
      new THREE.Vector3(minX, maxY, planeZ),
      new THREE.Vector3(minX, minY, planeZ),
    ];

    const edgeGeometry = new THREE.BufferGeometry().setFromPoints(edgePoints);
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: 0xaaaaaa,
      linewidth: 2,
      transparent: true,
      opacity: 0.6,
    });
    const edgeLines = new THREE.Line(edgeGeometry, edgeMaterial);
    edgeLines.name = `${this.taskName}_spee_plane_border`;

    if (lowerMesh) {
      lowerMesh.add(edgeLines);
    } else {
      this.group.add(edgeLines);
    }
  }

  /**
   * 渲染关键点标记
   * ⚠️ 添加到下颌模型，跟随下颌显示/隐藏
   */
  private renderKeyPoints(pointsMap: Map<number, THREE.Vector3>, fdis: number[]): void {
    const lowerMesh = this.context.lowerMeshLabel;

    fdis.forEach(fdi => {
      const point = pointsMap.get(fdi);
      if (!point) return;

      // 创建球体标记
      const geometry = new THREE.SphereGeometry(0.8, 16, 16);
      const material = new THREE.MeshPhongMaterial({
        color: 0x0000ff, // 蓝色
        emissive: 0x0000ff,
        emissiveIntensity: 0.3,
      });
      const marker = new THREE.Mesh(geometry, material);
      marker.position.copy(point);
      marker.name = `${this.taskName}_spee_point_${fdi}`;

      // ⚠️ 添加到下颌模型
      if (lowerMesh) {
        lowerMesh.add(marker);
      } else {
        this.group.add(marker);
      }

      // 添加FDI标签
      const label = LabelRenderer.createLabel(`FDI ${fdi}`, {
        position: point.clone().add(new THREE.Vector3(0, 2, 0)),
        fontSize: 10,
        backgroundColor: '#0000ff',
        fontColor: '#ffffff',
      });
      label.name = `${this.taskName}_label_${fdi}`;

      // ⚠️ 标签也添加到下颌模型
      // if (lowerMesh) {
      //   lowerMesh.add(label);
      // } else {
      //   this.group.add(label);
      // }
    });

    if (lowerMesh) {
      console.log('✅ 关键点标记已添加到下颌模型');
    }
  }

  /**
   * 渲染最深点
   * ⚠️ 添加到下颌模型，跟随下颌显示/隐藏
   */
  private renderDeepestPoint(curvePoints: THREE.Vector3[], depth: number): void {
    if (curvePoints.length === 0) return;

    // 找到Y坐标最低的点（最深点）
    const deepestPoint = curvePoints.reduce((lowest, point) =>
      point.y < lowest.y ? point : lowest,
    );

    const lowerMesh = this.context.lowerMeshLabel;

    // 高亮最深点（使用缩放坐标创建球体）
    const geometry = new THREE.SphereGeometry(1.5, 16, 16);
    const material = new THREE.MeshPhongMaterial({
      color: 0xff0000,
      emissive: 0xff0000,
      emissiveIntensity: 0.4,
    });
    const deepestMarker = new THREE.Mesh(geometry, material);
    deepestMarker.position.copy(deepestPoint);
    deepestMarker.name = `${this.taskName}_deepest_point`;

    // ⚠️ 添加到下颌模型
    if (lowerMesh) {
      lowerMesh.add(deepestMarker);
    } else {
      this.group.add(deepestMarker);
    }

    // 添加深度标签
    const depthLabel = LabelRenderer.createLabel(`深度: ${depth.toFixed(2)}mm`, {
      position: deepestPoint.clone().add(new THREE.Vector3(0, -3, 0)),
      fontSize: 11,
      backgroundColor: '#ff0000',
      fontColor: '#ffffff',
    });
    depthLabel.name = `${this.taskName}_depth_label`;

    // ⚠️ 标签也添加到下颌模型
    // if (lowerMesh) {
    //   lowerMesh.add(depthLabel);
    //   console.log('✅ 最深点标记已添加到下颌模型');
    // } else {
    //   this.group.add(depthLabel);
    // }
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
