import * as THREE from 'three'
import { BaseAnalysisStrategy } from './base/BaseAnalysisStrategy'
import type { AnalysisData, MeasurementGroup, RenderType } from '../types'
import { LineRenderer, LabelRenderer, SliceRenderer } from '../renderers'
import {
  calculateToothCenters,
  createMiddleArchWire,
  type ArchWireResult,
} from '../utils/ArchWireUtils'

/**
 * 中线偏差分析策略
 * 分析上下颌中线与面部中线的偏差
 * 包含牙弓线、可拖拽控制点和垂直面
 */
export class MidlineAnalysisStrategy extends BaseAnalysisStrategy {
  readonly id = 'midline'
  readonly name = '中线关系'
  readonly taskName = 'midline-deviation'
  readonly renderType: RenderType = 'POINT_SLICE'

  // 牙弓线相关
  private archWire: ArchWireResult | null = null
  private controlPoint1: THREE.Mesh | null = null
  private controlPoint2: THREE.Mesh | null = null
  private plane1: THREE.Mesh | null = null
  private plane2: THREE.Mesh | null = null

  /**
   * 渲染流程（重写父类方法以添加拖拽控制）
   */
  render(data: AnalysisData): void {
    // 调用父类的渲染方法
    super.render(data)

    // 渲染完成后，注册可拖拽对象到场景管理器
    this.registerDraggableObjects()
  }

  /**
   * 注册可拖拽对象
   * 将控制点注册到场景管理器的拖拽控制系统
   */
  private registerDraggableObjects(): void {
    // 这个方法需要场景管理器的支持
    // 在实际使用时，可以通过context或全局访问
    if (this.controlPoint1) {
      // 暂时通过userData标记为可拖拽
      // 实际的拖拽注册会在外部完成
      console.log('✅ 控制点1已创建并可拖拽')
    }

    if (this.controlPoint2) {
      console.log('✅ 控制点2已创建并可拖拽')
    }
  }

  /**
   * 获取可拖拽对象列表
   * 供外部注册拖拽控制使用
   */
  public getDraggableObjects(): THREE.Object3D[] {
    const objects: THREE.Object3D[] = []

    if (this.controlPoint1) {
      objects.push(this.controlPoint1)
    }

    if (this.controlPoint2) {
      objects.push(this.controlPoint2)
    }

    return objects
  }

  /**
   * 渲染特定元素
   * 中线分析：显示面部中线、上下颌中线和偏差
   * 包含牙弓线、可拖拽控制点和垂直面
   */
  protected renderSpecificElements(data: AnalysisData): void {
    const { teeth_points, measurements } = data

    if (!teeth_points || teeth_points.length === 0) return

    // 1. 创建牙弓线
    this.createArchWire(teeth_points)

    // 2. 创建两个可拖拽控制点
    this.createDraggableControlPoints()

    // 3. 创建垂直于牙弓线的两个面
    this.createVerticalPlanes()

    // 4. 渲染面部中线参考面
    this.renderFacialMidline()

    // 5. 渲染上颌中线
    this.renderJawMidline(teeth_points, measurements?.upper as Record<string, unknown>, true)

    // 6. 渲染下颌中线
    this.renderJawMidline(teeth_points, measurements?.lower as Record<string, unknown>, false)

    // 7. 渲染偏差指示
    this.renderDeviationIndicators(measurements)
  }

  /**
   * 渲染测量标注
   */
  protected renderMeasurements(measurements: Record<string, unknown>): void {
    if (!measurements) return

    const upperDeviation = (measurements.upper_deviation_mm as number) || 0
    const lowerDeviation = (measurements.lower_deviation_mm as number) || 0
    const diagnosis = (measurements.diagnosis as string) || '正常'

    // 创建统计信息面板
    const infoData = [
      {
        key: '上颌中线偏差',
        value: `${Math.abs(upperDeviation).toFixed(2)}mm ${this.getDirectionLabel(upperDeviation)}`,
      },
      {
        key: '下颌中线偏差',
        value: `${Math.abs(lowerDeviation).toFixed(2)}mm ${this.getDirectionLabel(lowerDeviation)}`,
      },
      { key: '诊断结果', value: diagnosis },
    ]

    const infoPanel = LabelRenderer.createInfoPanel(infoData, {
      position: new THREE.Vector3(0, 35, 0),
      fontSize: 14,
      backgroundColor: this.getDeviationColorString(
        Math.max(Math.abs(upperDeviation), Math.abs(lowerDeviation)),
      ),
      fontColor: '#ffffff',
    })

    this.group.add(infoPanel)
  }

