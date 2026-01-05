import * as THREE from 'three';
import type { AnalysisData, MeasurementGroup, RenderType } from '../types';
import { LabelRenderer } from '../renderers';
import { BaseAnalysisStrategy } from './base/BaseAnalysisStrategy';

/**
 * 咬合关系分析策略
 * 分析尖牙关系和磨牙关系
 */
export class OcclusionAnalysisStrategy extends BaseAnalysisStrategy {
  readonly id = 'occlusion';
  readonly name = '咬合关系';
  readonly taskName = 'occlusal-relationship';
  readonly renderType: RenderType = 'POINT_SLICE';

  /**
   * 渲染特定元素
   * 咬合关系分析：显示尖牙和磨牙的咬合关系
   */
  protected renderSpecificElements(data: AnalysisData): void {
    console.log('🚀 咬合关系 - renderSpecificElements 被调用');
    const { teeth_points, measurements } = data;

    console.log('📊 咬合关系 - teeth_points数量:', teeth_points?.length);
    console.log('📊 咬合关系 - measurements:', measurements);

    if (!teeth_points || teeth_points.length === 0) {
      console.warn('⚠️ 咬合关系 - 没有牙齿点位数据');
      return;
    }

    if (!measurements) {
      console.warn('⚠️ 咬合关系 - 没有测量数据');
      return;
    }
    // 1. 创建牙弓线（使用 teeth_points 数据）
    this.createArchWire();

    // 从teeth_points中提取尖牙和磨牙的FDI
    const canineTeeth = this.extractTeethByType(teeth_points, [
      'midpoint_canine_premolar',
      'canine_cusp',
    ]);
    const molarTeeth = this.extractTeethByType(teeth_points, ['cusp_mb', 'mesial_buccal_groove']);

    console.log('🦷 提取的尖牙:', canineTeeth);
    console.log('🦷 提取的磨牙:', molarTeeth);

    // 渲染左侧关系
    const leftSide = measurements.left_side as Record<string, unknown>;
    if (leftSide) {
      console.log('📍 渲染左侧咬合关系');
      this.renderSideOcclusion(
        teeth_points,
        canineTeeth.left,
        leftSide.canine_relationship as string,
        '尖牙',
        -15,
      );
      this.renderSideOcclusion(
        teeth_points,
        molarTeeth.left,
        leftSide.molar_relationship as string,
        '磨牙',
        -15,
      );
    }

    // 渲染右侧关系
    const rightSide = measurements.right_side as Record<string, unknown>;
    if (rightSide) {
      console.log('📍 渲染右侧咬合关系');
      this.renderSideOcclusion(
        teeth_points,
        canineTeeth.right,
        rightSide.canine_relationship as string,
        '尖牙',
        15,
      );
      this.renderSideOcclusion(
        teeth_points,
        molarTeeth.right,
        rightSide.molar_relationship as string,
        '磨牙',
        15,
      );
    }

    console.log('✅ 咬合关系 - renderSpecificElements 完成');
  }

  /**
   * 渲染测量标注
   */
  protected renderMeasurements(measurements: Record<string, unknown>): void {
    if (!measurements) return;

    const leftSide = measurements.left_side as Record<string, unknown>;
    const rightSide = measurements.right_side as Record<string, unknown>;

    // 左侧关系信息面板
    if (leftSide) {
      const canineRel = (leftSide.canine_relationship as string) || '未知';
      const molarRel = (leftSide.molar_relationship as string) || '未知';

      const leftPanel = LabelRenderer.createInfoPanel(
        [
          { key: '左侧咬合关系', value: '' },
          { key: '尖牙', value: canineRel },
          { key: '磨牙', value: molarRel },
        ],
        {
          position: new THREE.Vector3(-25, 30, 0),
          fontSize: 13,
          backgroundColor: this.getClassificationColor(canineRel),
          fontColor: '#ffffff',
        },
      );
      // this.group.add(leftPanel)
    }

    // 右侧关系信息面板
    if (rightSide) {
      const canineRel = (rightSide.canine_relationship as string) || '未知';
      const molarRel = (rightSide.molar_relationship as string) || '未知';

      const rightPanel = LabelRenderer.createInfoPanel(
        [
          { key: '右侧咬合关系', value: '' },
          { key: '尖牙', value: canineRel },
          { key: '磨牙', value: molarRel },
        ],
        {
          position: new THREE.Vector3(25, 30, 0),
          fontSize: 13,
          backgroundColor: this.getClassificationColor(canineRel),
          fontColor: '#ffffff',
        },
      );
      // this.group.add(rightPanel)
    }
  }

