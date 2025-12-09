import * as THREE from 'three'
import { BaseAnalysisStrategy } from './base/BaseAnalysisStrategy'
import type { AnalysisData, MeasurementGroup, RenderType } from '../types'
import { LabelRenderer } from '../renderers'

/**
 * 下颌补偿曲线分析策略（Spee曲线）
 * 分析下颌牙齿的矢状补偿曲线
 * ⚠️ 只处理下颌牙齿，不处理上颌
 */
export class LowerCurveAnalysisStrategy extends BaseAnalysisStrategy {
  readonly id = 'spee-curve'
  readonly name = 'Spee曲线'
  readonly taskName = 'lower-curve'
  readonly renderType: RenderType = 'POINT_CURVE'

  /**
   * 渲染特定元素
   * Spee曲线分析：显示曲线、关键点和深度
   * ⚠️ 只处理下颌牙齿，不处理上颌
   */
  protected renderSpecificElements(data: AnalysisData): void {
    const { teeth_points, measurements } = data

    if (!teeth_points || teeth_points.length === 0) return

    // ⚠️ 只过滤下颌牙齿（FDI 31-48），排除上颌牙齿（FDI 11-28）
    const lowerTeethPoints = teeth_points.filter((p) => p.fdi >= 31 && p.fdi <= 48)

    if (lowerTeethPoints.length === 0) {
      console.warn('⚠️ Spee曲线：未找到下颌牙齿数据')
      return
    }

    // 渲染Spee曲线（只使用下颌牙齿数据）
    this.renderSpeeCurve(lowerTeethPoints, measurements)
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

    // this.group.add(infoPanel)
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
   * ⚠️ 只处理下颌牙齿数据
   */
  private renderSpeeCurve(
    teethPoints: AnalysisData['teeth_points'],
    measurements: Record<string, unknown> | undefined,
  ): void {
    if (!measurements) return

    // ⚠️ 确保只使用下颌牙齿数据
    const lowerTeethPoints = teethPoints.filter((p) => p.fdi >= 31 && p.fdi <= 48)

    if (lowerTeethPoints.length === 0) {
      console.warn('⚠️ Spee曲线：未找到下颌牙齿数据')
      return
    }

    const curveData = measurements.curve_data as Array<number[]>
    const curveDepth = (measurements.curve_depth_mm as number) || 0

    if (!curveData || curveData.length === 0) {
      // 如果没有曲线数据，使用参考牙位生成曲线（只使用下颌数据）
      this.renderCurveFromTeeth(lowerTeethPoints, measurements)
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

    // 添加到下颌模型
    const lowerMesh = this.context.lowerMeshLabel
    if (lowerMesh) {
      lowerMesh.add(curveLine)
    } else {
      this.group.add(curveLine)
    }

    // 渲染最深点
    this.renderDeepestPoint(curvePoints, curveDepth)
  }

  /**
   * 从牙齿点位生成曲线
   * ⚠️ 只处理下颌牙齿，不处理上颌
   */
  private renderCurveFromTeeth(
    teethPoints: AnalysisData['teeth_points'],
    measurements: Record<string, unknown>,
  ): void {
    // ⚠️ 重要：只过滤下颌牙齿点位（FDI 31-48），完全排除上颌（FDI 11-28）
    const lowerTeethPoints = teethPoints.filter((p) => p.fdi >= 31 && p.fdi <= 48)

    if (lowerTeethPoints.length === 0) {
      console.warn('⚠️ Spee曲线：未找到下颌牙齿点位')
      return
    }

    // 使用下颌所有牙位：47->46->45->44->43->42->41->31->32->33->34->35->36->37 (不连接47和37)
    const referenceFDIs = [47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37]
    const pointsMap = new Map<number, THREE.Vector3>()

    // 提取每颗牙齿的中心点（使用缩放坐标）- 只从下颌牙齿中提取
    referenceFDIs.forEach((fdi) => {
      const toothPoints = lowerTeethPoints.filter((p) => p.fdi === fdi)
      if (toothPoints.length > 0) {
        const center = this.calculatePointsCenterScaled(toothPoints.map((p) => p.point))
        pointsMap.set(fdi, center)
      }
    })

    if (pointsMap.size < 3) {
      console.warn('Spee曲线：找不到足够的参考牙位点，需要至少3个点')
      return
    }

    const curveDepth = (measurements.curve_depth_mm as number) || 0

    // 1. 渲染平滑曲线（不绘制直线段）
    this.renderSpeeConnectionLine(pointsMap, referenceFDIs)

    // 2. 渲染覆盖下颌模型的白色透明平面（只使用下颌牙齿数据）
    this.renderFullLowerJawPlane(pointsMap, lowerTeethPoints)

    // 3. 渲染关键点标记（只标记4个下颌关键点：37, 47, 31, 41）
    const keyFDIs = [37, 47, 31, 41]
    const keyPointsMap = new Map<number, THREE.Vector3>()
    keyFDIs.forEach((fdi) => {
      const point = pointsMap.get(fdi)
      if (point) keyPointsMap.set(fdi, point)
    })
    this.renderKeyPoints(keyPointsMap, keyFDIs)

    // 4. 渲染最深点
    const allPoints = Array.from(pointsMap.values())
    this.renderDeepestPoint(allPoints, curveDepth)
  }

  /**
   * 渲染Spee曲线连接线
   * 连接下颌所有牙位：47->46->...->41->31->...->37 (不连接47和37，不闭合)
   * ⚠️ 添加到下颌模型，跟随下颌显示/隐藏
   */
  private renderSpeeConnectionLine(pointsMap: Map<number, THREE.Vector3>, fdis: number[]): void {
    // 按照指定顺序获取点位
    const orderedPoints: THREE.Vector3[] = []

    fdis.forEach((fdi) => {
      const point = pointsMap.get(fdi)
      if (point) {
        orderedPoints.push(point)
      }
    })

    if (orderedPoints.length < 2) return

    // 绘制更平滑的曲线，增加采样点数到200
    const curve = new THREE.CatmullRomCurve3(orderedPoints, false, 'catmullrom', 0.5)
    const curveGeometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(200))
    const curveMaterial = new THREE.LineBasicMaterial({
      color: 0x00ff00, // 绿色线条
      linewidth: 3,
    })
    const curveLine = new THREE.Line(curveGeometry, curveMaterial)
    curveLine.name = 'spee_curve_line'

    // ⚠️ 添加到下颌模型，而不是group
    const lowerMesh = this.context.lowerMeshLabel
    if (lowerMesh) {
      lowerMesh.add(curveLine)
      console.log('✅ Spee曲线已添加到下颌模型')
    } else {
      this.group.add(curveLine)
      console.warn('⚠️ 未找到下颌mesh，Spee曲线添加到group')
    }
  }

  /**
   * 渲染覆盖整个下颌的白色透明平面
   * 平面水平（平行于坐标系的XZ平面），高度为31和41号牙的平均高度
   */
  private renderFullLowerJawPlane(
    pointsMap: Map<number, THREE.Vector3>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    allTeethPoints: AnalysisData['teeth_points'],
  ): void {
    if (pointsMap.size < 3) return

    // 获取31号牙和41号牙的点位
    const point31 = pointsMap.get(31)
    const point41 = pointsMap.get(41)

    if (!point31 || !point41) {
      console.warn('⚠️ 未找到31或41号牙的点位，无法创建平面')
      return
    }

    // 平面高度：使用31和41号牙的平均高度
    const planeY = (point31.y + point41.y) / 2

    // 计算所有参考点的中心位置
    const referencePoints = Array.from(pointsMap.values())
    const centerX = referencePoints.reduce((sum, p) => sum + p.x, 0) / referencePoints.length
    const centerZ = referencePoints.reduce((sum, p) => sum + p.z, 0) / referencePoints.length

    // 固定平面大小：50x50（已经是场景坐标系）
    const planeSize = 50

    // 计算平面的四个角（以中心点为基准）
    const halfSize = planeSize / 2
    const minX = centerX - halfSize
    const maxX = centerX + halfSize
    const minZ = centerZ - halfSize
    const maxZ = centerZ + halfSize

    // 在x-z平面上创建网格（Y轴保持不变，形成水平平面）
    const segments = 50 // 网格分辨率
    const vertices: number[] = []
    const indices: number[] = []

    // 生成网格顶点（完全水平的平面，所有点Y坐标相同）
    for (let i = 0; i <= segments; i++) {
      for (let j = 0; j <= segments; j++) {
        const x = minX + (i / segments) * planeSize
        const z = minZ + (j / segments) * planeSize
        const y = planeY // 所有顶点使用相同的Y坐标，形成水平平面

        vertices.push(x, y, z)
      }
    }

    // 生成网格索引
    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < segments; j++) {
        const topLeft = i * (segments + 1) + j
        const topRight = topLeft + 1
        const bottomLeft = (i + 1) * (segments + 1) + j
        const bottomRight = bottomLeft + 1

        // 两个三角形组成一个四边形
        indices.push(topLeft, bottomLeft, topRight)
        indices.push(topRight, bottomLeft, bottomRight)
      }
    }

