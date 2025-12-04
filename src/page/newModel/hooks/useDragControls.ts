import { ref } from 'vue'
import * as THREE from 'three'
import type { DragControls } from 'three-stdlib'
import type { OrbitControls } from 'three-stdlib'
import { getClosestPointTOnCurve } from '../utils/geometryUtils'

/**
 * 拖拽控制组合函数
 */
export function useDragControls() {
  const draggableObjects = ref<THREE.Object3D[]>([])

  const setupDragControls = (
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
    controls: OrbitControls,
    DragControlsClass: typeof DragControls,
  ) => {
    const dragControls = new DragControlsClass(draggableObjects.value, camera, renderer.domElement)

    dragControls.addEventListener('dragstart', () => {
      controls.enabled = false
    })

    dragControls.addEventListener('dragend', () => {
      controls.enabled = true
    })

    dragControls.addEventListener('drag', (event: { object: THREE.Object3D }) => {
      if (event.object.userData.isControlPoint) {
        const point = event.object
        const curve = point.userData.curve

        if (curve) {
          const pos = point.position.clone()
          const t = getClosestPointTOnCurve(pos, curve)
          const newPos = curve.getPointAt(t)
          point.position.copy(newPos)
          console.log('Point T:', t, 'Position:', newPos)
        }
      }
    })

    return dragControls
  }

  const addDraggableObject = (obj: THREE.Object3D) => {
    draggableObjects.value.push(obj)
  }

  const getControlPointsData = () => {
    return draggableObjects.value.map((obj) => ({
      id: obj.id,
      position: obj.position.clone(),
      t: obj.userData.t,
      jaw: obj.userData.jaw,
    }))
  }

  return {
    draggableObjects,
    setupDragControls,
    addDraggableObject,
    getControlPointsData,
  }
}
