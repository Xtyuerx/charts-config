import { BaseAnalysisStrategy } from './base/BaseAnalysisStrategy'
import type { AnalysisData, MeasurementGroup, RenderType } from '../types'
import { LabelRenderer } from '../renderers'
import * as THREE from 'three'

/**
 * 牙号分析策略
 * 显示每颗牙齿的FDI编号和颜色标识
 */
export class ToothNumberAnalysisStrategy extends BaseAnalysisStrategy {
  readonly id = 'tooth-number'
  readonly name = '牙号'
  readonly taskName = 'tooth-number'
  readonly renderType: RenderType = 'LABEL_ONLY'

  /**
   * 渲染特定元素
   * 牙号分析主要渲染：每颗牙齿的编号标签
   */
  protected renderSpecificElements(data: AnalysisData): void {
    const { teeth_points } = data

    if (!teeth_points || teeth_points.length === 0) return

    // 按牙齿分组（每颗牙齿可能有多个点位）
    const toothGroups = this.groupByFDI(teeth_points)

    // 为每颗牙齿创建编号标签
    Object.entries(toothGroups).forEach(([fdiStr, points]) => {
      const fdi = Number(fdiStr)

      // 计算牙齿中心点（所有点位的平均位置）
      const center = this.calculateCenter(points.map((p) => p.point))

      // 创建牙齿编号标签
      const label = LabelRenderer.createLabel(fdiStr, {
        position: center,
        fontSize: 14,
        backgroundColor: 'transparent', // 透明背景
        fontColor: '#ffffff',
      })
      label.name = `label_${fdi}`

      // 使用方案2：直接添加到对应的 mesh
      this.addToMesh(label, fdi)
    })
  }

  /**
   * 渲染测量标注
   */
  protected renderMeasurements(measurements: Record<string, unknown>): void {
    // 创建统计信息面板
    const totalTeeth = (measurements.total_teeth as number) || 0
    const upperTeeth = (measurements.upper_teeth as number) || 0
    const lowerTeeth = (measurements.lower_teeth as number) || 0

    const infoData = [
      { key: '总牙齿数', value: `${totalTeeth}颗` },
      { key: '上颌', value: `${upperTeeth}颗` },
      { key: '下颌', value: `${lowerTeeth}颗` },
    ]

    const infoPanel = LabelRenderer.createInfoPanel(infoData, {
      position: new THREE.Vector3(0, 30, 0),
      fontSize: 14,
      backgroundColor: '#1976d2',
      fontColor: '#ffffff',
    })

    this.group.add(infoPanel)
  }

  /**
   * 格式化测量数据为面板展示格式
   */
  protected formatMeasurements(measurements: Record<string, unknown>): MeasurementGroup[] {
    const totalTeeth = (measurements.total_teeth as number) || 0
    const upperTeeth = (measurements.upper_teeth as number) || 0
    const lowerTeeth = (measurements.lower_teeth as number) || 0
    const missingTeeth = (measurements.missing_teeth as number[]) || []

    return [
      {
        groupName: '牙齿统计',
        children: [
          {
            name: '总牙齿数',
            value: `${totalTeeth}颗`,
            result: totalTeeth === 32 ? '完整' : '缺失',
          },
          {
            name: '上颌牙齿',
            value: `${upperTeeth}颗`,
            result: upperTeeth === 16 ? '完整' : '部分',
          },
          {
            name: '下颌牙齿',
            value: `${lowerTeeth}颗`,
            result: lowerTeeth === 16 ? '完整' : '部分',
          },
          {
            name: '缺失牙齿',
            value: missingTeeth.length > 0 ? missingTeeth.join(', ') : '无',
            result: missingTeeth.length === 0 ? '正常' : '异常',
          },
        ],
      },
    ]
  }

  // ==================== 私有辅助方法 ====================

  /**
   * 按FDI编号分组
   */
  private groupByFDI(
    points: AnalysisData['teeth_points'],
  ): Record<string, AnalysisData['teeth_points']> {
    return points.reduce(
      (acc, point) => {
        const fdi = point.fdi.toString()
        if (!acc[fdi]) {
          acc[fdi] = []
        }
        acc[fdi].push(point)
        return acc
      },
      {} as Record<string, AnalysisData['teeth_points']>,
    )
  }

  /**
   * 计算多个点的中心位置
   * 注意：不需要应用缩放，因为标签是 mesh 的子对象，会自动继承 mesh 的缩放
   */
  private calculateCenter(points: number[][]): THREE.Vector3 {
    const sum = points.reduce(
      (acc, p) => {
        acc.x += p[0] || 0
        acc.y += p[1] || 0
        acc.z += p[2] || 0
        return acc
      },
      { x: 0, y: 0, z: 0 },
    )

    // 返回原始坐标（不缩放），因为会继承父 mesh 的缩放
    return new THREE.Vector3(sum.x / points.length, sum.y / points.length, sum.z / points.length)
  }
}
