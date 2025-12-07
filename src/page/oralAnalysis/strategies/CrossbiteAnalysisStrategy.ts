import * as THREE from 'three'
import { BaseAnalysisStrategy } from './base/BaseAnalysisStrategy'
import type { AnalysisData, MeasurementGroup, RenderType } from '../types'
import { LabelRenderer } from '../renderers'

/**
 * 锁𬌗与反𬌗分析策略
 * 分析上下颌牙齿的水平咬合关系
 */
export class CrossbiteAnalysisStrategy extends BaseAnalysisStrategy {
  readonly id = 'crossbite'
  readonly name = '锁𬌗与反𬌗分析'
  readonly taskName = 'crossbite'
  readonly renderType: RenderType = 'POINT_ONLY'

  /**
   * 渲染特定元素
   * 锁𬌗与反𬌗分析：高亮显示异常的牙齿位置
   */
  protected renderSpecificElements(data: AnalysisData): void {
    const { teeth_points, measurements } = data

    if (!teeth_points || teeth_points.length === 0) return

    // 获取锁𬌗和反𬌗的牙齿列表
    const crossbiteTeeth = (measurements?.crossbite_teeth as number[]) || []
    const reverseBiteTeeth = (measurements?.reverse_bite_teeth as number[]) || []

    // 高亮锁𬌗牙齿（黄色）
    crossbiteTeeth.forEach((fdi) => {
      const toothPoints = teeth_points.filter((p) => p.fdi === fdi)
      if (toothPoints.length > 0) {
        const center = this.calculatePointsCenter(toothPoints.map((p) => p.point))

        // 创建黄色警告标记
        const geometry = new THREE.SphereGeometry(1.5, 32, 32)
        const material = new THREE.MeshPhongMaterial({
          color: 0xffa500,
          emissive: 0xffa500,
          emissiveIntensity: 0.6,
          transparent: true,
          opacity: 0.8,
        })
        const sphere = new THREE.Mesh(geometry, material)
        sphere.position.copy(center)
        sphere.name = `crossbite_${fdi}`
        this.group.add(sphere)

        // 添加标签
        const label = LabelRenderer.createLabel(`锁𬌗 ${fdi}`, {
          position: center.clone().add(new THREE.Vector3(0, 3, 0)),
          fontSize: 12,
          backgroundColor: '#ffa500',
          fontColor: '#ffffff',
        })
        this.group.add(label)
      }
    })

    // 高亮反𬌗牙齿（红色）
    reverseBiteTeeth.forEach((fdi) => {
      const toothPoints = teeth_points.filter((p) => p.fdi === fdi)
      if (toothPoints.length > 0) {
        const center = this.calculatePointsCenter(toothPoints.map((p) => p.point))

        // 创建红色警告标记
        const geometry = new THREE.SphereGeometry(1.5, 32, 32)
        const material = new THREE.MeshPhongMaterial({
          color: 0xff0000,
          emissive: 0xff0000,
          emissiveIntensity: 0.6,
          transparent: true,
          opacity: 0.8,
        })
        const sphere = new THREE.Mesh(geometry, material)
        sphere.position.copy(center)
        sphere.name = `reverse_bite_${fdi}`
        this.group.add(sphere)

        // 添加标签
        const label = LabelRenderer.createLabel(`反𬌗 ${fdi}`, {
          position: center.clone().add(new THREE.Vector3(0, 3, 0)),
          fontSize: 12,
          backgroundColor: '#ff0000',
          fontColor: '#ffffff',
        })
        this.group.add(label)
      }
    })
  }

  /**
   * 渲染测量标注
   */
  protected renderMeasurements(measurements: Record<string, unknown>): void {
    if (!measurements) return

    const crossbiteCount = ((measurements.crossbite_teeth as number[]) || []).length
    const reverseBiteCount = ((measurements.reverse_bite_teeth as number[]) || []).length
    const diagnosis = (measurements.diagnosis as string) || '正常'

    // 创建诊断信息面板
    const infoData = [
      { key: '锁𬌗牙齿', value: `${crossbiteCount}颗` },
      { key: '反𬌗牙齿', value: `${reverseBiteCount}颗` },
      { key: '诊断结果', value: diagnosis },
    ]

    const infoPanel = LabelRenderer.createInfoPanel(infoData, {
      position: new THREE.Vector3(0, 30, 0),
      fontSize: 14,
      backgroundColor: crossbiteCount + reverseBiteCount > 0 ? '#ff6b6b' : '#22c55e',
      fontColor: '#ffffff',
    })

    this.group.add(infoPanel)
  }

  /**
   * 格式化测量数据为面板展示格式
   */
  protected formatMeasurements(measurements: Record<string, unknown>): MeasurementGroup[] {
    const crossbiteTeeth = (measurements.crossbite_teeth as number[]) || []
    const reverseBiteTeeth = (measurements.reverse_bite_teeth as number[]) || []
    const diagnosis = (measurements.diagnosis as string) || '正常'

    return [
      {
        groupName: '锁𬌗与反𬌗分析',
        children: [
          {
            name: '锁𬌗牙齿数',
            value: `${crossbiteTeeth.length}颗`,
            result: crossbiteTeeth.length === 0 ? '正常' : '异常',
          },
          {
            name: '锁𬌗牙齿',
            value: crossbiteTeeth.length > 0 ? crossbiteTeeth.join(', ') : '无',
            result: crossbiteTeeth.length === 0 ? '正常' : '需要关注',
          },
          {
            name: '反𬌗牙齿数',
            value: `${reverseBiteTeeth.length}颗`,
            result: reverseBiteTeeth.length === 0 ? '正常' : '异常',
          },
          {
            name: '反𬌗牙齿',
            value: reverseBiteTeeth.length > 0 ? reverseBiteTeeth.join(', ') : '无',
            result: reverseBiteTeeth.length === 0 ? '正常' : '需要关注',
          },
          {
            name: '综合诊断',
            value: diagnosis,
            result: diagnosis.includes('正常') ? '正常' : '异常',
          },
        ],
      },
    ]
  }

  // ==================== 私有辅助方法 ====================

  /**
   * 计算多个点的中心位置
   */
  private calculatePointsCenter(points: number[][]): THREE.Vector3 {
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
}
