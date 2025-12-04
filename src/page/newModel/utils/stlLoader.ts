import * as THREE from 'three'
import { STLLoader } from 'three-stdlib'
import { MATERIAL_CONFIG, SCENE_CONFIG } from '../constants'
import type { STLModelsConfig, ToothCentersMap } from '../types'
import type { RenderPointsResult } from './pointCloudRenderer'

/**
 * 加载单个STL文件
 * @param url STL文件URL
 * @returns Promise<BufferGeometry>
 */
export function loadSTL(url: string): Promise<THREE.BufferGeometry> {
  return new Promise((resolve, reject) => {
    const loader = new STLLoader()
    loader.load(
      url,
      (geometry) => resolve(geometry),
      undefined,
      (error) => reject(error),
    )
  })
}

/**
 * 创建颌骨网格
 * @param geometry 几何体
 * @param isUpper 是否为上颌
 * @returns 网格对象
 */
export function createJawMesh(geometry: THREE.BufferGeometry, isUpper: boolean): THREE.Mesh {
  const material = new THREE.MeshPhongMaterial({
    color: MATERIAL_CONFIG.jaw.color,
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
 * @param geometry 几何体
 * @param isUpper 是否为上颌
 * @returns 网格对象
 */
export function createToothMesh(geometry: THREE.BufferGeometry, isUpper: boolean): THREE.Mesh {
  const material = new THREE.MeshPhongMaterial({
    color: MATERIAL_CONFIG.tooth.color,
    specular: MATERIAL_CONFIG.tooth.specular,
    shininess: MATERIAL_CONFIG.tooth.shininess,
    flatShading: false,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.scale.set(SCENE_CONFIG.modelScale, SCENE_CONFIG.modelScale, SCENE_CONFIG.modelScale)
  mesh.name = isUpper ? 'upper_tooth' : 'lower_tooth'

  return mesh
}

/**
 * 加载所有STL模型
 * @param config STL模型URL配置
 * @param scene 场景对象
 * @param renderPointsCallback 渲染点云的回调函数
 * @param labelsUpper 上颌标签数组
 * @param labelsLower 下颌标签数组
 * @returns Promise with mesh objects and tooth data
 */
export async function loadAllModels(
  config: STLModelsConfig,
  scene: THREE.Scene,
  renderPointsCallback: (
    geometry: THREE.BufferGeometry,
    labels: number[],
    mesh: THREE.Mesh,
  ) => RenderPointsResult | null,
  labelsUpper: number[],
  labelsLower: number[],
): Promise<{
  upperMesh: THREE.Mesh
  lowerMesh: THREE.Mesh
  upperMeshLabel: THREE.Mesh
  lowerMeshLabel: THREE.Mesh
  centersUpper: ToothCentersMap | null
  centersLower: ToothCentersMap | null
  upperToothPointsData: Record<number, Float32Array>
  lowerToothPointsData: Record<number, Float32Array>
}> {
  // 并行加载颌骨STL
  const [upperGeo, lowerGeo] = await Promise.all([loadSTL(config.upper), loadSTL(config.lower)])

  // 创建颌骨网格
  const upperMesh = createJawMesh(upperGeo, true)
  const lowerMesh = createJawMesh(lowerGeo, false)
  scene.add(upperMesh)
  scene.add(lowerMesh)

  // 并行加载牙齿STL
  const [upperToothGeo, lowerToothGeo] = await Promise.all([
    loadSTL(config.upper_only_tooth),
    loadSTL(config.lower_only_tooth),
  ])

  // 创建牙齿网格
  const upperMeshLabel = createToothMesh(upperToothGeo, true)
  const lowerMeshLabel = createToothMesh(lowerToothGeo, false)
  scene.add(upperMeshLabel)
  scene.add(lowerMeshLabel)

  // 渲染点云并获取中心点和点云数据
  const upperResult = renderPointsCallback(upperToothGeo, labelsUpper, upperMeshLabel)
  const lowerResult = renderPointsCallback(lowerToothGeo, labelsLower, lowerMeshLabel)

  return {
    upperMesh,
    lowerMesh,
    upperMeshLabel,
    lowerMeshLabel,
    centersUpper: upperResult?.toothCenters || null,
    centersLower: lowerResult?.toothCenters || null,
    upperToothPointsData: upperResult?.toothPointsData || {},
    lowerToothPointsData: lowerResult?.toothPointsData || {},
  }
}
