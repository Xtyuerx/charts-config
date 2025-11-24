<template>
  <div class="model-analysis-container">
    <div ref="container" class="three-container"></div>
    <div class="controls-panel">
      <button @click="resetNodes" class="control-btn">重置节点</button>
      <button @click="addRandomNode" class="control-btn">添加节点</button>
      <button @click="logNodeInfo" class="control-btn">节点信息</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import * as THREE from 'three'
import {
  STLLoader,
  OrbitControls,
  Line2,
  LineMaterial,
  LineGeometry,
  CSS2DRenderer,
  CSS2DObject,
} from 'three-stdlib'

// 拖拽状态管理
interface DragState {
  isDragging: boolean
  draggedObject: THREE.Object3D | null
  dragPlane: THREE.Plane
  dragOffset: THREE.Vector3
  raycaster: THREE.Raycaster
  mouse: THREE.Vector2
}

// 全局接口声明
declare global {
  interface Window {
    threeDNodeUtils: {
      resetNodePositions: () => void
      getNodeInfo: () => Array<{
        index: number
        position: THREE.Vector3
        originalPosition?: THREE.Vector3
        color: number
      }>
      cleanup: () => void
      createDraggableNode: (position: THREE.Vector3, color?: number, size?: number) => THREE.Mesh
      updateCurves: () => void
    }
    threeJSScene?: THREE.Scene
  }
}

const container = ref<HTMLDivElement>()

// 控制函数
function resetNodes() {
  if (window.threeDNodeUtils) {
    window.threeDNodeUtils.resetNodePositions()
  }
}

function addRandomNode() {
  if (window.threeDNodeUtils) {
    const randomPos = new THREE.Vector3(
      (Math.random() - 0.5) * 100,
      (Math.random() - 0.5) * 100,
      (Math.random() - 0.5) * 50,
    )
    const randomColor = Math.random() * 0xffffff
    window.threeDNodeUtils.createDraggableNode(randomPos, randomColor)
    window.threeDNodeUtils.updateCurves()
  }
}

function logNodeInfo() {
  if (window.threeDNodeUtils) {
    const info = window.threeDNodeUtils.getNodeInfo()
    console.log('节点信息:', info)
    alert(`当前有 ${info.length} 个节点，详细信息请查看控制台`)
  }
}

onMounted(() => {
  initThree()
})

