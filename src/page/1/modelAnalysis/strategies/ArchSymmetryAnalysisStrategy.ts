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

    // 渲染中线参考面
    // this.renderMidline(measurements);

    // 渲染牙齿点位（上下颌一起处理）
    this.renderTeethPoints(teeth_points);

    // 如果有对称性测量数据，额外渲染对称连线
    if (measurements) {
      const upperData = measurements.upper as Record<string, unknown>;
      const lowerData = measurements.lower as Record<string, unknown>;

      // if (upperData) {
      //   this.renderSymmetryPairs(teeth_points, upperData);
      // }
      // if (lowerData) {
      //   this.renderSymmetryPairs(teeth_points, lowerData);
      // }
    }
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

  // ==================== 私有辅助方法 ====================

  /**
   * 渲染中线参考面
   */
  private renderMidline(measurements: Record<string, unknown> | undefined): void {
    if (!measurements) return;

    // 创建中线平面（垂直于X轴）
    const midlinePlane = SliceRenderer.createMidlinePlane([0, -40, 0], [0, 40, 0], {
      color: 0x4caf50,
      opacity: 0.15,
      showBorder: true,
    });

    this.group.add(midlinePlane);

    // 添加中线标签
    const midlineLabel = LabelRenderer.createLabel('中线参考', {
      position: new THREE.Vector3(0, 35, 0),
      fontSize: 12,
      backgroundColor: '#4caf50',
      fontColor: '#ffffff',
    });
    // this.group.add(midlineLabel);
  }

  /**
   * 直接渲染所有牙齿点位
   * 根据FDI自动添加到对应的上下颌mesh
   * 上颌和下颌使用不同颜色
   */
  private renderTeethPoints(teethPoints: AnalysisData['teeth_points']): void {
    if (!teethPoints) return;

    console.log(`📊 开始渲染 ${teethPoints.length} 个点位`);

    // 上下颌点位颜色
    const upperColor = 0xfeb5b5; // 上颌：浅粉色 #FEB5B5
    const lowerColor = 0xa49ed9; // 下颌：浅紫色 #A49ED9

    let upperCount = 0;
    let lowerCount = 0;

    // 直接遍历所有点位
    teethPoints.forEach((point, index) => {
      const { fdi, point: coords } = point;
      const position = new THREE.Vector3(...coords);
      const isUpper = this.isUpper(fdi);

      // 根据上下颌选择颜色
      const pointColor = isUpper ? upperColor : lowerColor;

      console.log(
        `📍 点位 ${index}: FDI=${fdi} (${isUpper ? '上颌' : '下颌'}), 坐标=[${coords[0].toFixed(
          2,
        )}, ${coords[1].toFixed(2)}, ${coords[2].toFixed(2)}]`,
      );

      // 渲染点标记
      const marker = this.createPointMarkerUnscaled(position, pointColor, 0.8);
      marker.name = `point_${index}`;
      this.addToMesh(marker, fdi);

      if (isUpper) {
        upperCount++;
      } else {
        lowerCount++;
      }
    });

    console.log(`✅ 渲染完成: 上颌 ${upperCount} 个点位(粉色), 下颌 ${lowerCount} 个点位(紫色)`);
  }

  // ==================== 以下方法暂时不使用 ====================

  /**
   * 渲染对称点对连线（已禁用）
   */
  // private renderSymmetryPairs(
  //   teethPoints: AnalysisData['teeth_points'],
  //   jawData: Record<string, unknown>,
  // ): void {
  //   // 此方法已禁用
  // }

  /**
   * 创建不缩放的虚线
   */
  private createDashedLineUnscaled(
    start: THREE.Vector3,
    end: THREE.Vector3,
    color: number,
    lineWidth: number,
  ): THREE.Line {
    const points = [start, end];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);

    const material = new THREE.LineDashedMaterial({
      color,
      linewidth: lineWidth,
      dashSize: 1.0,
      gapSize: 0.5,
    });

    const line = new THREE.Line(geometry, material);
    line.computeLineDistances(); // 虚线必须调用
    line.name = 'dashed_line';

    return line;
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
      depthTest: true,
      depthWrite: true,
    });

    const sphere = new THREE.Mesh(geometry, material);
    sphere.position.copy(position);
    sphere.name = 'point_marker';

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