  /**
   * 格式化测量数据为面板展示格式
   */
  protected formatMeasurements(measurements: Record<string, unknown>): MeasurementGroup[] {
    const upperDeviation = (measurements.upper_deviation_mm as number) || 0
    const lowerDeviation = (measurements.lower_deviation_mm as number) || 0
    const upperDirection = (measurements.upper_deviation_direction as string) || '居中'
    const lowerDirection = (measurements.lower_deviation_direction as string) || '居中'
    const diagnosis = (measurements.diagnosis as string) || '正常'

    return [
      {
        groupName: '中线偏差分析',
        children: [
          {
            name: '上颌中线偏差',
            value: `${Math.abs(upperDeviation).toFixed(2)}mm`,
            result: this.evaluateDeviation(upperDeviation),
          },
          {
            name: '上颌偏差方向',
            value: upperDirection,
            result: upperDirection === '居中' ? '正常' : '偏移',
          },
          {
            name: '下颌中线偏差',
            value: `${Math.abs(lowerDeviation).toFixed(2)}mm`,
            result: this.evaluateDeviation(lowerDeviation),
          },
          {
            name: '下颌偏差方向',
            value: lowerDirection,
            result: lowerDirection === '居中' ? '正常' : '偏移',
          },
          {
            name: '综合诊断',
            value: diagnosis,
            result: diagnosis.includes('正常') || diagnosis.includes('居中') ? '正常' : '异常',
          },
        ],
      },
    ]
  }

  // ==================== 私有辅助方法 ====================

  /**
   * 创建牙弓线
   */
  private createArchWire(teethPoints: AnalysisData['teeth_points']): void {
    // 计算牙齿中心点
    const { upper, lower } = calculateToothCenters(teethPoints, false)

    // 创建中间牙弓线
    this.archWire = createMiddleArchWire(upper, lower)

    if (!this.archWire) return

    // 添加到场景
    this.group.add(this.archWire.group)
  }

  /**
   * 创建两个可拖拽控制点
   */
  private createDraggableControlPoints(): void {
    if (!this.archWire) return

    const { curve, group } = this.archWire

    // 创建第一个控制点（t=0.3位置）
    const t1 = 0.3
    const pos1 = curve.getPointAt(t1)
    this.controlPoint1 = this.createControlPoint(pos1, t1, 1)
    group.add(this.controlPoint1)

    // 创建第二个控制点（t=0.7位置）
    const t2 = 0.7
    const pos2 = curve.getPointAt(t2)
    this.controlPoint2 = this.createControlPoint(pos2, t2, 2)
    group.add(this.controlPoint2)

    // 将控制点添加到场景管理器的可拖拽对象列表
    // 注意：需要在使用时通过 SceneManager 来添加
    // 这里我们存储引用，在后面通过其他方式注册
  }

  /**
   * 创建单个控制点
   */
  private createControlPoint(position: THREE.Vector3, t: number, id: number): THREE.Mesh {
    const sphereGeo = new THREE.SphereGeometry(0.8, 16, 16)
    const sphereMat = new THREE.MeshBasicMaterial({
      color: 0xff6b6b,
      depthTest: false,
      transparent: true,
      opacity: 0.8,
    })
    const sphere = new THREE.Mesh(sphereGeo, sphereMat)
    sphere.renderOrder = 1000

    sphere.position.copy(position)
    sphere.userData.isMidlineControlPoint = true
    sphere.userData.controlPointId = id
    sphere.userData.t = t
    sphere.userData.strategy = this
    sphere.name = `midline_control_point_${id}`

    return sphere
  }

  /**
   * 创建垂直于牙弓线的两个面
   */
  private createVerticalPlanes(): void {
    if (!this.controlPoint1 || !this.controlPoint2 || !this.archWire) return

    // 创建第一个面
    this.plane1 = this.createVerticalPlane(this.controlPoint1, 1)
    this.group.add(this.plane1)

    // 创建第二个面
    this.plane2 = this.createVerticalPlane(this.controlPoint2, 2)
    this.group.add(this.plane2)
  }

  /**
   * 创建单个垂直面
   */
  private createVerticalPlane(controlPoint: THREE.Mesh, id: number): THREE.Mesh {
    const t = controlPoint.userData.t as number
    const curve = this.archWire!.curve

    // 获取曲线在该点的切线方向
    const tangent = curve.getTangentAt(t).normalize()

    // 创建一个垂直于切线的平面
    // 平面法线 = 切线方向
    const planeWidth = 30
    const planeHeight = 50

    // 创建平面几何体
    const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight)

