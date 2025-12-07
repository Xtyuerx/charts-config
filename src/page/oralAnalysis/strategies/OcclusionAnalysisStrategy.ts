import * as THREE from 'three'
import { BaseAnalysisStrategy } from './base/BaseAnalysisStrategy'
import type { AnalysisData, MeasurementGroup, RenderType } from '../types'
import { LineRenderer, LabelRenderer } from '../renderers'

/**
 * 咬合关系分析策略
 * 分析尖牙关系和磨牙关系
 */
export class OcclusionAnalysisStrategy extends BaseAnalysisStrategy {
  readonly id = 'occlusion'
  readonly name = '咬合关系'
  readonly taskName = 'occlusal-relationship'
  readonly renderType: RenderType = 'POINT_ONLY'

  /**
   * 渲染特定元素
   * 咬合关系分析：显示尖牙和磨牙的咬合关系
   */
  protected renderSpecificElements(data: AnalysisData): void {
    const { teeth_points, measurements } = data

    if (!teeth_points || teeth_points.length === 0) return

    // 渲染尖牙关系
    this.renderCanineRelationship(teeth_points, measurements?.canine as Record<string, unknown>)

    // 渲染磨牙关系
    this.renderMolarRelationship(teeth_points, measurements?.molar as Record<string, unknown>)
  }

  /**
   * 渲染测量标注
   */
  protected renderMeasurements(measurements: Record<string, unknown>): void {
    if (!measurements) return

    const canineData = measurements.canine as Record<string, unknown>
    const molarData = measurements.molar as Record<string, unknown>

    // 尖牙关系信息面板
    if (canineData) {
      const leftClass = (canineData.left_classification as string) || '未知'
      const rightClass = (canineData.right_classification as string) || '未知'

      const caninePanel = LabelRenderer.createInfoPanel(
        [
          { key: '尖牙关系', value: '' },
          { key: '左侧', value: leftClass },
          { key: '右侧', value: rightClass },
        ],
        {
          position: new THREE.Vector3(-25, 30, 0),
          fontSize: 13,
          backgroundColor: this.getClassificationColor(leftClass),
          fontColor: '#ffffff',
        },
      )
      this.group.add(caninePanel)
    }

    // 磨牙关系信息面板
    if (molarData) {
      const leftClass = (molarData.left_classification as string) || '未知'
      const rightClass = (molarData.right_classification as string) || '未知'

      const molarPanel = LabelRenderer.createInfoPanel(
        [
          { key: '磨牙关系', value: '' },
          { key: '左侧', value: leftClass },
          { key: '右侧', value: rightClass },
        ],
        {
          position: new THREE.Vector3(25, 30, 0),
          fontSize: 13,
          backgroundColor: this.getClassificationColor(leftClass),
          fontColor: '#ffffff',
        },
      )
      this.group.add(molarPanel)
    }
  }

  /**
   * 格式化测量数据为面板展示格式
   */
  protected formatMeasurements(measurements: Record<string, unknown>): MeasurementGroup[] {
    const canineData = measurements.canine as Record<string, unknown>
    const molarData = measurements.molar as Record<string, unknown>

    const groups: MeasurementGroup[] = []

    // 尖牙关系
    if (canineData) {
      const leftClass = (canineData.left_classification as string) || '未知'
      const rightClass = (canineData.right_classification as string) || '未知'
      const leftTeeth = (canineData.left_measurement_teeth as number[]) || []
      const rightTeeth = (canineData.right_measurement_teeth as number[]) || []

      groups.push({
        groupName: '尖牙关系',
        children: [
          {
            name: '左侧分类',
            value: leftClass,
            result: this.evaluateClassification(leftClass),
          },
          {
            name: '左侧牙位',
            value: leftTeeth.join('-'),
            result: '位置',
          },
          {
            name: '右侧分类',
            value: rightClass,
            result: this.evaluateClassification(rightClass),
          },
          {
            name: '右侧牙位',
            value: rightTeeth.join('-'),
            result: '位置',
          },
        ],
      })
    }

    // 磨牙关系
    if (molarData) {
      const leftClass = (molarData.left_classification as string) || '未知'
      const rightClass = (molarData.right_classification as string) || '未知'
      const leftTeeth = (molarData.left_measurement_teeth as number[]) || []
      const rightTeeth = (molarData.right_measurement_teeth as number[]) || []

      groups.push({
        groupName: '磨牙关系',
        children: [
          {
            name: '左侧分类',
            value: leftClass,
            result: this.evaluateClassification(leftClass),
          },
          {
            name: '左侧牙位',
            value: leftTeeth.join('-'),
            result: '位置',
          },
          {
            name: '右侧分类',
            value: rightClass,
            result: this.evaluateClassification(rightClass),
          },
          {
            name: '右侧牙位',
            value: rightTeeth.join('-'),
            result: '位置',
          },
        ],
      })
    }

    return groups
  }

