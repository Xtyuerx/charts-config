import * as THREE from 'three'
import type { AnalysisData, MeasurementGroup, RenderType } from '../types'
import { createJawArchWire, type ArchWireResult } from '../utils/ArchWireUtils'
import { BaseAnalysisStrategy } from './base/BaseAnalysisStrategy'

/**
 * 拥挤度分析策略
 * 分析上下颌牙齿的拥挤程度
 */
export class CrowdingAnalysisStrategy extends BaseAnalysisStrategy {
  readonly id = 'crowding'
  readonly name = '拥挤度'
  readonly taskName = 'tooth-crowding-degree'
  readonly renderType: RenderType = 'POINT_ONLY'

  // 存储可拖动的点位对象
  private draggablePoints: THREE.Mesh[] = []

  // 存储上下颌牙弓线
  private upperArchWire: ArchWireResult | null = null
  private lowerArchWire: ArchWireResult | null = null

  // 存储下颌水平基准平面
  private lowerJawPlane: THREE.Mesh | null = null
  // 存储平面信息用于拖拽约束
  private planeCenter: THREE.Vector3 | null = null
  private planeNormal: THREE.Vector3 | null = null
  // 🆕 倾斜角度配置（弧度）
  private readonly tiltAngleX = 0 // 前后倾斜（绕X轴）
  private readonly tiltAngleY = 0.1 // 旋转朝向（绕Y轴）
  private readonly tiltAngleZ = 0 // 左右倾斜（绕Z轴）

  /**
   * 渲染特定元素
   * 拥挤度分析：显示牙齿间距和拥挤区域，以及牙弓线
   */
  protected renderSpecificElements(data: AnalysisData): void {
    const { teeth_points, measurements } = data

    if (!teeth_points || teeth_points.length === 0) return

    // 创建上下颌牙弓线（在点位渲染之后）
    this.createArchWires()

    // 创建下颌水平基准平面
    this.createLowerJawPlane()

    // 渲染上颌拥挤度
    this.renderJawCrowding(teeth_points, measurements?.upper_jaw as Record<string, unknown>, true)

    // 渲染下颌拥挤度
    this.renderJawCrowding(teeth_points, measurements?.lower_jaw as Record<string, unknown>, false)
  }

  /**
   * 格式化测量数据为面板展示格式
   */
  protected formatMeasurements(measurements: Record<string, unknown>): MeasurementGroup[] {
    const upperData = measurements.upper_jaw as Record<string, unknown>
    const lowerData = measurements.lower_jaw as Record<string, unknown>

    const groups: MeasurementGroup[] = []

    // 上颌拥挤度
    if (upperData) {
      const discrepancy = (upperData.discrepancy_mm as number) || 0
      const toothWidthsSum = (upperData.tooth_widths_sum_mm as number) || 0
      const archLength = (upperData.arch_length_mm as number) || 0

      groups.push({
        groupName: '上颌拥挤度',
        children: [
          {
            name: '牙量与骨量的实际差值',
            value: `${discrepancy.toFixed(2)}mm`,
            result: '',
          },
          {
            name: '牙齿宽度总和/牙量',
            value: `${toothWidthsSum.toFixed(2)}mm`,
            result: '',
          },
          {
            name: '牙弓弧形长度/骨量',
            value: `${archLength.toFixed(2)}mm`,
            result: '',
          },
        ],
      })
    }

    // 下颌拥挤度
    if (lowerData) {
      const discrepancy = (lowerData.discrepancy_mm as number) || 0
      const toothWidthsSum = (lowerData.tooth_widths_sum_mm as number) || 0
      const archLength = (lowerData.arch_length_mm as number) || 0

      groups.push({
        groupName: '下颌拥挤度',
        children: [
          {
            name: '牙量与骨量的实际差值',
            value: `${discrepancy.toFixed(2)}mm`,
            result: '',
          },
          {
            name: '牙齿宽度总和/牙量',
            value: `${toothWidthsSum.toFixed(2)}mm`,
            result: '',
          },
          {
            name: '牙弓弧形长度/骨量',
            value: `${archLength.toFixed(2)}mm`,
            result: '',
          },
        ],
      })
    }

    return groups
  }

  // ==================== 私有辅助方法 ====================

