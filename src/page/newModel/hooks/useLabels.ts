import { ref } from 'vue'
import * as THREE from 'three'
import { createLabelsForTeeth } from '../utils/labelUtils'
import { createWidthLabel, getToothWidthAndCenter } from '../utils/widthUtils'
import type { ToothCentersMap } from '../types'

/**
 * 标签管理组合函数
 */
export function useLabels() {
  const allToothLabels = ref<THREE.Sprite[]>([])
  const toothWidthLabels = ref<THREE.Sprite[]>([])
  const showAllLabels = ref(false)
  const showWidths = ref(false)

  /**
   * 为牙齿创建编号标签
   */
  const generateToothLabels = (centers: ToothCentersMap, parentMesh: THREE.Mesh) => {
    const labels = createLabelsForTeeth(centers, parentMesh)
    allToothLabels.value.push(...labels)
  }

  /**
   * 为牙齿创建宽度标签
   */
  const generateWidthLabels = (toothPoints: Record<number, Float32Array>, scene: THREE.Scene) => {
    Object.keys(toothPoints).forEach((toothNum) => {
      const points = toothPoints[Number(toothNum)]
      if (!points) return

      const { width, center } = getToothWidthAndCenter(points)
      const label = createWidthLabel(width.toFixed(2) + ' mm')

      label.position.set(center.x, center.y + 1.5, center.z)
      label.visible = false
      scene.add(label)

      toothWidthLabels.value.push(label)
    })
  }

  /**
   * 切换牙号显示
   */
  const toggleToothNumbers = () => {
    showAllLabels.value = !showAllLabels.value
    allToothLabels.value.forEach((label) => {
      label.visible = showAllLabels.value
    })
  }

  /**
   * 切换宽度显示
   */
  const toggleWidthLabels = () => {
    showWidths.value = !showWidths.value
    toothWidthLabels.value.forEach((label) => {
      label.visible = showWidths.value
    })
  }

  return {
    allToothLabels,
    toothWidthLabels,
    showAllLabels,
    showWidths,
    generateToothLabels,
    generateWidthLabels,
    toggleToothNumbers,
    toggleWidthLabels,
  }
}