    // 创建几何体
    const planeGeometry = new THREE.BufferGeometry()
    planeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    planeGeometry.setIndex(indices)
    planeGeometry.computeVertexNormals()

    // 创建白色透明材质
    const planeMaterial = new THREE.MeshPhongMaterial({
      color: 0xffffff, // 白色
      transparent: true,
      opacity: 0.35, // 透明度35%
      side: THREE.DoubleSide, // 双面可见
      depthWrite: false, // 防止透明度问题
    })

    const planeMesh = new THREE.Mesh(planeGeometry, planeMaterial)
    planeMesh.name = 'spee_full_lower_plane'

    // 将平面添加到下颌模型mesh中，这样会跟随下颌一起显示/隐藏
    const lowerMesh = this.context.lowerMeshLabel
    if (lowerMesh) {
      lowerMesh.add(planeMesh)
      console.log('✅ Spee平面已添加到下颌模型')
    } else {
      this.group.add(planeMesh)
      console.warn('⚠️ 未找到下颌mesh，Spee平面添加到分析group')
    }

    // 添加平面边框（正方形边界，水平线）
    const edgePoints = [
      new THREE.Vector3(minX, planeY, minZ),
      new THREE.Vector3(maxX, planeY, minZ),
      new THREE.Vector3(maxX, planeY, maxZ),
      new THREE.Vector3(minX, planeY, maxZ),
      new THREE.Vector3(minX, planeY, minZ),
    ]

