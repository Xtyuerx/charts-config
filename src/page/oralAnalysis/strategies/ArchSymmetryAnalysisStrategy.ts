import * as THREE from 'three'
import { BaseAnalysisStrategy } from './base/BaseAnalysisStrategy'
import type { AnalysisData, MeasurementGroup, RenderType } from '../types'
import { LabelRenderer, SliceRenderer } from '../renderers'

/**
 * 牙弓对称性分析策略
 * 分析上下颌牙弓的左右对称性
 */
export class ArchSymmetryAnalysisStrategy extends BaseAnalysisStrategy {
  readonly id = 'arch-symmetry'
  readonly name = '牙弓对称性'
  readonly taskName = 'arch-symmetry'
  readonly renderType: RenderType = 'POINT_LINE'

  /**
   * 渲染特定元素
   * 牙弓对称性分析：显示中线、对称点和测量线
   */
  protected renderSpecificElements(data: AnalysisData): void {
    const { teeth_points, measurements } = data

    if (!teeth_points || teeth_points.length === 0) return

    // 渲染中线参考面
    this.renderMidline(measurements)

    // 渲染上颌对称性
    this.renderJawSymmetry(teeth_points, measurements?.upper as Record<string, unknown>)

    // 渲染下颌对称性
    this.renderJawSymmetry(teeth_points, measurements?.lower as Record<string, unknown>)
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
      const symmetryIndex = (upperData.symmetry_index as number) || 0
      const classification = (upperData.classification as string) || '对称'

      const upperPanel = LabelRenderer.createInfoPanel(
        [
          { key: '上颌对称性指数', value: symmetryIndex.toFixed(2) },
          { key: '分类', value: classification },
        ],
        {
          position: new THREE.Vector3(-25, 30, 0),
          fontSize: 13,
          backgroundColor: this.getSymmetryColor(symmetryIndex),
          fontColor: '#ffffff',
        },
      )
      this.group.add(upperPanel)
    }