onUnmounted(() => {
  // 组件卸载时清理资源
  if (window.threeDNodeUtils) {
    window.threeDNodeUtils.cleanup()
    window.threeDNodeUtils = undefined
  }
  if (window.threeJSScene) {
    window.threeJSScene = undefined
  }
})
function initThree() {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0xffffff)

  // 将scene存储到window对象，供其他函数访问
  window.threeJSScene = scene

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000)
  camera.position.set(0, 0, 250)

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(window.innerWidth, window.innerHeight)
  container.value!.appendChild(renderer.domElement)

  const labelRenderer = new CSS2DRenderer()
  labelRenderer.setSize(window.innerWidth, window.innerHeight)
  labelRenderer.domElement.style.position = 'absolute'
  labelRenderer.domElement.style.top = '0'
  labelRenderer.domElement.style.pointerEvents = 'none'
  container.value!.appendChild(labelRenderer.domElement)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.enablePan = false
  controls.minDistance = 80
  controls.maxDistance = 500

  const light = new THREE.DirectionalLight(0xffffff, 1)
  light.position.set(50, 100, 50)
  scene.add(light)
  scene.add(new THREE.AmbientLight(0xffffff, 0.4))

  // 初始化拖拽状态
  const dragState: DragState = {
    isDragging: false,
    draggedObject: null,
    dragPlane: new THREE.Plane(),
    dragOffset: new THREE.Vector3(),
    raycaster: new THREE.Raycaster(),
    mouse: new THREE.Vector2(),
  }

  // 存储可拖拽的节点
  const draggableNodes: THREE.Mesh[] = []

  // 创建可拖拽节点
  function createDraggableNode(
    position: THREE.Vector3,
    color: number = 0xff4444,
    size: number = 8,
  ) {
    const geometry = new THREE.SphereGeometry(size, 16, 16)
    const material = new THREE.MeshPhongMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: 0.2,
    })
    const node = new THREE.Mesh(geometry, material)
    node.position.copy(position)
    node.userData = { isDraggable: true, originalPosition: position.clone() }

    scene.add(node)
    draggableNodes.push(node)

    return node
  }

  // 创建控制节点（用于曲线控制）
  function createControlNodes() {
    // 在曲线关键位置创建可拖拽节点
    const nodePositions = [
      new THREE.Vector3(-60, -20, -10),
      new THREE.Vector3(0, 28, 0),
      new THREE.Vector3(60, -28, -10),
    ]

    nodePositions.forEach((pos, index) => {
      const colors = [0xff4444, 0x44ff44, 0x4444ff]
      const node = createDraggableNode(pos, colors[index])

      // 添加节点标签
      addLabelToMesh(node, new THREE.Vector3(0, 15, 0), `控制点${index + 1}`)
    })

    // 创建初始动态曲线
    updateCurves()
  }

  // 重置所有节点位置
  function resetNodePositions() {
    draggableNodes.forEach((node) => {
      if (node.userData.originalPosition) {
        node.position.copy(node.userData.originalPosition)
      }
    })
    updateCurves()
  }

  // 获取节点信息
  function getNodeInfo() {
    return draggableNodes.map((node, index) => ({
      index,
      position: node.position.clone(),
      originalPosition: node.userData.originalPosition?.clone(),
      color: (node.material as THREE.MeshPhongMaterial).color.getHex(),
    }))
  }

  // 清理函数
  function cleanup() {
    const currentScene = window.threeJSScene || scene

    // 移除事件监听器
    if (container.value) {
      container.value.removeEventListener('mousemove', onMouseMove)
      container.value.removeEventListener('mousedown', onMouseDown)
      container.value.removeEventListener('mouseup', onMouseUp)
      container.value.removeEventListener('mouseleave', onMouseUp)
    }

    // 清理场景中的动态对象
    draggableNodes.forEach((node) => {
      currentScene.remove(node)
      node.geometry.dispose()
      ;(node.material as THREE.Material).dispose()
    })
    draggableNodes.length = 0

    // 清理动态曲线
    const dynamicCurves: Line2[] = []
    currentScene.traverse((child) => {
      if (child instanceof Line2 && child.userData.isDynamicCurve) {
        dynamicCurves.push(child)
      }
    })
    dynamicCurves.forEach((curve) => {
      currentScene.remove(curve)
      curve.geometry.dispose()
      ;(curve.material as THREE.Material).dispose()
    })
  }

  // 暴露给外部的接口
  window.threeDNodeUtils = {
    resetNodePositions,
    getNodeInfo,
    cleanup,
    createDraggableNode,
    updateCurves,
  }

  const loader = new STLLoader()

  // ---------- 加载真实 STL ----------
  loader.load('/models/UpperJaw.stl', (geometry) => {
    geometry.computeVertexNormals()
    // 将几何体居中（调整原点）
    geometry.center()

    const material = new THREE.MeshPhongMaterial({
      color: 0xf8d7d7,
      specular: 0x555555,
      shininess: 30,
    })
    const jawMesh = new THREE.Mesh(geometry, material)

    // 如果需要旋转，使模型朝向合适（根据你的 STL 可能需要）
    jawMesh.rotation.y = Math.PI
    jawMesh.rotation.x = Math.PI / 2

    // 把模型加入场景
    scene.add(jawMesh)

    // ---------- 示例：一些“近似点”（世界坐标），程序会自动把它们吸附到模型表面 ----------
    // 这些点可以来自 AI，或你手动输入，这里只是示例：
    const approxWorldPoints = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 6, 8),
      new THREE.Vector3(5, 5, -2),
    ]

    approxWorldPoints.forEach((worldP, idx) => {
      // 将近似点投影到模型表面（返回局部点）
      const projected = projectPointToMeshSurface(jawMesh, worldP)
      if (projected) {
        // projected.localPoint 是 THREE.Vector3（局部坐标）
        // 我们把 label 作为子对象挂在 jawMesh（局部坐标）
        addLabelToMesh(jawMesh, projected.localPoint, String(idx + 1))
      } else {
        // 未找到投影（异常），直接把 label 加到场景某处以便调试
        console.warn('无法投影该点到网格表面：', worldP)
      }
    })

    // ---------- 绘制贴合模型的加粗曲线 ----------
    // 三维向量Vector3创建一组顶点坐标
    const arr = [
      new THREE.Vector3(-60, -20, -10),
      new THREE.Vector3(0, 28, 0),
      new THREE.Vector3(60, -28, -10),
    ]

    // 生成样条曲线上的点
    const curve = new THREE.CatmullRomCurve3(arr)
    const curvePoints = curve.getPoints(100)

    // 将曲线上的每个点投影到模型表面

    console.log('原始点数:', curvePoints.length, '投影成功点数:', arr.length)

    if (arr.length > 1) {
      // 使用 Line2 和 LineMaterial 来支持真正的线宽
      const positions: number[] = []
      curvePoints.forEach((p) => {
        positions.push(p.x, p.y, p.z)
      })

      const lineGeometry = new LineGeometry()
      lineGeometry.setPositions(positions)

      const lineMaterial = new LineMaterial({
        color: 0xff0000, // 红色
        linewidth: 5, // 线宽（像素）- Line2 支持真正的线宽
        resolution: new THREE.Vector2(window.innerWidth, window.innerHeight), // 分辨率
      })

      // 保存材质引用，用于窗口调整时更新
      lineMaterials.push(lineMaterial)

      const line = new Line2(lineGeometry, lineMaterial)
      line.computeLineDistances() // 必须调用

      // 作为 jawMesh 的子对象，继承其旋转变换
      jawMesh.add(line)
    }

    // 创建控制节点（在模型加载完成后）
    createControlNodes()

    // 如果你需要后续动态投影（比如用户用鼠标点击某处来放标签），可以调用同一个 projectPointToMeshSurface
  })

  // ---------- 添加 Label 并把它作为 mesh 的子对象 ----------
  function addLabelToMesh(parentMesh: THREE.Object3D, localPos: THREE.Vector3, text: string) {
    const div = document.createElement('div')
    div.textContent = text
    div.style.padding = '4px 6px'
    div.style.background = 'rgba(0,0,0,0.7)'
    div.style.color = 'white'
    div.style.borderRadius = '4px'
    div.style.fontSize = '12px'

    const label = new CSS2DObject(div)
    // 重要：这里使用局部坐标位置（父对象是 jawMesh）
    label.position.copy(localPos)
    parentMesh.add(label)
  }

  // 存储线条材质，用于窗口调整时更新分辨率
  const lineMaterials: LineMaterial[] = []

  // 鼠标事件处理函数
  function onMouseMove(event: MouseEvent) {
    if (!container.value) return

    const rect = container.value.getBoundingClientRect()
    dragState.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    dragState.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

    if (dragState.isDragging && dragState.draggedObject) {
      // 更新射线
      dragState.raycaster.setFromCamera(dragState.mouse, camera)

      // 计算拖拽平面与射线的交点
      const intersection = new THREE.Vector3()
      if (dragState.raycaster.ray.intersectPlane(dragState.dragPlane, intersection)) {
        // 应用偏移并更新物体位置
        intersection.sub(dragState.dragOffset)
        dragState.draggedObject.position.copy(intersection)

        // 更新相关曲线（如果有的话）
        updateCurves()
      }
    } else {
      // 非拖拽状态下的鼠标悬停检测
      dragState.raycaster.setFromCamera(dragState.mouse, camera)
      const intersects = dragState.raycaster.intersectObjects(draggableNodes)

      // 重置所有节点的悬停状态
      draggableNodes.forEach((node) => {
        if (node.userData.isHovered) {
          const material = node.material as THREE.MeshPhongMaterial
          material.emissiveIntensity = 0.2
          node.scale.set(1, 1, 1)
          node.userData.isHovered = false
        }
      })

      // 设置悬停节点的状态
      if (intersects.length > 0) {
        // 检查悬停状态
        const hoveredNode = intersects[0]?.object as THREE.Mesh
        if (!dragState.isDragging) {
          const material = hoveredNode.material as THREE.MeshPhongMaterial
          material.emissiveIntensity = 0.3
          hoveredNode.scale.set(1.2, 1.2, 1.2)
          hoveredNode.userData.isHovered = true

          // 改变鼠标样式
          container.value!.style.cursor = 'pointer'
        }
      } else {
        container.value!.style.cursor = 'default'
      }
    }
  }

  function onMouseDown(event: MouseEvent) {
    if (!container.value) return

    const rect = container.value.getBoundingClientRect()
    dragState.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    dragState.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

    // 更新射线
    dragState.raycaster.setFromCamera(dragState.mouse, camera)

    // 检测与可拖拽物体的交集
    const intersects = dragState.raycaster.intersectObjects(draggableNodes)

    if (intersects.length > 0 && intersects[0]) {
      // 禁用轨道控制器
      controls.enabled = false

      // 设置拖拽状态
      dragState.isDragging = true
      dragState.draggedObject = intersects[0].object

      // 设置拖拽平面（与相机垂直的平面）
      const cameraDirection = new THREE.Vector3()
      camera.getWorldDirection(cameraDirection)
      dragState.dragPlane.setFromNormalAndCoplanarPoint(cameraDirection, intersects[0].point!)

      // 计算偏移
      dragState.dragOffset.subVectors(intersects[0].point!, dragState.draggedObject.position)

      // 高亮被拖拽的物体
      if (dragState.draggedObject instanceof THREE.Mesh) {
        const material = dragState.draggedObject.material as THREE.MeshPhongMaterial
        material.emissiveIntensity = 0.5
      }
    }
  }

  function onMouseUp() {
    if (dragState.isDragging && dragState.draggedObject) {
      // 恢复物体材质
      if (dragState.draggedObject instanceof THREE.Mesh) {
        const material = dragState.draggedObject.material as THREE.MeshPhongMaterial
        material.emissiveIntensity = 0.2
      }

      // 重置拖拽状态
      dragState.isDragging = false
      dragState.draggedObject = null

      // 重新启用轨道控制器
      controls.enabled = true
    }
  }

  // 更新曲线函数（当控制点移动时）
  function updateCurves() {
    // 获取控制点位置
    const controlPoints = draggableNodes.map((node) => node.position.clone())

    if (controlPoints.length >= 2) {
      // 创建新的曲线
      const curve = new THREE.CatmullRomCurve3(controlPoints)
      const curvePoints = curve.getPoints(100)

      // 更新现有曲线或创建新曲线
      updateOrCreateCurve(curvePoints)
    }

    console.log('控制点位置已更新，曲线已重新生成')
  }

  // 更新或创建曲线
  function updateOrCreateCurve(points: THREE.Vector3[]) {
    const currentScene = window.threeJSScene || scene

    // 查找现有的曲线
    let existingLine: Line2 | null = null
    currentScene.traverse((child) => {
      if (child instanceof Line2 && child.userData.isDynamicCurve) {
        existingLine = child
      }
    })

    if (existingLine) {
      // 更新现有曲线
      const positions: number[] = []
      points.forEach((p) => {
        positions.push(p.x, p.y, p.z)
      })

      const geometry = (existingLine as Line2).geometry as LineGeometry
      geometry.setPositions(positions)
      ;(existingLine as Line2).computeLineDistances()
    } else {
      // 创建新曲线
      const positions: number[] = []
      points.forEach((p) => {
        positions.push(p.x, p.y, p.z)
      })

      const lineGeometry = new LineGeometry()
      lineGeometry.setPositions(positions)

      const lineMaterial = new LineMaterial({
        color: 0x00ff00, // 绿色动态曲线
        linewidth: 4,
        resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
      })

      const line = new Line2(lineGeometry, lineMaterial)
      line.computeLineDistances()
      line.userData.isDynamicCurve = true

      currentScene.add(line)
      lineMaterials.push(lineMaterial)
    }
  }

  // ---------- 动画循环 ----------
  function animate() {
    requestAnimationFrame(animate)
    controls.update()
    renderer.render(scene, camera)
    labelRenderer.render(scene, camera)
  }
  animate()

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
    labelRenderer.setSize(window.innerWidth, window.innerHeight)

    // 更新 Line2 材质的分辨率
    lineMaterials.forEach((material) => {
      material.resolution.set(window.innerWidth, window.innerHeight)
    })
  })

  // 添加鼠标事件监听器
  container.value!.addEventListener('mousemove', onMouseMove)
  container.value!.addEventListener('mousedown', onMouseDown)
  container.value!.addEventListener('mouseup', onMouseUp)
  container.value!.addEventListener('mouseleave', onMouseUp) // 鼠标离开容器时结束拖拽
}

