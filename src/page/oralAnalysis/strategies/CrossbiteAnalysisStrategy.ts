import * as THREE from 'three'
import { BaseAnalysisStrategy } from './base/BaseAnalysisStrategy'
import type { AnalysisData, MeasurementGroup, RenderType, ToothPoint } from '../types'
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
   * 重写点位渲染 - 将点位添加到对应的 mesh，跟随上下颌显示/隐藏
   * 上颌使用红色，下颌使用绿色
   */
  protected renderPoints(teethPoints: ToothPoint[]): void {
    teethPoints.forEach((p) => {
      // 根据上下颌选择颜色：上颌用红色，下颌用绿色
      const color = this.isUpper(p.fdi) ? 0xff0000 : 0x00ff00

      // 解析 point（可能是字符串或数组）
      let pointCoords: number[]
      if (typeof p.point === 'string') {
        pointCoords = JSON.parse(p.point) as number[]
      } else {
        pointCoords = p.point
      }

      // 创建球体作为点标记
      const geometry = new THREE.SphereGeometry(0.6, 16, 16)
      const material = new THREE.MeshPhongMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.3,
        transparent: true,
        opacity: 0.8,
      })
      const sphere = new THREE.Mesh(geometry, material)

      // 不应用缩放，因为 mesh 本身已经有缩放了
      sphere.position.set(pointCoords[0] ?? 0, pointCoords[1] ?? 0, pointCoords[2] ?? 0)
      sphere.name = `point_${p.fdi}_${p.type}` // 使用统一的命名格式

      // 添加到对应的 mesh（上颌或下颌）
      this.addToMesh(sphere, p.fdi)
    })

    console.log(`✅ 渲染了 ${teethPoints.length} 个锁𬌗与反𬌗点位，已添加到对应 mesh`)
  }

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
        // 解析点位坐标
        const parsedPoints = toothPoints.map((p) => {
          if (typeof p.point === 'string') {
            return JSON.parse(p.point) as number[]
          }
          return p.point
        })

        const center = this.calculatePointsCenterUnscaled(parsedPoints)

        // 创建黄色警告标记（不缩放）
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
        sphere.name = `${this.taskName}_crossbite_${fdi}`

        // 使用方案2：添加到 mesh
        this.addToMesh(sphere, fdi)

        // 添加标签（不缩放）
        const label = LabelRenderer.createLabel(`锁𬌗 ${fdi}`, {
          position: center.clone().add(new THREE.Vector3(0, 3, 0)),
          fontSize: 12,
          backgroundColor: '#ffa500',
          fontColor: '#ffffff',
        })
        label.name = `${this.taskName}_label_${fdi}`

        // 使用方案2：添加到 mesh
        this.addToMesh(label, fdi)
      }
    })

    // 高亮反𬌗牙齿（红色）
    reverseBiteTeeth.forEach((fdi) => {
      const toothPoints = teeth_points.filter((p) => p.fdi === fdi)
      if (toothPoints.length > 0) {
        // 解析点位坐标
        const parsedPoints = toothPoints.map((p) => {
          if (typeof p.point === 'string') {
            return JSON.parse(p.point) as number[]
          }
          return p.point
        })

        const center = this.calculatePointsCenterUnscaled(parsedPoints)

        // 创建红色警告标记（不缩放）
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
        sphere.name = `${this.taskName}_reverse_bite_${fdi}`

        // 使用方案2：添加到 mesh
        this.addToMesh(sphere, fdi)

        // 添加标签（不缩放）
        const label = LabelRenderer.createLabel(`反𬌗 ${fdi}`, {
          position: center.clone().add(new THREE.Vector3(0, 3, 0)),
          fontSize: 12,
          backgroundColor: '#ff0000',
          fontColor: '#ffffff',
        })
        label.name = `${this.taskName}_label_${fdi}`

        // 使用方案2：添加到 mesh
        this.addToMesh(label, fdi)
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

    // 创建诊断信息面板（添加到主 group）
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

    // this.group.add(infoPanel)
  }

  /**
   * 重写 toggleMeshChildren 方法，确保点位能正确跟随模型显示/隐藏
   */
  protected toggleMeshChildren(visible: boolean): void {
    if (!this.context) return

    const meshes = [
      this.context.upperMeshLabel,
      this.context.lowerMeshLabel,
    ].filter(Boolean) as THREE.Mesh[]

    console.log(`🔄 切换锁𬌗与反𬌗分析点位可见性: ${visible}`)

    meshes.forEach((mesh) => {
      mesh.children.forEach((child) => {
        // 查找所有属于当前策略的对象（以 taskName 开头）
        if (child.name.startsWith(`${this.taskName}_`)) {
          child.visible = visible
          console.log(`  - ${child.name}: ${visible}`)
        }
      })
    })
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
}
