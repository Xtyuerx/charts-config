import * as THREE from 'three'
import { BaseAnalysisStrategy } from './base/BaseAnalysisStrategy'
import type { AnalysisData, MeasurementGroup, RenderType, ToothPoint } from '../types'
import { LineRenderer, LabelRenderer } from '../renderers'

/**
 * Bolton分析策略
 * 分析上下颌牙齿宽度比例关系
 */
export class BoltonAnalysisStrategy extends BaseAnalysisStrategy {
  readonly id = 'bolton'
  readonly name = 'Bolton分析'
  readonly taskName = 'bolton'
  readonly renderType: RenderType = 'POINT_LINE'

  /**
   * 渲染特定元素
   * Bolton分析主要渲染：每颗牙齿的宽度测量线
   */
  protected renderSpecificElements(data: AnalysisData): void {
    const { teeth_points, measurements } = data

    if (!teeth_points || teeth_points.length === 0) return

    // 按牙齿分组
    const toothGroups = this.groupPointsByTooth(teeth_points)

    // 渲染每颗牙齿的宽度测量线
    Object.entries(toothGroups).forEach(([fdiStr, points]) => {
      const mesial = points.find((p) => p.type === 'boundary_mesial')
      const distal = points.find((p) => p.type === 'boundary_distal')

      if (mesial && distal) {
        // 创建测量线（带箭头）
        const measureLine = LineRenderer.createMeasurementLine(mesial.point, distal.point, {
          color: this.isUpper(mesial.fdi) ? 0x00ff00 : 0x00bfff,
          lineWidth: 2,
          showArrows: true,
        })
        measureLine.name = `bolton_line_${fdiStr}`
        console.log(measureLine, 'measureLine', this.group)
        this.group.add(measureLine)

        // 添加宽度数值标签
        const width = this.getToothWidth(measurements, fdiStr)
        if (width !== null) {
          const midPoint = this.getMidPoint(mesial.point, distal.point)
          const label = LabelRenderer.createMeasurementLabel(width, 'mm', midPoint, {
            fontSize: 10,
            backgroundColor: '#00000080',
          })
          this.group.add(label)
        }
      }
    })

    // 绘制上下颌总宽度对比线
    this.renderTotalWidthComparison(toothGroups, measurements)
  }

  /**
   * 渲染测量标注
   */
  protected renderMeasurements(measurements: Record<string, unknown>): void {
    if (!measurements) return

    // 解析测量数据
    const frontRatio = (measurements.front_ratio_percent as number) || 0
    const allRatio = (measurements.all_ratio_percent as number) || 0
    const upperFrontSum = (measurements.upper_front_sum as number) || 0
    const lowerFrontSum = (measurements.lower_front_sum as number) || 0
    const upperAllSum = (measurements.upper_all_sum as number) || 0
    const lowerAllSum = (measurements.lower_all_sum as number) || 0

    // 创建左侧信息面板（前牙比）
    const frontData = [
      { key: '前牙比', value: `${frontRatio.toFixed(2)}%` },
      { key: '标准值', value: '77.2%' },
      { key: '上前牙', value: `${upperFrontSum.toFixed(2)}mm` },
      { key: '下前牙', value: `${lowerFrontSum.toFixed(2)}mm` },
    ]

    const frontPanel = LabelRenderer.createInfoPanel(frontData, {
      position: new THREE.Vector3(-40, 20, 0),
      fontSize: 12,
      backgroundColor: '#285e50',
      fontColor: '#ffffff',
    })
    this.group.add(frontPanel)

    // 创建右侧信息面板（全牙比）
    const allData = [
      { key: '全牙比', value: `${allRatio.toFixed(2)}%` },
      { key: '标准值', value: '91.3%' },
      { key: '上全牙', value: `${upperAllSum.toFixed(2)}mm` },
      { key: '下全牙', value: `${lowerAllSum.toFixed(2)}mm` },
    ]

    const allPanel = LabelRenderer.createInfoPanel(allData, {
      position: new THREE.Vector3(40, 20, 0),
      fontSize: 12,
      backgroundColor: '#1e3a8a',
      fontColor: '#ffffff',
    })
    this.group.add(allPanel)

    // 添加诊断结果
    const diagnosis = this.analyzeBoltonRatio(frontRatio, allRatio)
    const diagnosisLabel = LabelRenderer.createLabel(diagnosis, {
      position: new THREE.Vector3(0, 35, 0),
      fontSize: 14,
      backgroundColor: diagnosis.includes('正常') ? '#22c55e' : '#ef4444',
      fontColor: '#ffffff',
    })
    this.group.add(diagnosisLabel)
  }