/**
 * projectPointToMeshSurface
 * - 输入：mesh（THREE.Mesh） 和 一个 worldPoint（THREE.Vector3，世界坐标）
 * - 输出：{ localPoint: THREE.Vector3, worldPoint: THREE.Vector3, normal: THREE.Vector3 } 或 null
 *
 * 算法：把 worldPoint 转为 mesh.local 坐标，然后遍历三角面，找离点最近的三角面上的点（closest point on triangle）。
 * 返回局部坐标（便于 parent.add(label)），也返回世界坐标与法向。
 *
 * 注意：该实现为逐三角遍历，精确但在面数很大时会慢。若性能成为问题，请使用 three-mesh-bvh。
 */
function projectPointToMeshSurface(mesh: THREE.Mesh, worldPoint: THREE.Vector3) {
  const geometry = mesh.geometry as THREE.BufferGeometry
  if (!geometry || !geometry.attributes.position) return null

  // 把世界坐标转为 mesh 的局部坐标
  const localPoint = worldPoint.clone()
  mesh.worldToLocal(localPoint)

  const posAttr = geometry.attributes.position
  const indexAttr = geometry.index // 可能为 null（非索引化）
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const triClosest = new THREE.Vector3()
  const tmpNormal = new THREE.Vector3()

  const bestPoint = new THREE.Vector3()
  let bestDistSq = Infinity
  const bestNormal = new THREE.Vector3()

  // 辅助：获取三角顶点坐标（局部坐标系）
  const getVertex = (i: number, target: THREE.Vector3) => {
    target.fromBufferAttribute(posAttr, i)
  }

  // 遍历三角
  const triCount = indexAttr ? indexAttr.count / 3 : posAttr.count / 3
  for (let ti = 0; ti < triCount; ti++) {
    let i0: number, i1: number, i2: number
    if (indexAttr) {
      i0 = indexAttr.getX(ti * 3)
      i1 = indexAttr.getX(ti * 3 + 1)
      i2 = indexAttr.getX(ti * 3 + 2)
    } else {
      i0 = ti * 3
      i1 = ti * 3 + 1
      i2 = ti * 3 + 2
    }

    getVertex(i0, a)
    getVertex(i1, b)
    getVertex(i2, c)

    // 计算当前三角上离 localPoint 最近的点（局部坐标系）
    closestPointOnTriangle(localPoint, a, b, c, triClosest)

    // 计算距离平方
    const dsq = triClosest.distanceToSquared(localPoint)
    if (dsq < bestDistSq) {
      bestDistSq = dsq
      bestPoint.copy(triClosest)

      // 计算三角面法向（用于让 label 以法线偏移）
      tmpNormal.subVectors(b, a).cross(tmpNormal.subVectors(c, a)).normalize()
      bestNormal.copy(tmpNormal)
    }
  }

  // 返回局部点和世界点与法向
  const outLocal = bestPoint.clone()
  const outWorld = outLocal.clone()
  mesh.localToWorld(outWorld)

  return {
    localPoint: outLocal,
    worldPoint: outWorld,
    normal: bestNormal,
  }
}

