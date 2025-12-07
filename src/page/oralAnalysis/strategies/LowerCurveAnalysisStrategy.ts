import * as THREE from 'three'
import { BaseAnalysisStrategy } from './base/BaseAnalysisStrategy'
import type { AnalysisData, MeasurementGroup, RenderType } from '../types'
import { LineRenderer, LabelRenderer } from '../renderers'

/**
 * 下颌补偿曲线分析策略（Spee曲线）
 * 分析下颌牙齿的矢状补偿曲线
 */
export class LowerCurveAnalysisStrategy extends BaseAnalysisStrategy {
  readonly id = 'spee-curve'
  readonly name = 'Spee曲线'
  readonly taskName = 'lower-curve'
  readonly renderType: RenderType = 'POINT_CURVE'

  /**
   * 渲染特定元素
   * Spee曲线分析：显示曲线、关键点和深度
   */
  protected renderSpecificElements(data: AnalysisData): void {
    const { teeth_points, measurements } = data

    if (!teeth_points || teeth_points.length === 0) return

    // 渲染Spee曲线
    this.renderSpeeCurve(teeth_points, measurements)
  }

  /**
   * 渲染测量标注
   */
  protected renderMeasurements(measurements: Record<string, unknown>): void {
    if (!measurements) return

    const curveDepth = (measurements.curve_depth_mm as number) || 0
    const classification = (measurements.classification as string) || '正常'
    const diagnosis = (measurements.diagnosis as string) || '正常'

    // 创建统计信息面板
    const infoData = [
      { key: 'Spee曲线深度', value: `${curveDepth.toFixed(2)}mm` },
      { key: '分类', value: classification },
      { key: '诊断结果', value: diagnosis },
    ]

    const infoPanel = LabelRenderer.createInfoPanel(infoData, {
      position: new THREE.Vector3(0, 30, 0),
      fontSize: 14,
      backgroundColor: this.getCurveColor(curveDepth),
      fontColor: '#ffffff',
    })

    this.group.add(infoPanel)
  }

  /**
   * 格式化测量数据为面板展示格式
   */
  protected formatMeasurements(measurements: Record<string, unknown>): MeasurementGroup[] {
    const curveDepth = (measurements.curve_depth_mm as number) || 0
    const classification = (measurements.classification as string) || '正常'
    const diagnosis = (measurements.diagnosis as string) || '正常'
    const curvePoints = (measurements.curve_reference_teeth as number[]) || []

    return [
      {
        groupName: 'Spee曲线分析',
        children: [
          {
            name: '曲线深度',
            value: `${curveDepth.toFixed(2)}mm`,
            result: this.evaluateCurveDepth(curveDepth),
          },
          {
            name: '分类',
            value: classification,
            result: classification.includes('正常') ? '正常' : '异常',
          },
          {
            name: '参考牙位',
            value:
              curvePoints.length > 0
                ? `${curvePoints[0]}-${curvePoints[curvePoints.length - 1]}`
                : '未指定',
            result: '范围',
          },
          {
            name: '诊断结果',
            value: diagnosis,
            result: diagnosis.includes('正常') ? '正常' : '需要关注',
          },
        ],
      },
    ]
  }

  // ==================== 私有辅助方法 ====================

  /**
   * 渲染Spee曲线
   */
  private renderSpeeCurve(
    teethPoints: AnalysisData['teeth_points'],
    measurements: Record<string, unknown> | undefined,
  ): void {
    if (!measurements) return

    const curveData = measurements.curve_data as Array<number[]>
    const curveDepth = (measurements.curve_depth_mm as number) || 0

    if (!curveData || curveData.length === 0) {
      // 如果没有曲线数据，使用参考牙位生成曲线
      this.renderCurveFromTeeth(teethPoints, measurements)
      return
    }

    // 将曲线数据转换为Three.js坐标
    const scale = 1.5
    const curvePoints = curveData.map(
      (point) =>
        new THREE.Vector3(
          (point[0] || 0) * scale,
          (point[1] || 0) * scale,
          (point[2] || 0) * scale,
        ),
    )

    // 根据深度选择颜色
    const color = this.getCurveColorNum(curveDepth)

    // 使用CatmullRomCurve3创建平滑曲线
    const curve = new THREE.CatmullRomCurve3(curvePoints)
    const curveGeometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(50))
    const curveMaterial = new THREE.LineBasicMaterial({
      color,
      linewidth: 3,
    })
    const curveLine = new THREE.Line(curveGeometry, curveMaterial)
    curveLine.name = 'spee_curve'
    this.group.add(curveLine)

