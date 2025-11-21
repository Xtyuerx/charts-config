<template>
  <div ref="container" class="three-container"></div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
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

const container = ref<HTMLDivElement>()

onMounted(() => {
  initThree()
})

function initThree() {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0xffffff)

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
.three-container {
  width: 100%;
  height: 100vh;
  position: relative;
  overflow: hidden;
}
</style>