    // 下颌信息面板
    if (lowerData) {
      const symmetryIndex = (lowerData.symmetry_index as number) || 0
      const classification = (lowerData.classification as string) || '对称'

      const lowerPanel = LabelRenderer.createInfoPanel(
        [
          { key: '下颌对称性指数', value: symmetryIndex.toFixed(2) },
          { key: '分类', value: classification },
        ],
        {
          position: new THREE.Vector3(25, 30, 0),
          fontSize: 13,
          backgroundColor: this.getSymmetryColor(symmetryIndex),
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

    // 上颌对称性
    if (upperData) {
      const symmetryIndex = (upperData.symmetry_index as number) || 0
      const classification = (upperData.classification as string) || '对称'
      const leftDeviation = (upperData.left_deviation_mm as number) || 0
      const rightDeviation = (upperData.right_deviation_mm as number) || 0

      groups.push({
        groupName: '上颌牙弓对称性',
        children: [
          {
            name: '对称性指数',
            value: symmetryIndex.toFixed(2),
            result: this.evaluateSymmetry(symmetryIndex),
          },
          {
            name: '分类',
            value: classification,
            result: classification.includes('对称') ? '正常' : '异常',
          },
          {
            name: '左侧偏差',
            value: `${Math.abs(leftDeviation).toFixed(2)}mm`,
            result: '测量值',
          },
          {
            name: '右侧偏差',
            value: `${Math.abs(rightDeviation).toFixed(2)}mm`,
            result: '测量值',
          },
        ],
      })
    }

    // 下颌对称性
    if (lowerData) {
      const symmetryIndex = (lowerData.symmetry_index as number) || 0
      const classification = (lowerData.classification as string) || '对称'
      const leftDeviation = (lowerData.left_deviation_mm as number) || 0
      const rightDeviation = (lowerData.right_deviation_mm as number) || 0

      groups.push({
        groupName: '下颌牙弓对称性',
        children: [
          {
            name: '对称性指数',
            value: symmetryIndex.toFixed(2),
            result: this.evaluateSymmetry(symmetryIndex),
          },
          {
            name: '分类',
            value: classification,
            result: classification.includes('对称') ? '正常' : '异常',
          },
          {
            name: '左侧偏差',
            value: `${Math.abs(leftDeviation).toFixed(2)}mm`,
            result: '测量值',
          },
          {
            name: '右侧偏差',
            value: `${Math.abs(rightDeviation).toFixed(2)}mm`,
            result: '测量值',
          },
        ],
      })
    }

    return groups
  }

  // ==================== 私有辅助方法 ====================

  /**
   * 渲染中线参考面
   */
  private renderMidline(measurements: Record<string, unknown> | undefined): void {
    if (!measurements) return

    // 创建中线平面（垂直于X轴）
    const midlinePlane = SliceRenderer.createMidlinePlane([0, -40, 0], [0, 40, 0], {
      color: 0x4caf50,
      opacity: 0.15,
      showBorder: true,
    })

    this.group.add(midlinePlane)

    // 添加中线标签
    const midlineLabel = LabelRenderer.createLabel('中线参考', {
      position: new THREE.Vector3(0, 35, 0),
      fontSize: 12,
      backgroundColor: '#4caf50',
      fontColor: '#ffffff',
    })
    this.group.add(midlineLabel)
  }

  /**
   * 渲染单个颌的对称性
   */
  private renderJawSymmetry(
    teethPoints: AnalysisData['teeth_points'],
    jawData: Record<string, unknown> | undefined,
  ): void {
    if (!jawData) return

    // 获取对称点对
    const symmetryPairs = (jawData.symmetry_pairs as Array<Record<string, unknown>>) || []

    symmetryPairs.forEach((pair) => {
      const leftFDI = pair.left_fdi as number
      const rightFDI = pair.right_fdi as number
      const deviation = (pair.deviation_mm as number) || 0

      // 找到左右两颗牙齿的点
      const leftPoints = teethPoints.filter((p) => p.fdi === leftFDI)
      const rightPoints = teethPoints.filter((p) => p.fdi === rightFDI)

      if (leftPoints.length === 0 || rightPoints.length === 0) return

      // 计算牙齿中心点（不缩放）
      const leftCenter = this.calculatePointsCenterUnscaled(leftPoints.map((p) => p.point))
      const rightCenter = this.calculatePointsCenterUnscaled(rightPoints.map((p) => p.point))

      // 根据偏差大小选择颜色
      const color = this.getDeviationColor(deviation)

      // 渲染对称连接线（使用不缩放版本）
      const line = this.createDashedLineUnscaled(leftCenter, rightCenter, color, 2)
      this.addLineToMesh(line, leftFDI, rightFDI)

      // 渲染端点标记（不缩放）
      const leftMarker = this.createPointMarkerUnscaled(leftCenter, color, 0.8)
      const rightMarker = this.createPointMarkerUnscaled(rightCenter, color, 0.8)
      this.addToMesh(leftMarker, leftFDI)
      this.addToMesh(rightMarker, rightFDI)

      // 如果偏差明显，添加偏差标签
      if (Math.abs(deviation) > 1.0) {
        const midPoint = new THREE.Vector3().addVectors(leftCenter, rightCenter).multiplyScalar(0.5)

        const deviationLabel = LabelRenderer.createLabel(
          `偏差: ${Math.abs(deviation).toFixed(1)}mm`,
          {
            position: midPoint.clone().add(new THREE.Vector3(0, 2, 0)),
            fontSize: 10,
            backgroundColor: `#${color.toString(16).padStart(6, '0')}`,
            fontColor: '#ffffff',
          },
        )
        deviationLabel.name = `deviation_label_${leftFDI}_${rightFDI}`
        this.addLineToMesh(deviationLabel, leftFDI, rightFDI)
      }
    })
  }

  /**
   * 创建不缩放的虚线
   */
  private createDashedLineUnscaled(
    start: THREE.Vector3,
    end: THREE.Vector3,
    color: number,
    lineWidth: number,
  ): THREE.Line {
    const points = [start, end]
    const geometry = new THREE.BufferGeometry().setFromPoints(points)

    const material = new THREE.LineDashedMaterial({
      color,
      linewidth: lineWidth,
      dashSize: 1.0,
      gapSize: 0.5,
    })

    const line = new THREE.Line(geometry, material)
    line.computeLineDistances() // 虚线必须调用
    line.name = 'dashed_line'

    return line
  }

  /**
   * 创建不缩放的点标记
   */
  private createPointMarkerUnscaled(
    position: THREE.Vector3,
    color: number,
    size: number,
  ): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(size, 16, 16)
    const material = new THREE.MeshPhongMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.3,
    })

    const sphere = new THREE.Mesh(geometry, material)
    sphere.position.copy(position)
    sphere.name = 'point_marker'

    return sphere
  }

  /**
   * 根据对称性指数获取颜色
   */
  private getSymmetryColor(index: number): string {
    if (index >= 0.9) return '#22c55e' // 绿色 - 良好对称
    if (index >= 0.7) return '#ff9800' // 橙色 - 轻度不对称
    return '#ff0000' // 红色 - 明显不对称
  }

  /**
   * 根据偏差大小获取颜色
   */
  private getDeviationColor(deviation: number): number {
    const absDev = Math.abs(deviation)
    if (absDev <= 1.0) return 0x22c55e // 绿色 - 正常
    if (absDev <= 2.0) return 0xff9800 // 橙色 - 轻度偏差
    return 0xff0000 // 红色 - 明显偏差
  }

  /**
   * 评估对称性
   */
  private evaluateSymmetry(index: number): string {
    if (index >= 0.9) return '良好对称'
    if (index >= 0.7) return '轻度不对称'
    return '明显不对称'
  }
}
