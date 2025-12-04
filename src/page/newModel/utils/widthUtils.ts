import * as THREE from 'three'

/**
 * 创建宽度测量标签（修正版）
 * @param text 显示文本
 * @returns THREE.Sprite
 */
export function createWidthLabel(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 128
  const ctx = canvas.getContext('2d')!

  ctx.font = '48px Arial'
  ctx.fillStyle = 'black'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 20, 64)

  const texture = new THREE.CanvasTexture(canvas)
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(12, 6, 1)

  return sprite
}

/**
 * 计算牙齿的宽度和中心点
 * @param points 牙齿点云数据
 * @returns 宽度和中心点
 */
export function getToothWidthAndCenter(points: Float32Array): {
  width: number
  center: THREE.Vector3
} {
  if (!points || points.length < 3) {
    return { width: 0, center: new THREE.Vector3() }
  }

  let minX = points[0] || 0
  let maxX = points[0] || 0
  let sumX = 0
  let sumY = 0
  let sumZ = 0
  const n = points.length / 3

  for (let i = 0; i < n; i++) {
    const x = points[i * 3] || 0
    const y = points[i * 3 + 1] || 0
    const z = points[i * 3 + 2] || 0

    if (x < minX) minX = x
    if (x > maxX) maxX = x

    sumX += x
    sumY += y
    sumZ += z
  }

  const width = maxX - minX
  const center = new THREE.Vector3(sumX / n, sumY / n, sumZ / n)

  return { width, center }
}
