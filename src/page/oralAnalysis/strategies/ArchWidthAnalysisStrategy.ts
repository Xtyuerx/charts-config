import * as THREE from 'three'
import { BaseAnalysisStrategy } from './base/BaseAnalysisStrategy'
import type { AnalysisData, MeasurementGroup, RenderType } from '../types'
import { LabelRenderer } from '../renderers'

/**
 * 牙弓宽度分析策略
 * 测量上下颌的牙弓宽度
 */
export class ArchWidthAnalysisStrategy extends BaseAnalysisStrategy {
  readonly id = 'arch-width'
  readonly name = '牙弓宽度分析'
  readonly taskName = 'arch-width'
  readonly renderType: RenderType = 'POINT_LINE'

  /**
   * 重写点位渲染方法
   * 确保点位添加到对应的 mesh，而不是 group
   * 这样点位才能随模型的显示/隐藏自动同步
   */
  protected renderPoints(teethPoints: import('../types').ToothPoint[]): void {
    // 过滤出牙弓宽度分析需要的点位（13, 23, 16, 26, 33, 43, 36, 46）
    const targetFdis = [13, 23, 16, 26, 33, 43, 36, 46]
    const relevantPoints = teethPoints.filter((p) => targetFdis.includes(p.fdi))

    // 为每个点位创建标记并添加到对应的 mesh
    relevantPoints.forEach((p) => {
      const color = this.getPointColor(p.type)

      // 创建球体作为点标记（不缩放，因为会添加到 mesh）
      const geometry = new THREE.SphereGeometry(0.6, 16, 16)
      const material = new THREE.MeshPhongMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.3,
        transparent: true,
        opacity: 0.8,
      })
      const sphere = new THREE.Mesh(geometry, material)

      // 设置位置（不缩放，因为 mesh 本身已经有缩放了）
      sphere.position.set(p.point[0], p.point[1], p.point[2])
      sphere.name = `point_${p.fdi}_${p.type}`

      // 添加到对应的 mesh（这样点位会随 mesh 显示/隐藏）
      this.addToMesh(sphere, p.fdi)
    })

    console.log(`✅ 渲染了 ${relevantPoints.length} 个牙弓宽度点位，已添加到对应 mesh`)
  }

  /**
   * 渲染特定元素
   * 牙弓宽度分析：显示测量线和宽度值
   * 上颌：连接 13-23（前牙弓），16-26（后牙弓）
   * 下颌：连接 33-43（前牙弓），36-46（后牙弓）
   */
  protected renderSpecificElements(data: AnalysisData): void {
    const { teeth_points, measurements } = data

    if (!teeth_points || teeth_points.length === 0) return

    // 渲染上颌牙弓宽度（固定连接 13-23 和 16-26）
    this.renderUpperArchWidth(teeth_points, measurements)

    // 渲染下颌牙弓宽度（固定连接 33-43 和 36-46）
    this.renderLowerArchWidth(teeth_points, measurements)
  }

  /**
   * 渲染测量标注
   */
  protected renderMeasurements(measurements: Record<string, unknown>): void {
    if (!measurements) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const upperArch = measurements.upper_arch as Record<string, any> | undefined
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lowerArch = measurements.lower_arch as Record<string, any> | undefined
    const diagnosis = (measurements.diagnosis as string) || ''
    const severity = (measurements.severity as string) || ''

    // 上颌信息面板
    if (upperArch) {
      const canineWidth = upperArch.canine_width_3_3?.width || 0
      const molarWidth = upperArch.molar_width_6_6?.width || 0

      LabelRenderer.createInfoPanel(
        [
          { key: '上颌尖牙宽度', value: `${canineWidth.toFixed(2)}mm` },
          { key: '上颌磨牙宽度', value: `${molarWidth.toFixed(2)}mm` },
        ],
        {
          position: new THREE.Vector3(-25, 30, 0),
          fontSize: 13,
          backgroundColor: '#1976d2',
          fontColor: '#ffffff',
        },
      )
      // this.group.add(upperPanel)
    }

    // 下颌信息面板
    if (lowerArch) {
      const canineWidth = lowerArch.canine_width_3_3?.width || 0
      const molarWidth = lowerArch.molar_width_6_6?.width || 0

      LabelRenderer.createInfoPanel(
        [
          { key: '下颌尖牙宽度', value: `${canineWidth.toFixed(2)}mm` },
          { key: '下颌磨牙宽度', value: `${molarWidth.toFixed(2)}mm` },
        ],
        {
          position: new THREE.Vector3(25, 30, 0),
          fontSize: 13,
          backgroundColor: '#1976d2',
          fontColor: '#ffffff',
        },
      )
      // this.group.add(lowerPanel)
    }

    // 诊断信息
    if (diagnosis || severity) {
      const diagnosisPanel = LabelRenderer.createLabel(`${diagnosis} - ${severity}`, {
        position: new THREE.Vector3(0, 40, 0),
        fontSize: 14,
        backgroundColor: diagnosis === '正常' ? '#22c55e' : '#ef4444',
        fontColor: '#ffffff',
      })
      // this.group.add(diagnosisPanel)
    }
  }

  /**
   * 格式化测量数据为面板展示格式
   */
  protected formatMeasurements(measurements: Record<string, unknown>): MeasurementGroup[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const upperArch = measurements.upper_arch as Record<string, any> | undefined
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lowerArch = measurements.lower_arch as Record<string, any> | undefined
    const diagnosis = (measurements.diagnosis as string) || '未诊断'
    const severity = (measurements.severity as string) || '未知'

    const groups: MeasurementGroup[] = []

    // 上颌牙弓宽度（固定牙位：13-23, 16-26）
    const upperCanineWidth = upperArch?.canine_width_3_3?.width as number | undefined
    const upperMolarWidth = upperArch?.molar_width_6_6?.width as number | undefined

    groups.push({
      groupName: '上颌牙弓宽度',
      children: [
        {
          name: '尖牙宽度 (13-23)',
          value: upperCanineWidth ? `${upperCanineWidth.toFixed(2)}mm` : '未测量',
          result: '前牙弓宽度',
        },
        {
          name: '磨牙宽度 (16-26)',
          value: upperMolarWidth ? `${upperMolarWidth.toFixed(2)}mm` : '未测量',
          result: '后牙弓宽度',
        },
      ],
    })

    // 下颌牙弓宽度（固定牙位：33-43, 36-46）
    const lowerCanineWidth = lowerArch?.canine_width_3_3?.width as number | undefined
    const lowerMolarWidth = lowerArch?.molar_width_6_6?.width as number | undefined

    groups.push({
      groupName: '下颌牙弓宽度',
      children: [
        {
          name: '尖牙宽度 (33-43)',
          value: lowerCanineWidth ? `${lowerCanineWidth.toFixed(2)}mm` : '未测量',
          result: '前牙弓宽度',
        },
        {
          name: '磨牙宽度 (36-46)',
          value: lowerMolarWidth ? `${lowerMolarWidth.toFixed(2)}mm` : '未测量',
          result: '后牙弓宽度',
        },
      ],
    })

    // 添加诊断结果组
    groups.push({
      groupName: '诊断结果',
      children: [
        {
          name: '诊断',
          value: diagnosis,
          result: diagnosis === '正常' ? '正常' : '异常',
        },
        {
          name: '严重程度',
          value: severity,
          result: severity === '正常' ? '正常' : severity,
        },
      ],
    })

    return groups
  }

  // ==================== 私有辅助方法 ====================

  /**
   * 渲染上颌牙弓宽度
   * 固定连接：13-23（前牙弓），16-26（后牙弓）
   */
  private renderUpperArchWidth(
    teethPoints: AnalysisData['teeth_points'],
    measurements: Record<string, unknown> | undefined,
  ): void {
    // 尝试从不同的数据结构中获取宽度值
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const upperArch = measurements?.upper_arch as Record<string, any> | undefined

    // 前牙弓宽度：13-23（尖牙）
    const anteriorWidth =
      (measurements?.anterior_width_mm as number) ||
      (upperArch?.canine_width_3_3?.width as number) ||
      this.calculateDistance(teethPoints, 13, 23)

    this.renderWidthLine(
      teethPoints,
      13, // 左上尖牙
      23, // 右上尖牙
      anteriorWidth,
      0x00ff00, // 绿色
      '前',
      true, // 上颌
    )

    // 后牙弓宽度：16-26（第一磨牙）
    const posteriorWidth =
      (measurements?.posterior_width_mm as number) ||
      (upperArch?.molar_width_6_6?.width as number) ||
      this.calculateDistance(teethPoints, 16, 26)

    this.renderWidthLine(
      teethPoints,
      16, // 左上第一磨牙
      26, // 右上第一磨牙
      posteriorWidth,
      0xff9800, // 橙色
      '后',
      true, // 上颌
    )
  }

  /**
   * 渲染下颌牙弓宽度
   * 固定连接：33-43（前牙弓），36-46（后牙弓）
   */
  private renderLowerArchWidth(
    teethPoints: AnalysisData['teeth_points'],
    measurements: Record<string, unknown> | undefined,
  ): void {
    // 尝试从不同的数据结构中获取宽度值
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lowerArch = measurements?.lower_arch as Record<string, any> | undefined

    // 前牙弓宽度：33-43（尖牙）
    const anteriorWidth =
      (measurements?.anterior_width_mm as number) ||
      (lowerArch?.canine_width_3_3?.width as number) ||
      this.calculateDistance(teethPoints, 43, 33)

    this.renderWidthLine(
      teethPoints,
      43, // 左下尖牙
      33, // 右下尖牙
      anteriorWidth,
      0x00bfff, // 天蓝色
      '前',
      false, // 下颌
    )

    // 后牙弓宽度：36-46（第一磨牙）
    const posteriorWidth =
      (measurements?.posterior_width_mm as number) ||
      (lowerArch?.molar_width_6_6?.width as number) ||
      this.calculateDistance(teethPoints, 46, 36)

    this.renderWidthLine(
      teethPoints,
      46, // 左下第一磨牙
      36, // 右下第一磨牙
      posteriorWidth,
      0xffa500, // 橙黄色
      '后',
      false, // 下颌
    )
  }

  /**
   * 计算两颗牙齿之间的距离
   */
  private calculateDistance(
    teethPoints: AnalysisData['teeth_points'],
    fdi1: number,
    fdi2: number,
  ): number {
    const tooth1Points = teethPoints.filter((p) => p.fdi === fdi1)
    const tooth2Points = teethPoints.filter((p) => p.fdi === fdi2)

    if (tooth1Points.length === 0 || tooth2Points.length === 0) {
      return 0
    }

    const center1 = this.calculatePointsCenterUnscaled(tooth1Points.map((p) => p.point))
    const center2 = this.calculatePointsCenterUnscaled(tooth2Points.map((p) => p.point))

    return center1.distanceTo(center2)
  }

  /**
   * 创建牙位标签（小巧的数字标签）
   */
  private createToothLabel(text: string, position: THREE.Vector3): THREE.Sprite {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建canvas context')

    canvas.width = 128
    canvas.height = 128

    // 较小的字体
    const fontSize = 70
    context.font = `bold ${fontSize}px Arial`
    context.textAlign = 'center'
    context.textBaseline = 'middle'

    // 绘制半透明背景
    const padding = 12
    context.fillStyle = 'rgba(0, 0, 0, 0.7)'
    context.beginPath()
    context.arc(canvas.width / 2, canvas.height / 2, fontSize / 2 + padding, 0, Math.PI * 2)
    context.fill()

    // 绘制文字
    context.fillStyle = '#ffffff'
    context.fillText(text, canvas.width / 2, canvas.height / 2)

    // 创建纹理和 Sprite
    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })

    const sprite = new THREE.Sprite(material)
    sprite.position.copy(position)
    sprite.scale.set(1.5, 1.5, 1) // 较小的缩放

    sprite.userData = { text }
    return sprite
  }

  /**
   * 创建宽度标签（使用更大的 canvas 确保文本完整显示）
   */
  private createWidthLabel(
    text: string,
    position: THREE.Vector3,
    backgroundColor: string,
  ): THREE.Sprite {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建canvas context')

    // 使用更大的 canvas 以容纳更长的文本
    canvas.width = 512
    canvas.height = 128

    // 设置较小的字体
    const fontSize = 100 // canvas 字体大小
    context.font = `${fontSize}px Arial`
    context.textAlign = 'center'
    context.textBaseline = 'middle'

    // 测量文本宽度
    const textMetrics = context.measureText(text)
    const textWidth = textMetrics.width

    // 绘制背景
    const padding = 16
    const bgWidth = textWidth + padding * 2
    const bgHeight = fontSize + padding * 2
    const bgX = (canvas.width - bgWidth) / 2
    const bgY = (canvas.height - bgHeight) / 2

    context.fillStyle = backgroundColor
    context.beginPath()
    context.roundRect(bgX, bgY, bgWidth, bgHeight, 8)
    context.fill()

    // 绘制文字
    context.fillStyle = '#ffffff'
    context.fillText(text, canvas.width / 2, canvas.height / 2)

    // 创建纹理和 Sprite
    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })

    const sprite = new THREE.Sprite(material)
    sprite.position.copy(position)

    // 调整缩放以适应文本宽度（较小的缩放）
    const scaleX = Math.max(4, (textWidth / 256) * 3)
    sprite.scale.set(scaleX, 1, 1)

    sprite.userData = { text }
    return sprite
  }

  /**
   * 渲染宽度测量线
   * @param teethPoints 所有牙齿点位
   * @param fdi1 第一颗牙齿的FDI编号
   * @param fdi2 第二颗牙齿的FDI编号
   * @param width 宽度值（毫米）
   * @param color 线条颜色
   * @param label 标签文字（前/后）
   * @param isUpper 是否为上颌
   */
  private renderWidthLine(
    teethPoints: AnalysisData['teeth_points'],
    fdi1: number,
    fdi2: number,
    width: number,
    color: number,
    label: string,
    isUpper: boolean,
  ): void {
    // 找到两颗牙齿的点
    const tooth1Points = teethPoints.filter((p) => p.fdi === fdi1)
    const tooth2Points = teethPoints.filter((p) => p.fdi === fdi2)

    if (tooth1Points.length === 0 || tooth2Points.length === 0) {
      console.warn(`⚠️ 未找到牙齿点位: ${fdi1} 或 ${fdi2}`)
      return
    }

    // 计算牙齿中心点（不缩放，因为会添加到 mesh）
    const center1 = this.calculatePointsCenterUnscaled(tooth1Points.map((p) => p.point))
    const center2 = this.calculatePointsCenterUnscaled(tooth2Points.map((p) => p.point))

    // 注意：点位标记已经在 renderPoints 方法中创建，这里只创建连接线

    // 创建测量线（不缩放）
    const line = this.createLineUnscaled(center1, center2, color, 3)
    line.name = `line_${fdi1}_${fdi2}`

    // 根据颌位添加到对应的 mesh
    // 因为同一颌的两颗牙，所以都添加到同一个mesh
    this.addLineToMesh(line, fdi1, fdi2)

    // 渲染宽度标签（在线的中点，不缩放）
    const midPoint = new THREE.Vector3().addVectors(center1, center2).multiplyScalar(0.5)

    // 使用简洁的标签文本，减小字体，确保完整显示
    const jawLabel = isUpper ? '上' : '下'
    const widthLabel = this.createWidthLabel(
      `${jawLabel}${label}: ${width.toFixed(1)}mm`,
      midPoint.clone().add(new THREE.Vector3(0, isUpper ? 3 : -3, 0)),
      `#${color.toString(16).padStart(6, '0')}`,
    )
    widthLabel.name = `width_label_${fdi1}_${fdi2}`

    // 添加到对应的 mesh
    this.addLineToMesh(widthLabel, fdi1, fdi2)

    // 渲染牙位标签（使用更小的标签）
    const tooth1Label = this.createToothLabel(
      fdi1.toString(),
      center1.clone().add(new THREE.Vector3(0, isUpper ? -2 : 2, 0)),
    )
    tooth1Label.name = `tooth_label_${fdi1}`

    const tooth2Label = this.createToothLabel(
      fdi2.toString(),
      center2.clone().add(new THREE.Vector3(0, isUpper ? -2 : 2, 0)),
    )
    tooth2Label.name = `tooth_label_${fdi2}`

    // 添加到对应的 mesh
    this.addToMesh(tooth1Label, fdi1)
    this.addToMesh(tooth2Label, fdi2)

    console.log(
      `✅ 渲染${jawLabel}${label}牙弓宽度线: ${fdi1}-${fdi2}, 宽度: ${width.toFixed(2)}mm`,
    )
  }
}
