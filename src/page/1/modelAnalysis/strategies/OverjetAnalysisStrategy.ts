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

  /**
   * 重写点位渲染方法，根据上下颌显示不同颜色
   */
  protected renderPoints(teethPoints: import('../types').ToothPoint[]): void {
    const upperPoints = teethPoints.filter(p => this.isUpper(p.fdi));
    const lowerPoints = teethPoints.filter(p => this.isLower(p.fdi));
    // 1. 创建牙弓线（使用 teeth_points 数据）
    this.createArchWire();
    // 渲染上颌点位（#FEB5B5）
    this.createColoredPointMarkers(upperPoints, 0xfeb5b5);
    // 渲染下颌点位（#A49ED9）
    this.createColoredPointMarkers(lowerPoints, 0xa49ed9);
  }

  /**
   * 创建指定颜色的点位标记
   */
  private createColoredPointMarkers(points: import('../types').ToothPoint[], color: number): void {
    points.forEach(p => {
      // 创建球体作为点标记
      const geometry = new THREE.SphereGeometry(0.5, 16, 16);
      const material = new THREE.MeshPhongMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.3,
        depthTest: true, // 启用深度测试，使点位可以被遮挡
        depthWrite: true,
      });
      const sphere = new THREE.Mesh(geometry, material);

      // 设置位置（不应用缩放）
      sphere.position.set(p.point[0], p.point[1], p.point[2]);
      sphere.name = `overjet_point_${p.fdi}_${p.type}`;

      // 设置为可拖动，并保存完整的原始数据
      sphere.userData.draggable = true;
      sphere.userData.isOverbitePoint = true;
      sphere.userData.strategy = this;
      sphere.userData.fdi = p.fdi;
      sphere.userData.pointType = p.type;
      sphere.userData.pointTypeCn = p.type_cn;
      sphere.userData.originalPosition = sphere.position.clone();
      sphere.userData.originalToothPoint = p; // 保存完整的原始数据

      // 添加到对应的 mesh，点位会随模型的隐藏而隐藏
      this.addToMesh(sphere, p.fdi);
      this.draggablePoints.push(sphere);
    });
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
      const fdi = point.userData.fdi as number;
      const type = point.userData.pointType as string;
      const type_cn = point.userData.pointTypeCn as string;
      const originalPos = point.userData.originalPosition as THREE.Vector3;
      const currentPos = point.position;

      // 检查点位是否发生移动
      const hasMoved = !currentPos.equals(originalPos);

      return {
        fdi,
        type,
        type_cn,
        point: [currentPos.x, currentPos.y, currentPos.z] as [number, number, number],
      };
    });
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

    // 高亮显示关键的前牙切端点
    const anteriorTeeth = [11, 12, 13, 21, 22, 23, 31, 32, 33, 41, 42, 43];
    incisalPoints
      .filter(p => anteriorTeeth.includes(p.fdi))
      .forEach(p => {
        // 根据上下颌选择颜色：上颌 #FEB5B5，下颌 #A49ED9
        const isUpper = this.isUpper(p.fdi);
        const color = isUpper ? 0xfeb5b5 : 0xa49ed9;

        // 给前牙切端点添加标记，统一大小（使用 unscaled 位置）
        const geometry = new THREE.SphereGeometry(0.5, 16, 16);
        const material = new THREE.MeshPhongMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.5,
          transparent: true,
          opacity: 0.8,
          depthTest: true, // 启用深度测试，使点位可以被遮挡
          depthWrite: true,
        });
        const sphere = new THREE.Mesh(geometry, material);
        sphere.position.set(p.point[0], p.point[1], p.point[2]); // 不再应用缩放
        sphere.name = `highlight_${p.fdi}`;
        this.addToMesh(sphere, p.fdi); // 添加到对应的 mesh，点位会随模型隐藏而隐藏
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
