import * as THREE from 'three'
import type { RenderContext as IRenderContext } from '../types'

/**
 * 渲染上下文类
 * 封装所有3D渲染相关的核心对象
 */
export class RenderContext implements IRenderContext {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  upperMesh: THREE.Mesh | null = null
  lowerMesh: THREE.Mesh | null = null
  upperMeshLabel: THREE.Mesh | null = null
  lowerMeshLabel: THREE.Mesh | null = null
  centersUpper: Record<number, THREE.Vector3> | null = null
  centersLower: Record<number, THREE.Vector3> | null = null

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer) {
    this.scene = scene
    this.camera = camera
    this.renderer = renderer
  }

  /**
   * 设置模型网格对象
   */
  setMeshes(meshes: {
    upperMesh: THREE.Mesh
    lowerMesh: THREE.Mesh
    upperMeshLabel: THREE.Mesh
    lowerMeshLabel: THREE.Mesh
  }): void {
    this.upperMesh = meshes.upperMesh
    this.lowerMesh = meshes.lowerMesh
    this.upperMeshLabel = meshes.upperMeshLabel
    this.lowerMeshLabel = meshes.lowerMeshLabel
  }

  /**
   * 设置牙齿中心点
   */
  setToothCenters(centers: {
    centersUpper: Record<number, THREE.Vector3> | null
    centersLower: Record<number, THREE.Vector3> | null
  }): void {
    this.centersUpper = centers.centersUpper
    this.centersLower = centers.centersLower
  }

  /**
   * 获取场景中的所有模型
   */
  getAllMeshes() {
    return {
      upperMesh: this.upperMesh,
      lowerMesh: this.lowerMesh,
      upperMeshLabel: this.upperMeshLabel,
      lowerMeshLabel: this.lowerMeshLabel,
    }
  }

  /**
   * 检查模型是否已加载
   */
  hasModels(): boolean {
    return !!(this.upperMesh && this.lowerMesh && this.upperMeshLabel && this.lowerMeshLabel)
  }

  /**
   * 清理资源
   */
  dispose(): void {
    // 渲染器清理
    this.renderer.dispose()

    // 清理场景中的所有对象
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose()
        if (Array.isArray(object.material)) {
          object.material.forEach((mat) => mat.dispose())
        } else {
          object.material.dispose()
        }
      }
    })
  }
}
