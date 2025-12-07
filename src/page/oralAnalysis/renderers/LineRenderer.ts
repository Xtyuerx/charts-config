import * as THREE from 'three'
import { Line2 } from 'three-stdlib'
import { LineMaterial } from 'three-stdlib'
import { LineGeometry } from 'three-stdlib'
import type { LineRendererOptions } from '../types'
import { DEFAULT_LINE_OPTIONS, SCENE_CONFIG } from '../constants'

/**
 * 线渲染器
 * 提供各种线条的渲染方法
 */
export class LineRenderer {
  /**
   * 创建基础线条
   */
  static createLine(
    start: [number, number, number] | THREE.Vector3,
    end: [number, number, number] | THREE.Vector3,
    options: LineRendererOptions = {},
  ): THREE.Line {
    const opts = { ...DEFAULT_LINE_OPTIONS, ...options }
    const scale = SCENE_CONFIG.modelScale

    // 转换为Vector3
    const startVec = Array.isArray(start)
      ? new THREE.Vector3(start[0] * scale, start[1] * scale, start[2] * scale)
      : start.clone().multiplyScalar(scale)

    const endVec = Array.isArray(end)
      ? new THREE.Vector3(end[0] * scale, end[1] * scale, end[2] * scale)
      : end.clone().multiplyScalar(scale)

    // 创建几何体
    const points = [startVec, endVec]
    const geometry = new THREE.BufferGeometry().setFromPoints(points)

    // 创建材质
    const material = opts.dashed
      ? new THREE.LineDashedMaterial({
          color: opts.color,
          linewidth: opts.lineWidth,
          dashSize: opts.dashSize,
          gapSize: opts.gapSize,
        })
      : new THREE.LineBasicMaterial({
          color: opts.color,
          linewidth: opts.lineWidth,
        })

    const line = new THREE.Line(geometry, material)

    // 如果是虚线，需要计算距离
    if (opts.dashed) {
      line.computeLineDistances()
    }

    line.name = 'line'

    return line
  }

  /**
   * 创建宽线条（使用Line2）
   */
  static createThickLine(
    start: [number, number, number] | THREE.Vector3,
    end: [number, number, number] | THREE.Vector3,
    options: LineRendererOptions = {},
  ): Line2 {
    const opts = { ...DEFAULT_LINE_OPTIONS, ...options }
    const scale = SCENE_CONFIG.modelScale

    // 转换为数组格式
    const startArr = Array.isArray(start) ? start : start.toArray()
    const endArr = Array.isArray(end) ? end : end.toArray()

    // 应用缩放
    const positions = [
      startArr[0] * scale,
      startArr[1] * scale,
      startArr[2] * scale,
      endArr[0] * scale,
      endArr[1] * scale,
      endArr[2] * scale,
    ]

    const geometry = new LineGeometry()
    geometry.setPositions(positions)

    const material = new LineMaterial({
      color: opts.color,
      linewidth: opts.lineWidth * 0.001, // Line2的linewidth单位是世界坐标
      dashed: opts.dashed,
      dashSize: opts.dashSize,
      gapSize: opts.gapSize,
    })

    const line = new Line2(geometry, material)
    line.name = 'thick_line'

    return line
  }

  /**
   * 创建测量线（带箭头）
   */
  static createMeasurementLine(
    start: [number, number, number] | THREE.Vector3,
    end: [number, number, number] | THREE.Vector3,
    options: LineRendererOptions = {},
  ): THREE.Group {
    const group = new THREE.Group()
    group.name = 'measurement_line'

    // 创建主线
    const line = this.createLine(start, end, options)
    group.add(line)

    // 如果需要箭头
    if (options.showArrows) {
      const scale = SCENE_CONFIG.modelScale

      const startVec = Array.isArray(start)
        ? new THREE.Vector3(start[0] * scale, start[1] * scale, start[2] * scale)
        : start.clone().multiplyScalar(scale)

      const endVec = Array.isArray(end)
        ? new THREE.Vector3(end[0] * scale, end[1] * scale, end[2] * scale)
        : end.clone().multiplyScalar(scale)

      // 创建起点箭头
      const startArrow = this.createArrow(startVec, endVec, options.color || 0x00ff00)
      group.add(startArrow)

      // 创建终点箭头
      const endArrow = this.createArrow(endVec, startVec, options.color || 0x00ff00)
      group.add(endArrow)
    }

    return group
  }

