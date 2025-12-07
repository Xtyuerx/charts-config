import * as THREE from 'three'
import type { LabelRendererOptions } from '../types'
import { DEFAULT_LABEL_OPTIONS, SCENE_CONFIG } from '../constants'

/**
 * 标签渲染器
 * 提供各种文本标签的渲染方法
 */
export class LabelRenderer {
  /**
   * 创建文本标签（Sprite）
   */
  static createLabel(text: string, options: LabelRendererOptions = {}): THREE.Sprite {
    const opts = { ...DEFAULT_LABEL_OPTIONS, ...options }

    // 创建Canvas（与 newModel 保持一致：256x256）
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建canvas context')

    canvas.width = 256
    canvas.height = 256

    // 设置字体（与 newModel 保持一致）
    context.font = '200px Arial'
    context.textAlign = 'center'
    context.textBaseline = 'middle'

    // 绘制背景（如果需要）
    if (opts.backgroundColor && opts.backgroundColor !== 'transparent') {
      const padding = opts.padding * 4
      context.fillStyle = opts.backgroundColor
      this.roundRect(
        context,
        padding,
        padding,
        canvas.width - padding * 2,
        canvas.height - padding * 2,
        opts.borderRadius * 4,
      )
      context.fill()
    }

    // 绘制文字
    context.fillStyle = opts.fontColor
    context.fillText(text, canvas.width / 2, canvas.height / 2)

    // 创建纹理和Sprite
    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      sizeAttenuation: true, // 与 newModel 保持一致
    })

    const sprite = new THREE.Sprite(material)

    // 设置位置（与 newModel 保持一致：直接使用中心点，不需要额外缩放）
    if (opts.position) {
      sprite.position.copy(opts.position)
    }

    // 设置缩放（与 newModel 保持一致：2, 2, 1）
    sprite.scale.set(2, 2, 1)

    sprite.name = 'label'
    sprite.userData = { text }

    return sprite
  }

  /**
   * 创建多行文本标签
   */
  static createMultiLineLabel(lines: string[], options: LabelRendererOptions = {}): THREE.Sprite {
    const opts = { ...DEFAULT_LABEL_OPTIONS, ...options }

    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建canvas context')

    canvas.width = 512
    canvas.height = 512

    // 设置字体
    const fontSize = opts.fontSize * 4
    context.font = `${fontSize}px Arial`
    context.textAlign = 'center'
    context.textBaseline = 'middle'

    // 计算最大宽度和总高度
    let maxWidth = 0
    lines.forEach((line) => {
      const metrics = context.measureText(line)
      maxWidth = Math.max(maxWidth, metrics.width)
    })

    const lineHeight = fontSize * 1.2
    const totalHeight = lineHeight * lines.length
    const padding = opts.padding * 4

    // 绘制背景
    const bgWidth = maxWidth + padding * 2
    const bgHeight = totalHeight + padding * 2

    context.fillStyle = opts.backgroundColor
    this.roundRect(
      context,
      canvas.width / 2 - bgWidth / 2,
      canvas.height / 2 - bgHeight / 2,
      bgWidth,
      bgHeight,
      opts.borderRadius * 4,
    )
    context.fill()

    // 绘制文本（从上往下）
    context.fillStyle = opts.fontColor
    const startY = canvas.height / 2 - totalHeight / 2 + lineHeight / 2

    lines.forEach((line, index) => {
      context.fillText(line, canvas.width / 2, startY + index * lineHeight)
    })

    // 创建Sprite
    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    })

    const sprite = new THREE.Sprite(material)

    if (opts.position) {
      const scale = SCENE_CONFIG.modelScale
      sprite.position.copy(opts.position).multiplyScalar(scale)
    }

    const scaleFactor = Math.max(maxWidth / 256, 4)
    sprite.scale.set(scaleFactor, (scaleFactor * totalHeight) / maxWidth, 1)

    sprite.name = 'multi_line_label'
    sprite.userData = { lines }

    return sprite
  }

  /**
   * 创建信息面板（多个键值对）
   */
  static createInfoPanel(
    data: Array<{ key: string; value: string }>,
    options: LabelRendererOptions = {},
  ): THREE.Sprite {
    const lines = data.map((item) => `${item.key}: ${item.value}`)
    return this.createMultiLineLabel(lines, options)
  }

  /**
   * 创建简单文本（无背景）
   */
  static createSimpleText(text: string, options: LabelRendererOptions = {}): THREE.Sprite {
    const opts = { ...DEFAULT_LABEL_OPTIONS, ...options }

    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建canvas context')

    canvas.width = 512
    canvas.height = 256

    // 绘制文本（无背景）
    context.font = `${opts.fontSize * 4}px Arial`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillStyle = opts.fontColor
    context.fillText(text, canvas.width / 2, canvas.height / 2)

    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    })

    const sprite = new THREE.Sprite(material)

    if (opts.position) {
      const scale = SCENE_CONFIG.modelScale
      sprite.position.copy(opts.position).multiplyScalar(scale)
    }

    sprite.scale.set(4, 2, 1)
    sprite.name = 'simple_text'

    return sprite
  }

  /**
   * 创建带指示线的标签（标签指向某个点）
   */
  static createLabelWithPointer(
    text: string,
    targetPosition: THREE.Vector3,
    labelOffset: THREE.Vector3,
    options: LabelRendererOptions = {},
  ): THREE.Group {
    const group = new THREE.Group()
    group.name = 'label_with_pointer'

    const scale = SCENE_CONFIG.modelScale

    // 创建标签
    const label = this.createLabel(text, {
      ...options,
      position: targetPosition.clone().add(labelOffset),
    })
    group.add(label)

    // 创建指示线
    const lineGeometry = new THREE.BufferGeometry().setFromPoints([
      targetPosition.clone().multiplyScalar(scale),
      targetPosition.clone().add(labelOffset).multiplyScalar(scale),
    ])

    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
      linewidth: 1,
      transparent: true,
      opacity: 0.6,
    })

    const line = new THREE.Line(lineGeometry, lineMaterial)
    group.add(line)

    return group
  }

  /**
   * 创建测量数值标签（用于显示距离、角度等）
   */
  static createMeasurementLabel(
    value: number,
    unit: string,
    position: THREE.Vector3,
    options: LabelRendererOptions = {},
  ): THREE.Sprite {
    const text = `${value.toFixed(2)}${unit}`
    return this.createLabel(text, {
      ...options,
      position,
      fontSize: options.fontSize || 12,
      backgroundColor: options.backgroundColor || '#00000080',
    })
  }

  /**
   * 绘制圆角矩形（辅助方法）
   */
  private static roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ): void {
    ctx.beginPath()
    ctx.moveTo(x + radius, y)
    ctx.lineTo(x + width - radius, y)
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius)
    ctx.lineTo(x + width, y + height - radius)
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
    ctx.lineTo(x + radius, y + height)
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius)
    ctx.lineTo(x, y + radius)
    ctx.quadraticCurveTo(x, y, x + radius, y)
    ctx.closePath()
  }

  /**
   * 更新标签文本（无需重新创建）
   */
  static updateLabelText(sprite: THREE.Sprite, newText: string): void {
    if (!sprite.material.map) return

    const canvas = (sprite.material.map as THREE.CanvasTexture).image as HTMLCanvasElement
    const context = canvas.getContext('2d')
    if (!context) return

    // 清除并重绘
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.font = '56px Arial'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillStyle = '#ffffff'
    context.fillText(newText, canvas.width / 2, canvas.height / 2)

    sprite.material.map.needsUpdate = true
    sprite.userData.text = newText
  }
}
