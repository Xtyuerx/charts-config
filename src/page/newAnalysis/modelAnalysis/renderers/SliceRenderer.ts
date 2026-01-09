import * as THREE from 'three'
import type { SliceRendererOptions } from '../types'
import { SCENE_CONFIG } from '../constants'

/**
 * 切片渲染器
 * 提供切片平面、投影面等的渲染方法
 */
export class SliceRenderer {
  /**
   * 创建切片平面
   */
  static createSlicePlane(
    center: THREE.Vector3,
    normal: THREE.Vector3,
    options: SliceRendererOptions = {},
  ): THREE.Mesh {
    const opts = {
      color: 0xff6b6b,
      opacity: 0.3,
      width: 20,
      height: 20,
      showBorder: true,
      ...options,
    }

    const scale = SCENE_CONFIG.modelScale

    // 创建平面几何
    const geometry = new THREE.PlaneGeometry(opts.width, opts.height)

    // 创建材质
    const material = new THREE.MeshBasicMaterial({
      color: opts.color,
      transparent: true,
      opacity: opts.opacity,
      side: THREE.DoubleSide,
      depthWrite: false, // 避免遮挡问题
    })

    const plane = new THREE.Mesh(geometry, material)

    // 设置位置
    plane.position.copy(center).multiplyScalar(scale)

    // 设置朝向（根据法向量）
    const defaultNormal = new THREE.Vector3(0, 0, 1)
    const quaternion = new THREE.Quaternion().setFromUnitVectors(defaultNormal, normal.normalize())
    plane.quaternion.copy(quaternion)

    plane.name = 'slice_plane'

    // 添加边框
    if (opts.showBorder) {
      const borderGroup = this.createPlaneBorder(opts.width, opts.height, opts.color)
      borderGroup.position.copy(plane.position)
      borderGroup.quaternion.copy(plane.quaternion)
      plane.userData.border = borderGroup
    }

    return plane
  }

  /**
   * 创建中线平面（用于中线偏差分析）
   */
  static createMidlinePlane(
    point1: [number, number, number],
    point2: [number, number, number],
    options: SliceRendererOptions = {},
  ): THREE.Group {
    const group = new THREE.Group()
    group.name = 'midline_plane'

    const scale = SCENE_CONFIG.modelScale

    // 转换点
    const p1 = new THREE.Vector3(point1[0] * scale, point1[1] * scale, point1[2] * scale)
    const p2 = new THREE.Vector3(point2[0] * scale, point2[1] * scale, point2[2] * scale)

    // 计算中心和方向
    const center = p1.clone().add(p2).multiplyScalar(0.5)
    const direction = p2.clone().sub(p1).normalize()

    // 计算法向量（垂直于中线）
    const upVector = new THREE.Vector3(0, 1, 0)
    const normal = direction.clone().cross(upVector).normalize()

    // 创建平面
    const opts = {
      width: 30,
      height: 40,
      ...options,
    }

    const plane = this.createSlicePlane(center.divideScalar(scale), normal, opts)
    group.add(plane)

    // 添加中线
    const lineGeometry = new THREE.BufferGeometry().setFromPoints([p1, p2])
    const lineMaterial = new THREE.LineBasicMaterial({
      color: opts.color || 0xff6b6b,
      linewidth: 2,
    })
    const line = new THREE.Line(lineGeometry, lineMaterial)
    group.add(line)

    return group
  }

  /**
   * 创建投影平面（用于覆盖度分析）
   */
  static createProjectionPlane(
    position: THREE.Vector3,
    width: number,
    height: number,
    options: SliceRendererOptions = {},
  ): THREE.Mesh {
    const opts = {
      color: 0x6b8eff,
      opacity: 0.2,
      showBorder: false,
      ...options,
    }

    const scale = SCENE_CONFIG.modelScale

    const geometry = new THREE.PlaneGeometry(width, height)
    const material = new THREE.MeshBasicMaterial({
      color: opts.color,
      transparent: true,
      opacity: opts.opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    })

    const plane = new THREE.Mesh(geometry, material)
    plane.position.copy(position).multiplyScalar(scale)
    plane.name = 'projection_plane'

    return plane
  }

  /**
   * 创建网格平面
   */
  static createGridPlane(
    center: THREE.Vector3,
    size: number,
    divisions: number,
    options: SliceRendererOptions = {},
  ): THREE.Group {
    const group = new THREE.Group()
    group.name = 'grid_plane'

    const scale = SCENE_CONFIG.modelScale
    const opts = {
      color: 0x888888,
      opacity: 0.5,
      ...options,
    }

    // 创建网格
    const gridHelper = new THREE.GridHelper(size, divisions, opts.color, opts.color)
    gridHelper.position.copy(center).multiplyScalar(scale)
    gridHelper.material.transparent = true
    gridHelper.material.opacity = opts.opacity

    group.add(gridHelper)

    return group
  }

