import * as THREE from 'three'
import { BaseAnalysisStrategy } from './base/BaseAnalysisStrategy'
import type { AnalysisData, MeasurementGroup, RenderType } from '../types'
import { LabelRenderer } from '../renderers'
import { createMiddleArchWire } from '../utils/ArchWireUtils'

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

  /**
   * 渲染特定元素
   * 拥挤度分析：显示牙齿间距和拥挤区域，以及牙弓线
   */
  protected renderSpecificElements(data: AnalysisData): void {
    console.log('renderSpecificElements', data)
    const { teeth_points, measurements } = data

    if (!teeth_points || teeth_points.length === 0) return

    // 清空之前的可拖动点位
    this.draggablePoints = []

    // 渲染牙弓线
    this.createArchWire()

    // 渲染上颌拥挤度
    this.renderJawCrowding(teeth_points, measurements?.upper_jaw as Record<string, unknown>, true)

    // 渲染下颌拥挤度
    this.renderJawCrowding(teeth_points, measurements?.lower_jaw as Record<string, unknown>, false)
  }

  /**
   * 渲染测量标注
   */
  protected renderMeasurements(measurements: Record<string, unknown>): void {
    if (!measurements) return

    const upperData = measurements.upper_jaw as Record<string, unknown>
    const lowerData = measurements.lower_jaw as Record<string, unknown>

    // 上颌信息面板
    if (upperData) {
      const discrepancy = (upperData.discrepancy_mm as number) || 0
      const grade = (upperData.grade as string) || '正常'

      const upperPanel = LabelRenderer.createInfoPanel(
        [
          { key: '上颌拥挤度', value: `${discrepancy.toFixed(2)}mm` },
          { key: '等级', value: grade },
        ],
        {
          position: new THREE.Vector3(-25, 30, 0),
          fontSize: 13,
          backgroundColor: `#${this.getCrowdingColor(discrepancy).toString(16).padStart(6, '0')}`,
          fontColor: '#ffffff',
        },
      )
      this.group.add(upperPanel)
    }

    // 下颌信息面板
    if (lowerData) {
      const discrepancy = (lowerData.discrepancy_mm as number) || 0
      const grade = (lowerData.grade as string) || '正常'

      const lowerPanel = LabelRenderer.createInfoPanel(
        [
          { key: '下颌拥挤度', value: `${discrepancy.toFixed(2)}mm` },
          { key: '等级', value: grade },
        ],
        {
          position: new THREE.Vector3(25, 30, 0),
          fontSize: 13,
          backgroundColor: `#${this.getCrowdingColor(discrepancy).toString(16).padStart(6, '0')}`,
          fontColor: '#ffffff',
        },
      )
      this.group.add(lowerPanel)
    }
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
      const grade = (upperData.grade as string) || '正常'
      const toothWidthsSum = (upperData.tooth_widths_sum_mm as number) || 0
      const archLength = (upperData.arch_length_mm as number) || 0

      groups.push({
        groupName: '上颌拥挤度',
        children: [
          {
            name: '拥挤度差异',
            value: `${discrepancy.toFixed(2)}mm`,
            result: this.evaluateCrowding(discrepancy),
          },
          {
            name: '等级',
            value: grade,
            result: grade.includes('正常') || grade === '无拥挤' ? '正常' : '异常',
          },
          {
            name: '牙齿宽度总和',
            value: `${toothWidthsSum.toFixed(2)}mm`,
            result: '测量值',
          },
          {
            name: '牙弓长度',
            value: `${archLength.toFixed(2)}mm`,
            result: '测量值',
          },
        ],
      })
    }

    // 下颌拥挤度
    if (lowerData) {
      const discrepancy = (lowerData.discrepancy_mm as number) || 0
      const grade = (lowerData.grade as string) || '正常'
      const toothWidthsSum = (lowerData.tooth_widths_sum_mm as number) || 0
      const archLength = (lowerData.arch_length_mm as number) || 0

      groups.push({
        groupName: '下颌拥挤度',
        children: [
          {
            name: '拥挤度差异',
            value: `${discrepancy.toFixed(2)}mm`,
            result: this.evaluateCrowding(discrepancy),
          },
          {
            name: '等级',
            value: grade,
            result: grade.includes('正常') || grade === '无拥挤' ? '正常' : '异常',
          },
          {
            name: '牙齿宽度总和',
            value: `${toothWidthsSum.toFixed(2)}mm`,
            result: '测量值',
          },
          {
            name: '牙弓长度',
            value: `${archLength.toFixed(2)}mm`,
            result: '测量值',
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
      const color = this.getPointColor(p.type)

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

      // 添加到对应的 mesh 和可拖动点位数组
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
   * 拖动点位时的回调函数
   * 更新牙弓线形状
   */
  public updateOnDrag(object: THREE.Object3D): void {
    console.log('🔄 点位拖动:', object.name)

    // 更新牙弓线（如果存在）
    if (this.archWire) {
      this.updateArchWireShape()
    }
  }

  /**
   * 更新牙弓线形状
   * 基于当前所有点位的位置重新计算牙弓线
   */
  private updateArchWireShape(): void {
    if (!this.archWire || !this.context) return

    // 收集所有点位的当前位置，按FDI分组
    const updatedUpperCenters: Record<number, THREE.Vector3> = {}
    const updatedLowerCenters: Record<number, THREE.Vector3> = {}

    // 统计每个FDI的所有点位
    const fdiPointsMap: Record<number, THREE.Vector3[]> = {}

    this.draggablePoints.forEach((point) => {
      const fdi = point.userData.fdi as number
      if (!fdi) return

      if (!fdiPointsMap[fdi]) {
        fdiPointsMap[fdi] = []
      }
      // 点位坐标是未缩放的
      fdiPointsMap[fdi].push(point.position.clone())
    })

    // 计算每个FDI的中心点
    const scale = 1.5 // SCENE_CONFIG.modelScale
    Object.entries(fdiPointsMap).forEach(([fdi, points]) => {
      const fdiNum = Number(fdi)

      // 计算平均位置
      const sum = points.reduce(
        (acc, p) => {
          acc.x += p.x
          acc.y += p.y
          acc.z += p.z
          return acc
        },
        { x: 0, y: 0, z: 0 },
      )

      const center = new THREE.Vector3(
        (sum.x / points.length) * scale,
        (sum.y / points.length) * scale,
        (sum.z / points.length) * scale,
      )

      // 根据FDI范围分配到上下颌
      if (fdiNum >= 11 && fdiNum <= 28) {
        updatedUpperCenters[fdiNum] = center
      } else if (fdiNum >= 31 && fdiNum <= 48) {
        updatedLowerCenters[fdiNum] = center
      }
    })

    console.log('🔄 更新牙弓线形状', {
      上颌点数: Object.keys(updatedUpperCenters).length,
      下颌点数: Object.keys(updatedLowerCenters).length,
    })

    // 如果没有足够的点，不更新
    if (
      Object.keys(updatedUpperCenters).length === 0 ||
      Object.keys(updatedLowerCenters).length === 0
    ) {
      console.warn('⚠️ 没有足够的点位数据来更新牙弓线')
      return
    }

    // 移除旧的牙弓线
    if (this.archWire.group) {
      this.group.remove(this.archWire.group)

      // 释放资源
      this.archWire.tubeMesh.geometry.dispose()
      if (this.archWire.tubeMesh.material) {
        if (Array.isArray(this.archWire.tubeMesh.material)) {
          this.archWire.tubeMesh.material.forEach((m) => m.dispose())
        } else {
          this.archWire.tubeMesh.material.dispose()
        }
      }
    }

    // 使用更新后的中心点创建新的牙弓线
    this.archWire = createMiddleArchWire(updatedUpperCenters, updatedLowerCenters)

    if (this.archWire) {
      this.group.add(this.archWire.group)
      console.log('✅ 牙弓线已更新')
    } else {
      console.warn('⚠️ 牙弓线更新失败')
    }
  }

  /**
   * 渲染单个颌的拥挤度
   */
  private renderJawCrowding(
    teethPoints: AnalysisData['teeth_points'],
    jawData: Record<string, unknown> | undefined,
    isUpper: boolean,
  ): void {
    if (!jawData) return

    const discrepancy = (jawData.discrepancy_mm as number) || 0

    // 根据拥挤度选择颜色
    const color = this.getCrowdingColor(discrepancy)

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

      // 创建小球标记（颜色根据拥挤度，不缩放）
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

      // 使用方案2：添加到 mesh
      this.addToMesh(sphere, Number(fdi))
    })
  }

  /**
   * 按FDI分组
   */
  private groupByFDI(
    points: AnalysisData['teeth_points'],
  ): Record<string, AnalysisData['teeth_points']> {
    return points.reduce(
      (acc, point) => {
        const fdi = point.fdi.toString()
        if (!acc[fdi]) {
          acc[fdi] = []
        }
        acc[fdi].push(point)
        return acc
      },
      {} as Record<string, AnalysisData['teeth_points']>,
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
