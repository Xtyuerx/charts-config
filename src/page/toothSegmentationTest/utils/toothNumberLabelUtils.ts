import * as THREE from 'three'
import type { SurfaceGraph } from './surfaceBoundaryUtils'
import type { ToothBoundary } from './toothBoundaryEditorUtils'

/** 标签中心选在该牙自己的表面，而不是悬在整颗牙的体积中心。 */
export function createToothNumberLabels(
  graph: SurfaceGraph,
  labels: readonly number[],
  boundaries: readonly ToothBoundary[],
) {
  const regions = new Map<number, { sum: THREE.Vector3; area: number; faces: number[] }>()
  graph.surface.faces.forEach((face, index) => {
    const toothId = labels[index] ?? 0
    if (toothId <= 0) return
    const region = regions.get(toothId) ?? { sum: new THREE.Vector3(), area: 0, faces: [] }
    const area = face.triangle.getArea()
    region.sum.addScaledVector(face.center, area)
    region.area += area
    region.faces.push(index)
    regions.set(toothId, region)
  })
  const anchors = new Map<number, { point: THREE.Vector3; normal: THREE.Vector3 }>()
  regions.forEach((region, toothId) => {
    const center = region.sum.divideScalar(region.area || 1)
    const closest = region.faces.reduce((a, b) =>
      graph.surface.faces[a]!.center.distanceToSquared(center) <=
      graph.surface.faces[b]!.center.distanceToSquared(center)
        ? a
        : b,
    )
    const face = graph.surface.faces[closest]!
    // 部分 STL 三角面的 winding 反向。以牙齿区域中心为基准，统一让标签偏移朝外。
    const normal = face.normal.clone()
    if (normal.dot(face.center.clone().sub(center)) < 0) normal.negate()
    anchors.set(toothId, { point: face.center.clone(), normal })
  })
  boundaries.forEach((boundary) => {
    if (anchors.has(boundary.toothId) || !boundary.boundary.length) return
    const center = boundary.boundary
      .reduce(
        (sum, control) => sum.add(new THREE.Vector3(...control.position)),
        new THREE.Vector3(),
      )
      .divideScalar(boundary.boundary.length)
    const hit = graph.surface.tree.closestPointToPoint(center)
    if (hit) {
      const face = graph.surface.faces[hit.faceIndex]!
      const normal = face.normal.clone()
      if (normal.dot(hit.point.clone().sub(center)) < 0) normal.negate()
      anchors.set(boundary.toothId, {
        point: hit.point.clone(),
        normal,
      })
    }
  })
  const group = new THREE.Group()
  group.name = 'tooth-number-labels'
  anchors.forEach(({ point, normal }, toothId) => {
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 96
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建牙位号标签')
    context.font = 'bold 64px sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.lineJoin = 'round'
    context.lineWidth = 8
    context.strokeStyle = '#ffffff'
    context.fillStyle = '#192d45'
    context.strokeText(String(toothId), 64, 48)
    context.fillText(String(toothId), 64, 48)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        alphaTest: 0.1,
        depthTest: true,
        depthWrite: false,
        toneMapped: false,
      }),
    )
    sprite.name = 'tooth-number-label'
    sprite.userData.toothId = toothId
    sprite.position
      .copy(point)
      .addScaledVector(normal, Math.max(graph.surface.epsilon * 10, graph.surface.step * 0.1))
    sprite.scale.set(2.8, 2.1, 1)
    sprite.renderOrder = 31
    group.add(sprite)
  })
  return group
}