  /**
   * 格式化测量数据为面板展示格式
   */
  protected formatMeasurements(measurements: Record<string, unknown>): MeasurementGroup[] {
    const leftSide = measurements.left_side as Record<string, unknown>;
    const rightSide = measurements.right_side as Record<string, unknown>;

    const groups: MeasurementGroup[] = [];

    // 左侧咬合关系
    if (leftSide) {
      const canineRel = (leftSide.canine_relationship as string) || '未知';
      const molarRel = (leftSide.molar_relationship as string) || '未知';

      groups.push({
        groupName: '左侧咬合关系',
        children: [
          {
            name: '尖牙关系',
            value: canineRel,
            result: this.evaluateClassification(canineRel),
          },
          {
            name: '磨牙关系',
            value: molarRel,
            result: this.evaluateClassification(molarRel),
          },
        ],
      });
    }

    // 右侧咬合关系
    if (rightSide) {
      const canineRel = (rightSide.canine_relationship as string) || '未知';
      const molarRel = (rightSide.molar_relationship as string) || '未知';

      groups.push({
        groupName: '右侧咬合关系',
        children: [
          {
            name: '尖牙关系',
            value: canineRel,
            result: this.evaluateClassification(canineRel),
          },
          {
            name: '磨牙关系',
            value: molarRel,
            result: this.evaluateClassification(molarRel),
          },
        ],
      });
    }

    return groups;
  }

  // ==================== 私有辅助方法 ====================

  /**
   * 从teeth_points中提取特定类型的牙齿
   * @param teethPoints 所有牙齿点位
   * @param types 点位类型（字符串或字符串数组）
   * @returns 左右侧的牙齿FDI号码
   */
  private extractTeethByType(
    teethPoints: AnalysisData['teeth_points'],
    types: string | string[],
  ): { left: number[]; right: number[] } {
    const typeArray = Array.isArray(types) ? types : [types];
    const fdis = new Set<number>();

    // 提取所有符合类型的牙齿FDI
    teethPoints.forEach(point => {
      if (typeArray.includes(point.type)) {
        fdis.add(point.fdi);
      }
    });

    // 按左右侧分组
    const left: number[] = [];
    const right: number[] = [];

    fdis.forEach(fdi => {
      // FDI编码规则：13, 23 (上尖牙), 33, 43 (下尖牙)
      // 第二位数字：1-3为右侧，4-6为左侧（从医生角度看）
      // 实际上：x3为右侧尖牙，x3为左侧尖牙
      const secondDigit = fdi % 10;
      if (secondDigit >= 4 && secondDigit <= 8) {
        // 左侧（医生视角）：x4-x8
        left.push(fdi);
      } else {
        // 右侧（医生视角）：x1-x3
        right.push(fdi);
      }
    });

    return { left, right };
  }