    // 创建材质
    const material = new THREE.MeshBasicMaterial({
      color: id === 1 ? 0x00ff00 : 0x0000ff,
      opacity: 0.2,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: false,
    })

    const plane = new THREE.Mesh(geometry, material)
    plane.renderOrder = 998

    // 设置平面位置
    plane.position.copy(controlPoint.position)

    // 计算平面的旋转：平面法线应该与切线方向一致
    const normal = tangent.clone()
    const up = new THREE.Vector3(0, 1, 0)

    // 使用四元数设置旋转
    const quaternion = new THREE.Quaternion()
    const targetUp = new THREE.Vector3().crossVectors(normal, up).normalize()
    const finalUp = new THREE.Vector3().crossVectors(targetUp, normal).normalize()

    const rotationMatrix = new THREE.Matrix4()
    rotationMatrix.makeBasis(targetUp, finalUp, normal)
    quaternion.setFromRotationMatrix(rotationMatrix)
    plane.quaternion.copy(quaternion)

    plane.userData.controlPointId = id
    plane.name = `midline_vertical_plane_${id}`

    return plane
  }

  /**
   * 更新垂直面的位置和方向
   * 当控制点被拖拽时调用
   */
  public updatePlane(controlPointId: number): void {
    if (!this.archWire) return

    const controlPoint = controlPointId === 1 ? this.controlPoint1 : this.controlPoint2
    const plane = controlPointId === 1 ? this.plane1 : this.plane2

    if (!controlPoint || !plane) return

    const t = controlPoint.userData.t as number
    const curve = this.archWire.curve

    // 获取曲线在该点的切线方向
    const tangent = curve.getTangentAt(t).normalize()

    // 更新平面位置
    plane.position.copy(controlPoint.position)

    // 更新平面旋转
    const normal = tangent.clone()
    const up = new THREE.Vector3(0, 1, 0)

    const quaternion = new THREE.Quaternion()
    const targetUp = new THREE.Vector3().crossVectors(normal, up).normalize()
    const finalUp = new THREE.Vector3().crossVectors(targetUp, normal).normalize()

    const rotationMatrix = new THREE.Matrix4()
    rotationMatrix.makeBasis(targetUp, finalUp, normal)
    quaternion.setFromRotationMatrix(rotationMatrix)
    plane.quaternion.copy(quaternion)
  }

  /**
   * 渲染面部中线参考面
   */
  private renderFacialMidline(): void {
    // TODO: 创建半透明的中线参考面（垂直于X轴）
    const midlinePlane = SliceRenderer.createMidlinePlane([0, 0, 0], [100, 100, 0], {
      width: 100,
      height: 100,
      color: 0x2196f3,
      opacity: 0.1,
      showBorder: true,
    })

    this.group.add(midlinePlane)

    // 添加面部中线标识
    const facialMidlineLabel = LabelRenderer.createLabel('面部中线', {
      position: new THREE.Vector3(0, 45, 0),
      fontSize: 13,
      backgroundColor: '#2196f3',
      fontColor: '#ffffff',
    })
    this.group.add(facialMidlineLabel)
  }

  /**
   * 渲染单个颌的中线
   */
  private renderJawMidline(
    teethPoints: AnalysisData['teeth_points'],
    jawData: Record<string, unknown> | undefined,
    isUpper: boolean,
  ): void {
    if (!jawData) return

    const midlinePosition = (jawData.midline_position_mm as number) || 0
    const midlinePoints = (jawData.midline_reference_teeth as number[]) || []

    if (midlinePoints.length < 2) return

    // 找到中切牙的点
    const tooth1Points = teethPoints.filter((p) => p.fdi === midlinePoints[0])
    const tooth2Points = teethPoints.filter((p) => p.fdi === midlinePoints[1])

    if (tooth1Points.length === 0 || tooth2Points.length === 0) return

    // 计算两颗中切牙的中心点
    const center1 = this.calculatePointsCenter(tooth1Points.map((p) => p.point))
    const center2 = this.calculatePointsCenter(tooth2Points.map((p) => p.point))

    // 计算中点（中线位置）
    const midPoint = new THREE.Vector3().addVectors(center1, center2).multiplyScalar(0.5)

    // 根据偏差选择颜色
    const color = this.getDeviationColor(Math.abs(midlinePosition))

    // 渲染中线（垂直线）
    const lineStart = midPoint.clone().add(new THREE.Vector3(0, -10, 0))
    const lineEnd = midPoint.clone().add(new THREE.Vector3(0, 10, 0))

    const midline = LineRenderer.createLine(lineStart, lineEnd, {
      color,
      lineWidth: 3,
    })
    this.group.add(midline)

    // 渲染中点标记（使用简单的球体）
    const sphereGeo = new THREE.SphereGeometry(1.2, 16, 16)
    const sphereMat = new THREE.MeshBasicMaterial({ color })
    const marker = new THREE.Mesh(sphereGeo, sphereMat)
    marker.position.copy(midPoint)
    this.group.add(marker)

    // 渲染中线标签
    const jawType = isUpper ? '上颌' : '下颌'
    const midlineLabel = LabelRenderer.createLabel(`${jawType}中线`, {
      position: midPoint.clone().add(new THREE.Vector3(0, isUpper ? 12 : -12, 0)),
      fontSize: 11,
      backgroundColor: `#${color.toString(16).padStart(6, '0')}`,
      fontColor: '#ffffff',
    })
    this.group.add(midlineLabel)

    // 如果有明显偏差，渲染偏差指示线
    if (Math.abs(midlinePosition) > 0.5) {
      const facialMidPoint = new THREE.Vector3(0, midPoint.y, midPoint.z)
      const deviationLine = LineRenderer.createMeasurementLine(facialMidPoint, midPoint, {
        color: 0xff0000,
        lineWidth: 2,
        showArrows: true,
      })
      this.group.add(deviationLine)

      // 添加偏差数值标签
      const deviationMid = new THREE.Vector3()
        .addVectors(facialMidPoint, midPoint)
        .multiplyScalar(0.5)

      const deviationValueLabel = LabelRenderer.createLabel(
        `${Math.abs(midlinePosition).toFixed(2)}mm`,
        {
          position: deviationMid.clone().add(new THREE.Vector3(0, 3, 0)),
          fontSize: 10,
          backgroundColor: '#ff0000',
          fontColor: '#ffffff',
        },
      )
      this.group.add(deviationValueLabel)
    }
  }

  /**
   * 渲染偏差指示器
   */
  private renderDeviationIndicators(measurements: Record<string, unknown> | undefined): void {
    if (!measurements) return

    const upperDeviation = (measurements.upper_deviation_mm as number) || 0
    const lowerDeviation = (measurements.lower_deviation_mm as number) || 0

    // 如果有偏差，在合适位置添加方向箭头
    if (Math.abs(upperDeviation) > 1.0 || Math.abs(lowerDeviation) > 1.0) {
      // 可以添加额外的视觉指示器
      // 例如：在参考面上标注偏差方向
    }
  }

  /**
   * 计算多个点的中心
   */
  private calculatePointsCenter(points: number[][]): THREE.Vector3 {
    const scale = 1.5
    const sum = points.reduce(
      (acc, p) => {
        acc.x += p[0] || 0
        acc.y += p[1] || 0
        acc.z += p[2] || 0
        return acc
      },
      { x: 0, y: 0, z: 0 },
    )

    return new THREE.Vector3(
      (sum.x / points.length) * scale,
      (sum.y / points.length) * scale,
      (sum.z / points.length) * scale,
    )
  }

  /**
   * 根据偏差大小获取颜色（数值）
   */
  private getDeviationColor(deviation: number): number {
    const absDev = Math.abs(deviation)
    if (absDev <= 1.0) return 0x22c55e // 绿色 - 正常
    if (absDev <= 2.0) return 0xff9800 // 橙色 - 轻度偏差
    return 0xff0000 // 红色 - 明显偏差
  }

  /**
   * 根据偏差大小获取颜色（字符串）
   */
  private getDeviationColorString(deviation: number): string {
    const absDev = Math.abs(deviation)
    if (absDev <= 1.0) return '#22c55e' // 绿色
    if (absDev <= 2.0) return '#ff9800' // 橙色
    return '#ff0000' // 红色
  }

  /**
   * 获取方向标签
   */
  private getDirectionLabel(deviation: number): string {
    if (Math.abs(deviation) < 0.5) return '(居中)'
    return deviation > 0 ? '(右偏)' : '(左偏)'
  }

  /**
   * 评估偏差程度
   */
  private evaluateDeviation(deviation: number): string {
    const absDev = Math.abs(deviation)
    if (absDev <= 1.0) return '正常'
    if (absDev <= 2.0) return '轻度偏差'
    return '明显偏差'
  }
}
