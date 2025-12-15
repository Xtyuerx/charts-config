import * as THREE from 'three';
import type { AnalysisData, MeasurementGroup, RenderType } from '../types';
import { LabelRenderer } from '../renderers';
import { createJawArchWire, type ArchWireResult } from '../utils/ArchWireUtils';
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

  /**
   * 渲染特定元素
   * 拥挤度分析：显示牙齿间距和拥挤区域，以及牙弓线
   */
  protected renderSpecificElements(data: AnalysisData): void {
    const { teeth_points, measurements } = data;

    if (!teeth_points || teeth_points.length === 0) return;

    // 创建上下颌牙弓线（在点位渲染之后）
    this.createArchWires();

    // 渲染上颌拥挤度
    this.renderJawCrowding(teeth_points, measurements?.upper_jaw as Record<string, unknown>, true);

    // 渲染下颌拥挤度
    this.renderJawCrowding(teeth_points, measurements?.lower_jaw as Record<string, unknown>, false);
  }

  /**
   * 渲染测量标注
   */
  protected renderMeasurements(measurements: Record<string, unknown>): void {
    if (!measurements) return;

    const upperData = measurements.upper_jaw as Record<string, unknown>;
    const lowerData = measurements.lower_jaw as Record<string, unknown>;

    // 上颌信息面板
    if (upperData) {
      const discrepancy = (upperData.discrepancy_mm as number) || 0;
      const grade = (upperData.grade as string) || '正常';

      const upperPanel = LabelRenderer.createInfoPanel(
        [
          { key: '上颌拥挤度', value: `${discrepancy.toFixed(2)}mm` },
          { key: '等级', value: grade },
        ],
        {
          position: new THREE.Vector3(-25, 30, 0),
          fontSize: 13,
          backgroundColor: `#${this.getCrowdingColor(discrepancy).toString(16).padStart(6, '0')}`,
          fontColor: '#ffffff',
        },
      );
      // this.group.add(upperPanel)
    }

    // 下颌信息面板
    if (lowerData) {
      const discrepancy = (lowerData.discrepancy_mm as number) || 0;
      const grade = (lowerData.grade as string) || '正常';

      const lowerPanel = LabelRenderer.createInfoPanel(
        [
          { key: '下颌拥挤度', value: `${discrepancy.toFixed(2)}mm` },
          { key: '等级', value: grade },
        ],
        {
          position: new THREE.Vector3(25, 30, 0),
          fontSize: 13,
          backgroundColor: `#${this.getCrowdingColor(discrepancy).toString(16).padStart(6, '0')}`,
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
    const upperData = measurements.upper_jaw as Record<string, unknown>;
    const lowerData = measurements.lower_jaw as Record<string, unknown>;

    const groups: MeasurementGroup[] = [];

    // 上颌拥挤度
    if (upperData) {
      const discrepancy = (upperData.discrepancy_mm as number) || 0;
      const grade = (upperData.grade as string) || '正常';
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
      const grade = (lowerData.grade as string) || '正常';
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

      // 设置为可拖动
      sphere.userData.draggable = true;
      sphere.userData.isCrowdingPoint = true;
      sphere.userData.strategy = this;
      sphere.userData.fdi = p.fdi;
      sphere.userData.pointType = p.type;
      sphere.userData.originalPosition = sphere.position.clone();

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
   */
  private createArchWires(): void {
    // 收集上下颌牙齿中心点
    const { upperCenters, lowerCenters } = this.collectToothCenters();

    // 创建上颌牙弓线并添加到上颌mesh
    if (Object.keys(upperCenters).length >= 2) {
      this.upperArchWire = createJawArchWire(upperCenters, 'upper');
      if (this.upperArchWire) {
        this.addArchWireToMesh(this.upperArchWire, true);
      }
    }

    // 创建下颌牙弓线（保持自然Spee曲线）并添加到下颌mesh
    if (Object.keys(lowerCenters).length >= 2) {
      // 直接使用原始点位，保持下颌的自然Spee曲线（纵向弧度）
      this.lowerArchWire = createJawArchWire(lowerCenters, 'lower');
      if (this.lowerArchWire) {
        this.addArchWireToMesh(this.lowerArchWire, false);
      }
    }
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
   * 收集牙齿中心点
   */
  private collectToothCenters(): {
    upperCenters: Record<number, THREE.Vector3>;
    lowerCenters: Record<number, THREE.Vector3>;
  } {
    const upperCenters: Record<number, THREE.Vector3> = {};
    const lowerCenters: Record<number, THREE.Vector3> = {};

    // 统计每个FDI的所有点位
    const fdiPointsMap: Record<number, THREE.Vector3[]> = {};

    this.draggablePoints.forEach(point => {
      const fdi = point.userData.fdi as number;
      if (!fdi) return;

      if (!fdiPointsMap[fdi]) {
        fdiPointsMap[fdi] = [];
      }
      fdiPointsMap[fdi].push(point.position.clone());
    });

    // 计算每个FDI的中心点（使用原始坐标，不应用缩放）
    // 因为点位和牙弓线都会添加到mesh，mesh本身有缩放
    Object.entries(fdiPointsMap).forEach(([fdi, points]) => {
      const fdiNum = Number(fdi);

      // 计算平均位置（原始坐标）
      const sum = points.reduce(
        (acc, p) => {
          acc.x += p.x;
          acc.y += p.y;
          acc.z += p.z;
          return acc;
        },
        { x: 0, y: 0, z: 0 },
      );

      // 使用原始坐标，不乘以scale
      const center = new THREE.Vector3(
        sum.x / points.length,
        sum.y / points.length,
        sum.z / points.length,
      );

      // 根据FDI范围分配到上下颌
      if (fdiNum >= 11 && fdiNum <= 28) {
        upperCenters[fdiNum] = center;
      } else if (fdiNum >= 31 && fdiNum <= 48) {
        lowerCenters[fdiNum] = center;
      }
    });

    return { upperCenters, lowerCenters };
  }

  /**
   * 更新牙弓线形状
   * 基于当前所有点位的位置重新计算牙弓线
   */
  private updateArchWireShape(): void {
    if (!this.context) return;

    // 收集更新后的牙齿中心点
    const { upperCenters, lowerCenters } = this.collectToothCenters();

    // 更新上颌牙弓线
    if (this.upperArchWire && Object.keys(upperCenters).length >= 2) {
      // 从上颌mesh中移除旧的牙弓线
      const upperMesh = this.context.upperMeshLabel;
      if (upperMesh) {
        upperMesh.remove(this.upperArchWire.group);
      }
      this.disposeArchWire(this.upperArchWire);

      // 创建新的牙弓线并添加到上颌mesh
      this.upperArchWire = createJawArchWire(upperCenters, 'upper');
      if (this.upperArchWire) {
        this.addArchWireToMesh(this.upperArchWire, true);
      }
    }

    // 更新下颌牙弓线（保持自然Spee曲线）
    if (this.lowerArchWire && Object.keys(lowerCenters).length >= 2) {
      // 从下颌mesh中移除旧的牙弓线
      const lowerMesh = this.context.lowerMeshLabel;
      if (lowerMesh) {
        lowerMesh.remove(this.lowerArchWire.group);
      }
      this.disposeArchWire(this.lowerArchWire);

      // 直接使用原始点位创建新的牙弓线（保持Spee曲线）
      this.lowerArchWire = createJawArchWire(lowerCenters, 'lower');
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

  /**
   * 将点位投影到最佳拟合平面（带平面信息）
   * 用于下颌牙弓线的平面投影
   */
  private projectToPlaneWithInfo(centers: Record<number, THREE.Vector3>): {
    projectedCenters: Record<number, THREE.Vector3>;
    planeInfo: { centroid: THREE.Vector3; normal: THREE.Vector3 };
  } {
    const points = Object.values(centers);
    if (points.length < 3) {
      return {
        projectedCenters: centers,
        planeInfo: {
          centroid: new THREE.Vector3(),
          normal: new THREE.Vector3(0, 0, 1),
        },
      };
    }

    // 1. 计算中心点（质心）
    const centroid = new THREE.Vector3();
    points.forEach(p => centroid.add(p));
    centroid.divideScalar(points.length);

    // 2. 计算协方差矩阵并进行PCA（主成分分析）
    // 构建以质心为中心的点集
    const centeredPoints = points.map(p => new THREE.Vector3().subVectors(p, centroid));

    // 计算协方差矩阵的特征向量（简化版本：使用叉积法）
    // 对于牙弓，我们假设平面大致是水平的（XY平面为主）
    // 计算最小方差方向作为平面法向量

    let xx = 0,
      yy = 0,
      zz = 0;
    let xy = 0,
      xz = 0,
      yz = 0;

    centeredPoints.forEach(p => {
      xx += p.x * p.x;
      yy += p.y * p.y;
      zz += p.z * p.z;
      xy += p.x * p.y;
      xz += p.x * p.z;
      yz += p.y * p.z;
    });

    xx /= points.length;
    yy /= points.length;
    zz /= points.length;
    xy /= points.length;
    xz /= points.length;
    yz /= points.length;

    // 简化：假设Z轴方向的方差最小（牙齿大致在同一平面）
    // 平面法向量近似为Z轴或通过特征分析得出
    // 这里使用简化方法：计算平均法向量

    // 使用前三个点来初步估计平面（如果点足够多可以用更复杂的方法）
    let normal: THREE.Vector3;

    if (points.length >= 3) {
      // 使用多个点对计算平均法向量
      const normals: THREE.Vector3[] = [];

      for (let i = 0; i < Math.min(points.length - 2, 5); i++) {
        const v1 = new THREE.Vector3().subVectors(points[i + 1], points[i]);
        const v2 = new THREE.Vector3().subVectors(points[i + 2], points[i]);
        const n = new THREE.Vector3().crossVectors(v1, v2).normalize();
        if (n.length() > 0.1) {
          normals.push(n);
        }
      }

      // 平均法向量
      normal = new THREE.Vector3();
      normals.forEach(n => normal.add(n));
      normal.divideScalar(normals.length).normalize();

      // 确保法向量指向大致向上（Z正方向）
      if (normal.z < 0) {
        normal.negate();
      }
    } else {
      // 默认使用Z轴作为法向量
      normal = new THREE.Vector3(0, 0, 1);
    }

    // 3. 将所有点投影到平面上
    const projectedCenters: Record<number, THREE.Vector3> = {};

    Object.entries(centers).forEach(([fdi, point]) => {
      // 计算点到平面的距离
      const toPoint = new THREE.Vector3().subVectors(point, centroid);
      const distance = toPoint.dot(normal);

      // 投影点 = 原点 - (距离 * 法向量)
      const projected = new THREE.Vector3()
        .copy(point)
        .sub(normal.clone().multiplyScalar(distance));

      projectedCenters[Number(fdi)] = projected;
    });

    return {
      projectedCenters,
      planeInfo: { centroid, normal },
    };
  }

  /**
   * 创建调试平面可视化
   */
  private createDebugPlane(planeInfo: { centroid: THREE.Vector3; normal: THREE.Vector3 }): void {
    const { centroid, normal } = planeInfo;

    // 创建一个平面几何体用于可视化
    // 注意：平面会被mesh的缩放影响，所以使用原始大小
    const planeSize = 60; // 调整大小以适配原始坐标系
    const planeGeometry = new THREE.PlaneGeometry(planeSize, planeSize);

    const planeMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });

    const planeMesh = new THREE.Mesh(planeGeometry, planeMaterial);
    planeMesh.name = `${this.taskName}_debug_plane`;
    planeMesh.renderOrder = 998;

    // 设置平面位置和方向（使用原始坐标，因为会被mesh缩放）
    planeMesh.position.copy(centroid);

    // 将平面旋转到与法向量对齐
    const defaultNormal = new THREE.Vector3(0, 0, 1);
    const quaternion = new THREE.Quaternion();
    quaternion.setFromUnitVectors(defaultNormal, normal);
    planeMesh.setRotationFromQuaternion(quaternion);

    // 添加到下颌mesh（mesh本身有1.5倍缩放）
    const lowerMesh = this.context?.lowerMeshLabel;
    if (lowerMesh) {
      lowerMesh.add(planeMesh);
    }
  }

  /**
   * 渲染单个颌的拥挤度
   */
  private renderJawCrowding(
    teethPoints: AnalysisData['teeth_points'],
    jawData: Record<string, unknown> | undefined,
    isUpper: boolean,
  ): void {
    if (!jawData || !teethPoints) return;

    const discrepancy = (jawData.discrepancy_mm as number) || 0;

    // 根据颌位设置颜色：上颌 #FEB5B5，下颌 #A49ED9
    const color = isUpper ? 0xfeb5b5 : 0xa49ed9;

    // 筛选对应颌的牙齿
    const jawTeeth = teethPoints.filter(p => (isUpper ? this.isUpper(p.fdi) : this.isLower(p.fdi)));

    // 按FDI分组
    const toothGroups = this.groupByFDI(jawTeeth);

    // 为每颗牙齿创建拥挤度标记（使用不缩放坐标）
    Object.entries(toothGroups).forEach(([fdi, points]) => {
      // 解析每个点的坐标
      const parsedPoints = points.map(p => {
        if (typeof p.point === 'string') {
          return JSON.parse(p.point) as number[];
        }
        return p.point;
      });

      const center = this.calculatePointsCenterUnscaled(parsedPoints);

      // 创建小球标记（上颌红色，下颌绿色）
      const geometry = new THREE.SphereGeometry(0.8, 16, 16);
      const material = new THREE.MeshPhongMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.4,
        transparent: true,
        opacity: 0.7,
      });
      const sphere = new THREE.Mesh(geometry, material);
      sphere.position.copy(center);
      sphere.name = `crowding_${fdi}`;

      // 使用方案2：添加到 mesh，点位会随模型的隐藏而隐藏
      this.addToMesh(sphere, Number(fdi));
    });
  }

  /**
   * 按FDI分组
   */
  private groupByFDI(
    points: NonNullable<AnalysisData['teeth_points']>,
  ): Record<string, NonNullable<AnalysisData['teeth_points']>> {
    return points.reduce((acc, point) => {
      const fdi = point.fdi.toString();
      if (!acc[fdi]) {
        acc[fdi] = [];
      }
      acc[fdi]!.push(point);
      return acc;
    }, {} as Record<string, NonNullable<AnalysisData['teeth_points']>>);
  }

  /**
   * 根据拥挤度获取颜色
   */
  private getCrowdingColor(crowding: number): number {
    if (crowding >= -1 && crowding <= 1) return 0x22c55e; // 绿色 - 正常
    if (crowding < -4 || crowding > 4) return 0xff0000; // 红色 - 严重
    return 0xffa500; // 橙色 - 轻度
  }

  /**
   * 评估拥挤度
   */
  private evaluateCrowding(crowding: number): string {
    if (crowding >= -1 && crowding <= 1) return '正常';
    if (crowding < -4 || crowding > 4) return '严重';
    return '轻度拥挤';
  }
}