    const edgeGeometry = new THREE.BufferGeometry().setFromPoints(edgePoints)
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: 0xaaaaaa,
      linewidth: 2,
      transparent: true,
      opacity: 0.6,
    })
    const edgeLines = new THREE.Line(edgeGeometry, edgeMaterial)
    edgeLines.name = 'spee_plane_border'

    // 边框也添加到下颌mesh
    if (lowerMesh) {
      lowerMesh.add(edgeLines)
    } else {
      this.group.add(edgeLines)
    }
    // ========== ✅ 最后统一进行平面旋转 ==========

    // 1. 计算 31→41 方向
    const jawDir = new THREE.Vector3().subVectors(point41, point31).normalize()

    // 2. 平面中心位置
    const centerPos = new THREE.Vector3(centerX, planeY, centerZ)

    // 3. 设置平面位置
    planeMesh.position.copy(centerPos)
    edgeLines.position.copy(centerPos)

    // 4. 让两者一起 lookAt
    const lookTarget = new THREE.Vector3().addVectors(centerPos, jawDir)

    planeMesh.lookAt(lookTarget)
    edgeLines.lookAt(lookTarget)
  }

  /**
   * 渲染关键点标记
   * ⚠️ 添加到下颌模型，跟随下颌显示/隐藏
   */
  private renderKeyPoints(pointsMap: Map<number, THREE.Vector3>, fdis: number[]): void {
    const lowerMesh = this.context.lowerMeshLabel

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
      marker.name = `spee_point_${fdi}`

      // ⚠️ 添加到下颌模型
      if (lowerMesh) {
        lowerMesh.add(marker)
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

      // ⚠️ 标签也添加到下颌模型
      if (lowerMesh) {
        lowerMesh.add(label)
      } else {
        this.group.add(label)
      }
    })

    if (lowerMesh) {
      console.log('✅ 关键点标记已添加到下颌模型')
    }
  }

  /**
   * 渲染最深点
   * ⚠️ 添加到下颌模型，跟随下颌显示/隐藏
   */
  private renderDeepestPoint(curvePoints: THREE.Vector3[], depth: number): void {
    if (curvePoints.length === 0) return

    // 找到Y坐标最低的点（最深点）
    const deepestPoint = curvePoints.reduce((lowest, point) =>
      point.y < lowest.y ? point : lowest,
    )

    const lowerMesh = this.context.lowerMeshLabel

    // 高亮最深点（使用缩放坐标创建球体）
    const geometry = new THREE.SphereGeometry(1.5, 16, 16)
    const material = new THREE.MeshPhongMaterial({
      color: 0xff0000,
      emissive: 0xff0000,
      emissiveIntensity: 0.4,
    })
    const deepestMarker = new THREE.Mesh(geometry, material)
    deepestMarker.position.copy(deepestPoint)
    deepestMarker.name = 'deepest_point'

    // ⚠️ 添加到下颌模型
    if (lowerMesh) {
      lowerMesh.add(deepestMarker)
    } else {
      this.group.add(deepestMarker)
    }

    // 添加深度标签
    const depthLabel = LabelRenderer.createLabel(`深度: ${depth.toFixed(2)}mm`, {
      position: deepestPoint.clone().add(new THREE.Vector3(0, -3, 0)),
      fontSize: 11,
      backgroundColor: '#ff0000',
      fontColor: '#ffffff',
    })

    // ⚠️ 标签也添加到下颌模型
    if (lowerMesh) {
      lowerMesh.add(depthLabel)
      console.log('✅ 最深点标记已添加到下颌模型')
    } else {
      this.group.add(depthLabel)
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
