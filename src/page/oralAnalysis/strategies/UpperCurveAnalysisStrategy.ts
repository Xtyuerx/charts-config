import * as THREE from 'three'
import { BaseAnalysisStrategy } from './base/BaseAnalysisStrategy'
import type { AnalysisData, MeasurementGroup, RenderType } from '../types'
import { LabelRenderer } from '../renderers'

/**
 * 上颌补偿曲线分析策略
 * 分析上颌牙齿的补偿曲线
 * ⚠️ 只处理上颌牙齿，不处理下颌
 */
export class UpperCurveAnalysisStrategy extends BaseAnalysisStrategy {
  readonly id = 'upper-curve'
  readonly name = '上颌补偿曲线'
  readonly taskName = 'upper-curve'
  readonly renderType: RenderType = 'POINT_CURVE'

  /**
   * 渲染特定元素
   * 上颌补偿曲线分析：显示曲线、关键点和曲率
   * ⚠️ 只处理上颌牙齿，不处理下颌
   */
  protected renderSpecificElements(data: AnalysisData): void {
    const { teeth_points, measurements } = data

    if (!teeth_points || teeth_points.length === 0) return

    // ⚠️ 只过滤上颌牙齿（FDI 11-28），排除下颌牙齿（FDI 31-48）
    const upperTeethPoints = teeth_points.filter((p) => p.fdi >= 11 && p.fdi <= 28)

    if (upperTeethPoints.length === 0) {
      console.warn('⚠️ 上颌补偿曲线：未找到上颌牙齿数据')
      return
    }

    // 渲染上颌补偿曲线（只使用上颌牙齿数据）
    this.renderUpperCurve(upperTeethPoints, measurements)
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
   * ⚠️ 只处理上颌牙齿数据
   */
  private renderUpperCurve(
    teethPoints: AnalysisData['teeth_points'],
    measurements: Record<string, unknown> | undefined,
  ): void {
    if (!measurements) return

    // ⚠️ 确保只使用上颌牙齿数据
    const upperTeethPoints = teethPoints.filter((p) => p.fdi >= 11 && p.fdi <= 28)

    if (upperTeethPoints.length === 0) {
      console.warn('⚠️ 上颌补偿曲线：未找到上颌牙齿数据')
      return
    }

    const curveData = measurements.curve_data as Array<number[]>
    const curvature = (measurements.curvature as number) || 0

    if (!curveData || curveData.length === 0) {
      // 如果没有曲线数据，使用参考牙位生成曲线（只使用上颌数据）
      this.renderCurveFromTeeth(upperTeethPoints, measurements)
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
   * ⚠️ 只处理上颌牙齿，不处理下颌
   */
  private renderCurveFromTeeth(
    teethPoints: AnalysisData['teeth_points'],
    measurements: Record<string, unknown>,
  ): void {
    // ⚠️ 重要：只过滤上颌牙齿点位（FDI 11-28），完全排除下颌（FDI 31-48）
    const upperTeethPoints = teethPoints.filter((p) => p.fdi >= 11 && p.fdi <= 28)

    if (upperTeethPoints.length === 0) {
      console.warn('⚠️ 上颌补偿曲线：未找到上颌牙齿点位')
      return
    }

    // 使用上颌所有牙位：17->16->15->14->13->12->11->21->22->23->24->25->26->27 (不连接17和27)
    const referenceFDIs = [17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27]
    const pointsMap = new Map<number, THREE.Vector3>()

    // 提取每颗牙齿的中心点（使用缩放坐标）- 只从上颌牙齿中提取
    referenceFDIs.forEach((fdi) => {
      const toothPoints = upperTeethPoints.filter((p) => p.fdi === fdi)
      if (toothPoints.length > 0) {
        const center = this.calculatePointsCenterScaled(toothPoints.map((p) => p.point))
        pointsMap.set(fdi, center)
      }
    })

    if (pointsMap.size < 3) {
      console.warn('上颌补偿曲线：找不到足够的参考牙位点，需要至少3个点')
      return
    }

    const curvature = (measurements.curvature as number) || 0

    // 1. 渲染平滑曲线
    this.renderUpperConnectionLine(pointsMap, referenceFDIs, curvature)

    // 2. 渲染关键点标记（只标记4个上颌关键点：17, 27, 11, 21）
    const keyFDIs = [17, 27, 11, 21]
    const keyPointsMap = new Map<number, THREE.Vector3>()
    keyFDIs.forEach((fdi) => {
      const point = pointsMap.get(fdi)
      if (point) keyPointsMap.set(fdi, point)
    })
    this.renderKeyPoints(keyPointsMap, keyFDIs)

    // 3. 渲染曲率信息
    const allPoints = Array.from(pointsMap.values())
    this.renderCurvatureInfo(allPoints, curvature)
  }

  /**
   * 渲染上颌曲线连接线
   * 连接上颌所有牙位：17->16->...->11->21->...->27 (不连接17和27，不闭合)
   * ⚠️ 添加到上颌模型，跟随上颌显示/隐藏
   */
  private renderUpperConnectionLine(
    pointsMap: Map<number, THREE.Vector3>,
    fdis: number[],
    curvature: number,
  ): void {
    // 按照指定顺序获取点位
    const orderedPoints: THREE.Vector3[] = []

    fdis.forEach((fdi) => {
      const point = pointsMap.get(fdi)
      if (point) {
        orderedPoints.push(point)
      }
    })

    if (orderedPoints.length < 2) return

    // 根据曲率选择颜色
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

    // ⚠️ 添加到上颌模型，而不是group
    const upperMesh = this.context.upperMeshLabel
    if (upperMesh) {
      upperMesh.add(curveLine)
      console.log('✅ 上颌补偿曲线已添加到上颌模型')
    } else {
      this.group.add(curveLine)
      console.warn('⚠️ 未找到上颌mesh，上颌补偿曲线添加到group')
    }
  }

  /**
   * 渲染关键点标记
   * ⚠️ 添加到上颌模型，跟随上颌显示/隐藏
   */
  private renderKeyPoints(pointsMap: Map<number, THREE.Vector3>, fdis: number[]): void {
    const upperMesh = this.context.upperMeshLabel

    fdis.forEach((fdi) => {
      const point = pointsMap.get(fdi)
      if (!point) return

      // 创建球体标记
      const geometry = new THREE.SphereGeometry(0.8, 16, 16)
      const material = new THREE.MeshPhongMaterial({
        color: 0x0000ff, // 蓝色
        emissive: 0x0000ff,
        emissiveIntensity: 0.3,
      })
      const marker = new THREE.Mesh(geometry, material)
      marker.position.copy(point)
      marker.name = `upper_curve_point_${fdi}`

      // ⚠️ 添加到上颌模型
      if (upperMesh) {
        upperMesh.add(marker)
      } else {
        this.group.add(marker)
      }

      // 添加FDI标签
      const label = LabelRenderer.createLabel(`FDI ${fdi}`, {
        position: point.clone().add(new THREE.Vector3(0, 2, 0)),
        fontSize: 10,
        backgroundColor: '#0000ff',
        fontColor: '#ffffff',
      })

      // ⚠️ 标签也添加到上颌模型
      if (upperMesh) {
        upperMesh.add(label)
      } else {
        this.group.add(label)
      }
    })

    if (upperMesh) {
      console.log('✅ 关键点标记已添加到上颌模型')
    }
  }

  /**
   * 渲染曲率信息
   * ⚠️ 添加到上颌模型，跟随上颌显示/隐藏
   */
  private renderCurvatureInfo(curvePoints: THREE.Vector3[], curvature: number): void {
    if (curvePoints.length === 0) return

    // 在曲线中点显示曲率信息
    const midIndex = Math.floor(curvePoints.length / 2)
    const midPoint = curvePoints[midIndex]

    if (!midPoint) return

    const upperMesh = this.context.upperMeshLabel

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

    // ⚠️ 添加到上颌模型
    if (upperMesh) {
      upperMesh.add(midMarker)
    } else {
      this.group.add(midMarker)
    }

    // 添加曲率标签
    const curvatureLabel = LabelRenderer.createLabel(`曲率: ${curvature.toFixed(3)}`, {
      position: midPoint.clone().add(new THREE.Vector3(0, 3, 0)),
      fontSize: 11,
      backgroundColor: '#2196f3',
      fontColor: '#ffffff',
    })

    // ⚠️ 标签也添加到上颌模型
    if (upperMesh) {
      upperMesh.add(curvatureLabel)
      console.log('✅ 曲率信息已添加到上颌模型')
    } else {
      this.group.add(curvatureLabel)
    }
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
