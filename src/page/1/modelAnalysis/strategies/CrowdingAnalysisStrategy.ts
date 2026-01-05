import * as THREE from 'three';
import type { AnalysisData, MeasurementGroup, RenderType } from '../types';
import type { ArchWireResult } from '../utils/ArchWireUtils';
import { BaseAnalysisStrategy } from './base/BaseAnalysisStrategy';

/**
 * 拥挤度分析策略
 * 分析上下颌牙齿的拥挤程度
 */
export class CrowdingAnalysisStrategy extends BaseAnalysisStrategy {
  readonly id = 'crowding';
  readonly name = '拥挤度';
  readonly taskName = 'tooth-crowding-degree';
  readonly renderType: RenderType = 'POINT_ONLY';

  // 存储可拖动的点位对象
  private draggablePoints: THREE.Mesh[] = [];

  // 存储上下颌牙弓线
  private upperArchWire: ArchWireResult | null = null;
  private lowerArchWire: ArchWireResult | null = null;

  // 不再使用下颌水平基准平面
  // 牙弓线将直接基于点位的实际位置进行连线

  /**
   * 渲染特定元素
   * 拥挤度分析：显示牙齿间距和拥挤区域，以及牙弓线
   */
  protected renderSpecificElements(data: AnalysisData): void {
    const { teeth_points, measurements } = data;

    if (!teeth_points || teeth_points.length === 0) return;

    // 创建上下颌牙弓线（在点位渲染之后，基于点位实际位置连线）
    this.createArchWires();

    // 注释掉renderJawCrowding，避免与renderPoints创建的点位重复
    // renderPoints 已经为每个点位创建了可拖动的球体
    // renderJawCrowding(teeth_points, measurements?.upper_jaw as Record<string, unknown>, true);
    // renderJawCrowding(teeth_points, measurements?.lower_jaw as Record<string, unknown>, false);
  }

  /**
   * 格式化测量数据为面板展示格式
   */
  protected formatMeasurements(measurements: Record<string, unknown>): MeasurementGroup[] {
    const upperData = measurements.upper_jaw as Record<string, unknown>;
    const lowerData = measurements.lower_jaw as Record<string, unknown>;

    const groups: MeasurementGroup[] = [];

    // 上颌拥挤度
    if (upperData) {
      const discrepancy = (upperData.discrepancy_mm as number) || 0;
      const toothWidthsSum = (upperData.tooth_widths_sum_mm as number) || 0;
      const archLength = (upperData.arch_length_mm as number) || 0;

      groups.push({
        groupName: '上颌拥挤度',
        children: [
          {
            name: '牙量与骨量的实际差值',
            value: `${discrepancy.toFixed(2)}mm`,
            result: '',
          },
          {
            name: '牙齿宽度总和/牙量',
            value: `${toothWidthsSum.toFixed(2)}mm`,
            result: '',
          },
          {
            name: '牙弓弧形长度/骨量',
            value: `${archLength.toFixed(2)}mm`,
            result: '',
          },
        ],
      });
    }

    // 下颌拥挤度
    if (lowerData) {
      const discrepancy = (lowerData.discrepancy_mm as number) || 0;
      const toothWidthsSum = (lowerData.tooth_widths_sum_mm as number) || 0;
      const archLength = (lowerData.arch_length_mm as number) || 0;

      groups.push({
        groupName: '下颌拥挤度',
        children: [
          {
            name: '牙量与骨量的实际差值',
            value: `${discrepancy.toFixed(2)}mm`,
            result: '',
          },
          {
            name: '牙齿宽度总和/牙量',
            value: `${toothWidthsSum.toFixed(2)}mm`,
            result: '',
          },
          {
            name: '牙弓弧形长度/骨量',
            value: `${archLength.toFixed(2)}mm`,
            result: '',
          },
        ],
      });
    }

    return groups;
  }

  // ==================== 私有辅助方法 ====================