    // 渲染关键点
    curvePoints.forEach((point, index) => {
      const marker = LineRenderer.createPoint(point, {
        color,
        size: 0.8,
      })
      this.group.add(marker)

      // 在起点和终点添加标签
      if (index === 0 || index === curvePoints.length - 1) {
        const label = LabelRenderer.createLabel(index === 0 ? '起点' : '终点', {
          position: point.clone().add(new THREE.Vector3(0, 2, 0)),
          fontSize: 10,
          backgroundColor: '#00000099',
          fontColor: '#ffffff',
        })
        this.group.add(label)
      }
    })

    // 渲染最深点
    this.renderDeepestPoint(curvePoints, curveDepth)
  }

  /**
   * 从牙齿点位生成曲线
   */
  private renderCurveFromTeeth(
    teethPoints: AnalysisData['teeth_points'],
    measurements: Record<string, unknown>,
  ): void {
    const curveTeeth = (measurements.curve_reference_teeth as number[]) || []

    if (curveTeeth.length === 0) return

    const curvePoints: THREE.Vector3[] = []

    // 提取每颗牙齿的中心点
    curveTeeth.forEach((fdi) => {
      const toothPoints = teethPoints.filter((p) => p.fdi === fdi)
      if (toothPoints.length > 0) {
        const center = this.calculatePointsCenter(toothPoints.map((p) => p.point))
        curvePoints.push(center)
      }
    })

    if (curvePoints.length < 2) return

    const curveDepth = (measurements.curve_depth_mm as number) || 0
    const color = this.getCurveColorNum(curveDepth)

    // 创建平滑曲线
    const curve = new THREE.CatmullRomCurve3(curvePoints)
    const curveGeometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(50))
    const curveMaterial = new THREE.LineBasicMaterial({
      color,
      linewidth: 3,
    })
    const curveLine = new THREE.Line(curveGeometry, curveMaterial)
    curveLine.name = 'spee_curve_from_teeth'
    this.group.add(curveLine)

    // 渲染关键点
    curvePoints.forEach((point, index) => {
      const marker = LineRenderer.createPoint(point, {
        color,
        size: 0.7,
      })
      this.group.add(marker)
    })

    // 渲染最深点
    this.renderDeepestPoint(curvePoints, curveDepth)
  }

  /**
   * 渲染最深点
   */
  private renderDeepestPoint(curvePoints: THREE.Vector3[], depth: number): void {
    if (curvePoints.length === 0) return

    // 找到Y坐标最低的点（最深点）
    const deepestPoint = curvePoints.reduce((lowest, point) =>
      point.y < lowest.y ? point : lowest,
    )

    // 高亮最深点
    const deepestMarker = LineRenderer.createPoint(deepestPoint, {
      color: 0xff0000,
      size: 1.5,
    })
    this.group.add(deepestMarker)

    // 添加深度标签
    const depthLabel = LabelRenderer.createLabel(`深度: ${depth.toFixed(2)}mm`, {
      position: deepestPoint.clone().add(new THREE.Vector3(0, -3, 0)),
      fontSize: 11,
      backgroundColor: '#ff0000',
      fontColor: '#ffffff',
    })
    this.group.add(depthLabel)
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
   * 根据曲线深度获取颜色（字符串）
   */
  private getCurveColor(depth: number): string {
    const absDepth = Math.abs(depth)
    if (absDepth <= 1.5) return '#22c55e' // 绿色 - 正常
    if (absDepth <= 3.0) return '#ff9800' // 橙色 - 轻度
    return '#ff0000' // 红色 - 明显
  }

  /**
   * 根据曲线深度获取颜色（数值）
   */
  private getCurveColorNum(depth: number): number {
    const absDepth = Math.abs(depth)
    if (absDepth <= 1.5) return 0x22c55e // 绿色
    if (absDepth <= 3.0) return 0xff9800 // 橙色
    return 0xff0000 // 红色
  }

  /**
   * 评估曲线深度
   */
  private evaluateCurveDepth(depth: number): string {
    const absDepth = Math.abs(depth)
    if (absDepth <= 1.5) return '正常'
    if (absDepth <= 3.0) return '轻度加深'
    return '明显加深'
  }
}