  // ==================== 私有辅助方法 ====================

  /**
   * 渲染尖牙关系
   */
  private renderCanineRelationship(
    teethPoints: AnalysisData['teeth_points'],
    canineData: Record<string, unknown> | undefined,
  ): void {
    if (!canineData) return

    // 渲染左侧尖牙关系
    this.renderSideRelationship(
      teethPoints,
      canineData.left_measurement_teeth as number[],
      canineData.left_classification as string,
      '尖牙',
      -15,
    )

    // 渲染右侧尖牙关系
    this.renderSideRelationship(
      teethPoints,
      canineData.right_measurement_teeth as number[],
      canineData.right_classification as string,
      '尖牙',
      15,
    )
  }

  /**
   * 渲染磨牙关系
   */
  private renderMolarRelationship(
    teethPoints: AnalysisData['teeth_points'],
    molarData: Record<string, unknown> | undefined,
  ): void {
    if (!molarData) return

    // 渲染左侧磨牙关系
    this.renderSideRelationship(
      teethPoints,
      molarData.left_measurement_teeth as number[],
      molarData.left_classification as string,
      '磨牙',
      -15,
    )

    // 渲染右侧磨牙关系
    this.renderSideRelationship(
      teethPoints,
      molarData.right_measurement_teeth as number[],
      molarData.right_classification as string,
      '磨牙',
      15,
    )
  }

  /**
   * 渲染单侧咬合关系
   */
  private renderSideRelationship(
    teethPoints: AnalysisData['teeth_points'],
    teeth: number[] | undefined,
    classification: string | undefined,
    type: string,
    xOffset: number,
  ): void {
    if (!teeth || teeth.length === 0 || !classification) return

    // 获取颜色
    const color = this.getClassificationColorNum(classification)

    // 为每颗牙齿渲染标记
    teeth.forEach((fdi) => {
      const toothPoints = teethPoints.filter((p) => p.fdi === fdi)
      if (toothPoints.length === 0) return

      const center = this.calculatePointsCenter(toothPoints.map((p) => p.point))

      // 创建标记球体
      const geometry = new THREE.SphereGeometry(1.2, 32, 32)
      const material = new THREE.MeshPhongMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.5,
        transparent: true,
        opacity: 0.8,
      })
      const sphere = new THREE.Mesh(geometry, material)
      sphere.position.copy(center)
      sphere.name = `occlusion_${fdi}`
      this.group.add(sphere)

      // 添加牙位标签
      const toothLabel = LabelRenderer.createLabel(fdi.toString(), {
        position: center.clone().add(new THREE.Vector3(0, 2, 0)),
        fontSize: 10,
        backgroundColor: '#00000099',
        fontColor: '#ffffff',
      })
      this.group.add(toothLabel)
    })

    // 如果有多颗牙齿，连接它们
    if (teeth.length > 1) {
      const centers = teeth
        .map((fdi) => {
          const toothPoints = teethPoints.filter((p) => p.fdi === fdi)
          if (toothPoints.length === 0) return null
          return this.calculatePointsCenter(toothPoints.map((p) => p.point))
        })
        .filter((c): c is THREE.Vector3 => c !== null)

      for (let i = 0; i < centers.length - 1; i++) {
        const line = LineRenderer.createDashedLine(centers[i], centers[i + 1], {
          color,
          lineWidth: 2,
          dashSize: 0.5,
          gapSize: 0.3,
        })
        this.group.add(line)
      }
    }

    // 添加分类标签
    const firstTooth = teethPoints.filter((p) => p.fdi === teeth[0])
    if (firstTooth.length > 0) {
      const center = this.calculatePointsCenter(firstTooth.map((p) => p.point))
      const classLabel = LabelRenderer.createLabel(`${type}: ${classification}`, {
        position: center.clone().add(new THREE.Vector3(xOffset, 5, 0)),
        fontSize: 12,
        backgroundColor: `#${color.toString(16).padStart(6, '0')}`,
        fontColor: '#ffffff',
      })
      this.group.add(classLabel)
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
   * 根据分类获取颜色（字符串）
   */
  private getClassificationColor(classification: string): string {
    if (classification.includes('I类') || classification.includes('正常')) return '#22c55e'
    if (classification.includes('II类')) return '#ff9800'
    if (classification.includes('III类')) return '#ff6b6b'
    return '#9e9e9e'
  }

  /**
   * 根据分类获取颜色（数值）
   */
  private getClassificationColorNum(classification: string): number {
    if (classification.includes('I类') || classification.includes('正常')) return 0x22c55e
    if (classification.includes('II类')) return 0xff9800
    if (classification.includes('III类')) return 0xff6b6b
    return 0x9e9e9e
  }

  /**
   * 评估分类
   */
  private evaluateClassification(classification: string): string {
    if (classification.includes('I类') || classification.includes('正常')) return '正常'
    return '需要关注'
  }
}

