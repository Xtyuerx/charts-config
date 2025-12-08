import * as THREE from 'three'
import { BaseAnalysisStrategy } from './base/BaseAnalysisStrategy'
import type { AnalysisData, MeasurementGroup, RenderType } from '../types'
import { LabelRenderer } from '../renderers'

/**
 * 牙弓宽度分析策略
 * 测量上下颌的牙弓宽度
 */
export class ArchWidthAnalysisStrategy extends BaseAnalysisStrategy {
  readonly id = 'arch-width'
  readonly name = '牙弓宽度分析'
  readonly taskName = 'arch-width'
  readonly renderType: RenderType = 'POINT_LINE'

  /**
   * 渲染特定元素
   * 牙弓宽度分析：显示测量线和宽度值
   */
  protected renderSpecificElements(data: AnalysisData): void {
    const { teeth_points, measurements } = data

    if (!teeth_points || teeth_points.length === 0) return

    // 渲染上颌牙弓宽度
    this.renderJawWidth(teeth_points, measurements?.upper as Record<string, unknown>)

    // 渲染下颌牙弓宽度
    this.renderJawWidth(teeth_points, measurements?.lower as Record<string, unknown>)
  }

  /**
   * 渲染测量标注
   */
  protected renderMeasurements(measurements: Record<string, unknown>): void {
    if (!measurements) return

    const upperData = measurements.upper as Record<string, unknown>
    const lowerData = measurements.lower as Record<string, unknown>

    // 上颌信息面板
    if (upperData) {
      const anteriorWidth = (upperData.anterior_width_mm as number) || 0
      const posteriorWidth = (upperData.posterior_width_mm as number) || 0

      const upperPanel = LabelRenderer.createInfoPanel(
        [
          { key: '上颌前牙弓宽度', value: `${anteriorWidth.toFixed(2)}mm` },
          { key: '上颌后牙弓宽度', value: `${posteriorWidth.toFixed(2)}mm` },
        ],
        {
          position: new THREE.Vector3(-25, 30, 0),
          fontSize: 13,
          backgroundColor: '#1976d2',
          fontColor: '#ffffff',
        },
      )
      this.group.add(upperPanel)
    }

    // 下颌信息面板
    if (lowerData) {
      const anteriorWidth = (lowerData.anterior_width_mm as number) || 0
      const posteriorWidth = (lowerData.posterior_width_mm as number) || 0

      const lowerPanel = LabelRenderer.createInfoPanel(
        [
          { key: '下颌前牙弓宽度', value: `${anteriorWidth.toFixed(2)}mm` },
          { key: '下颌后牙弓宽度', value: `${posteriorWidth.toFixed(2)}mm` },
        ],
        {
          position: new THREE.Vector3(25, 30, 0),
          fontSize: 13,
          backgroundColor: '#1976d2',
          fontColor: '#ffffff',
        },
      )
      this.group.add(lowerPanel)
    }
  }

  /**
   * 格式化测量数据为面板展示格式
   */
  protected formatMeasurements(measurements: Record<string, unknown>): MeasurementGroup[] {
    const upperData = measurements.upper as Record<string, unknown>
    const lowerData = measurements.lower as Record<string, unknown>

    const groups: MeasurementGroup[] = []

    // 上颌牙弓宽度
    if (upperData) {
      const anteriorWidth = (upperData.anterior_width_mm as number) || 0
      const posteriorWidth = (upperData.posterior_width_mm as number) || 0
      const anteriorTeeth = (upperData.anterior_measurement_teeth as number[]) || []
      const posteriorTeeth = (upperData.posterior_measurement_teeth as number[]) || []

      groups.push({
        groupName: '上颌牙弓宽度',
        children: [
          {
            name: '前牙弓宽度',
            value: `${anteriorWidth.toFixed(2)}mm`,
            result: '测量值',
          },
          {
            name: '测量牙位',
            value: anteriorTeeth.join('-'),
            result: '位置',
          },
          {
            name: '后牙弓宽度',
            value: `${posteriorWidth.toFixed(2)}mm`,
            result: '测量值',
          },
          {
            name: '测量牙位',
            value: posteriorTeeth.join('-'),
            result: '位置',
          },
        ],
      })
    }

    // 下颌牙弓宽度
    if (lowerData) {
      const anteriorWidth = (lowerData.anterior_width_mm as number) || 0
      const posteriorWidth = (lowerData.posterior_width_mm as number) || 0
      const anteriorTeeth = (lowerData.anterior_measurement_teeth as number[]) || []
      const posteriorTeeth = (lowerData.posterior_measurement_teeth as number[]) || []

      groups.push({
        groupName: '下颌牙弓宽度',
        children: [
          {
            name: '前牙弓宽度',
            value: `${anteriorWidth.toFixed(2)}mm`,
            result: '测量值',
          },
          {
            name: '测量牙位',
            value: anteriorTeeth.join('-'),
            result: '位置',
          },
          {
            name: '后牙弓宽度',
            value: `${posteriorWidth.toFixed(2)}mm`,
            result: '测量值',
          },
          {
            name: '测量牙位',
            value: posteriorTeeth.join('-'),
            result: '位置',
          },
        ],
      })
    }

    return groups
  }

