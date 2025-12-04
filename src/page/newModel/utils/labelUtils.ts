import * as THREE from 'three'
import { LABEL_CONFIG, TOOTH_COLOR_MAP } from '../constants'
import type { ToothCenterPoint } from '../types'

/**
 * 创建牙齿编号标签
 * @param toothLabel 牙齿编号
 * @returns THREE.Sprite 标签对象
 */
export function createToothLabel(toothLabel: number): THREE.Sprite | null {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return null

  canvas.width = LABEL_CONFIG.canvas.width
  canvas.height = LABEL_CONFIG.canvas.height

  // 绘制文字
  context.font = LABEL_CONFIG.font
  context.fillStyle = LABEL_CONFIG.textColor
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(toothLabel.toString(), canvas.width / 2, canvas.height / 2)

  // 创建纹理
  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true

  // 创建sprite材质
  const spriteMaterial = new THREE.SpriteMaterial({
    map: texture,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: true,
  })

  // 创建sprite对象
  const sprite = new THREE.Sprite(spriteMaterial)
  sprite.scale.set(LABEL_CONFIG.scale.x, LABEL_CONFIG.scale.y, LABEL_CONFIG.scale.z)
  sprite.name = `label_${toothLabel}`

  return sprite
}

/**
 * 创建质心点标签
 * @param fdi 牙齿编号
 * @param position 标签位置
 * @param parentGroup 父组对象
 */
export function createCenterPointLabel(
  fdi: number,
  position: THREE.Vector3,
  parentGroup: THREE.Group,
): void {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return

  canvas.width = 128
  canvas.height = 128

  // 绘制背景圆形
  context.fillStyle = 'rgba(0, 0, 0, 0.6)'
  context.beginPath()
  context.arc(64, 64, 60, 0, Math.PI * 2)
  context.fill()

  // 绘制文字
  context.font = 'Bold 50px Arial'
  context.fillStyle = '#ffffff'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(fdi.toString(), 64, 64)

  // 创建纹理
  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true

  // 创建sprite材质
  const spriteMaterial = new THREE.SpriteMaterial({
    map: texture,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: true,
  })

  // 创建sprite对象
  const sprite = new THREE.Sprite(spriteMaterial)
  sprite.position.set(position.x, position.y, position.z + 1.5)
  sprite.scale.set(1.5, 1.5, 1)
  sprite.name = `center_label_${fdi}`

  parentGroup.add(sprite)
}

/**
 * 为每颗牙齿创建编号标签
 * @param centers 牙齿中心点映射
 * @param parentMesh 父网格对象
 * @returns 所有创建的标签数组
 */
export function createLabelsForTeeth(
  centers: Record<number, THREE.Vector3>,
  parentMesh: THREE.Mesh,
): THREE.Sprite[] {
  const labels: THREE.Sprite[] = []

  Object.keys(centers).forEach((label) => {
    const toothLabel = Number(label)
    const center = centers[toothLabel]
    if (!center) return

    const sprite = createToothLabel(toothLabel)
    if (!sprite) return

    sprite.position.copy(center)
    sprite.visible = false
    parentMesh.add(sprite)
    labels.push(sprite)
  })

  return labels
}

/**
 * 渲染牙齿质心点
 * @param teethPoints 牙齿质心点数组
 * @param parentMesh 父网格对象（可选）
 */
export function renderTeethCenterPoints(
  teethPoints: ToothCenterPoint[],
  parentMesh?: THREE.Object3D,
): void {
  if (!teethPoints || teethPoints.length === 0) return

  const centerPointsGroup = new THREE.Group()
  centerPointsGroup.name = 'teeth_center_points'

  teethPoints.forEach((item) => {
    const { fdi, point } = item
    const [x, y, z] = point

    // 创建球体表示质心点
    const sphereGeometry = new THREE.SphereGeometry(0.5, 16, 16)
    const color = TOOTH_COLOR_MAP[fdi] || 0xffff00

    const sphereMaterial = new THREE.MeshBasicMaterial({
      color: color,
      depthTest: false,
      transparent: true,
      opacity: 0.9,
    })

    const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial)
    sphere.position.set(x, y, z)
    sphere.name = `center_point_${fdi}`
    sphere.userData.fdi = fdi
    sphere.userData.type = item.type
    sphere.userData.type_cn = item.type_cn

    centerPointsGroup.add(sphere)

    // 创建文字标签
    createCenterPointLabel(fdi, new THREE.Vector3(x, y, z), centerPointsGroup)
  })

  if (parentMesh) {
    parentMesh.add(centerPointsGroup)
  }

  console.log(`已渲染 ${teethPoints.length} 个牙齿质心点`)
}
