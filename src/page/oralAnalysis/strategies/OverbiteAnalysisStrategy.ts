import * as THREE from 'three'
import { BaseAnalysisStrategy } from './base/BaseAnalysisStrategy'
import type { AnalysisData, MeasurementGroup, RenderType } from '../types'
import { LineRenderer, LabelRenderer } from '../renderers'

/**
 * 覆盖度分析策略
 * 分析前牙垂直覆盖关系
 */
export class OverbiteAnalysisStrategy extends BaseAnalysisStrategy {
  readonly id = 'overbite'
  readonly name = '覆盖度分析'
  readonly taskName = 'overbite'
  readonly renderType: RenderType = 'POINT_ONLY'

  /**
   * 渲染特定元素
   * 覆盖度分析主要渲染：切端点之间的垂直参考线
   */
  protected renderSpecificElements(data: AnalysisData): void {
    const { teeth_points } = data

    if (!teeth_points || teeth_points.length === 0) return

    // 找到所有切端点和龈缘点
    const incisalPoints = teeth_points.filter((p) => p.type === 'incisal_edge')
    const gingivaPoints = teeth_points.filter((p) => p.type === 'gingiva_margin')

    // 为每对点添加垂直参考线（虚线）
    incisalPoints.forEach((ip) => {
      const gp = gingivaPoints.find((g) => g.fdi === ip.fdi)
      if (gp) {
        // 创建虚线连接
        const line = LineRenderer.createDashedLine(ip.point, gp.point, {
          color: 0xff6b6b,
          dashSize: 0.5,
          gapSize: 0.3,
          lineWidth: 1,
        })
        line.name = `overbite_line_${ip.fdi}`
        this.group.add(line)
      }
    })

    // 高亮显示关键的前牙切端点
    const anteriorTeeth = [11, 12, 13, 21, 22, 23, 31, 32, 33, 41, 42, 43]
    incisalPoints
      .filter((p) => anteriorTeeth.includes(p.fdi))
      .forEach((p) => {
        // 给前牙切端点添加更大的标记
        const geometry = new THREE.SphereGeometry(0.7, 16, 16)
        const material = new THREE.MeshPhongMaterial({
          color: 0xff0000,
          emissive: 0xff0000,
          emissiveIntensity: 0.5,
          transparent: true,
          opacity: 0.8,
        })
        const sphere = new THREE.Mesh(geometry, material)

        const scale = 1.5
        sphere.position.set(p.point[0] * scale, p.point[1] * scale, p.point[2] * scale)
        sphere.name = `highlight_${p.fdi}`
        this.group.add(sphere)
      })
  }

  /**
   * 渲染测量标注
   */
  protected renderMeasurements(measurements: Record<string, unknown>): void {
    if (!measurements) return

    // 解析测量数据
    const H_total = (measurements.H_total as number) || 0
    const H_overlap = (measurements.H_overlap as number) || 0
    const diagnosis = (measurements.diagnosis as string) || '正常'

    // 创建信息面板
    const labelData = [
      { key: 'H总', value: `${H_total.toFixed(2)}mm` },
      { key: '重叠', value: `${H_overlap.toFixed(2)}mm` },
      { key: '诊断', value: diagnosis },
    ]

    const infoPanel = LabelRenderer.createInfoPanel(labelData, {
      position: new THREE.Vector3(0, 30, 0),
      fontSize: 14,
      backgroundColor: '#285e50',
      fontColor: '#ffffff',
    })

    this.group.add(infoPanel)

    // 如果有异常，添加警告标签
    if (diagnosis.includes('深覆') || diagnosis.includes('异常')) {
      const warningLabel = LabelRenderer.createLabel('⚠️ 注意', {
        position: new THREE.Vector3(0, 35, 0),
        fontSize: 12,
        backgroundColor: '#ff6b6b',
        fontColor: '#ffffff',
      })
      this.group.add(warningLabel)
    }
  }

  /**
   * 格式化测量数据为面板展示格式
   */
  protected formatMeasurements(measurements: Record<string, unknown>): MeasurementGroup[] {
    const H_total = (measurements.H_total as number) || 0
    const H_overlap = (measurements.H_overlap as number) || 0
    const diagnosis = (measurements.diagnosis as string) || '正常'
    const percentage = (measurements.percentage as number) || 0

    return [
      {
        groupName: '覆盖度测量',
        children: [
          {
            name: 'H总（垂直距离）',
            value: `${H_total.toFixed(2)}mm`,
            result: H_total > 0 ? '正常' : '异常',
          },
          {
            name: 'H重叠（重叠量）',
            value: `${H_overlap.toFixed(2)}mm`,
            result: H_overlap < 3 ? '正常' : '深覆',
          },
          {
            name: '覆盖百分比',
            value: `${percentage.toFixed(1)}%`,
            result: percentage < 50 ? '正常' : '深覆',
          },
          {
            name: '诊断结果',
            value: diagnosis,
            result: diagnosis.includes('正常') ? '正常' : '异常',
          },
        ],
      },
    ]
  }
}
