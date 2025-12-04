import * as THREE from 'three'

/**
 * 寻找曲线上离目标点最近的参数 t 值 (0-1)
 * @param point 目标点
 * @param curve 曲线对象
 * @param divisions 分段数量
 * @returns 最近点的 t 值
 */
export function getClosestPointTOnCurve(
  point: THREE.Vector3,
  curve: THREE.Curve<THREE.Vector3>,
  divisions = 100,
): number {
  let bestT = 0
  let minDistanceSq = Infinity

  for (let i = 0; i <= divisions; i++) {
    const t = i / divisions
    const pt = curve.getPointAt(t)
    const distSq = point.distanceToSquared(pt)
    if (distSq < minDistanceSq) {
      minDistanceSq = distSq
      bestT = t
    }
  }

  return bestT
}

/**
 * 统计labels数组中各个牙齿编号的数量
 * @param labels labels数组
 * @returns 牙齿编号到数量的映射
 */
export function countToothLabels(labels: number[]): Record<number, number> {
  const counts: Record<number, number> = {}
  labels.forEach((label) => {
    counts[label] = (counts[label] || 0) + 1
  })
  return counts
}

/**
 * 创建切片平面
 * @param point 平面位置点
 * @param normal 平面法线
 * @param scene 场景对象
 * @returns 平面网格
 */
export function createSlicePlane(
  point: THREE.Vector3,
  normal: THREE.Vector3,
  scene: THREE.Scene,
): THREE.Mesh {
  const planeGeometry = new THREE.PlaneGeometry(50, 50)
  const planeMaterial = new THREE.MeshBasicMaterial({
    color: 0xffff00,
    side: THREE.DoubleSide,
    opacity: 0.5,
    transparent: true,
    side: THREE.DoubleSide,
  })

  const plane = new THREE.Mesh(planeGeometry, planeMaterial)

  // 将平面 Z 轴方向对齐到目标法线方向
  const quat = new THREE.Quaternion()
  quat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize())
  plane.quaternion.copy(quat)

  // 设置平面位置
  plane.position.copy(point)

  scene.add(plane)
  return plane
}