  /**
   * 渲染单侧咬合关系
   */
  private renderSideOcclusion(
    teethPoints: AnalysisData['teeth_points'],
    teeth: number[] | undefined,
    relationship: string | undefined,
    type: string,
    xOffset: number,
  ): void {
    console.log(`🎯 renderSideOcclusion - 类型: ${type}, 牙位:`, teeth, '关系:', relationship);

    if (!teeth || teeth.length === 0 || !relationship) {
      console.warn(`⚠️ ${type} - 数据不完整，跳过渲染`);
      return;
    }

    // 根据关系类型获取颜色
    const color = this.getRelationshipColor(relationship);
    console.log(`🎨 ${type} - 关系: ${relationship}, 颜色代码:`, color.toString(16));

    // 为每颗牙齿渲染标记和切面
    teeth.forEach(fdi => {
      const toothPoints = teethPoints.filter(p => p.fdi === fdi);
      if (toothPoints.length === 0) return;

      const center = this.calculatePointsCenterUnscaled(toothPoints.map(p => p.point));

      // 创建标记球体（使用 unscaled 位置）
      const geometry = new THREE.SphereGeometry(1.2, 32, 32);
      const material = new THREE.MeshPhongMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.5,
        transparent: true,
        opacity: 0.8,
      });
      const sphere = new THREE.Mesh(geometry, material);
      sphere.position.copy(center);
      sphere.name = `occlusion_${fdi}`;

      console.log(`🔵 咬合关系 - 牙位 ${fdi}, 球体位置:`, center);
      // this.addToMesh(sphere, fdi); // 添加到对应的 mesh

      // 添加牙位标签
      const toothLabel = LabelRenderer.createLabel(fdi.toString(), {
        position: center.clone().add(new THREE.Vector3(0, 2, 0)),
        fontSize: 10,
        backgroundColor: '#00000099',
        fontColor: '#ffffff',
      });
      toothLabel.name = `tooth_label_${fdi}`;
      // this.addToMesh(toothLabel, fdi); // 添加到对应的 mesh

      // 创建垂直切面（垂直于牙弓方向）
      const sliceGroup = this.createOcclusionSlice(center, fdi, color);

      // 检查mesh是否存在
      const isUpper = this.isUpper(fdi);
      const targetMesh = isUpper ? this.context.upperMeshLabel : this.context.lowerMeshLabel;
      console.log(
        `📐 咬合关系 - 牙位 ${fdi} (${isUpper ? '上颌' : '下颌'}), 切面位置:`,
        center,
        'targetMesh存在:',
        !!targetMesh,
      );

      this.addToMesh(sliceGroup, fdi); // 切面组（包含平面和边框）添加到对应的 mesh

      // 恢复切片的深度测试，使其能被模型遮挡
      this.enableDepthTestForSlice(sliceGroup);
    });

    // 如果有多颗牙齿，连接它们
    if (teeth.length > 1) {
      const centersWithFdi = teeth
        .map(fdi => {
          const toothPoints = teethPoints.filter(p => p.fdi === fdi);
          if (toothPoints.length === 0) return null;
          return {
            fdi,
            center: this.calculatePointsCenterUnscaled(toothPoints.map(p => p.point)),
          };
        })
        .filter((c): c is { fdi: number; center: THREE.Vector3 } => c !== null);

      for (let i = 0; i < centersWithFdi.length - 1; i++) {
        const start = centersWithFdi[i];
        const end = centersWithFdi[i + 1];

        if (!start || !end) continue; // 安全检查

        // 创建虚线（使用 unscaled 坐标）
        // const line = this.createDashedLineUnscaled(start.center, end.center, color, 2);
        // line.name = `occlusion_line_${start.fdi}_${end.fdi}`;
        // console.log(`➖ 咬合关系 - 虚线连接: ${start.fdi} -> ${end.fdi}`);
        // this.addLineToMesh(line, start.fdi, end.fdi); // 智能添加
      }
    }

    // 添加关系标签
    // if (teeth.length === 0) return; // 安全检查
    // const firstToothFdi = teeth[0];
    // if (firstToothFdi === undefined) return; // 安全检查

    // const firstTooth = teethPoints.filter(p => p.fdi === firstToothFdi);
    // if (firstTooth.length > 0) {
    //   const center = this.calculatePointsCenterUnscaled(firstTooth.map(p => p.point));
    //   const relationLabel = LabelRenderer.createLabel(`${type}: ${relationship}`, {
    //     position: center.clone().add(new THREE.Vector3(xOffset, 5, 0)),
    //     fontSize: 12,
    //     backgroundColor: `#${color.toString(16).padStart(6, '0')}`,
    //     fontColor: '#ffffff',
    //   });
    //   relationLabel.name = `relation_label_${firstToothFdi}`;
    //   this.addToMesh(relationLabel, firstToothFdi); // 添加到第一颗牙的 mesh
    // }
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

  /**
   * 创建咬合切面
   * 为每个咬合点创建一个垂直切面（使用 unscaled 坐标）
   */
  private createOcclusionSlice(center: THREE.Vector3, fdi: number, color: number): THREE.Group {
    const group = new THREE.Group();
    group.name = `occlusion_slice_group_${fdi}`;
    group.position.copy(center); // group 放在 center 位置

    // 判断是左侧还是右侧（根据FDI编码规则）
    const isLeft = (fdi >= 20 && fdi <= 29) || (fdi >= 30 && fdi <= 39);

    // 切面尺寸 - 增大尺寸以便更容易看到
    const width = 15;
    const height = 20;

    // 创建平面几何
    const geometry = new THREE.PlaneGeometry(width, height);

    // 创建材质 - 提高不透明度，让切面更明显
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.4, // 从0.25提高到0.4
      side: THREE.DoubleSide,
    });

    const plane = new THREE.Mesh(geometry, material);
    plane.position.set(0, 0, 0); // 相对于 group 的原点
    plane.renderOrder = -1;
    plane.name = `occlusion_slice_${fdi}`;

    // 设置切面朝向（垂直方向）
    // 绕 X 轴旋转 90 度使其竖立
    plane.rotation.x = Math.PI / 2;

    // 根据左右侧微调旋转角度
    if (isLeft) {
      plane.rotation.y = Math.PI / 6; // 向左倾斜 30 度
    } else {
      plane.rotation.y = -Math.PI / 6; // 向右倾斜 30 度
    }

    group.add(plane);

    // 创建边框
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
      opacity: 0.8, // 从0.6提高到0.8，让边框更明显
      depthWrite: true,
    });

    const border = new THREE.Line(borderGeometry, borderMaterial);
    border.position.set(0, 0, 0); // 相对于 group 的原点
    border.rotation.x = Math.PI / 2;
    border.name = `occlusion_slice_border_${fdi}`;

    // 根据左右侧微调旋转角度
    if (isLeft) {
      border.rotation.y = Math.PI / 6;
    } else {
      border.rotation.y = -Math.PI / 6;
    }

    group.add(border);

    return group;
  }

  /**
   * 创建虚线（不应用缩放）
   */
  private createDashedLineUnscaled(
    start: THREE.Vector3,
    end: THREE.Vector3,
    color: number,
    lineWidth = 2,
  ): THREE.Line {
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    const material = new THREE.LineDashedMaterial({
      color,
      linewidth: lineWidth,
      dashSize: 1.0, // 增加虚线段长度
      gapSize: 0.5, // 增加间隔
      transparent: true,
      opacity: 0.8,
    });
    const line = new THREE.Line(geometry, material);
    line.computeLineDistances(); // 虚线需要计算距离
    line.renderOrder = -1; // 确保在最前面渲染
    return line;
  }

  /**
   * 根据咬合关系获取颜色（数值）
   */
  private getRelationshipColor(relationship: string): number {
    // 中性关系（正常）
    if (
      relationship.includes('中性') ||
      relationship.includes('I类') ||
      relationship.includes('正常')
    ) {
      return 0x22c55e; // 绿色
    }
    // 远中关系（II类）
    if (relationship.includes('远中') || relationship.includes('II类')) {
      return 0xff9800; // 橙色
    }
    // 近中关系（III类）
    if (relationship.includes('近中') || relationship.includes('III类')) {
      return 0xff6b6b; // 红色
    }
    return 0x9e9e9e; // 灰色（未知）
  }

  /**
   * 根据分类获取颜色（字符串）- 用于信息面板
   */
  private getClassificationColor(classification: string): string {
    if (
      classification.includes('I类') ||
      classification.includes('正常') ||
      classification.includes('中性')
    ) {
      return '#22c55e';
    }
    if (classification.includes('II类') || classification.includes('远中')) return '#ff9800';
    if (classification.includes('III类') || classification.includes('近中')) return '#ff6b6b';
    return '#9e9e9e';
  }

  /**
   * 评估分类
   */
  private evaluateClassification(classification: string): string {
    if (
      classification.includes('I类') ||
      classification.includes('正常') ||
      classification.includes('中性')
    ) {
      return '正常';
    }
    return '需要关注';
  }
}
