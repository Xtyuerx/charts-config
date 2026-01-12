import * as THREE from 'three';
import type { AnalysisData, MeasurementGroup, RenderType, ToothPoint } from '../types';
import { LineRenderer, LabelRenderer } from '../renderers';
import { BaseAnalysisStrategy } from './base/BaseAnalysisStrategy';

/**
 * Bolton分析策略
 * 分析上下颌牙齿宽度比例关系
 */
export class BoltonAnalysisStrategy extends BaseAnalysisStrategy {
  readonly id = 'bolton';
  readonly name = 'Bolton分析';
  readonly taskName = 'bolton';
  readonly renderType: RenderType = 'POINT_LINE';
  // 存储可拖动的点位对象
  private draggablePoints: THREE.Mesh[] = [];

  /**
   * 渲染特定元素
   * Bolton分析主要渲染：每颗牙齿的宽度测量线
   */
  protected renderSpecificElements(data: AnalysisData): void {
    const { teeth_points, measurements } = data;

    if (!teeth_points || teeth_points.length === 0) return;
    // 按牙齿分组
    const toothGroups = this.groupPointsByTooth(teeth_points);

    // 渲染每颗牙齿的宽度测量线
    Object.entries(toothGroups).forEach(([fdiStr, points]) => {
      const mesial = points.find(p => p.type === 'boundary_mesial');
      const distal = points.find(p => p.type === 'boundary_distal');

      if (mesial && distal) {
        const fdi = Number(fdiStr);

        // ⚠️ 重要：使用不缩放的线创建方法
        // 因为会添加到 mesh 上，mesh 已经有 scale = 1.5
        const color = this.isUpper(mesial.fdi) ? 0x00ff00 : 0x00bfff;
        const measureLine = this.createLineUnscaled(mesial.point, distal.point, color, 2);
        measureLine.name = `line_${fdiStr}`;
        measureLine.renderOrder = 1000;

        // 使用方案2：直接添加到 mesh
        this.addToMesh(measureLine, fdi);

        // 添加宽度数值标签
        const width = this.getToothWidth(measurements, fdiStr);
        if (width !== null) {
          // 使用不缩放的中点计算
          const midPoint = this.getMidPointUnscaled(mesial.point, distal.point);
          const label = this.createCompactLabel(`${width.toFixed(2)}mm`, midPoint);
          label.name = `label_${fdiStr}`;
          label.renderOrder = 1001;

          // 使用方案2：直接添加到 mesh
          this.addToMesh(label, fdi);
        }
      }
    });

    // 绘制上下颌总宽度对比线
    this.renderTotalWidthComparison(toothGroups, measurements);
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
   * 返回符合 ToothPoint 格式的数据，保持与初始格式完全一致
   */
  public getUpdatedPoints(): Array<import('../types').ToothPoint> {
    return this.draggablePoints.map(point => {
      const fdi = point.userData.fdi as number;
      const type = point.userData.pointType as string;
      const type_cn = point.userData.pointTypeCn as string;
      const originalPos = point.userData.originalPosition as THREE.Vector3;
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
   * 重写点位渲染 - 只渲染 boundary_mesial 和 boundary_distal 点
   */
  // 修改 renderPoints 方法，创建可拖拽的点位
  protected renderPoints(teethPoints: ToothPoint[]): void {
    // 只渲染边界点
    const boundaryPoints = teethPoints.filter(
      p => p.type === 'boundary_mesial' || p.type === 'boundary_distal',
    );

    // 渲染每个点，并添加到对应的 mesh
    boundaryPoints.forEach(p => {
      const color = this.getPointColor(p.type);

      // 创建可拖拽的球体作为点标记
      const sphere = this.createDraggablePointSphere(p, color);

      // 添加到可拖拽点位数组
      this.draggablePoints.push(sphere);

      // 使用方案2：添加到对应的 mesh
      this.addToMesh(sphere, p.fdi);
    });
  }

  // 创建可拖拽的点位球体
  private createDraggablePointSphere(toothPoint: ToothPoint, color: number): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(0.5, 16, 16);
    const material = new THREE.MeshPhongMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.3,
    });
    const sphere = new THREE.Mesh(geometry, material);

    // 设置位置
    sphere.position.set(toothPoint.point[0], toothPoint.point[1], toothPoint.point[2]);
    sphere.name = `point_${toothPoint.fdi}_${toothPoint.type}`;

    // 设置拖拽相关的 userData
    sphere.userData = {
      fdi: toothPoint.fdi,
      pointType: toothPoint.type,
      pointTypeCn: toothPoint.type_cn,
      originalPosition: sphere.position.clone(),
      originalPoint: toothPoint,
      isDraggable: true,
      isBoltonPoint: true,
      strategy: this, // 保存策略引用
      draggable: true,
    };

    return sphere;
  }
  // 添加更新连线和标签的方法
  public updateConnectionsAndLabels(): void {
    // 遍历所有可拖拽点位，按牙齿分组更新
    const toothGroups = this.groupDraggablePointsByTooth();

    Object.entries(toothGroups).forEach(([fdiStr, points]) => {
      const mesialPoint = points.find(p => p.userData.pointType === 'boundary_mesial');
      const distalPoint = points.find(p => p.userData.pointType === 'boundary_distal');

      if (mesialPoint && distalPoint) {
        this.updateToothMeasureLine(fdiStr, mesialPoint, distalPoint);
        this.updateToothLabel(fdiStr, mesialPoint, distalPoint);
      }
    });
  }

  // 按牙齿分组可拖拽点位
  private groupDraggablePointsByTooth(): Record<string, THREE.Mesh[]> {
    return this.draggablePoints.reduce((acc, point) => {
      const fdi = point.userData.fdi.toString();
      if (!acc[fdi]) {
        acc[fdi] = [];
      }
      acc[fdi].push(point);
      return acc;
    }, {} as Record<string, THREE.Mesh[]>);
  }

  // 更新牙齿测量线
  private updateToothMeasureLine(
    fdiStr: string,
    mesialPoint: THREE.Mesh,
    distalPoint: THREE.Mesh,
  ): void {
    // 🔥 使用正确的名称格式，包含 taskName 前缀
    const lineName = `${this.taskName}_line_${fdiStr}`;
    const fdi = Number(fdiStr);

    // 在对应的mesh中查找测量线
    const targetMesh = this.isUpper(fdi)
      ? this.context?.upperMeshLabel
      : this.context?.lowerMeshLabel;

    if (targetMesh) {
      let found = false;
      targetMesh.traverse(child => {
        if (child.name === lineName && child instanceof THREE.Line) {
          found = true;
          this.doUpdateMeasureLine(child, mesialPoint.position, distalPoint.position);
        }
      });
    }
  }

  // 执行测量线更新
  private doUpdateMeasureLine(
    measureLine: THREE.Line,
    startPos: THREE.Vector3,
    endPos: THREE.Vector3,
  ): void {
    if (!measureLine.geometry || !measureLine.geometry.attributes.position) {
      console.warn('⚠️ 测量线几何体或位置属性不存在');
      return;
    }

    const positions = measureLine.geometry.attributes.position;

    // 更新线条的两个端点
    positions.setXYZ(0, startPos.x, startPos.y, startPos.z);
    positions.setXYZ(1, endPos.x, endPos.y, endPos.z);
    positions.needsUpdate = true;

    // 重新计算边界框
    if (measureLine.geometry.boundingBox) {
      measureLine.geometry.computeBoundingBox();
    }
    if (measureLine.geometry.boundingSphere) {
      measureLine.geometry.computeBoundingSphere();
    }
  }

  // 更新牙齿标签
  private updateToothLabel(fdiStr: string, mesialPoint: THREE.Mesh, distalPoint: THREE.Mesh): void {
    // 🔥 使用正确的名称格式，包含 taskName 前缀
    const labelName = `${this.taskName}_label_${fdiStr}`;
    const fdi = Number(fdiStr);
    const targetMesh = this.isUpper(fdi)
      ? this.context?.upperMeshLabel
      : this.context?.lowerMeshLabel;

    if (targetMesh) {
      targetMesh.traverse(child => {
        if (child.name === labelName && child instanceof THREE.Sprite) {
          // 计算新的中点位置
          const midPoint = new THREE.Vector3();
          midPoint.lerpVectors(mesialPoint.position, distalPoint.position, 0.5);

          // 向上偏移，避开线条
          const labelPosition = midPoint.clone().add(new THREE.Vector3(0, 2, 0));
          child.position.copy(labelPosition);

          // 重新计算宽度并更新标签文字
          const newWidth = mesialPoint.position.distanceTo(distalPoint.position);
          this.updateLabelText(child, `${newWidth.toFixed(2)}mm`);
        }
      });
    }
  }

  // 更新标签文字
  private updateLabelText(sprite: THREE.Sprite, newText: string): void {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return;

    // 重新绘制标签（使用与createCompactLabel相同的样式）
    canvas.width = 256;
    canvas.height = 128;

    // 绘制背景
    context.fillStyle = 'rgba(0, 0, 0, 0.7)';
    context.roundRect(10, 30, 236, 68, 8);
    context.fill();

    // 绘制边框
    context.strokeStyle = '#60a5fa';
    context.lineWidth = 2;
    context.roundRect(10, 30, 236, 68, 8);
    context.stroke();

    // 绘制文字
    context.fillStyle = '#ffffff';
    context.font = 'bold 36px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(newText, 128, 64);

    // 更新纹理
    const texture = new THREE.CanvasTexture(canvas);
    if (sprite.material instanceof THREE.SpriteMaterial) {
      sprite.material.map = texture;
      sprite.material.needsUpdate = true;
    }
  }
  // 修改方法名从 onPointDragUpdate 到 updateOnDrag
  public updateOnDrag(object: THREE.Object3D): void {
    // 当任何点位被拖拽时，更新相关的连线和标签
    this.updateConnectionsAndLabels();
  }

  // 清理方法
  cleanup(): void {
    super.cleanup();
    this.draggablePoints = [];
  }

  /**
   * 渲染测量标注
   */
  protected renderMeasurements(measurements: Record<string, unknown>): void {
    if (!measurements) return;
  }

  /**
   * 格式化测量数据为面板展示格式
   */
  protected formatMeasurements(measurements: Record<string, unknown>): MeasurementGroup[] {}

  // ==================== 私有辅助方法 ====================

  /**
   * 创建紧凑的测量标签（参考牙间隙实现，但保持简洁样式）
   */
  private createCompactLabel(text: string, position: THREE.Vector3): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建canvas context');

    // 设置canvas尺寸
    canvas.width = 256;
    canvas.height = 128;

    // 绘制背景
    context.fillStyle = 'rgba(0, 0, 0, 0.7)';
    context.roundRect(10, 30, 236, 68, 8);
    context.fill();

    // 绘制边框
    context.strokeStyle = '#60a5fa';
    context.lineWidth = 2;
    context.roundRect(10, 30, 236, 68, 8);
    context.stroke();

    // 绘制文字
    context.fillStyle = '#ffffff';
    context.font = 'bold 36px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, 128, 64);

    // 创建纹理和精灵
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);

