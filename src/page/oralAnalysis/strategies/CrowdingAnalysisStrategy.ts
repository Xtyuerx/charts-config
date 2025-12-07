import * as THREE from 'three'
import { BaseAnalysisStrategy } from './base/BaseAnalysisStrategy'
import type { AnalysisData, MeasurementGroup, RenderType } from '../types'
import { LabelRenderer } from '../renderers'

/**
 * 拥挤度分析策略
 * 分析上下颌牙齿的拥挤程度
 */
export class CrowdingAnalysisStrategy extends BaseAnalysisStrategy {
  readonly id = 'crowding'
  readonly name = '拥挤度'
  readonly taskName = 'tooth-crowding-degree'
  readonly renderType: RenderType = 'POINT_ONLY'

  /**
   * 渲染特定元素
   * 拥挤度分析：显示牙齿间距和拥挤区域
   */
  protected renderSpecificElements(data: AnalysisData): void {
    const { teeth_points, measurements } = data

    if (!teeth_points || teeth_points.length === 0) return

    // 渲染上颌拥挤度
    this.renderJawCrowding(
      teeth_points,
      measurements?.upper as Record<string, unknown>,
      true,
    )

    // 渲染下颌拥挤度
    this.renderJawCrowding(
      teeth_points,
      measurements?.lower as Record<string, unknown>,
      false,
    )
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
      const upperCrowding = (upperData.crowding_degree_mm as number) || 0
      const upperClassification = (upperData.classification as string) || '正常'

      const upperPanel = LabelRenderer.createInfoPanel(
        [
          { key: '上颌拥挤度', value: `${upperCrowding.toFixed(2)}mm` },
          { key: '分类', value: upperClassification },
        ],
        {
          position: new THREE.Vector3(-25, 30, 0),
          fontSize: 13,
          backgroundColor: this.getCrowdingColor(upperCrowding),
          fontColor: '#ffffff',
        },
      )
      this.group.add(upperPanel)
    }

    // 下颌信息面板
    if (lowerData) {
      const lowerCrowding = (lowerData.crowding_degree_mm as number) || 0
      const lowerClassification = (lowerData.classification as string) || '正常'

      const lowerPanel = LabelRenderer.createInfoPanel(
        [
          { key: '下颌拥挤度', value: `${lowerCrowding.toFixed(2)}mm` },
          { key: '分类', value: lowerClassification },
        ],
        {
          position: new THREE.Vector3(25, 30, 0),
          fontSize: 13,
          backgroundColor: this.getCrowdingColor(lowerCrowding),
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

    // 上颌拥挤度
    if (upperData) {
      const crowding = (upperData.crowding_degree_mm as number) || 0
      const classification = (upperData.classification as string) || '正常'
      const availableSpace = (upperData.available_space_mm as number) || 0
      const requiredSpace = (upperData.required_space_mm as number) || 0

      groups.push({
        groupName: '上颌拥挤度',
        children: [
          {
            name: '拥挤度',
            value: `${crowding.toFixed(2)}mm`,
            result: this.evaluateCrowding(crowding),
          },
          {
            name: '分类',
            value: classification,
            result: classification.includes('正常') ? '正常' : '异常',
          },
          {
            name: '可用间隙',
            value: `${availableSpace.toFixed(2)}mm`,
            result: '测量值',
          },
          {
            name: '所需间隙',
            value: `${requiredSpace.toFixed(2)}mm`,
            result: '测量值',
          },
        ],
      })
    }

    // 下颌拥挤度
    if (lowerData) {
      const crowding = (lowerData.crowding_degree_mm as number) || 0
      const classification = (lowerData.classification as string) || '正常'
      const availableSpace = (lowerData.available_space_mm as number) || 0
      const requiredSpace = (lowerData.required_space_mm as number) || 0

      groups.push({
        groupName: '下颌拥挤度',
        children: [
          {
            name: '拥挤度',
            value: `${crowding.toFixed(2)}mm`,
            result: this.evaluateCrowding(crowding),
          },
          {
            name: '分类',
            value: classification,
            result: classification.includes('正常') ? '正常' : '异常',
          },
          {
            name: '可用间隙',
            value: `${availableSpace.toFixed(2)}mm`,
            result: '测量值',
          },
          {
            name: '所需间隙',
            value: `${requiredSpace.toFixed(2)}mm`,
            result: '测量值',
          },
        ],
      })
    }

    return groups
  }

  // ==================== 私有辅助方法 ====================

  /**
   * 渲染单个颌的拥挤度
   */
  private renderJawCrowding(
    teethPoints: AnalysisData['teeth_points'],
    jawData: Record<string, unknown> | undefined,
    isUpper: boolean,
  ): void {
    if (!jawData) return

    const crowdingDegree = (jawData.crowding_degree_mm as number) || 0

    // 根据拥挤度选择颜色
    const color = this.getCrowdingColor(crowdingDegree)

    // 筛选对应颌的牙齿
    const jawTeeth = teethPoints.filter((p) =>
      isUpper ? this.isUpper(p.fdi) : this.isLower(p.fdi),
    )

    // 按FDI分组
    const toothGroups = this.groupByFDI(jawTeeth)

    // 为每颗牙齿创建拥挤度标记
    Object.entries(toothGroups).forEach(([fdi, points]) => {
      const center = this.calculatePointsCenter(points.map((p) => p.point))

      // 创建小球标记（颜色根据拥挤度）
      const geometry = new THREE.SphereGeometry(0.8, 16, 16)
      const material = new THREE.MeshPhongMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.4,
        transparent: true,
        opacity: 0.7,
      })
      const sphere = new THREE.Mesh(geometry, material)
      sphere.position.copy(center)
      sphere.name = `crowding_${fdi}`
      this.group.add(sphere)
    })
  }

  /**
   * 按FDI分组
   */
  private groupByFDI(points: AnalysisData['teeth_points']): Record<string, AnalysisData['teeth_points']> {
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
   * 根据拥挤度获取颜色
   */
  private getCrowdingColor(crowding: number): number {
    if (crowding >= -1 && crowding <= 1) return 0x22c55e // 绿色 - 正常
    if (crowding < -4 || crowding > 4) return 0xff0000 // 红色 - 严重
    return 0xffa500 // 橙色 - 轻度
  }

  /**
   * 评估拥挤度
   */
  private evaluateCrowding(crowding: number): string {
    if (crowding >= -1 && crowding <= 1) return '正常'
    if (crowding < -4 || crowding > 4) return '严重'
    return '轻度拥挤'
  }
}