  /**
   * 重写点位渲染 - 使点位可拖动
   */
  protected renderPoints(teethPoints: import('../types').ToothPoint[]): void {
    teethPoints.forEach((p) => {
      // 根据颌位设置颜色：上颌 #FEB5B5，下颌 #A49ED9
      const color = this.isUpper(p.fdi) ? 0xfeb5b5 : 0xa49ed9

      // 解析 point（可能是字符串或数组）
      let pointCoords: number[]
      if (typeof p.point === 'string') {
        // 解析字符串格式: "[-5.4728, -24.4353, -3.1645]"
        pointCoords = JSON.parse(p.point) as number[]
      } else {
        pointCoords = p.point
      }

      // 创建球体作为点标记
      const geometry = new THREE.SphereGeometry(0.5, 16, 16)
      const material = new THREE.MeshPhongMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.3,
        transparent: true,
      })
      const sphere = new THREE.Mesh(geometry, material)

      // 不应用缩放，因为 mesh 本身已经有缩放了
      sphere.position.set(pointCoords[0] ?? 0, pointCoords[1] ?? 0, pointCoords[2] ?? 0)
      sphere.name = `point_${p.fdi}_${p.type}`

      // 设置为可拖动
      sphere.userData.draggable = true
      sphere.userData.isCrowdingPoint = true
      sphere.userData.strategy = this
      sphere.userData.fdi = p.fdi
      sphere.userData.pointType = p.type
      sphere.userData.originalPosition = sphere.position.clone()

      // 添加到对应的 mesh，点位会随模型的隐藏而隐藏
      this.addToMesh(sphere, p.fdi)
      this.draggablePoints.push(sphere)
    })
  }

  /**
   * 获取所有可拖动对象
   * 供 SceneManager 注册拖拽控制使用
   */
  public getDraggableObjects(): THREE.Mesh[] {
    return this.draggablePoints
  }

  /**
   * 清理资源
   * 重写基类方法，额外清理拥挤度特有的资源
   */
  cleanup(): void {
    // 清理可拖动点位
    this.draggablePoints = []

    // 释放上颌牙弓线资源（基类的cleanupMeshChildren会从mesh中移除）
    if (this.upperArchWire) {
      this.disposeArchWire(this.upperArchWire)
      this.upperArchWire = null
    }

    // 释放下颌牙弓线资源（基类的cleanupMeshChildren会从mesh中移除）
    if (this.lowerArchWire) {
      this.disposeArchWire(this.lowerArchWire)
      this.lowerArchWire = null
    }

    // 释放下颌平面资源
    if (this.lowerJawPlane) {
      this.disposePlane(this.lowerJawPlane)
      this.lowerJawPlane = null
    }

    // 清理平面约束信息
    this.planeCenter = null
    this.planeNormal = null

    // 调用基类清理方法（会自动从mesh中移除所有以taskName_开头的对象）
    super.cleanup()
  }

  /**
   * 拖动点位时的回调函数
   * 约束点位在平面上移动，并更新牙弓线形状
   */
  public updateOnDrag(object: THREE.Object3D): void {
    // 如果是下颌点位且有平面约束，则限制在平面上移动
    if (object.userData.constrainedToPlane && this.planeCenter && this.planeNormal) {
      const fdi = object.userData.fdi as number
      if (fdi && fdi >= 31 && fdi <= 48) {
        // 下颌牙齿范围
        const currentPos = object.position.clone()

        // 计算点到平面的距离
        const toPoint = new THREE.Vector3().subVectors(currentPos, this.planeCenter)
        const distance = toPoint.dot(this.planeNormal)

        // 如果点位偏离平面，则投影回平面
        if (Math.abs(distance) > 0.001) {
          // 阈值0.001mm
          const projectedPos = currentPos
            .clone()
            .sub(this.planeNormal.clone().multiplyScalar(distance))
          object.position.copy(projectedPos)

          console.log(
            `🔒 点位 FDI-${fdi} 已约束到平面: 偏移=${distance.toFixed(4)}mm -> 已矫正到平面上`,
          )
        }
      }
    }

    // 更新上下颌牙弓线（如果存在）
    if (this.upperArchWire || this.lowerArchWire) {
      this.updateArchWireShape()
    }
  }

  /**
   * 创建上下颌牙弓线
   */
  private createArchWires(): void {
    // 收集上下颌牙齿中心点
    const { upperCenters, lowerCenters } = this.collectToothCenters()

    // 创建上颌牙弓线并添加到上颌mesh
    if (Object.keys(upperCenters).length >= 2) {
      this.upperArchWire = createJawArchWire(upperCenters, 'upper')
      if (this.upperArchWire) {
        this.addArchWireToMesh(this.upperArchWire, true)
      }
    }

    // 创建下颌牙弓线（保持自然Spee曲线）并添加到下颌mesh
    if (Object.keys(lowerCenters).length >= 2) {
      // 直接使用原始点位，保持下颌的自然Spee曲线（纵向弧度）
      this.lowerArchWire = createJawArchWire(lowerCenters, 'lower')
      if (this.lowerArchWire) {
        this.addArchWireToMesh(this.lowerArchWire, false)
      }
    }
  }

  /**
   * 将牙弓线添加到对应的mesh
   * @param archWire 牙弓线对象
   * @param isUpper 是否为上颌
   */
  private addArchWireToMesh(archWire: ArchWireResult, isUpper: boolean): void {
    const targetMesh = isUpper ? this.context.upperMeshLabel : this.context.lowerMeshLabel

    if (!targetMesh) {
      return
    }

    // 设置名称和渲染属性
    archWire.group.name = `${this.taskName}_${isUpper ? 'upper' : 'lower'}_arch_wire`
    archWire.group.renderOrder = 999

    // 遍历牙弓线的所有子对象，设置渲染属性
    archWire.group.traverse((child) => {
      child.renderOrder = 999

      if ('material' in child) {
        const material = (child as THREE.Mesh | THREE.Line).material
        if (material) {
          if (Array.isArray(material)) {
            material.forEach((mat) => {
              mat.depthTest = false
              mat.depthWrite = false
              mat.transparent = true
            })
          } else {
            material.depthTest = false
            material.depthWrite = false
            material.transparent = true
          }
        }
      }
    })

    // 添加到对应的mesh，使其随mesh的显隐而显隐
    targetMesh.add(archWire.group)
  }

  /**
   * 收集牙齿中心点
   */
  private collectToothCenters(): {
    upperCenters: Record<number, THREE.Vector3>
    lowerCenters: Record<number, THREE.Vector3>
  } {
    const upperCenters: Record<number, THREE.Vector3> = {}
    const lowerCenters: Record<number, THREE.Vector3> = {}

    // 统计每个FDI的所有点位
    const fdiPointsMap: Record<number, THREE.Vector3[]> = {}

    this.draggablePoints.forEach((point) => {
      const fdi = point.userData.fdi as number
      if (!fdi) return

      if (!fdiPointsMap[fdi]) {
        fdiPointsMap[fdi] = []
      }
      fdiPointsMap[fdi].push(point.position.clone())
    })

    // 计算每个FDI的中心点（使用原始坐标，不应用缩放）
    // 因为点位和牙弓线都会添加到mesh，mesh本身有缩放
    Object.entries(fdiPointsMap).forEach(([fdi, points]) => {
      const fdiNum = Number(fdi)

      // 计算平均位置（原始坐标）
      const sum = points.reduce(
        (acc, p) => {
          acc.x += p.x
          acc.y += p.y
          acc.z += p.z
          return acc
        },
        { x: 0, y: 0, z: 0 },
      )

      // 使用原始坐标，不乘以scale
      const center = new THREE.Vector3(
        sum.x / points.length,
        sum.y / points.length,
        sum.z / points.length,
      )

      // 根据FDI范围分配到上下颌
      if (fdiNum >= 11 && fdiNum <= 28) {
        upperCenters[fdiNum] = center
      } else if (fdiNum >= 31 && fdiNum <= 48) {
        lowerCenters[fdiNum] = center
      }
    })

    return { upperCenters, lowerCenters }
  }

  /**
   * 更新牙弓线形状
   * 基于当前所有点位的位置重新计算牙弓线
   */
  private updateArchWireShape(): void {
    if (!this.context) return

    // 收集更新后的牙齿中心点
    const { upperCenters, lowerCenters } = this.collectToothCenters()

    // 更新上颌牙弓线
    if (this.upperArchWire && Object.keys(upperCenters).length >= 2) {
      // 从上颌mesh中移除旧的牙弓线
      const upperMesh = this.context.upperMeshLabel
      if (upperMesh) {
        upperMesh.remove(this.upperArchWire.group)
      }
      this.disposeArchWire(this.upperArchWire)

      // 创建新的牙弓线并添加到上颌mesh
      this.upperArchWire = createJawArchWire(upperCenters, 'upper')
      if (this.upperArchWire) {
        this.addArchWireToMesh(this.upperArchWire, true)
      }
    }

    // 更新下颌牙弓线（保持自然Spee曲线）
    if (this.lowerArchWire && Object.keys(lowerCenters).length >= 2) {
      // 从下颌mesh中移除旧的牙弓线
      const lowerMesh = this.context.lowerMeshLabel
      if (lowerMesh) {
        lowerMesh.remove(this.lowerArchWire.group)
      }
      this.disposeArchWire(this.lowerArchWire)

      // 直接使用原始点位创建新的牙弓线（保持Spee曲线）
      this.lowerArchWire = createJawArchWire(lowerCenters, 'lower')
      if (this.lowerArchWire) {
        this.addArchWireToMesh(this.lowerArchWire, false)
      }
    }
  }

  /**
   * 释放牙弓线资源
   */
  private disposeArchWire(archWire: ArchWireResult): void {
    // 遍历组中的所有对象，释放几何体和材质
    archWire.group.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        // 释放几何体
        if (child.geometry) {
          child.geometry.dispose()
        }

        // 释放材质
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose())
          } else {
            child.material.dispose()
          }
        }
      }
    })
  }

  /**
   * 将点位投影到最佳拟合平面（带平面信息）
   * 用于下颌牙弓线的平面投影
   */
  private projectToPlaneWithInfo(centers: Record<number, THREE.Vector3>): {
    projectedCenters: Record<number, THREE.Vector3>
    planeInfo: { centroid: THREE.Vector3; normal: THREE.Vector3 }
  } {
    const points = Object.values(centers)
    if (points.length < 3) {
      return {
        projectedCenters: centers,
        planeInfo: {
          centroid: new THREE.Vector3(),
          normal: new THREE.Vector3(0, 0, 1),
        },
      }
    }

    // 1. 计算中心点（质心）
    const centroid = new THREE.Vector3()
    points.forEach((p) => centroid.add(p))
    centroid.divideScalar(points.length)

    // 简化：假设Z轴方向的方差最小（牙齿大致在同一平面）
    // 平面法向量近似为Z轴或通过特征分析得出
    // 这里使用简化方法：计算平均法向量

    // 使用前三个点来初步估计平面（如果点足够多可以用更复杂的方法）
    let normal: THREE.Vector3

    if (points.length >= 3) {
      // 使用多个点对计算平均法向量
      const normals: THREE.Vector3[] = []

      for (let i = 0; i < Math.min(points.length - 2, 5); i++) {
        const p0 = points[i]
        const p1 = points[i + 1]
        const p2 = points[i + 2]
        if (!p0 || !p1 || !p2) continue

        const v1 = new THREE.Vector3().subVectors(p1, p0)
        const v2 = new THREE.Vector3().subVectors(p2, p0)
        const n = new THREE.Vector3().crossVectors(v1, v2).normalize()
        if (n.length() > 0.1) {
          normals.push(n)
        }
      }

      // 平均法向量
      normal = new THREE.Vector3()
      normals.forEach((n) => normal.add(n))
      normal.divideScalar(normals.length).normalize()

      // 确保法向量指向大致向上（Z正方向）
      if (normal.z < 0) {
        normal.negate()
      }
    } else {
      // 默认使用Z轴作为法向量
      normal = new THREE.Vector3(0, 0, 1)
    }

    // 3. 将所有点投影到平面上
    const projectedCenters: Record<number, THREE.Vector3> = {}

    Object.entries(centers).forEach(([fdi, point]) => {
      // 计算点到平面的距离
      const toPoint = new THREE.Vector3().subVectors(point, centroid)
      const distance = toPoint.dot(normal)

      // 投影点 = 原点 - (距离 * 法向量)
      const projected = new THREE.Vector3().copy(point).sub(normal.clone().multiplyScalar(distance))

      projectedCenters[Number(fdi)] = projected
    })

    return {
      projectedCenters,
      planeInfo: { centroid, normal },
    }
  }

  /**
   * 创建下颌水平基准平面
   * 功能：生成一个水平平面，确保下颌所有点位的Y坐标保持一致
   * 平面特性：
   * 1. 平面尺寸：基于下颌三维模型的精确边界框尺寸，覆盖整个下颌结构
   * 2. 相对位置：平面Y坐标设置为下颌所有点位的平均Y值，实现水平铺展效果
   * 3. 坐标对齐：平面中心对齐下颌模型中心，所有点位投影对齐到该平面
   */
  private createLowerJawPlane(): void {
    const lowerMesh = this.context?.lowerMeshLabel
    if (!lowerMesh) {
      console.warn('下颌mesh不存在，无法创建平面')
      return
    }

    // 收集下颌点位
    const lowerPoints: THREE.Vector3[] = []
    this.draggablePoints.forEach((point) => {
      const fdi = point.userData.fdi as number
      if (fdi && fdi >= 31 && fdi <= 48) {
        // 下颌牙齿范围
        lowerPoints.push(point.position.clone())
      }
    })

    if (lowerPoints.length < 2) {
      console.warn('下颌点位数量不足，无法创建平面')
      return
    }

    // 1. 获取下颌三维模型的精确边界框
    // 注意：需要先更新矩阵以确保边界框准确
    lowerMesh.updateMatrixWorld(true)

    // 计算模型的边界框（在本地坐标系中，不受scale影响）
    const boundingBox = new THREE.Box3()

    // 遍历mesh的所有子对象，计算完整的边界框
    lowerMesh.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry) {
        // 计算几何体的边界框
        if (!child.geometry.boundingBox) {
          child.geometry.computeBoundingBox()
        }
        if (child.geometry.boundingBox) {
          // 将子对象的边界框扩展到总边界框中
          boundingBox.expandByObject(child)
        }
      }
    })

    // 如果边界框无效，回退到使用点位范围
    if (boundingBox.isEmpty()) {
      console.warn('无法获取下颌模型边界框，使用点位范围')
      this.createPlaneFromPoints(lowerPoints)
      return
    }

    // 3. 使用PCA计算下颌点位的最佳拟合平面
    // 计算质心
    const centroid = new THREE.Vector3()
    lowerPoints.forEach((p) => centroid.add(p))
    centroid.divideScalar(lowerPoints.length)

    // 构建协方差矩阵并计算法向量
    let xx = 0,
      yy = 0,
      zz = 0

    lowerPoints.forEach((p) => {
      const dx = p.x - centroid.x
      const dy = p.y - centroid.y
      const dz = p.z - centroid.z

      xx += dx * dx
      yy += dy * dy
      zz += dz * dz
    })

    const n = lowerPoints.length
    xx /= n
    yy /= n
    zz /= n

    // 计算最小特征值对应的特征向量（法向量）
    // 简化方法：找最小方差的方向
    // 对于牙齿数据，通常Y方向方差最小（垂直于咬合平面）
    const variances = [
      { dir: new THREE.Vector3(1, 0, 0), var: xx },
      { dir: new THREE.Vector3(0, 1, 0), var: yy },
      { dir: new THREE.Vector3(0, 0, 1), var: zz },
    ]

    // 找到方差最小的方向作为法向量的主要方向
    variances.sort((a, b) => a.var - b.var)
    const minVariance = variances[0]
    if (!minVariance) {
      console.error('无法计算法向量')
      return
    }
    const normal = minVariance.dir.clone()

    // 确保法向量指向正Y方向（向上）
    if (normal.y < 0) {
      normal.negate()
    }

    // 4. 计算点位在拟合平面上的投影范围
    // 构建平面的两个正交基向量（tangent 和 bitangent）
    const tangent = new THREE.Vector3()
    const bitangent = new THREE.Vector3()

    // 找一个与法向量不平行的向量作为参考
    const referenceVector =
      Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)

    tangent.crossVectors(normal, referenceVector).normalize()
    bitangent.crossVectors(normal, tangent).normalize()

    // 计算所有点在这两个方向上的投影范围
    let minU = Infinity,
      maxU = -Infinity
    let minV = Infinity,
      maxV = -Infinity

    lowerPoints.forEach((p) => {
      const vec = new THREE.Vector3().subVectors(p, centroid)
      const u = vec.dot(tangent)
      const v = vec.dot(bitangent)

      minU = Math.min(minU, u)
      maxU = Math.max(maxU, u)
      minV = Math.min(minV, v)
      maxV = Math.max(maxV, v)
    })

    // 使用投影范围作为平面尺寸，添加10%边距
    const planeWidth = (maxU - minU) * 1.1
    const planeHeight = (maxV - minV) * 1.1

    // 5. 创建平面几何体
    const planeGeometry = new THREE.PlaneGeometry(planeWidth, planeHeight, 10, 10)

    const planeMaterial = new THREE.MeshBasicMaterial({
      color: 0x4a9eff,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      wireframe: false,
    })

    const planeMesh = new THREE.Mesh(planeGeometry, planeMaterial)
    planeMesh.name = `${this.taskName}_lower_jaw_plane`
    planeMesh.renderOrder = 997

    // 6. 设置平面位置：沿法向量向下偏移，确保在下颌下方不交叉
    const offsetDistance = -3 // 向下偏移距离
    const planeCenter = centroid.clone().sub(normal.clone().multiplyScalar(offsetDistance))
    planeMesh.position.copy(planeCenter)

    // 7. 设置平面方向：与下颌点位拟合平面平行
    const defaultNormal = new THREE.Vector3(0, 0, 1) // PlaneGeometry默认法向量
    const quaternion = new THREE.Quaternion()
    quaternion.setFromUnitVectors(defaultNormal, normal)
    planeMesh.setRotationFromQuaternion(quaternion)

    // 应用统一的倾斜角度
    if (Math.abs(this.tiltAngleX) > 0.001) planeMesh.rotateX(this.tiltAngleX)
    if (Math.abs(this.tiltAngleY) > 0.001) planeMesh.rotateY(this.tiltAngleY)
    if (Math.abs(this.tiltAngleZ) > 0.001) planeMesh.rotateZ(this.tiltAngleZ)

    // 7. 添加网格线辅助显示（不需要额外旋转，跟随planeMesh）
    const wireframeGeometry = new THREE.EdgesGeometry(planeGeometry)
    const wireframeMaterial = new THREE.LineBasicMaterial({
      color: 0x2d7dd2, // 深蓝色
      transparent: true,
      opacity: 0.6,
      depthTest: false,
      depthWrite: false,
    })
    const wireframe = new THREE.LineSegments(wireframeGeometry, wireframeMaterial)
    wireframe.renderOrder = 998
    planeMesh.add(wireframe)

    // 8. 添加到下颌mesh，使其随下颌模型的显隐而显隐
    lowerMesh.add(planeMesh)
    this.lowerJawPlane = planeMesh

    // 9. 将所有下颌点位和牙弓线投影到平面上
    this.projectLowerJawToPlane(planeCenter, normal)

    console.log('下颌水平基准平面已创建：')
    console.log(
      `  - 平面中心位置: (${planeCenter.x.toFixed(2)}, ${planeCenter.y.toFixed(2)}, ${planeCenter.z.toFixed(2)})`,
    )
    console.log(
      `  - 点位质心: (${centroid.x.toFixed(2)}, ${centroid.y.toFixed(2)}, ${centroid.z.toFixed(2)})`,
    )
    console.log(`  - 平面尺寸（宽×长）: ${planeWidth.toFixed(2)} x ${planeHeight.toFixed(2)}`)
    console.log(
      `  - 投影范围: U[${minU.toFixed(2)}, ${maxU.toFixed(2)}] V[${minV.toFixed(2)}, ${maxV.toFixed(2)}]`,
    )
    console.log(
      `  - 拟合平面法向量: (${normal.x.toFixed(3)}, ${normal.y.toFixed(3)}, ${normal.z.toFixed(3)})`,
    )
    console.log(
      `  - 平面基向量: tangent(${tangent.x.toFixed(3)}, ${tangent.y.toFixed(3)}, ${tangent.z.toFixed(3)})`,
    )
    console.log(`  - 协方差: xx=${xx.toFixed(2)}, yy=${yy.toFixed(2)}, zz=${zz.toFixed(2)}`)
    console.log(`  - 覆盖点位数量: ${lowerPoints.length}`)
    console.log(
      `  - 说明: 平面已根据点位在拟合平面上的投影精确计算尺寸，向下偏移${offsetDistance}单位避免交叉`,
    )
  }

  /**
   * 将下颌点位和牙弓线投影到平面上
   * @param planeCenter 平面中心点
   * @param normal 平面法向量
   */
  private projectLowerJawToPlane(planeCenter: THREE.Vector3, normal: THREE.Vector3): void {
    // 保存平面信息用于拖拽约束
    this.planeCenter = planeCenter.clone()
    this.planeNormal = normal.clone()

    let projectedCount = 0

    // 遍历所有可拖动点位，将下颌点位投影到平面
    this.draggablePoints.forEach((pointMesh) => {
      const fdi = pointMesh.userData.fdi as number
      if (fdi && fdi >= 31 && fdi <= 48) {
        // 下颌牙齿范围
        const currentPos = pointMesh.position.clone()

        // 计算点到平面的距离（带符号）
        const toPoint = new THREE.Vector3().subVectors(currentPos, planeCenter)
        const distance = toPoint.dot(normal)

        // 投影到平面：点位置 - 距离 * 法向量
        const projectedPos = currentPos.clone().sub(normal.clone().multiplyScalar(distance))

        // 更新点位位置，确保完全贴合平面
        pointMesh.position.copy(projectedPos)

        // 记录投影信息和约束信息
        pointMesh.userData.projectedToPlane = true
        pointMesh.userData.constrainedToPlane = true // 标记为平面约束
        pointMesh.userData.originalPosition = currentPos
        pointMesh.userData.projectionDistance = distance

        projectedCount++

        // 验证点位是否在平面上
        const verifyDistance = new THREE.Vector3()
          .subVectors(pointMesh.position, planeCenter)
          .dot(normal)
        console.log(
          `点位 FDI-${fdi} 投影: 距离=${distance.toFixed(2)}mm, ` +
            `验证距离=${verifyDistance.toFixed(4)}mm, ` +
            `原位置(${currentPos.x.toFixed(1)}, ${currentPos.y.toFixed(1)}, ${currentPos.z.toFixed(1)}) -> ` +
            `新位置(${projectedPos.x.toFixed(1)}, ${projectedPos.y.toFixed(1)}, ${projectedPos.z.toFixed(1)})`,
        )
      }
    })

    console.log(`✓ 已将 ${projectedCount} 个下颌点位完全贴合到平面上`)
    // 🆕 对所有投影后的下颌点位应用与平面同步的倾斜变换
    if (
      Math.abs(this.tiltAngleX) > 0.001 ||
      Math.abs(this.tiltAngleY) > 0.001 ||
      Math.abs(this.tiltAngleZ) > 0.001
    ) {
      // 创建旋转矩阵（与平面倾斜顺序一致）
      const rotationMatrix = new THREE.Matrix4()
      rotationMatrix.makeRotationFromEuler(
        new THREE.Euler(this.tiltAngleX, this.tiltAngleY, this.tiltAngleZ, 'XYZ'),
      )

      // 对每个下颌点位应用旋转（围绕平面中心旋转）
      this.draggablePoints.forEach((pointMesh) => {
        const fdi = pointMesh.userData.fdi as number
        if (fdi && fdi >= 31 && fdi <= 48) {
          // 将点位移到原点（相对于平面中心）
          const relativePos = new THREE.Vector3().subVectors(pointMesh.position, planeCenter)

          // 应用旋转
          relativePos.applyMatrix4(rotationMatrix)

          // 移回平面中心位置
          pointMesh.position.copy(planeCenter.clone().add(relativePos))
        }
      })

      console.log(
        `✓ 已对点位应用同步倾斜: ` +
          `X=${((this.tiltAngleX * 180) / Math.PI).toFixed(1)}°, ` +
          `Y=${((this.tiltAngleY * 180) / Math.PI).toFixed(1)}°, ` +
          `Z=${((this.tiltAngleZ * 180) / Math.PI).toFixed(1)}°`,
      )
    }
    // 更新下颌牙弓线，使其基于投影后的点位重新生成
    if (this.lowerArchWire) {
      console.log('正在更新下颌牙弓线以匹配平面...')
      this.updateArchWireShape()
      console.log('✓ 下颌牙弓线已更新到平面上')
    }
  }

  /**
   * 当边界框无效时，使用点位范围创建平面（回退方案）
   */
  private createPlaneFromPoints(lowerPoints: THREE.Vector3[]): void {
    // 计算质心
    const centroid = new THREE.Vector3()
    lowerPoints.forEach((p) => centroid.add(p))
    centroid.divideScalar(lowerPoints.length)

    // 计算协方差矩阵
    let xx = 0,
      yy = 0,
      zz = 0

    lowerPoints.forEach((p) => {
      const dx = p.x - centroid.x
      const dy = p.y - centroid.y
      const dz = p.z - centroid.z

      xx += dx * dx
      yy += dy * dy
      zz += dz * dz
    })

    const n = lowerPoints.length
    xx /= n
    yy /= n
    zz /= n

    // 找最小方差方向作为法向量
    const variances = [
      { dir: new THREE.Vector3(1, 0, 0), var: xx },
      { dir: new THREE.Vector3(0, 1, 0), var: yy },
      { dir: new THREE.Vector3(0, 0, 1), var: zz },
    ]

    variances.sort((a, b) => a.var - b.var)
    const minVariance = variances[0]
    if (!minVariance) {
      console.error('无法计算法向量')
      return
    }
    const normal = minVariance.dir.clone()

    if (normal.y < 0) {
      normal.negate()
    }

    // 计算点位在拟合平面上的投影范围
    const tangent = new THREE.Vector3()
    const bitangent = new THREE.Vector3()

    const referenceVector =
      Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)

    tangent.crossVectors(normal, referenceVector).normalize()
    bitangent.crossVectors(normal, tangent).normalize()

    let minU = Infinity,
      maxU = -Infinity
    let minV = Infinity,
      maxV = -Infinity

    lowerPoints.forEach((p) => {
      const vec = new THREE.Vector3().subVectors(p, centroid)
      const u = vec.dot(tangent)
      const v = vec.dot(bitangent)

      minU = Math.min(minU, u)
      maxU = Math.max(maxU, u)
      minV = Math.min(minV, v)
      maxV = Math.max(maxV, v)
    })

    const planeWidth = (maxU - minU) * 1.1
    const planeHeight = (maxV - minV) * 1.1

    // 计算偏移距离
    const offsetDistance = 5
    const planeCenter = centroid.clone().sub(normal.clone().multiplyScalar(offsetDistance))

    // 创建平面
    const planeGeometry = new THREE.PlaneGeometry(planeWidth, planeHeight, 10, 10)
    const planeMaterial = new THREE.MeshBasicMaterial({
      color: 0x4a9eff,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    })

    const planeMesh = new THREE.Mesh(planeGeometry, planeMaterial)
    planeMesh.name = `${this.taskName}_lower_jaw_plane`
    planeMesh.renderOrder = 997
    planeMesh.position.copy(planeCenter)

    // 设置方向：与拟合平面平行
    const defaultNormal = new THREE.Vector3(0, 0, 1)
    const quaternion = new THREE.Quaternion()
    quaternion.setFromUnitVectors(defaultNormal, normal)
    planeMesh.setRotationFromQuaternion(quaternion)

    const lowerMesh = this.context?.lowerMeshLabel
    if (lowerMesh) {
      lowerMesh.add(planeMesh)
      this.lowerJawPlane = planeMesh

      // 将下颌点位和牙弓线投影到平面上
      this.projectLowerJawToPlane(planeCenter, normal)
    }
  }

  /**
   * 创建调试平面可视化
   */
  private createDebugPlane(planeInfo: { centroid: THREE.Vector3; normal: THREE.Vector3 }): void {
    const { centroid, normal } = planeInfo

    // 创建一个平面几何体用于可视化
    // 注意：平面会被mesh的缩放影响，所以使用原始大小
    const planeSize = 60 // 调整大小以适配原始坐标系
    const planeGeometry = new THREE.PlaneGeometry(planeSize, planeSize)

    const planeMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    })

    const planeMesh = new THREE.Mesh(planeGeometry, planeMaterial)
    planeMesh.name = `${this.taskName}_debug_plane`
    planeMesh.renderOrder = 998

    // 设置平面位置和方向（使用原始坐标，因为会被mesh缩放）
    planeMesh.position.copy(centroid)

    // 将平面旋转到与法向量对齐
    const defaultNormal = new THREE.Vector3(0, 0, 1)
    const quaternion = new THREE.Quaternion()
    quaternion.setFromUnitVectors(defaultNormal, normal)
    planeMesh.setRotationFromQuaternion(quaternion)

    // 添加到下颌mesh（mesh本身有1.5倍缩放）
    const lowerMesh = this.context?.lowerMeshLabel
    if (lowerMesh) {
      lowerMesh.add(planeMesh)
    }
  }

  /**
   * 释放平面资源
   */
  private disposePlane(plane: THREE.Mesh): void {
    // 释放几何体
    if (plane.geometry) {
      plane.geometry.dispose()
    }

    // 释放材质
    if (plane.material) {
      if (Array.isArray(plane.material)) {
        plane.material.forEach((m) => m.dispose())
      } else {
        plane.material.dispose()
      }
    }

    // 释放子对象（如网格线）
    plane.traverse((child) => {
      if (
        child instanceof THREE.Mesh ||
        child instanceof THREE.Line ||
        child instanceof THREE.LineSegments
      ) {
        if (child.geometry) {
          child.geometry.dispose()
        }
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose())
          } else {
            child.material.dispose()
          }
        }
      }
    })
  }

  /**
   * 渲染单个颌的拥挤度
   */
  private renderJawCrowding(
    teethPoints: AnalysisData['teeth_points'],
    jawData: Record<string, unknown> | undefined,
    isUpper: boolean,
  ): void {
    if (!jawData || !teethPoints) return

    // 根据颌位设置颜色：上颌 #FEB5B5，下颌 #A49ED9
    const color = isUpper ? 0xfeb5b5 : 0xa49ed9

    // 筛选对应颌的牙齿
    const jawTeeth = teethPoints.filter((p) =>
      isUpper ? this.isUpper(p.fdi) : this.isLower(p.fdi),
    )

    // 按FDI分组
    const toothGroups = this.groupByFDI(jawTeeth)

    // 为每颗牙齿创建拥挤度标记（使用不缩放坐标）
    Object.entries(toothGroups).forEach(([fdi, points]) => {
      // 解析每个点的坐标
      const parsedPoints = points.map((p) => {
        if (typeof p.point === 'string') {
          return JSON.parse(p.point) as number[]
        }
        return p.point
      })

      const center = this.calculatePointsCenterUnscaled(parsedPoints)

      // 创建小球标记（上颌红色，下颌绿色）
      const geometry = new THREE.SphereGeometry(0.8, 16, 16)
      const material = new THREE.MeshPhongMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.4,
        transparent: true,
        opacity: 0.7,
      })
      const sphere = new THREE.Mesh(geometry, material)
      sphere.position.copy(center)
      sphere.name = `crowding_${fdi}`

      // 使用方案2：添加到 mesh，点位会随模型的隐藏而隐藏
      this.addToMesh(sphere, Number(fdi))
    })
  }

  /**
   * 按FDI分组
   */
  private groupByFDI(
    points: NonNullable<AnalysisData['teeth_points']>,
  ): Record<string, NonNullable<AnalysisData['teeth_points']>> {
    return points.reduce(
      (acc, point) => {
        const fdi = point.fdi.toString()
        if (!acc[fdi]) {
          acc[fdi] = []
        }
        acc[fdi]!.push(point)
        return acc
      },
      {} as Record<string, NonNullable<AnalysisData['teeth_points']>>,
    )
  }

  /**
   * 根据拥挤度获取颜色
   */
  private getCrowdingColor(crowding: number): number {
    if (crowding >= -1 && crowding <= 1) return 0x22c55e // 绿色 - 正常
    if (crowding < -4 || crowding > 4) return 0xff0000 // 红色 - 严重
    return 0xffa500 // 橙色 - 轻度
  }

  /**
   * 评估拥挤度
   */
  private evaluateCrowding(crowding: number): string {
    if (crowding >= -1 && crowding <= 1) return '正常'
    if (crowding < -4 || crowding > 4) return '严重'
    return '轻度拥挤'
  }
}
