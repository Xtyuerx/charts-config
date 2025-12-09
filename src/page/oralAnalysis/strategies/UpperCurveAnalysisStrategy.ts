import * as THREE from 'three'
import { BaseAnalysisStrategy } from './base/BaseAnalysisStrategy'
import type { AnalysisData, MeasurementGroup, RenderType } from '../types'
import { LabelRenderer } from '../renderers'

/**
 * 上颌补偿曲线分析策略
 * 分析上颌牙齿的补偿曲线
 */
export class UpperCurveAnalysisStrategy extends BaseAnalysisStrategy {
  readonly id = 'upper-curve'
  readonly name = '上颌补偿曲线'
  readonly taskName = 'upper-curve'
  readonly renderType: RenderType = 'POINT_CURVE'

  /**
   * 渲染特定元素
   * 上颌补偿曲线分析：显示曲线、关键点和曲率
   */
  protected renderSpecificElements(data: AnalysisData): void {
    const { teeth_points, measurements } = data

    if (!teeth_points || teeth_points.length === 0) return

    // 渲染上颌补偿曲线
    this.renderUpperCurve(teeth_points, measurements)
  }

  /**
   * 渲染测量标注
   */
  protected renderMeasurements(measurements: Record<string, unknown>): void {
    if (!measurements) return

    const curvature = (measurements.curvature as number) || 0
    const classification = (measurements.classification as string) || '正常'
    const diagnosis = (measurements.diagnosis as string) || '正常'

    // 创建统计信息面板
    const infoData = [
      { key: '曲线曲率', value: curvature.toFixed(3) },
      { key: '分类', value: classification },
      { key: '诊断结果', value: diagnosis },
    ]

    const infoPanel = LabelRenderer.createInfoPanel(infoData, {
      position: new THREE.Vector3(0, 30, 0),
      fontSize: 14,
      backgroundColor: this.getCurvatureColor(curvature),
      fontColor: '#ffffff',
    })

    this.group.add(infoPanel)
  }