  /**
   * 重写点位渲染 - 使点位可拖动
   */
  protected renderPoints(teethPoints: import('../types').ToothPoint[]): void {
    teethPoints.forEach(p => {
      // 根据颌位设置颜色：上颌 #FEB5B5，下颌 #A49ED9
      const color = this.isUpper(p.fdi) ? 0xfeb5b5 : 0xa49ed9;

      // 解析 point（可能是字符串或数组）
      let pointCoords: number[];
      if (typeof p.point === 'string') {
        // 解析字符串格式: "[-5.4728, -24.4353, -3.1645]"
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
        transparent: true,
      });
      const sphere = new THREE.Mesh(geometry, material);

      // 不应用缩放，因为 mesh 本身已经有缩放了
      sphere.position.set(pointCoords[0] ?? 0, pointCoords[1] ?? 0, pointCoords[2] ?? 0);
      sphere.name = `point_${p.fdi}_${p.type}`;

      // 设置为可拖动，并保存完整的原始数据
      sphere.userData.draggable = true;
      sphere.userData.isCrowdingPoint = true;
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

  /**
   * 清理资源
   * 重写基类方法，额外清理拥挤度特有的资源
   */
  cleanup(): void {
    // 清理可拖动点位
    this.draggablePoints = [];

    // 释放上颌牙弓线资源（基类的cleanupMeshChildren会从mesh中移除）
    if (this.upperArchWire) {
      this.disposeArchWire(this.upperArchWire);
      this.upperArchWire = null;
    }

    // 释放下颌牙弓线资源（基类的cleanupMeshChildren会从mesh中移除）
    if (this.lowerArchWire) {
      this.disposeArchWire(this.lowerArchWire);
      this.lowerArchWire = null;
    }

    // 调用基类清理方法（会自动从mesh中移除所有以taskName_开头的对象）
    super.cleanup();
  }

  /**
   * 拖动点位时的回调函数
   * 更新牙弓线形状
   */
  public updateOnDrag(object: THREE.Object3D): void {
    // 更新上下颌牙弓线（如果存在）
    if (this.upperArchWire || this.lowerArchWire) {
      this.updateArchWireShape();
    }
  }

  /**
   * 创建上下颌牙弓线
   * 直接基于点位的实际位置进行连线（不计算中心点）
   */
  private createArchWires(): void {
    // 收集所有点位
    const { upperPoints, lowerPoints } = this.collectAllPoints();

    // 创建上颌牙弓线（青色）
    if (upperPoints.length >= 2) {
      this.upperArchWire = this.createArchWireFromPoints(upperPoints, 0x00ffff);
      if (this.upperArchWire) {
        this.addArchWireToMesh(this.upperArchWire, true);
      }
    }

    // 创建下颌牙弓线（青色）
    if (lowerPoints.length >= 2) {
      this.lowerArchWire = this.createArchWireFromPoints(lowerPoints, 0x00ffff);
      if (this.lowerArchWire) {
        this.addArchWireToMesh(this.lowerArchWire, false);
      }
    }
  }

  /**
   * 根据点位数组创建牙弓线
   * @param points 点位数组
   * @param color 线条颜色
   */
  private createArchWireFromPoints(points: THREE.Vector3[], color: number): ArchWireResult {
    const group = new THREE.Group();

    // 创建平滑曲线（使用 CatmullRomCurve3）
    const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5);

    // 创建管道几何体（与原始牙弓线样式保持一致）
    const tubeGeometry = new THREE.TubeGeometry(
      curve,
      points.length * 5, // 管道分段数
      0.3, // 管道半径
      8, // 径向分段数
      false,
    );

    // 创建管道材质
    const tubeMaterial = new THREE.MeshPhongMaterial({
      color,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    });

    // 创建管道网格
    const tubeMesh = new THREE.Mesh(tubeGeometry, tubeMaterial);
    group.add(tubeMesh);

    // 创建控制点（空数组，满足接口要求）
    const controlPoints: THREE.Mesh[] = [];

    return { group, curve, tubeMesh, controlPoints };
  }

  /**
   * 将牙弓线添加到对应的mesh
   * @param archWire 牙弓线对象
   * @param isUpper 是否为上颌
   */
  private addArchWireToMesh(archWire: ArchWireResult, isUpper: boolean): void {
    const targetMesh = isUpper ? this.context.upperMeshLabel : this.context.lowerMeshLabel;

    if (!targetMesh) {
      return;
    }

    // 设置名称和渲染属性
    archWire.group.name = `${this.taskName}_${isUpper ? 'upper' : 'lower'}_arch_wire`;
    archWire.group.renderOrder = 999;

    // 遍历牙弓线的所有子对象，设置渲染属性
    archWire.group.traverse(child => {
      child.renderOrder = 999;

      if ('material' in child) {
        const material = (child as THREE.Mesh | THREE.Line).material;
        if (material) {
          if (Array.isArray(material)) {
            material.forEach(mat => {
              mat.depthTest = false;
              mat.depthWrite = false;
              mat.transparent = true;
            });
          } else {
            material.depthTest = false;
            material.depthWrite = false;
            material.transparent = true;
          }
        }
      }
    });

    // 添加到对应的mesh，使其随mesh的显隐而显隐
    targetMesh.add(archWire.group);
  }

  /**
   * 收集所有点位（不计算中心点，直接使用原始点位）
   * 按FDI和点位索引排序，用于连线
   */
  private collectAllPoints(): {
    upperPoints: THREE.Vector3[];
    lowerPoints: THREE.Vector3[];
  } {
    const upperPoints: THREE.Vector3[] = [];
    const lowerPoints: THREE.Vector3[] = [];

    // 直接收集所有可拖动点位的坐标
    this.draggablePoints.forEach(point => {
      const fdi = point.userData.fdi as number;
      if (!fdi) return;

      const position = point.position.clone();

      // 根据FDI范围分配到上下颌（使用基类的方法保证一致性）
      if (this.isUpper(fdi)) {
        upperPoints.push(position);
      } else if (this.isLower(fdi)) {
        lowerPoints.push(position);
      }
    });
    return { upperPoints, lowerPoints };
  }

  /**
   * 更新牙弓线形状
   * 基于当前所有点位的实际位置重新生成牙弓线
   */
  private updateArchWireShape(): void {
    if (!this.context) return;
    this.getDraggableObjects();
    // 收集更新后的所有点位
    const { upperPoints, lowerPoints } = this.collectAllPoints();

    // 更新上颌牙弓线（青色）
    if (this.upperArchWire && upperPoints.length >= 2) {
      // 从上颌mesh中移除旧的牙弓线
      const upperMesh = this.context.upperMeshLabel;
      if (upperMesh) {
        upperMesh.remove(this.upperArchWire.group);
      }
      this.disposeArchWire(this.upperArchWire);

      // 基于点位创建新的牙弓线
      this.upperArchWire = this.createArchWireFromPoints(upperPoints, 0x00ffff);
      if (this.upperArchWire) {
        this.addArchWireToMesh(this.upperArchWire, true);
      }
    }

    // 更新下颌牙弓线（青色）
    if (this.lowerArchWire && lowerPoints.length >= 2) {
      // 从下颌mesh中移除旧的牙弓线
      const lowerMesh = this.context.lowerMeshLabel;
      if (lowerMesh) {
        lowerMesh.remove(this.lowerArchWire.group);
      }
      this.disposeArchWire(this.lowerArchWire);

      // 基于点位创建新的牙弓线
      this.lowerArchWire = this.createArchWireFromPoints(lowerPoints, 0x00ffff);
      if (this.lowerArchWire) {
        this.addArchWireToMesh(this.lowerArchWire, false);
      }
    }
  }

  /**
   * 释放牙弓线资源
   */
  private disposeArchWire(archWire: ArchWireResult): void {
    // 遍历组中的所有对象，释放几何体和材质
    archWire.group.traverse(child => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        // 释放几何体
        if (child.geometry) {
          child.geometry.dispose();
        }

        // 释放材质
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      }
    });
  }
}
