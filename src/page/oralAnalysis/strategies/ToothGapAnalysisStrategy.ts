import * as THREE from 'three'
import { BaseAnalysisStrategy } from './base/BaseAnalysisStrategy'
import type { AnalysisData, MeasurementGroup, RenderType } from '../types'
import { LineRenderer, LabelRenderer } from '../renderers'

/**
 * 牙齿间隙分析策略
 * 分析牙齿之间的间隙
 */
export class ToothGapAnalysisStrategy extends BaseAnalysisStrategy {
  readonly id = 'tooth-gap'
  readonly name = '牙齿间隙分析'
  readonly taskName = 'tooth-gap'
  readonly renderType: RenderType = 'POINT_LINE'

  /**
   * 渲染特定元素
   * 牙齿间隙分析：显示间隙位置和大小
   */
  protected renderSpecificElements(data: AnalysisData): void {
    const { teeth_points, measurements } = data

    if (!teeth_points || teeth_points.length === 0) return

    // 获取间隙列表
    const gaps = (measurements?.gaps as Array<Record<string, unknown>>) || []

    // 渲染每个间隙
    gaps.forEach((gap, index) => {
      this.renderGap(teeth_points, gap, index)
    })
  }

  /**
   * 渲染测量标注
   */
  protected renderMeasurements(measurements: Record<string, unknown>): void {
    if (!measurements) return

    const totalGaps = ((measurements.gaps as Array<Record<string, unknown>>) || []).length
    const totalGapSize = (measurements.total_gap_size_mm as number) || 0
    const diagnosis = (measurements.diagnosis as string) || '正常'

    // 创建统计信息面板
    const infoData = [
      { key: '间隙数量', value: `${totalGaps}处` },
      { key: '总间隙大小', value: `${totalGapSize.toFixed(2)}mm` },
      { key: '诊断结果', value: diagnosis },
    ]

    const infoPanel = LabelRenderer.createInfoPanel(infoData, {
      position: new THREE.Vector3(0, 30, 0),
      fontSize: 14,
      backgroundColor: totalGaps > 0 ? '#ff9800' : '#22c55e',
      fontColor: '#ffffff',
    })

    this.group.add(infoPanel)
  }

  /**
   * 格式化测量数据为面板展示格式
   */
  protected formatMeasurements(measurements: Record<string, unknown>): MeasurementGroup[] {
    const gaps = (measurements.gaps as Array<Record<string, unknown>>) || []
    const totalGapSize = (measurements.total_gap_size_mm as number) || 0
    const diagnosis = (measurements.diagnosis as string) || '正常'

    const children = [
      {
        name: '间隙总数',
        value: `${gaps.length}处`,
        result: gaps.length === 0 ? '正常' : '存在间隙',
      },
      {
        name: '总间隙大小',
        value: `${totalGapSize.toFixed(2)}mm`,
        result: '测量值',
      },
      {
        name: '诊断结果',
        value: diagnosis,
        result: diagnosis.includes('正常') ? '正常' : '异常',
      },
    ]

    // 添加每个间隙的详细信息
    gaps.forEach((gap, index) => {
      const between = gap.between as number[]
      const size = (gap.size_mm as number) || 0
      const location = (gap.location as string) || '未知'

      children.push({
        name: `间隙 ${index + 1} (${between.join('-')})`,
        value: `${size.toFixed(2)}mm`,
        result: location,
      })
    })

    return [
      {
        groupName: '牙齿间隙分析',
        children,
      },
    ]
  }

  // ==================== 私有辅助方法 ====================

  /**
   * 渲染单个间隙
   */
  private renderGap(
    teethPoints: AnalysisData['teeth_points'],
    gap: Record<string, unknown>,
    index: number,
  ): void {
    const between = gap.between as number[]
    const size = (gap.size_mm as number) || 0

    if (!between || between.length !== 2) return

    // 找到两颗牙齿的点
    const tooth1Points = teethPoints.filter((p) => p.fdi === between[0])
    const tooth2Points = teethPoints.filter((p) => p.fdi === between[1])

    if (tooth1Points.length === 0 || tooth2Points.length === 0) return

    // 计算牙齿中心点
    const center1 = this.calculatePointsCenter(tooth1Points.map((p) => p.point))
    const center2 = this.calculatePointsCenter(tooth2Points.map((p) => p.point))

    // 根据间隙大小选择颜色
    const color = this.getGapColor(size)

    // 渲染间隙线（虚线）
    const line = LineRenderer.createDashedLine(center1, center2, {
      color,
      lineWidth: 2,
      dashSize: 0.5,
      gapSize: 0.3,
    })
    this.group.add(line)

    // 渲染端点标记
    const marker1 = LineRenderer.createPoint(center1, { color, size: 1.0 })
    const marker2 = LineRenderer.createPoint(center2, { color, size: 1.0 })
    this.group.add(marker1)
    this.group.add(marker2)

    // 渲染间隙大小标签
    const midPoint = new THREE.Vector3()
      .addVectors(center1, center2)
      .multiplyScalar(0.5)

    const gapLabel = LabelRenderer.createMeasurementLabel(
      `${size.toFixed(2)}mm`,
      midPoint.clone().add(new THREE.Vector3(0, 2, 0)),
      {
        fontSize: 11,
        backgroundColor: `#${color.toString(16).padStart(6, '0')}`,
        fontColor: '#ffffff',
      },
    )
    this.group.add(gapLabel)

    // 渲染牙位标签
    const toothLabel = LabelRenderer.createLabel(`${between[0]}-${between[1]}`, {
      position: midPoint.clone().add(new THREE.Vector3(0, -2, 0)),
      fontSize: 10,
      backgroundColor: '#00000099',
      fontColor: '#ffffff',
    })
    this.group.add(toothLabel)
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
   * 根据间隙大小获取颜色
   */
  private getGapColor(size: number): number {
    if (size < 0.5) return 0x22c55e // 绿色 - 正常
    if (size < 2.0) return 0xff9800 // 橙色 - 轻度间隙
    return 0xff0000 // 红色 - 显著间隙
  }
}