  /**
   * 格式化测量数据为面板展示格式
   */
  protected formatMeasurements(measurements: Record<string, unknown>): MeasurementGroup[] {
    const curvature = (measurements.curvature as number) || 0
    const classification = (measurements.classification as string) || '正常'
    const diagnosis = (measurements.diagnosis as string) || '正常'
    const curvePoints = (measurements.curve_reference_teeth as number[]) || []

    return [
      {
        groupName: '上颌补偿曲线分析',
        children: [
          {
            name: '曲线曲率',
            value: curvature.toFixed(3),
            result: this.evaluateCurvature(curvature),
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
   * 渲染上颌补偿曲线
   */
  private renderUpperCurve(
    teethPoints: AnalysisData['teeth_points'],
    measurements: Record<string, unknown> | undefined,
  ): void {
    if (!measurements) return

    const curveData = measurements.curve_data as Array<number[]>
    const curvature = (measurements.curvature as number) || 0

    if (!curveData || curveData.length === 0) {
      // 如果没有曲线数据，使用参考牙位生成曲线
      this.renderCurveFromTeeth(teethPoints, measurements)
      return
    }

    // 将曲线数据转换为Three.js坐标（保持缩放）
    const scale = 1.5
    const curvePoints = curveData.map(
      (point) =>
        new THREE.Vector3(
          (point[0] || 0) * scale,
          (point[1] || 0) * scale,
          (point[2] || 0) * scale,
        ),
    )

    console.log('🔵 UpperCurve - 曲线点数:', curvePoints.length)
    if (curvePoints.length < 2) {
      console.warn('⚠️ UpperCurve - 曲线点数不足，至少需要2个点')
      return
    }

    // 根据曲率选择颜色
    const color = this.getCurvatureColorNum(curvature)

    // 使用CatmullRomCurve3创建平滑曲线
    const curve = new THREE.CatmullRomCurve3(curvePoints)
    curve.closed = false
    curve.curveType = 'catmullrom'
    curve.tension = 0.5

    // 使用TubeGeometry创建有厚度的曲线（参考牙弓线样式）
    const tubeGeometry = new THREE.TubeGeometry(
      curve,
      64, // tubularSegments
      0.3, // radius - 曲线粗细
      8, // radialSegments
      false, // closed
    )

    const curveMaterial = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.3,
      metalness: 0.6,
      depthTest: false, // 不进行深度测试，始终显示在前面
      transparent: true,
      opacity: 0.9,
    })

    const curveLine = new THREE.Mesh(tubeGeometry, curveMaterial)
    curveLine.renderOrder = 999 // 最后渲染，确保不被遮挡
    curveLine.name = 'upper_curve'
    this.group.add(curveLine) // 曲线添加到主 group（跨越多个牙齿）
    console.log('✅ UpperCurve - 曲线已添加到场景')

    // 渲染曲率信息
    this.renderCurvatureInfo(curvePoints, curvature)
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
    const fdis: number[] = [] // 记录每个点对应的 FDI

    // 提取每颗牙齿的中心点（使用缩放坐标）
    curveTeeth.forEach((fdi) => {
      const toothPoints = teethPoints.filter((p) => p.fdi === fdi)
      if (toothPoints.length > 0) {
        const center = this.calculatePointsCenterScaled(toothPoints.map((p) => p.point))
        curvePoints.push(center)
        fdis.push(fdi)
      }
    })

    if (curvePoints.length < 2) return

    const curvature = (measurements.curvature as number) || 0
    const color = this.getCurvatureColorNum(curvature)

    console.log('🔵 UpperCurve (from teeth) - 曲线点数:', curvePoints.length)

    // 创建平滑曲线
    const curve = new THREE.CatmullRomCurve3(curvePoints)
    curve.closed = false
    curve.curveType = 'catmullrom'
    curve.tension = 0.5

    // 使用TubeGeometry创建有厚度的曲线（参考牙弓线样式）
    const tubeGeometry = new THREE.TubeGeometry(
      curve,
      64, // tubularSegments
      0.3, // radius - 曲线粗细
      8, // radialSegments
      false, // closed
    )

    const curveMaterial = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.3,
      metalness: 0.6,
      depthTest: false, // 不进行深度测试，始终显示在前面
      transparent: true,
      opacity: 0.9,
    })

    const curveLine = new THREE.Mesh(tubeGeometry, curveMaterial)
    curveLine.renderOrder = 999 // 最后渲染，确保不被遮挡
    curveLine.name = 'upper_curve_from_teeth'
    this.group.add(curveLine) // 曲线添加到主 group（跨越多个牙齿）
    console.log('✅ UpperCurve (from teeth) - 曲线已添加到场景')

    // 渲染曲率信息
    this.renderCurvatureInfo(curvePoints, curvature)
  }

  /**
   * 渲染曲率信息
   */
  private renderCurvatureInfo(curvePoints: THREE.Vector3[], curvature: number): void {
    if (curvePoints.length === 0) return

    // 在曲线中点显示曲率信息（添加到 group）
    const midIndex = Math.floor(curvePoints.length / 2)
    const midPoint = curvePoints[midIndex]

    if (!midPoint) return

    // 高亮中点（使用缩放坐标创建球体）
    const geometry = new THREE.SphereGeometry(1.3, 16, 16)
    const material = new THREE.MeshPhongMaterial({
      color: 0x2196f3,
      emissive: 0x2196f3,
      emissiveIntensity: 0.4,
    })
    const midMarker = new THREE.Mesh(geometry, material)
    midMarker.position.copy(midPoint)
    midMarker.name = 'curve_mid_marker'
    this.group.add(midMarker)

    // 添加曲率标签
    const curvatureLabel = LabelRenderer.createLabel(`曲率: ${curvature.toFixed(3)}`, {
      position: midPoint.clone().add(new THREE.Vector3(0, 3, 0)),
      fontSize: 11,
      backgroundColor: '#2196f3',
      fontColor: '#ffffff',
    })
    this.group.add(curvatureLabel)
  }

  /**
   * 计算多个点的中心（缩放版本，用于添加到 group）
   */
  private calculatePointsCenterScaled(points: number[][]): THREE.Vector3 {
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
   * 根据曲率获取颜色（字符串）
   */
  private getCurvatureColor(curvature: number): string {
    const absCurv = Math.abs(curvature)
    if (absCurv <= 0.02) return '#22c55e' // 绿色 - 正常
    if (absCurv <= 0.05) return '#ff9800' // 橙色 - 轻度
    return '#ff0000' // 红色 - 明显
  }

  /**
   * 根据曲率获取颜色（数值）
   */
  private getCurvatureColorNum(curvature: number): number {
    const absCurv = Math.abs(curvature)
    if (absCurv <= 0.02) return 0x22c55e // 绿色
    if (absCurv <= 0.05) return 0xff9800 // 橙色
    return 0xff0000 // 红色
  }

  /**
   * 评估曲率
   */
  private evaluateCurvature(curvature: number): string {
    const absCurv = Math.abs(curvature)
    if (absCurv <= 0.02) return '正常'
    if (absCurv <= 0.05) return '轻度异常'
    return '明显异常'
  }
}
