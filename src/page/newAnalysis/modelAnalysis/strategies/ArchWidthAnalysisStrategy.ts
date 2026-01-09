import * as THREE from 'three';
import type { AnalysisData, MeasurementGroup, RenderType } from '../types';
import { LabelRenderer } from '../renderers';
import { BaseAnalysisStrategy } from './base/BaseAnalysisStrategy';

/**
 * 牙弓宽度分析策略
 * 测量上下颌的牙弓宽度
 */
export class ArchWidthAnalysisStrategy extends BaseAnalysisStrategy {
  readonly id = 'arch-width';
  readonly name = '牙弓宽度分析';
  readonly taskName = 'arch-width';
  readonly renderType: RenderType = 'POINT_LINE';
  // 存储可拖动的点位对象
  private draggablePoints: THREE.Mesh[] = [];

  /**
   * 重写点位渲染方法
   * 确保点位添加到对应的 mesh，而不是 group
   * 这样点位才能随模型的显示/隐藏自动同步
   */
  protected renderPoints(teethPoints: import('../types').ToothPoint[]): void {
    // 过滤出牙弓宽度分析需要的点位（13, 23, 16, 26, 33, 43, 36, 46）
    const targetFdis = [13, 23, 16, 26, 33, 43, 36, 46];
    const relevantPoints = teethPoints.filter(p => targetFdis.includes(p.fdi));

    // 为每个点位创建标记并添加到对应的 mesh
    relevantPoints.forEach(p => {
      const color = this.getPointColor(p.type);

      // 创建球体作为点标记（不缩放，因为会添加到 mesh）
      const geometry = new THREE.SphereGeometry(0.6, 16, 16);
      const material = new THREE.MeshPhongMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.3,
        transparent: true,
        opacity: 0.8,
      });
      const sphere = new THREE.Mesh(geometry, material);

      // 设置位置（不缩放，因为 mesh 本身已经有缩放了）
      sphere.position.set(p.point[0], p.point[1], p.point[2]);
      // 🔥 修正：使用 taskName 前缀
      sphere.name = `${this.taskName}_point_${p.fdi}_${p.type}`;

      // 设置拖拽相关的 userData
      sphere.userData = {
        fdi: p.fdi,
        type: p.type,
        type_cn: p.type_cn,
        originalPoint: [...p.point] as [number, number, number],
        isArchWidthPoint: true,
        strategy: this,
        draggable: true,
      };

      // 添加到可拖拽点位数组
      this.draggablePoints.push(sphere);

      // 添加到对应的 mesh（这样点位会随 mesh 显示/隐藏）
      this.addToMesh(sphere, p.fdi);
    });
  }
  /**
   * 处理点位拖拽时的更新
   * 当任何牙弓宽度点位被拖拽时，重新计算并更新连线和标签
   */
  public updateOnDrag(object: THREE.Object3D): void {
    if (!object.userData?.isArchWidthPoint) return;

    // 更新点位的原始坐标数据
    if (object instanceof THREE.Mesh && object.userData.originalPoint) {
      const newPosition = object.position.clone();
      object.userData.originalPoint = [newPosition.x, newPosition.y, newPosition.z];
    }

    // 重新渲染连线和标签
    this.updateConnectionsAndLabels();
  }

  /**
   * 更新所有连线和标签
   * 基于当前点位位置重新计算宽度并更新显示
   */
  private updateConnectionsAndLabels(): void {
    if (!this.data?.teeth_points) return;

    // 使用基类的清理方法，清理所有以 taskName 开头的对象（除了点位）
    this.cleanupLinesAndLabelsOnly();

    // 获取更新后的点位数据
    const updatedTeethPoints = this.getUpdatedTeethPoints();

    // 重新渲染连线和标签
    this.renderUpperArchWidth(updatedTeethPoints, this.data.measurements);
    this.renderLowerArchWidth(updatedTeethPoints, this.data.measurements);
  }
  /**
   * 只清理连线和标签，保留点位
   */
  private cleanupLinesAndLabelsOnly(): void {
    if (!this.context) return;

    const meshes = [
      this.context.upperMesh,
      this.context.lowerMesh,
      this.context.upperMeshLabel,
      this.context.lowerMeshLabel,
    ].filter(Boolean) as THREE.Mesh[];

    meshes.forEach(mesh => {
      // 收集需要删除的连线和标签（保留点位）
      const toRemove: THREE.Object3D[] = [];
      mesh.children.forEach(child => {
        if (
          child.name.startsWith(`${this.taskName}_line_`) ||
          child.name.startsWith(`${this.taskName}_width_label_`) ||
          child.name.startsWith(`${this.taskName}_tooth_label_`)
        ) {
          toRemove.push(child);
        }
      });

      // 删除并释放资源
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
   * 获取更新后的点位数据
   * 从可拖拽点位中获取最新的位置信息
   */
  private getUpdatedTeethPoints(): import('../types').ToothPoint[] {
    const updatedPoints: import('../types').ToothPoint[] = [];
    this.draggablePoints.forEach(sphere => {
      if (sphere.userData?.fdi && sphere.userData?.type) {
        // 🔥 使用当前实际位置，而不是 originalPoint
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
   * 获取移动后的点位数据
   * 返回符合 ToothPoint 格式的数据，保持与初始格式完全一致
   */
  public getUpdatedPoints(): Array<import('../types').ToothPoint> {
    return this.draggablePoints.map(point => {
      const fdi = point.userData.fdi as number;
      // 🔥 修正：使用正确的字段名
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
   * 清理现有的连线和标签
   * 移除之前创建的测量线和标签，准备重新渲染
   */
  private cleanupLinesAndLabels(): void {
    if (!this.context) return;

    const meshes = [
      this.context.upperMesh,
      this.context.lowerMesh,
      this.context.upperMeshLabel,
      this.context.lowerMeshLabel,
    ].filter(Boolean) as THREE.Mesh[];

    meshes.forEach(mesh => {
      // 收集需要删除的连线和标签（保留点位）
      const toRemove: THREE.Object3D[] = [];
      mesh.children.forEach(child => {
        if (
          child.name.startsWith('line_') ||
          child.name.startsWith('width_label_') ||
          child.name.startsWith('tooth_label_')
        ) {
          toRemove.push(child);
        }
      });

      // 删除并释放资源
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

  // 清理方法
  cleanup(): void {
    super.cleanup();
    this.draggablePoints = [];
  }
  /**
   * 渲染特定元素
   * 牙弓宽度分析：显示测量线和宽度值
   * 上颌：连接 13-23（前牙弓），16-26（后牙弓）
   * 下颌：连接 33-43（前牙弓），36-46（后牙弓）
   */
  protected renderSpecificElements(data: AnalysisData): void {
    const { teeth_points, measurements } = data;

    if (!teeth_points || teeth_points.length === 0) return;

    // 渲染上颌牙弓宽度（固定连接 13-23 和 16-26）
    this.renderUpperArchWidth(teeth_points, measurements);

    // 渲染下颌牙弓宽度（固定连接 33-43 和 36-46）
    this.renderLowerArchWidth(teeth_points, measurements);
  }
  /**
   * 获取所有可拖动对象
   * 供 SceneManager 注册拖拽控制使用
   */

  public getDraggableObjects(): THREE.Mesh[] {
    return this.draggablePoints;
  }
  /**
   * 渲染测量标注
   */
  protected renderMeasurements(measurements: Record<string, unknown>): void {
    if (!measurements) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const upperArch = measurements.upper_arch as Record<string, any> | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lowerArch = measurements.lower_arch as Record<string, any> | undefined;
    const diagnosis = (measurements.diagnosis as string) || '';
    const severity = (measurements.severity as string) || '';

    // 上颌信息面板
    if (upperArch) {
      const canineWidth = upperArch.canine_width_3_3?.width || 0;
      const molarWidth = upperArch.molar_width_6_6?.width || 0;

      LabelRenderer.createInfoPanel(
        [
          { key: '上颌尖牙宽度', value: `${canineWidth.toFixed(2)}mm` },
          { key: '上颌磨牙宽度', value: `${molarWidth.toFixed(2)}mm` },
        ],
        {
          position: new THREE.Vector3(-25, 30, 0),
          fontSize: 13,
          backgroundColor: '#1976d2',
          fontColor: '#ffffff',
        },
      );
      // this.group.add(upperPanel)
    }

    // 下颌信息面板
    if (lowerArch) {
      const canineWidth = lowerArch.canine_width_3_3?.width || 0;
      const molarWidth = lowerArch.molar_width_6_6?.width || 0;

      LabelRenderer.createInfoPanel(
        [
          { key: '下颌尖牙宽度', value: `${canineWidth.toFixed(2)}mm` },
          { key: '下颌磨牙宽度', value: `${molarWidth.toFixed(2)}mm` },
        ],
        {
          position: new THREE.Vector3(25, 30, 0),
          fontSize: 13,
          backgroundColor: '#1976d2',
          fontColor: '#ffffff',
        },
      );
      // this.group.add(lowerPanel)
    }

    // 诊断信息
    if (diagnosis || severity) {
      const diagnosisPanel = LabelRenderer.createLabel(`${diagnosis} - ${severity}`, {
        position: new THREE.Vector3(0, 40, 0),
        fontSize: 14,
        backgroundColor: diagnosis === '正常' ? '#22c55e' : '#ef4444',
        fontColor: '#ffffff',
      });
      // this.group.add(diagnosisPanel)
    }
  }

  /**
   * 格式化测量数据为面板展示格式
   */
  protected formatMeasurements(measurements: Record<string, unknown>): MeasurementGroup[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const upperArch = measurements.upper_arch as Record<string, any> | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lowerArch = measurements.lower_arch as Record<string, any> | undefined;
    const diagnosis = (measurements.diagnosis as string) || '未诊断';
    const severity = (measurements.severity as string) || '未知';

    const groups: MeasurementGroup[] = [];

    // 上颌牙弓宽度（固定牙位：13-23, 16-26）
    const upperCanineWidth = upperArch?.canine_width_3_3?.width as number | undefined;
    const upperMolarWidth = upperArch?.molar_width_6_6?.width as number | undefined;

    groups.push({
      groupName: '上颌牙弓宽度',
      children: [
        {
          name: '尖牙宽度 (13-23)',
          value: upperCanineWidth ? `${upperCanineWidth.toFixed(2)}mm` : '未测量',
          result: '前牙弓宽度',
        },
        {
          name: '磨牙宽度 (16-26)',
          value: upperMolarWidth ? `${upperMolarWidth.toFixed(2)}mm` : '未测量',
          result: '后牙弓宽度',
        },
      ],
    });

    // 下颌牙弓宽度（固定牙位：33-43, 36-46）
    const lowerCanineWidth = lowerArch?.canine_width_3_3?.width as number | undefined;
    const lowerMolarWidth = lowerArch?.molar_width_6_6?.width as number | undefined;

    groups.push({
      groupName: '下颌牙弓宽度',
      children: [
        {
          name: '尖牙宽度 (33-43)',
          value: lowerCanineWidth ? `${lowerCanineWidth.toFixed(2)}mm` : '未测量',
          result: '前牙弓宽度',
        },
        {
          name: '磨牙宽度 (36-46)',
          value: lowerMolarWidth ? `${lowerMolarWidth.toFixed(2)}mm` : '未测量',
          result: '后牙弓宽度',
        },
      ],
    });

    // 添加诊断结果组
    groups.push({
      groupName: '诊断结果',
      children: [
        {
          name: '诊断',
          value: diagnosis,
          result: diagnosis === '正常' ? '正常' : '异常',
        },
        {
          name: '严重程度',
          value: severity,
          result: severity === '正常' ? '正常' : severity,
        },
      ],
    });

    return groups;
  }

  // ==================== 私有辅助方法 ====================

  /**
   * 渲染上颌牙弓宽度
   * 固定连接：13-23（前牙弓），16-26（后牙弓）
   */
  private renderUpperArchWidth(
    teethPoints: AnalysisData['teeth_points'],
    measurements: Record<string, unknown> | undefined,
  ): void {
    // 尝试从不同的数据结构中获取宽度值
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const upperArch = measurements?.upper_arch as Record<string, any> | undefined;

    // 前牙弓宽度：13-23（尖牙）
    const anteriorWidth =
      (measurements?.anterior_width_mm as number) ||
      (upperArch?.canine_width_3_3?.width as number) ||
      this.calculateDistance(teethPoints, 13, 23);

    this.renderWidthLine(
      teethPoints,
      13, // 左上尖牙
      23, // 右上尖牙
      anteriorWidth,
      0x00ff00, // 绿色
      '前',
      true, // 上颌
    );

    // 后牙弓宽度：16-26（第一磨牙）
    const posteriorWidth =
      (measurements?.posterior_width_mm as number) ||
      (upperArch?.molar_width_6_6?.width as number) ||
      this.calculateDistance(teethPoints, 16, 26);

    this.renderWidthLine(
      teethPoints,
      16, // 左上第一磨牙
      26, // 右上第一磨牙
      posteriorWidth,
      0xff9800, // 橙色
      '后',
      true, // 上颌
    );
  }

  /**
   * 渲染下颌牙弓宽度
   * 固定连接：33-43（前牙弓），36-46（后牙弓）
   */
  private renderLowerArchWidth(
    teethPoints: AnalysisData['teeth_points'],
    measurements: Record<string, unknown> | undefined,
  ): void {
    // 尝试从不同的数据结构中获取宽度值
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lowerArch = measurements?.lower_arch as Record<string, any> | undefined;

    // 前牙弓宽度：33-43（尖牙）
    const anteriorWidth =
      (measurements?.anterior_width_mm as number) ||
      (lowerArch?.canine_width_3_3?.width as number) ||
      this.calculateDistance(teethPoints, 43, 33);

    this.renderWidthLine(
      teethPoints,
      43, // 左下尖牙
      33, // 右下尖牙
      anteriorWidth,
      0x00bfff, // 天蓝色
      '前',
      false, // 下颌
    );

    // 后牙弓宽度：36-46（第一磨牙）
    const posteriorWidth =
      (measurements?.posterior_width_mm as number) ||
      (lowerArch?.molar_width_6_6?.width as number) ||
      this.calculateDistance(teethPoints, 46, 36);

    this.renderWidthLine(
      teethPoints,
      46, // 左下第一磨牙
      36, // 右下第一磨牙
      posteriorWidth,
      0xffa500, // 橙黄色
      '后',
      false, // 下颌
    );
  }

  /**
   * 计算两颗牙齿之间的距离
   */
  private calculateDistance(
    teethPoints: AnalysisData['teeth_points'],
    fdi1: number,
    fdi2: number,
  ): number {
    const tooth1Points = teethPoints.filter(p => p.fdi === fdi1);
    const tooth2Points = teethPoints.filter(p => p.fdi === fdi2);

    if (tooth1Points.length === 0 || tooth2Points.length === 0) {
      return 0;
    }

    const center1 = this.calculatePointsCenterUnscaled(tooth1Points.map(p => p.point));
    const center2 = this.calculatePointsCenterUnscaled(tooth2Points.map(p => p.point));

    return center1.distanceTo(center2);
  }

  /**
   * 创建牙位标签（小巧的数字标签）
   */
  private createToothLabel(text: string, position: THREE.Vector3): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建canvas context');

    canvas.width = 128;
    canvas.height = 128;

    // 较小的字体
    const fontSize = 70;
    context.font = `bold ${fontSize}px Arial`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    // 绘制半透明背景
    const padding = 12;
    context.fillStyle = 'rgba(0, 0, 0, 0.7)';
    context.beginPath();
    context.arc(canvas.width / 2, canvas.height / 2, fontSize / 2 + padding, 0, Math.PI * 2);
    context.fill();

    // 绘制文字
    context.fillStyle = '#ffffff';
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
    sprite.scale.set(1.5, 1.5, 1); // 较小的缩放

    sprite.userData = { text };
    return sprite;
  }

  /**
   * 创建宽度标签（使用更大的 canvas 确保文本完整显示）
   */
  /**
   * 创建宽度标签（使用更大的尺寸）
   */
  private createWidthLabel(
    text: string,
    position: THREE.Vector3,
    backgroundColor?: string, // 保留参数兼容性
  ): THREE.Sprite {
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
   * 渲染宽度测量线
   * @param teethPoints 所有牙齿点位
   * @param fdi1 第一颗牙齿的FDI编号
   * @param fdi2 第二颗牙齿的FDI编号
   * @param width 宽度值（毫米）
   * @param color 线条颜色
   * @param label 标签文字（前/后）
   * @param isUpper 是否为上颌
   */
  private renderWidthLine(
    teethPoints: AnalysisData['teeth_points'],
    fdi1: number,
    fdi2: number,
    width: number,
    color: number,
    label: string,
    isUpper: boolean,
  ): void {
    // 找到两颗牙齿的点
    const tooth1Points = teethPoints.filter(p => p.fdi === fdi1);
    const tooth2Points = teethPoints.filter(p => p.fdi === fdi2);

    if (tooth1Points.length === 0 || tooth2Points.length === 0) {
      console.warn(`⚠️ 未找到牙齿点位: ${fdi1} 或 ${fdi2}`);
      return;
    }

    // 计算牙齿中心点（不缩放，因为会添加到 mesh）
    const center1 = this.calculatePointsCenterUnscaled(tooth1Points.map(p => p.point));
    const center2 = this.calculatePointsCenterUnscaled(tooth2Points.map(p => p.point));

    // 注意：点位标记已经在 renderPoints 方法中创建，这里只创建连接线

    // 创建测量线（使用 taskName 前缀）
    const line = this.createLineUnscaled(center1, center2, color, 3);
    line.name = `${this.taskName}_line_${fdi1}_${fdi2}`;

    // 根据颌位添加到对应的 mesh
    this.addLineToMesh(line, fdi1, fdi2);

    // 渲染宽度标签（使用 taskName 前缀）
    const midPoint = new THREE.Vector3().addVectors(center1, center2).multiplyScalar(0.5);
    const jawLabel = isUpper ? '上' : '下';
    const widthLabel = this.createWidthLabel(
      `${jawLabel}${label}: ${width.toFixed(1)}mm`,
      midPoint.clone().add(new THREE.Vector3(0, isUpper ? 3 : -3, 0)),
      `#${color.toString(16).padStart(6, '0')}`,
    );
    widthLabel.name = `${this.taskName}_width_label_${fdi1}_${fdi2}`;

    // 添加到对应的 mesh
    this.addLineToMesh(widthLabel, fdi1, fdi2);

    // 渲染牙位标签（使用 taskName 前缀）
    const tooth1Label = this.createToothLabel(
      fdi1.toString(),
      center1.clone().add(new THREE.Vector3(0, isUpper ? -2 : 2, 0)),
    );
    tooth1Label.name = `${this.taskName}_tooth_label_${fdi1}`;

    const tooth2Label = this.createToothLabel(
      fdi2.toString(),
      center2.clone().add(new THREE.Vector3(0, isUpper ? -2 : 2, 0)),
    );
    tooth2Label.name = `${this.taskName}_tooth_label_${fdi2}`;

    // 添加到对应的 mesh
    this.addToMesh(tooth1Label, fdi1);
    this.addToMesh(tooth2Label, fdi2);
  }
}
