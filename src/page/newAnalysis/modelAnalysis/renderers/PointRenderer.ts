import * as THREE from 'three'
import type { PointRendererOptions, ToothPoint } from '../types'
import { DEFAULT_POINT_OPTIONS, POINT_TYPE_COLORS, SCENE_CONFIG } from '../constants'

/**
 * 点渲染器
 * 提供各种点位标记的渲染方法
 */
export class PointRenderer {
  /**
   * 创建单个点标记（球体）
   */
  static createMarker(
    position: [number, number, number] | THREE.Vector3,
    options: PointRendererOptions = {},
  ): THREE.Mesh {
    const opts = { ...DEFAULT_POINT_OPTIONS, ...options }

    // 创建球体几何
    const geometry = new THREE.SphereGeometry(opts.size, 16, 16)

    // 创建材质
    const material = new THREE.MeshPhongMaterial({
      color: opts.color,
      emissive: opts.color,
      emissiveIntensity: 0.3,
      transparent: true,
      opacity: opts.opacity,
    })

    const sphere = new THREE.Mesh(geometry, material)

    // 设置位置（考虑场景缩放）
    const scale = SCENE_CONFIG.modelScale
    if (Array.isArray(position)) {
      sphere.position.set(position[0] * scale, position[1] * scale, position[2] * scale)
    } else {
      sphere.position.copy(position).multiplyScalar(scale)
    }

    sphere.name = `point_marker`

    return sphere
  }

  /**
   * 批量创建点标记
   */
  static createMarkers(points: ToothPoint[], options: PointRendererOptions = {}): THREE.Group {
    const group = new THREE.Group()
    group.name = 'points_group'

    points.forEach((point) => {
      const color = POINT_TYPE_COLORS[point.type] || options.color || 0xffffff
      const marker = this.createMarker(point.point, {
        ...options,
        color,
      })

      marker.name = `point_${point.fdi}_${point.type}`
      marker.userData = {
        fdi: point.fdi,
        type: point.type,
        type_cn: point.type_cn,
      }

      group.add(marker)
    })

    return group
  }

  /**
   * 创建高亮点标记（带发光效果）
   */
  static createHighlightMarker(
    position: [number, number, number] | THREE.Vector3,
    color = 0xff0000,
  ): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(0.8, 32, 32)

    const material = new THREE.MeshPhongMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.8,
      transparent: true,
      opacity: 0.9,
    })

    const sphere = new THREE.Mesh(geometry, material)

    const scale = SCENE_CONFIG.modelScale
    if (Array.isArray(position)) {
      sphere.position.set(position[0] * scale, position[1] * scale, position[2] * scale)
    } else {
      sphere.position.copy(position).multiplyScalar(scale)
    }

    sphere.name = 'highlight_marker'

    return sphere
  }

  /**
   * 创建点云（大量点的优化渲染）
   */
  static createPointCloud(
    positions: Float32Array,
    color = 0xffffff,
    pointSize = 0.5,
  ): THREE.Points {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))

    const material = new THREE.PointsMaterial({
      color,
      size: pointSize,
      sizeAttenuation: true,
    })

    const points = new THREE.Points(geometry, material)
    points.name = 'point_cloud'

    return points
  }

  /**
   * 创建带标签的点标记
   */
  static createMarkerWithLabel(
    position: [number, number, number],
    label: string,
    options: PointRendererOptions = {},
  ): THREE.Group {
    const group = new THREE.Group()

    // 创建点
    const marker = this.createMarker(position, options)
    group.add(marker)

    // 创建标签
    if (options.showLabel && label) {
      const labelSprite = this.createSimpleLabel(label, 0xffffff)
      labelSprite.position.copy(marker.position)
      labelSprite.position.y += 2 // 偏移到点上方
      group.add(labelSprite)
    }

    return group
  }

  /**
   * 创建简单文本标签（私有辅助方法）
   */
  private static createSimpleLabel(text: string, color: number): THREE.Sprite {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建canvas context')

    canvas.width = 256
    canvas.height = 128

    context.fillStyle = `#${color.toString(16).padStart(6, '0')}`
    context.font = '48px Arial'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(text, 128, 64)

    const texture = new THREE.CanvasTexture(canvas)
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true })
    const sprite = new THREE.Sprite(material)

    sprite.scale.set(3, 1.5, 1)

    return sprite
  }
}