    sprite.position.copy(position);
    sprite.scale.set(5, 2.5, 1); // 使用与牙齿间隙相同的缩放
    sprite.renderOrder = 1000;

    return sprite;
  }

  /**
   * 按牙齿分组点位
   */
  private groupPointsByTooth(points: ToothPoint[]): Record<string, ToothPoint[]> {
    return points.reduce((acc, point) => {
      const fdi = point.fdi.toString();
      if (!acc[fdi]) {
        acc[fdi] = [];
      }
      acc[fdi].push(point);
      return acc;
    }, {} as Record<string, ToothPoint[]>);
  }

  /**
   * 获取牙齿宽度
   */
  private getToothWidth(measurements: Record<string, unknown>, fdi: string): number | null {
    const width = measurements.width as Record<string, number> | undefined;
    if (!width) return null;

    return width[fdi] || null;
  }

  /**
   * 渲染上下颌总宽度对比线
   */
  private renderTotalWidthComparison(
    toothGroups: Record<string, ToothPoint[]>,
    _measurements: Record<string, unknown>,
  ): void {
    // 获取上颌所有牙齿的边界点
    const upperTeeth = Object.entries(toothGroups).filter(([fdi]) => this.isUpper(Number(fdi)));

    if (upperTeeth.length === 0) return;

    // 找到最左和最右的点
    let leftmost: number[] | null = null;
    let rightmost: number[] | null = null;

    upperTeeth.forEach(([, points]) => {
      points.forEach(p => {
        if (!leftmost || (leftmost[0] !== undefined && p.point[0] < leftmost[0])) {
          leftmost = p.point;
        }
        if (!rightmost || (rightmost[0] !== undefined && p.point[0] > rightmost[0])) {
          rightmost = p.point;
        }
      });
    });
  }
}