  /**
   * 创建虚线
   */
  static createDashedLine(
    start: [number, number, number] | THREE.Vector3,
    end: [number, number, number] | THREE.Vector3,
    options: LineRendererOptions = {},
  ): THREE.Line {
    return this.createLine(start, end, {
      ...options,
      dashed: true,
    })
  }

  /**
   * 创建多段线
   */
  static createPolyline(
    points: Array<[number, number, number] | THREE.Vector3>,
    options: LineRendererOptions = {},
  ): THREE.Line {
    const opts = { ...DEFAULT_LINE_OPTIONS, ...options }
    const scale = SCENE_CONFIG.modelScale

    // 转换所有点
    const vectors = points.map((p) => {
      if (Array.isArray(p)) {
        return new THREE.Vector3(p[0] * scale, p[1] * scale, p[2] * scale)
      }
      return p.clone().multiplyScalar(scale)
    })

    const geometry = new THREE.BufferGeometry().setFromPoints(vectors)

    const material = opts.dashed
      ? new THREE.LineDashedMaterial({
          color: opts.color,
          linewidth: opts.lineWidth,
          dashSize: opts.dashSize,
          gapSize: opts.gapSize,
        })
      : new THREE.LineBasicMaterial({
          color: opts.color,
          linewidth: opts.lineWidth,
        })

    const line = new THREE.Line(geometry, material)

    if (opts.dashed) {
      line.computeLineDistances()
    }

    line.name = 'polyline'

    return line
  }

  /**
   * 创建平滑曲线
   */
  static createCurve(
    points: Array<[number, number, number] | THREE.Vector3>,
    options: LineRendererOptions = {},
  ): THREE.Line {
    const opts = { ...DEFAULT_LINE_OPTIONS, ...options }
    const scale = SCENE_CONFIG.modelScale

    // 转换点并缩放
    const vectors = points.map((p) => {
      if (Array.isArray(p)) {
        return new THREE.Vector3(p[0] * scale, p[1] * scale, p[2] * scale)
      }
      return p.clone().multiplyScalar(scale)
    })

    // 创建Catmull-Rom曲线
    const curve = new THREE.CatmullRomCurve3(vectors)
    const curvePoints = curve.getPoints(50) // 50个点进行平滑

    const geometry = new THREE.BufferGeometry().setFromPoints(curvePoints)

    const material = new THREE.LineBasicMaterial({
      color: opts.color,
      linewidth: opts.lineWidth,
    })

    const line = new THREE.Line(geometry, material)
    line.name = 'curve'

    return line
  }

  /**
   * 创建箭头（私有辅助方法）
   */
  private static createArrow(
    position: THREE.Vector3,
    direction: THREE.Vector3,
    color: number,
  ): THREE.Mesh {
    const dir = direction.clone().sub(position).normalize()

    const geometry = new THREE.ConeGeometry(0.3, 0.8, 8)
    const material = new THREE.MeshBasicMaterial({ color })
    const arrow = new THREE.Mesh(geometry, material)

    arrow.position.copy(position)
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)

    return arrow
  }

  /**
   * 计算两点距离
   */
  static calculateDistance(
    start: [number, number, number] | THREE.Vector3,
    end: [number, number, number] | THREE.Vector3,
  ): number {
    const startVec = Array.isArray(start) ? new THREE.Vector3(...start) : start
    const endVec = Array.isArray(end) ? new THREE.Vector3(...end) : end

    return startVec.distanceTo(endVec)
  }
}
