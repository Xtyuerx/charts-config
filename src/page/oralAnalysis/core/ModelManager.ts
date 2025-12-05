import * as THREE from 'three'
import { STLLoader } from 'three-stdlib'
import { MATERIAL_CONFIG, SCENE_CONFIG } from '../constants'
import type { STLModelsConfig, ToothCentersMap } from '../types'

/**
 * 模型加载结果
 */
export interface ModelLoadResult {
  upperMesh: THREE.Mesh
  lowerMesh: THREE.Mesh
  upperMeshLabel: THREE.Mesh
  lowerMeshLabel: THREE.Mesh
  centersUpper: ToothCentersMap | null
  centersLower: ToothCentersMap | null
}

/**
 * 模型管理器
 * 负责加载和管理STL模型
 */
export class ModelManager {
  private loader: STLLoader
  private scene: THREE.Scene

  constructor(scene: THREE.Scene) {
    this.loader = new STLLoader()
    this.scene = scene
  }

  /**
   * 加载单个STL文件
   */
  private loadSTL(url: string): Promise<THREE.BufferGeometry> {
    return new Promise((resolve, reject) => {
      this.loader.load(
        url,
        (geometry) => resolve(geometry),
        undefined,
        (error) => reject(error),
      )
    })
  }

  /**
   * 创建颌骨网格
   */
  private createJawMesh(geometry: THREE.BufferGeometry, isUpper: boolean): THREE.Mesh {
    const material = new THREE.MeshPhongMaterial({
      color: MATERIAL_CONFIG.jaw.color,
      transparent: true,
      opacity: MATERIAL_CONFIG.jaw.opacity,
      specular: MATERIAL_CONFIG.jaw.specular,
      shininess: MATERIAL_CONFIG.jaw.shininess,
      reflectivity: MATERIAL_CONFIG.jaw.reflectivity,
      side: MATERIAL_CONFIG.jaw.side,
      ...(isUpper
        ? {}
        : {
            emissive: MATERIAL_CONFIG.lowerJaw.emissive,
            emissiveIntensity: MATERIAL_CONFIG.lowerJaw.emissiveIntensity,
          }),
    })

    const mesh = new THREE.Mesh(geometry, material)
    mesh.scale.set(SCENE_CONFIG.modelScale, SCENE_CONFIG.modelScale, SCENE_CONFIG.modelScale)
    mesh.name = isUpper ? 'upper_jaw' : 'lower_jaw'

    return mesh
  }

  /**
   * 创建牙齿网格
   */
  private createToothMesh(geometry: THREE.BufferGeometry, isUpper: boolean): THREE.Mesh {
    const material = new THREE.MeshPhongMaterial({
      color: MATERIAL_CONFIG.tooth.color,
      specular: MATERIAL_CONFIG.tooth.specular,
      shininess: MATERIAL_CONFIG.tooth.shininess,
      side: MATERIAL_CONFIG.tooth.side,
      flatShading: false,
    })

    const mesh = new THREE.Mesh(geometry, material)
    mesh.scale.set(SCENE_CONFIG.modelScale, SCENE_CONFIG.modelScale, SCENE_CONFIG.modelScale)
    mesh.name = isUpper ? 'upper_tooth' : 'lower_tooth'

    return mesh
  }

  /**
   * 从几何体中提取牙齿中心点
   * 简化版本，实际项目中需要根据labels数据计算
   */
  private extractToothCenters(
    geometry: THREE.BufferGeometry,
    labels: number[],
  ): ToothCentersMap | null {
    if (!labels || labels.length === 0) return null

    const centers: ToothCentersMap = {}
    const position = geometry.attributes.position

    // 简化逻辑：按牙齿编号分组计算中心点
    const toothPoints: Record<number, THREE.Vector3[]> = {}

    for (let i = 0; i < labels.length; i++) {
      const toothNum = labels[i] as number
      if (toothNum === 0) continue // 跳过非牙齿点

      if (!toothPoints[toothNum]) {
        toothPoints[toothNum] = []
      }

      const x = position?.getX(i)
      const y = position?.getY(i)
      const z = position?.getZ(i)
      toothPoints[toothNum].push(new THREE.Vector3(x, y, z))
    }

    // 计算每颗牙齿的中心点
    Object.keys(toothPoints).forEach((toothNumStr) => {
      const toothNum = Number(toothNumStr)
      const points = toothPoints[toothNum]

      if (points && points.length > 0) {
        const center = new THREE.Vector3()
        points.forEach((p) => center.add(p))
        center.divideScalar(points.length)
        centers[toothNum] = center
      }
    })

    return centers
  }

  /**
   * 加载所有模型
   */
  async loadAllModels(
    config: STLModelsConfig,
    labelsUpper: number[] = [],
    labelsLower: number[] = [],
  ): Promise<ModelLoadResult> {
    try {
      // 并行加载颌骨STL
      const [upperGeo, lowerGeo] = await Promise.all([
        this.loadSTL(config.upper),
        this.loadSTL(config.lower),
      ])

      // 创建颌骨网格
      const upperMesh = this.createJawMesh(upperGeo, true)
      const lowerMesh = this.createJawMesh(lowerGeo, false)
      this.scene.add(upperMesh)
      this.scene.add(lowerMesh)

      // 并行加载牙齿STL
      const [upperToothGeo, lowerToothGeo] = await Promise.all([
        this.loadSTL(config.upper_only_tooth),
        this.loadSTL(config.lower_only_tooth),
      ])

      // 创建牙齿网格
      const upperMeshLabel = this.createToothMesh(upperToothGeo, true)
      const lowerMeshLabel = this.createToothMesh(lowerToothGeo, false)
      this.scene.add(upperMeshLabel)
      this.scene.add(lowerMeshLabel)

      // 提取牙齿中心点
      const centersUpper = this.extractToothCenters(upperToothGeo, labelsUpper)
      const centersLower = this.extractToothCenters(lowerToothGeo, labelsLower)

      console.log('✅ 模型加载完成')

      return {
        upperMesh,
        lowerMesh,
        upperMeshLabel,
        lowerMeshLabel,
        centersUpper,
        centersLower,
      }
    } catch (error) {
      console.error('❌ 模型加载失败:', error)
      throw error
    }
  }

  /**
   * 加载JSON标签数据
   */
  async loadLabelsData(): Promise<{
    labelsUpper: number[]
    labelsLower: number[]
  }> {
    try {
      const [upperJson, lowerJson] = await Promise.all([
        fetch('/points/upper.json').then((r) => r.json()),
        fetch('/points/lower.json').then((r) => r.json()),
      ])

      const labelsUpper = upperJson.labels || []
      const labelsLower = lowerJson.labels || []

      console.log(`✅ 标签数据加载完成: 上颌${labelsUpper.length}点, 下颌${labelsLower.length}点`)

      return { labelsUpper, labelsLower }
    } catch (error) {
      console.error('❌ 标签数据加载失败:', error)
      return { labelsUpper: [], labelsLower: [] }
    }
  }
}