  /**
   * 格式化测量数据为面板展示格式
   */
  protected formatMeasurements(measurements: Record<string, unknown>): MeasurementGroup[] {
    const frontRatio = (measurements.front_ratio_percent as number) || 0
    const allRatio = (measurements.all_ratio_percent as number) || 0
    const upperFrontSum = (measurements.upper_front_sum as number) || 0
    const lowerFrontSum = (measurements.lower_front_sum as number) || 0
    const upperAllSum = (measurements.upper_all_sum as number) || 0
    const lowerAllSum = (measurements.lower_all_sum as number) || 0

    return [
      {
        groupName: '前牙Bolton分析',
        children: [
          {
            name: '前牙比',
            value: `${frontRatio.toFixed(2)}%`,
            result: this.evaluateRatio(frontRatio, 77.2),
          },
          {
            name: '标准值',
            value: '77.2%',
            result: '参考',
          },
          {
            name: '上前牙宽度',
            value: `${upperFrontSum.toFixed(2)}mm`,
            result: '测量值',
          },
          {
            name: '下前牙宽度',
            value: `${lowerFrontSum.toFixed(2)}mm`,
            result: '测量值',
          },
        ],
      },
      {
        groupName: '全牙Bolton分析',
        children: [
          {
            name: '全牙比',
            value: `${allRatio.toFixed(2)}%`,
            result: this.evaluateRatio(allRatio, 91.3),
          },
          {
            name: '标准值',
            value: '91.3%',
            result: '参考',
          },
          {
            name: '上全牙宽度',
            value: `${upperAllSum.toFixed(2)}mm`,
            result: '测量值',
          },
          {
            name: '下全牙宽度',
            value: `${lowerAllSum.toFixed(2)}mm`,
            result: '测量值',
          },
        ],
      },
    ]
  }

  // ==================== 私有辅助方法 ====================

  /**
   * 按牙齿分组点位
   */
  private groupPointsByTooth(points: ToothPoint[]): Record<string, ToothPoint[]> {
    return points.reduce(
      (acc, point) => {
        const fdi = point.fdi.toString()
        if (!acc[fdi]) {
          acc[fdi] = []
        }
        acc[fdi].push(point)
        return acc
      },
      {} as Record<string, ToothPoint[]>,
    )
  }

  /**
   * 获取牙齿宽度
   */
  private getToothWidth(measurements: Record<string, unknown>, fdi: string): number | null {
    const width = measurements.width as Record<string, number> | undefined
    if (!width) return null

    return width[fdi] || null
  }

  /**
   * 渲染上下颌总宽度对比线
   */
  private renderTotalWidthComparison(
    toothGroups: Record<string, ToothPoint[]>,
    _measurements: Record<string, unknown>,
  ): void {
    console.log(_measurements, '_measurements')
    // 获取上颌所有牙齿的边界点
    const upperTeeth = Object.entries(toothGroups).filter(([fdi]) => this.isUpper(Number(fdi)))

    if (upperTeeth.length === 0) return

    // 找到最左和最右的点
    let leftmost: number[] | null = null
    let rightmost: number[] | null = null

    upperTeeth.forEach(([, points]) => {
      points.forEach((p) => {
        if (!leftmost || (leftmost[0] !== undefined && p.point[0] < leftmost[0])) {
          leftmost = p.point
        }
        if (!rightmost || (rightmost[0] !== undefined && p.point[0] > rightmost[0])) {
          rightmost = p.point
        }
      })
    })

    // 绘制总宽度线（如果需要）
    if (leftmost && rightmost) {
      const totalLine = LineRenderer.createLine(leftmost, rightmost, {
        color: 0xffaa00,
        lineWidth: 3,
      })
      totalLine.name = 'total_width_line'
      // this.group.add(totalLine) // 可选：根据需要显示
    }
  }

  /**
   * 分析Bolton比例
   */
  private analyzeBoltonRatio(frontRatio: number, allRatio: number): string {
    const frontDiff = Math.abs(frontRatio - 77.2)
    const allDiff = Math.abs(allRatio - 91.3)

    if (frontDiff <= 2 && allDiff <= 2) {
      return '✓ Bolton比例正常'
    } else if (frontDiff > 2 && allDiff > 2) {
      return '⚠️ 前牙和全牙比例均偏离标准'
    } else if (frontDiff > 2) {
      return '⚠️ 前牙比例偏离标准'
    } else {
      return '⚠️ 全牙比例偏离标准'
    }
  }

  /**
   * 评估比例
   */
  private evaluateRatio(actual: number, standard: number): string {
    const diff = Math.abs(actual - standard)
    if (diff <= 1) return '正常'
    if (diff <= 2) return '轻度偏离'
    return '显著偏离'
  }
}
