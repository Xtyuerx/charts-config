import * as THREE from 'three'
import { TOOTH_PAIRS } from '../constants'
import type { ToothPoint } from '../types'

/**
 * 牙弓线配置
 */
export const ARCH_WIRE_CONFIG = {
  tubeRadius: 0.2,
  tubeSegments: 64,
  radialSegments: 8,
  color: 0xffaa44,
  roughness: 0.8,
  metalness: 0.2,
  controlPointCount: 5,
  controlPointRadius: 0.5,
  controlPointColor: 0x285e50,
  curveType: 'catmullrom' as const,
  tension: 0.5,
}

/**
 * 牙齿中心点映射类型
 */
export type ToothCentersMap = Record<number, THREE.Vector3>

/**
 * 牙弓线创建结果
 */
export interface ArchWireResult {
  group: THREE.Group
  curve: THREE.CatmullRomCurve3
  tubeMesh: THREE.Mesh
  controlPoints: THREE.Mesh[]
}

/**
 * 根据牙齿点位计算牙齿中心点
 * @param teethPoints 牙齿点位数组
 * @param scaled 是否应用缩放
 */
export function calculateToothCenters(
  teethPoints: ToothPoint[],
  scaled: boolean = false,
): { upper: ToothCentersMap; lower: ToothCentersMap } {
  const scale = scaled ? 1.5 : 1
  const upperCenters: ToothCentersMap = {}
  const lowerCenters: ToothCentersMap = {}

  // 按 FDI 分组
  const groupedByFDI = teethPoints.reduce(
    (acc, p) => {
      if (!acc[p.fdi]) {
        acc[p.fdi] = []
      }
      acc[p.fdi]?.push(p)
      return acc
    },
    {} as Record<number, ToothPoint[]>,
  )

  // 计算每颗牙齿的中心点
  Object.entries(groupedByFDI).forEach(([fdi, points]) => {
    const fdiNum = parseInt(fdi)
    const sum = points.reduce(
      (acc, p) => {
        acc.x += p.point[0] || 0
        acc.y += p.point[1] || 0
        acc.z += p.point[2] || 0
        return acc
      },
      { x: 0, y: 0, z: 0 },
    )

    const center = new THREE.Vector3(
      (sum.x / points.length) * scale,
      (sum.y / points.length) * scale,
      (sum.z / points.length) * scale,
    )

    if (fdiNum >= 11 && fdiNum <= 28) {
      upperCenters[fdiNum] = center
    } else if (fdiNum >= 31 && fdiNum <= 48) {
      lowerCenters[fdiNum] = center
    }
  })

  return { upper: upperCenters, lower: lowerCenters }
}

/**
 * 创建中间牙弓线（上下颌中点连线）
 * @param upperCenters 上颌牙齿中心点
 * @param lowerCenters 下颌牙齿中心点
 * @returns 牙弓线结果对象
 */
export function createMiddleArchWire(
  upperCenters: ToothCentersMap | null,
  lowerCenters: ToothCentersMap | null,
): ArchWireResult | null {
  if (!upperCenters || !lowerCenters) return null

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

  if (points.length < 2) return null

  // 创建曲线
  const curve = new THREE.CatmullRomCurve3(points)
  curve.closed = false
  curve.curveType = ARCH_WIRE_CONFIG.curveType
  curve.tension = ARCH_WIRE_CONFIG.tension

  // 创建组
  const archGroup = new THREE.Group()
  archGroup.name = 'middle_arch_wire_group'

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

  return {
    group: archGroup,
    curve,
    tubeMesh,
    controlPoints: [],
  }
}

/**
 * 创建单颌牙弓线
 * @param centers 牙齿中心点映射
 * @param jawType 颌类型 ('upper' | 'lower')
 * @returns 牙弓线结果对象
 */
export function createJawArchWire(
  centers: ToothCentersMap | null,
  jawType: 'upper' | 'lower',
): ArchWireResult | null {
  if (!centers) return null

  // 获取该颌的所有牙齿编号并排序
  const fdiNumbers = Object.keys(centers)
    .map(Number)
    .sort((a, b) => {
      // 上颌：从18到11，再从21到28
      // 下颌：从48到41，再从31到38
      if (jawType === 'upper') {
        if (a >= 11 && a <= 18 && b >= 11 && b <= 18) return b - a // 右侧降序
        if (a >= 21 && a <= 28 && b >= 21 && b <= 28) return a - b // 左侧升序
        if (a >= 11 && a <= 18) return -1
        return 1
      } else {
        if (a >= 41 && a <= 48 && b >= 41 && b <= 48) return b - a // 右侧降序
        if (a >= 31 && a <= 38 && b >= 31 && b <= 38) return a - b // 左侧升序
        if (a >= 41 && a <= 48) return -1
        return 1
      }
    })

  const points: THREE.Vector3[] = fdiNumbers
    .map((fdi) => centers[fdi])
    .filter((p): p is THREE.Vector3 => p !== undefined)

  if (points.length < 2) return null

  // 创建曲线
  const curve = new THREE.CatmullRomCurve3(points)
  curve.closed = false
  curve.curveType = ARCH_WIRE_CONFIG.curveType
  curve.tension = ARCH_WIRE_CONFIG.tension

  // 创建组
  const archGroup = new THREE.Group()
  archGroup.name = `${jawType}_arch_wire_group`

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
  tubeMesh.name = `${jawType}_arch_wire`
  archGroup.add(tubeMesh)

  return {
    group: archGroup,
    curve,
    tubeMesh,
    controlPoints: [],
  }
}

/**
 * 添加可拖拽控制点到牙弓线
 * @param archWireResult 牙弓线结果对象
 * @param controlPointCount 控制点数量
 * @returns 控制点数组
 */
export function addControlPoints(
  archWireResult: ArchWireResult,
  controlPointCount: number = ARCH_WIRE_CONFIG.controlPointCount,
): THREE.Mesh[] {
  const { curve, group } = archWireResult
  const controlPoints: THREE.Mesh[] = []

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
    sphere.renderOrder = 1000

    sphere.position.copy(pointPos)
    sphere.userData.isControlPoint = true
    sphere.userData.curve = curve
    sphere.userData.t = t
    sphere.userData.archWire = archWireResult

    group.add(sphere)
    controlPoints.push(sphere)
  }

  archWireResult.controlPoints = controlPoints
  return controlPoints
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
 * 更新牙弓线几何体（当控制点移动时调用）
 * @param archWireResult 牙弓线结果对象
 */
export function updateArchWireGeometry(archWireResult: ArchWireResult): void {
  const { curve, tubeMesh } = archWireResult

  // 重新创建管道几何体
  const newGeometry = new THREE.TubeGeometry(
    curve,
    ARCH_WIRE_CONFIG.tubeSegments,
    ARCH_WIRE_CONFIG.tubeRadius,
    ARCH_WIRE_CONFIG.radialSegments,
    false,
  )

  // 释放旧几何体
  tubeMesh.geometry.dispose()

  // 应用新几何体
  tubeMesh.geometry = newGeometry
}
