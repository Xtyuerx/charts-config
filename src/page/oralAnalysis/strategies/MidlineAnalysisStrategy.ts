import * as THREE from 'three'
import { BaseAnalysisStrategy } from './base/BaseAnalysisStrategy'
import type { AnalysisData, MeasurementGroup, RenderType } from '../types'
import { LineRenderer, LabelRenderer, SliceRenderer } from '../renderers'

/**
 * 中线偏差分析策略
 * 分析上下颌中线与面部中线的偏差
 */
export class MidlineAnalysisStrategy extends BaseAnalysisStrategy {
  readonly id = 'midline'
  readonly name = '中线关系'
  readonly taskName = 'midline-deviation'
  readonly renderType: RenderType = 'POINT_SLICE'

  /**
   * 渲染特定元素
   * 中线分析：显示面部中线、上下颌中线和偏差
   */
  protected renderSpecificElements(data: AnalysisData): void {
    const { teeth_points, measurements } = data

    if (!teeth_points || teeth_points.length === 0) return

    // 渲染面部中线参考面
    this.renderFacialMidline(measurements)

    // 渲染上颌中线
    this.renderJawMidline(teeth_points, measurements?.upper as Record<string, unknown>, true)

    // 渲染下颌中线
    this.renderJawMidline(teeth_points, measurements?.lower as Record<string, unknown>, false)

    // 渲染偏差指示
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
      backgroundColor: this.getDeviationColor(
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
   * 渲染面部中线参考面
   */
  private renderFacialMidline(measurements: Record<string, unknown> | undefined): void {
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

    const midline = LineRenderer.createBasicLine(lineStart, lineEnd, {
      color,
      lineWidth: 3,
    })
    this.group.add(midline)

    // 渲染中点标记
    const marker = LineRenderer.createPoint(midPoint, { color, size: 1.2 })
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
        deviationMid.clone().add(new THREE.Vector3(0, 3, 0)),
        {
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