/**
 * closestPointOnTriangle（经典实现）
 * 计算点 p 到三角面 abc 的最近点，结果写入 out（都为 THREE.Vector3）
 *
 * 算法参考：Real-Time Collision Detection（Christer Ericson）
 */
function closestPointOnTriangle(
  p: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  out: THREE.Vector3,
) {
  // 从 a 出发的向量
  const ab = new THREE.Vector3().subVectors(b, a)
  const ac = new THREE.Vector3().subVectors(c, a)
  const ap = new THREE.Vector3().subVectors(p, a)

  const d1 = ab.dot(ap)
  const d2 = ac.dot(ap)

  if (d1 <= 0 && d2 <= 0) {
    // 区域A（顶点 a）
    out.copy(a)
    return out
  }

  // 检查顶点 B 区域
  const bp = new THREE.Vector3().subVectors(p, b)
  const d3 = ab.dot(bp)
  const d4 = ac.dot(bp)
  if (d3 >= 0 && d4 <= d3) {
    out.copy(b)
    return out
  }

  // 检查边 AB 区域
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3)
    out.copy(ab).multiplyScalar(v).add(a)
    return out
  }

  // 检查顶点 C 区域
  const cp = new THREE.Vector3().subVectors(p, c)
  const d5 = ab.dot(cp)
  const d6 = ac.dot(cp)
  if (d6 >= 0 && d5 <= d6) {
    out.copy(c)
    return out
  }

  // 检查边 AC 区域
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6)
    out.copy(ac).multiplyScalar(w).add(a)
    return out
  }

  // 检查边 BC 区域
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6))
    const bc = new THREE.Vector3().subVectors(c, b)
    out.copy(bc).multiplyScalar(w).add(b)
    return out
  }

  // 内部区域（投影到三角面平面上，然后用重心坐标）
  const denom = 1 / (va + vb + vc) // safe because not zero here
  const v = vb * denom
  const w = vc * denom
  out.copy(ab).multiplyScalar(v).add(ac.clone().multiplyScalar(w)).add(a)
  return out
}
</script>

<style>
.model-analysis-container {
  position: relative;
  width: 100%;
  height: 100vh;
}

.three-container {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
}

.controls-panel {
  position: absolute;
  top: 20px;
  left: 20px;
  background: rgba(255, 255, 255, 0.9);
  padding: 15px;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
  gap: 10px;
  z-index: 100;
}

.control-btn {
  padding: 8px 16px;
  background: #007bff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: background-color 0.3s;
}

.control-btn:hover {
  background: #0056b3;
}

.control-btn:active {
  transform: scale(0.98);
}
</style>