  /**
   * 创建圆形切片
   */
  static createCircularSlice(
    center: THREE.Vector3,
    radius: number,
    normal: THREE.Vector3,
    options: SliceRendererOptions = {},
  ): THREE.Mesh {
    const opts = {
      color: 0xff6b6b,
      opacity: 0.3,
      ...options,
    }

    const scale = SCENE_CONFIG.modelScale

    // 创建圆形几何
    const geometry = new THREE.CircleGeometry(radius, 32)

    const material = new THREE.MeshBasicMaterial({
      color: opts.color,
      transparent: true,
      opacity: opts.opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    })

    const circle = new THREE.Mesh(geometry, material)

    // 设置位置和方向
    circle.position.copy(center).multiplyScalar(scale)

    const defaultNormal = new THREE.Vector3(0, 0, 1)
    const quaternion = new THREE.Quaternion().setFromUnitVectors(defaultNormal, normal.normalize())
    circle.quaternion.copy(quaternion)

    circle.name = 'circular_slice'

    return circle
  }

  /**
   * 创建垂直切片（用于咬合关系分析）
   */
  static createVerticalSlice(
    position: THREE.Vector3,
    width: number,
    height: number,
    angle: number,
    options: SliceRendererOptions = {},
  ): THREE.Mesh {
    const opts = {
      color: 0xffa500,
      opacity: 0.25,
      ...options,
    }

    const scale = SCENE_CONFIG.modelScale

    const geometry = new THREE.PlaneGeometry(width, height)
    const material = new THREE.MeshBasicMaterial({
      color: opts.color,
      transparent: true,
      opacity: opts.opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    })

    const plane = new THREE.Mesh(geometry, material)
    plane.position.copy(position).multiplyScalar(scale)
    plane.rotation.y = angle // 垂直旋转

    plane.name = 'vertical_slice'

    return plane
  }

  /**
   * 创建平面边框（私有辅助方法）
   */
  private static createPlaneBorder(
    width: number,
    height: number,
    color: number,
  ): THREE.LineSegments {
    const points = [
      new THREE.Vector3(-width / 2, -height / 2, 0),
      new THREE.Vector3(width / 2, -height / 2, 0),
      new THREE.Vector3(width / 2, -height / 2, 0),
      new THREE.Vector3(width / 2, height / 2, 0),
      new THREE.Vector3(width / 2, height / 2, 0),
      new THREE.Vector3(-width / 2, height / 2, 0),
      new THREE.Vector3(-width / 2, height / 2, 0),
      new THREE.Vector3(-width / 2, -height / 2, 0),
    ]

    const geometry = new THREE.BufferGeometry().setFromPoints(points)
    const material = new THREE.LineBasicMaterial({
      color,
      linewidth: 2,
    })

    const border = new THREE.LineSegments(geometry, material)
    border.name = 'plane_border'

    return border
  }

  /**
   * 创建分割平面（用于展示模型切分）
   */
  static createClippingPlane(
    position: THREE.Vector3,
    normal: THREE.Vector3,
  ): THREE.Plane {
    const scale = SCENE_CONFIG.modelScale
    const scaledPosition = position.clone().multiplyScalar(scale)
    
    // THREE.Plane 使用点-法向量形式
    const plane = new THREE.Plane()
    plane.setFromNormalAndCoplanarPoint(normal.normalize(), scaledPosition)

    return plane
  }

  /**
   * 创建多个平行切片
   */
  static createParallelSlices(
    startPoint: THREE.Vector3,
    endPoint: THREE.Vector3,
    count: number,
    options: SliceRendererOptions = {},
  ): THREE.Group {
    const group = new THREE.Group()
    group.name = 'parallel_slices'

    const scale = SCENE_CONFIG.modelScale
    const direction = endPoint.clone().sub(startPoint)
    const step = direction.clone().divideScalar(count - 1)

    // 计算法向量
    const upVector = new THREE.Vector3(0, 1, 0)
    const normal = direction.clone().normalize().cross(upVector).normalize()

    // 创建多个平面
    for (let i = 0; i < count; i++) {
      const position = startPoint.clone().add(step.clone().multiplyScalar(i))
      const plane = this.createSlicePlane(position.divideScalar(scale), normal, {
        ...options,
        opacity: (options.opacity || 0.3) * (1 - i / count * 0.5), // 逐渐变透明
      })
      group.add(plane)
    }

    return group
  }
}

