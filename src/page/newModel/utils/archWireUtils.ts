import * as THREE from 'three'
import { TOOTH_PAIRS, ARCH_WIRE_CONFIG } from '../constants'
import type { ToothCentersMap } from '../types'

/**
 * 创建中间牙弓线
 * @param upperCenters 上颌牙齿中心点
 * @param lowerCenters 下颌牙齿中心点
 * @param scene 场景对象
 * @param draggableObjects 可拖拽对象数组
 */
export function createMiddleArchCurve(
  upperCenters: ToothCentersMap | null,
  lowerCenters: ToothCentersMap | null,
  scene: THREE.Scene,
  draggableObjects: THREE.Object3D[],
): void {
  if (!upperCenters || !lowerCenters) return

  const points: THREE.Vector3[] = []

  // 根据配对关系计算中点
  TOOTH_PAIRS.forEach(([upperCode, lowerCode]) => {
    const pUpper = upperCenters[upperCode]
    const pLower = lowerCenters[lowerCode]

    if (pUpper && pLower) {
      const mid = new THREE.Vector3().addVectors(pUpper, pLower).multiplyScalar(0.5)
      points.push(mid)
    }
  })

  if (points.length < 2) return

  // 创建曲线
  const curve = new THREE.CatmullRomCurve3(points)
  curve.closed = false
  curve.curveType = ARCH_WIRE_CONFIG.curveType
  curve.tension = ARCH_WIRE_CONFIG.tension

  // 创建组
  const archGroup = new THREE.Group()
  archGroup.scale.set(1.5, 1.5, 1.5)
  scene.add(archGroup)

  // 创建管道几何体
  const tubeGeometry = new THREE.TubeGeometry(
    curve,
    ARCH_WIRE_CONFIG.tubeSegments,
    ARCH_WIRE_CONFIG.tubeRadius,
    ARCH_WIRE_CONFIG.radialSegments,
    false,
  )

  // 创建纹理
  const texture = createArchWireTexture()

  // 创建材质
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    color: ARCH_WIRE_CONFIG.color,
    roughness: ARCH_WIRE_CONFIG.roughness,
    metalness: ARCH_WIRE_CONFIG.metalness,
    depthTest: false,
    transparent: true,
  })

  const tubeMesh = new THREE.Mesh(tubeGeometry, material)
  tubeMesh.renderOrder = 999
  tubeMesh.name = 'middle_arch_wire'
  archGroup.add(tubeMesh)

  // 添加控制点
  addControlPoints(curve, archGroup, draggableObjects)
}

/**
 * 创建牙弓线纹理
 * @returns THREE.CanvasTexture
 */
function createArchWireTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')

  if (ctx) {
    ctx.fillStyle = '#ddd'
    ctx.fillRect(0, 0, 64, 64)
    ctx.fillStyle = '#888'
    for (let i = 0; i < 64; i += 8) {
      ctx.beginPath()
      ctx.moveTo(0, i)
      ctx.lineTo(64, i + 32)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, i + 4)
      ctx.lineTo(64, i + 36)
      ctx.stroke()
    }
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(20, 1)

  return texture
}

/**
 * 添加控制点到牙弓线
 * @param curve 曲线对象
 * @param parentGroup 父组对象
 * @param draggableObjects 可拖拽对象数组
 */
function addControlPoints(
  curve: THREE.CatmullRomCurve3,
  parentGroup: THREE.Group,
  draggableObjects: THREE.Object3D[],
): void {
  const controlPointCount = ARCH_WIRE_CONFIG.controlPointCount

  for (let i = 0; i < controlPointCount; i++) {
    const t = i / (controlPointCount - 1)
    const pointPos = curve.getPointAt(t)

    const sphereGeo = new THREE.SphereGeometry(ARCH_WIRE_CONFIG.controlPointRadius, 16, 16)
    const sphereMat = new THREE.MeshBasicMaterial({
      color: ARCH_WIRE_CONFIG.controlPointColor,
      depthTest: false,
      transparent: true,
    })
    const sphere = new THREE.Mesh(sphereGeo, sphereMat)
    sphere.renderOrder = 999

    sphere.position.copy(pointPos)
    sphere.userData.isControlPoint = true
    sphere.userData.curve = curve
    sphere.userData.t = t
    sphere.userData.jaw = 'middle'

    parentGroup.add(sphere)
    draggableObjects.push(sphere)
  }
}
