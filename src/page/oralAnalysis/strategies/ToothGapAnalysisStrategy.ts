import * as THREE from 'three'
import { BaseAnalysisStrategy } from './base/BaseAnalysisStrategy'
import type { AnalysisData, MeasurementGroup, RenderType } from '../types'
import { LabelRenderer } from '../renderers'

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

    // 从 measurements 中获取上下颌的间隙数据
    const upperJaw = measurements?.upper_jaw as Record<string, unknown>
    const lowerJaw = measurements?.lower_jaw as Record<string, unknown>

    // 渲染上颌间隙
    if (upperJaw?.gap_details) {
      const gapDetails = upperJaw.gap_details as Array<Record<string, unknown>>
      gapDetails.forEach((gap) => {
        this.renderGap(teeth_points, gap, true)
      })
    }

    // 渲染下颌间隙
    if (lowerJaw?.gap_details) {
      const gapDetails = lowerJaw.gap_details as Array<Record<string, unknown>>
      gapDetails.forEach((gap) => {
        this.renderGap(teeth_points, gap, false)
      })
    }
  }

  /**
   * 渲染测量标注
   */
  protected renderMeasurements(measurements: Record<string, unknown>): void {
    if (!measurements) return

    // 上颌和下颌数据
    const upperJaw = measurements.upper_jaw as Record<string, unknown>
    const lowerJaw = measurements.lower_jaw as Record<string, unknown>

    // 创建上颌信息面板
    if (upperJaw) {
      const totalGaps = (upperJaw.total_gaps as number) || 0
      const totalGapSize = (upperJaw.total_gap_size_mm as number) || 0
      const grade = (upperJaw.grade as string) || '正常'

      const upperPanel = LabelRenderer.createInfoPanel(
        [
          { key: '上颌间隙数', value: `${totalGaps}处` },
          { key: '总间隙', value: `${totalGapSize.toFixed(2)}mm` },
          { key: '等级', value: grade },
        ],
        {
          position: new THREE.Vector3(-25, 30, 0),
          fontSize: 13,
          backgroundColor: this.getGradeColor(grade),
          fontColor: '#ffffff',
        },
      )
      // this.group.add(upperPanel)
    }

    // 创建下颌信息面板
    if (lowerJaw) {
      const totalGaps = (lowerJaw.total_gaps as number) || 0
      const totalGapSize = (lowerJaw.total_gap_size_mm as number) || 0
      const grade = (lowerJaw.grade as string) || '正常'

      const lowerPanel = LabelRenderer.createInfoPanel(
        [
          { key: '下颌间隙数', value: `${totalGaps}处` },
          { key: '总间隙', value: `${totalGapSize.toFixed(2)}mm` },
          { key: '等级', value: grade },
        ],
        {
          position: new THREE.Vector3(25, 30, 0),
          fontSize: 13,
          backgroundColor: this.getGradeColor(grade),
          fontColor: '#ffffff',
        },
      )
      // this.group.add(lowerPanel)
    }
  }

  /**
   * 格式化测量数据为面板展示格式
   */
  protected formatMeasurements(measurements: Record<string, unknown>): MeasurementGroup[] {
    const groups: MeasurementGroup[] = []

    // 上颌数据
    const upperJaw = measurements.upper_jaw as Record<string, unknown>
    if (upperJaw) {
      const upperChildren = [
        {
          name: '间隙总数',
          value: `${(upperJaw.total_gaps as number) || 0}处`,
          result: (upperJaw.grade as string) || '正常',
        },
        {
          name: '总间隙大小',
          value: `${((upperJaw.total_gap_size_mm as number) || 0).toFixed(2)}mm`,
          result: '测量值',
        },
        {
          name: '平均间隙',
          value: `${((upperJaw.average_gap_size as number) || 0).toFixed(2)}mm`,
          result: '测量值',
        },
        {
          name: '最大间隙',
          value: `${((upperJaw.max_gap_size as number) || 0).toFixed(2)}mm`,
          result: '测量值',
        },
      ]

      groups.push({
        groupName: '上颌间隙',
        children: upperChildren,
      })
    }

    // 下颌数据
    const lowerJaw = measurements.lower_jaw as Record<string, unknown>
    if (lowerJaw) {
      const lowerChildren = [
        {
          name: '间隙总数',
          value: `${(lowerJaw.total_gaps as number) || 0}处`,
          result: (lowerJaw.grade as string) || '正常',
        },
        {
          name: '总间隙大小',
          value: `${((lowerJaw.total_gap_size_mm as number) || 0).toFixed(2)}mm`,
          result: '测量值',
        },
        {
          name: '平均间隙',
          value: `${((lowerJaw.average_gap_size as number) || 0).toFixed(2)}mm`,
          result: '测量值',
        },
        {
          name: '最大间隙',
          value: `${((lowerJaw.max_gap_size as number) || 0).toFixed(2)}mm`,
          result: '测量值',
        },
      ]

      groups.push({
        groupName: '下颌间隙',
        children: lowerChildren,
      })
    }

    return groups
  }

  // ==================== 私有辅助方法 ====================

  /**
   * 渲染单个间隙
   * @param teethPoints 所有牙齿点位
   * @param gap 间隙数据 { tooth1, tooth2, gap_size }
   * @param isUpper 是否上颌
   */
  private renderGap(
    teethPoints: AnalysisData['teeth_points'],
    gap: Record<string, unknown>,
    isUpper: boolean,
  ): void {
    const tooth1 = gap.tooth1 as number // 远中牙齿
    const tooth2 = gap.tooth2 as number // 近中牙齿
    const gapSize = (gap.gap_size as number) || 0

    // 找到 tooth1 的 boundary_distal 点（远中边缘点）
    const point1 = teethPoints.find((p) => p.fdi === tooth1 && p.type === 'boundary_distal')
    // 找到 tooth2 的 boundary_mesial 点（近中边缘点）
    const point2 = teethPoints.find((p) => p.fdi === tooth2 && p.type === 'boundary_mesial')

    if (!point1 || !point2) return

    // 解析点位坐标
    const pos1 = this.parsePointPosition(point1.point)
    const pos2 = this.parsePointPosition(point2.point)

    // 两个点位使用不同颜色（tooth1用蓝色，tooth2用绿色）
    const pointColor1 = isUpper ? 0x3b82f6 : 0x8b5cf6 // 上颌蓝色，下颌紫色
    const pointColor2 = isUpper ? 0x10b981 : 0xf59e0b // 上颌绿色，下颌橙色
    const lineColor = this.getGapColor(gapSize)

    // 渲染点位球体（点位随模型的隐藏而隐藏）
    // tooth1 的 boundary_distal 点使用颜色1
    const sphere1 = this.createPointSphere(pos1, pointColor1, tooth1)
    // tooth2 的 boundary_mesial 点使用颜色2
    const sphere2 = this.createPointSphere(pos2, pointColor2, tooth2)
    this.addToMesh(sphere1, tooth1)
    this.addToMesh(sphere2, tooth2)

    // 渲染连接线
    const line = this.createConnectionLine(pos1, pos2, lineColor)
    line.name = `gap_line_${tooth1}_${tooth2}`
    this.addLineToMesh(line, tooth1, tooth2)

    // 计算中点位置
    const midPoint = new THREE.Vector3()
    midPoint.lerpVectors(pos1, pos2, 0.5)

    // 渲染距离标签
    const label = this.createDistanceLabel(gapSize, midPoint)
    label.name = `gap_label_${tooth1}_${tooth2}`
    this.addLineToMesh(label, tooth1, tooth2)
  }

  /**
   * 解析点位坐标（支持字符串和数组）
   */
  private parsePointPosition(point: [number, number, number] | string): THREE.Vector3 {
    let coords: number[]

    if (typeof point === 'string') {
      coords = JSON.parse(point) as number[]
    } else {
      coords = point
    }

    return new THREE.Vector3(coords[0] || 0, coords[1] || 0, coords[2] || 0)
  }

  /**
   * 创建点位球体标记
   */
  private createPointSphere(position: THREE.Vector3, color: number, fdi: number): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(0.6, 16, 16)
    const material = new THREE.MeshPhongMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.5,
      transparent: true,
      opacity: 0.9,
    })
    const sphere = new THREE.Mesh(geometry, material)
    sphere.position.copy(position)
    sphere.name = `gap_point_${fdi}`

    return sphere
  }

  /**
   * 创建连接线
   */
  private createConnectionLine(
    start: THREE.Vector3,
    end: THREE.Vector3,
    color: number,
  ): THREE.Line {
    const points = [start, end]
    const geometry = new THREE.BufferGeometry().setFromPoints(points)
    const material = new THREE.LineBasicMaterial({
      color,
      linewidth: 2,
      transparent: true,
      opacity: 0.8,
    })

    const line = new THREE.Line(geometry, material)
    return line
  }

  /**
   * 创建距离标签
   */
  private createDistanceLabel(distance: number, position: THREE.Vector3): THREE.Sprite {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建canvas context')

    // 设置canvas尺寸
    canvas.width = 256
    canvas.height = 128

    // 绘制背景
    context.fillStyle = 'rgba(0, 0, 0, 0.7)'
    context.roundRect(10, 30, 236, 68, 8)
    context.fill()

    // 绘制边框
    context.strokeStyle = '#60a5fa'
    context.lineWidth = 2
    context.roundRect(10, 30, 236, 68, 8)
    context.stroke()

    // 绘制文字
    context.fillStyle = '#ffffff'
    context.font = 'bold 36px Arial'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    const distanceText = `${distance.toFixed(2)}mm`
    context.fillText(distanceText, 128, 64)

    // 创建纹理和精灵
    const texture = new THREE.CanvasTexture(canvas)
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
    })
    const sprite = new THREE.Sprite(material)

    sprite.position.copy(position)
    sprite.scale.set(5, 2.5, 1)

    return sprite
  }

  /**
   * 根据间隙大小获取颜色
   */
  private getGapColor(size: number): number {
    if (size < 0.5) return 0x22c55e // 绿色 - 正常
    if (size < 2.0) return 0xff9800 // 橙色 - 轻度间隙
    return 0xff0000 // 红色 - 显著间隙
  }

  /**
   * 根据等级获取颜色
   */
  private getGradeColor(grade: string): string {
    if (grade.includes('正常') || grade.includes('无')) return '#22c55e' // 绿色
    if (grade.includes('轻度')) return '#ff9800' // 橙色
    if (grade.includes('中度')) return '#ff6b00' // 深橙色
    return '#ff0000' // 红色 - 严重
  }
}