  // ==================== 私有辅助方法 ====================

  /**
   * 渲染单个颌的牙弓宽度
   */
  private renderJawWidth(
    teethPoints: AnalysisData['teeth_points'],
    jawData: Record<string, unknown> | undefined,
  ): void {
    if (!jawData) return

    // 前牙弓宽度测量
    const anteriorTeeth = (jawData.anterior_measurement_teeth as number[]) || []
    if (anteriorTeeth.length === 2 && anteriorTeeth[0] && anteriorTeeth[1]) {
      this.renderWidthLine(
        teethPoints,
        anteriorTeeth[0],
        anteriorTeeth[1],
        (jawData.anterior_width_mm as number) || 0,
        0x00ff00, // 绿色
        '前',
      )
    }

    // 后牙弓宽度测量
    const posteriorTeeth = (jawData.posterior_measurement_teeth as number[]) || []
    if (posteriorTeeth.length === 2 && posteriorTeeth[0] && posteriorTeeth[1]) {
      this.renderWidthLine(
        teethPoints,
        posteriorTeeth[0],
        posteriorTeeth[1],
        (jawData.posterior_width_mm as number) || 0,
        0xff9800, // 橙色
        '后',
      )
    }
  }

  /**
   * 渲染宽度测量线
   */
  private renderWidthLine(
    teethPoints: AnalysisData['teeth_points'],
    fdi1: number,
    fdi2: number,
    width: number,
    color: number,
    label: string,
  ): void {
    // 找到两颗牙齿的点
    const tooth1Points = teethPoints.filter((p) => p.fdi === fdi1)
    const tooth2Points = teethPoints.filter((p) => p.fdi === fdi2)

    if (tooth1Points.length === 0 || tooth2Points.length === 0) return

    // 计算牙齿中心点（不缩放，因为会添加到 mesh）
    const center1 = this.calculatePointsCenterUnscaled(tooth1Points.map((p) => p.point))
    const center2 = this.calculatePointsCenterUnscaled(tooth2Points.map((p) => p.point))

    // 创建测量线（不缩放）
    const line = this.createLineUnscaled(center1, center2, color, 3)
    line.name = `line_${fdi1}_${fdi2}`

    // 使用方案2：智能添加线到 mesh
    this.addLineToMesh(line, fdi1, fdi2)

    // 渲染宽度标签（在线的中点，不缩放）
    const midPoint = new THREE.Vector3().addVectors(center1, center2).multiplyScalar(0.5)

    const widthLabel = LabelRenderer.createLabel(`${label}牙弓: ${width.toFixed(2)}mm`, {
      position: midPoint.clone().add(new THREE.Vector3(0, 3, 0)),
      fontSize: 12,
      backgroundColor: `#${color.toString(16).padStart(6, '0')}`,
      fontColor: '#ffffff',
    })
    widthLabel.name = `width_label_${fdi1}_${fdi2}`

    // 使用方案2：智能添加标签到 mesh
    this.addLineToMesh(widthLabel, fdi1, fdi2)

    // 渲染牙位标签（不缩放）
    const tooth1Label = LabelRenderer.createLabel(fdi1.toString(), {
      position: center1.clone().add(new THREE.Vector3(0, -2, 0)),
      fontSize: 10,
      backgroundColor: '#00000099',
      fontColor: '#ffffff',
    })
    tooth1Label.name = `tooth_label_${fdi1}`

    const tooth2Label = LabelRenderer.createLabel(fdi2.toString(), {
      position: center2.clone().add(new THREE.Vector3(0, -2, 0)),
      fontSize: 10,
      backgroundColor: '#00000099',
      fontColor: '#ffffff',
    })
    tooth2Label.name = `tooth_label_${fdi2}`

    // 使用方案2：直接添加到对应的 mesh
    this.addToMesh(tooth1Label, fdi1)
    this.addToMesh(tooth2Label, fdi2)
  }

  /**
   * 计算多个点的中心（缩放版本，用于添加到 group）
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
}
