<template>
  <article class="slice-viewport" data-testid="slice-viewport">
    <header>{{ title }}</header>
    <div class="viewport-stage">
      <div ref="rendererHostRef" class="tooth-view" :aria-label="title"></div>
      <div
        class="crosshair horizontal"
        :style="{ backgroundColor: horizontalColor }"
        aria-hidden="true"
      ></div>
      <div
        class="crosshair vertical"
        :style="{ backgroundColor: verticalColor }"
        aria-hidden="true"
      ></div>
      <span v-if="!geometry || !pose" class="empty-state">暂无牙齿</span>
    </div>
  </article>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import * as THREE from 'three'
import {
  calculateOrthographicViewHeight,
  createOrthographicViewPose,
  type SliceView,
  type ToothAxisPose,
} from '../utils/toothSliceUtils'

const props = defineProps<{
  title: string
  geometry: THREE.BufferGeometry | null
  pose: ToothAxisPose | null
  view: SliceView
  revision: number
  horizontalColor: string
  verticalColor: string
}>()

const rendererHostRef = ref<HTMLDivElement | null>(null)
let scene: THREE.Scene | null = null
let camera: THREE.OrthographicCamera | null = null
let renderer: THREE.WebGLRenderer | null = null
let toothMesh: THREE.Mesh | null = null
let toothMaterial: THREE.MeshStandardMaterial | null = null
let keyLight: THREE.DirectionalLight | null = null
let keyLightTarget: THREE.Object3D | null = null
let resizeObserver: ResizeObserver | null = null

function syncToothMesh() {
  if (!scene || !toothMaterial) return

  if (!props.geometry) {
    if (toothMesh) scene.remove(toothMesh)
    toothMesh = null
    return
  }

  if (!toothMesh) {
    toothMesh = new THREE.Mesh(props.geometry, toothMaterial)
    scene.add(toothMesh)
  } else {
    toothMesh.geometry = props.geometry
  }
}

function renderView() {
  if (!rendererHostRef.value || !renderer || !scene || !camera) return
  syncToothMesh()

  const width = Math.max(rendererHostRef.value.clientWidth, 1)
  const height = Math.max(rendererHostRef.value.clientHeight, 1)
  renderer.setSize(width, height, false)

  if (!props.geometry || !props.pose || !toothMesh) {
    renderer.render(scene, camera)
    return
  }

  props.geometry.computeBoundingSphere()
  props.geometry.computeBoundingBox()
  const radius = Math.max(props.geometry.boundingSphere?.radius ?? 1, 1)
  const distance = radius * 4
  const aspect = width / height
  const viewHeight = calculateOrthographicViewHeight(
    props.geometry.boundingBox ?? new THREE.Box3(),
    props.pose,
    props.view,
    aspect,
  )
  const viewPose = createOrthographicViewPose(props.pose, props.view, distance)

  camera.left = (-viewHeight * aspect) / 2
  camera.right = (viewHeight * aspect) / 2
  camera.top = viewHeight / 2
  camera.bottom = -viewHeight / 2
  camera.near = 0.01
  camera.far = distance * 4
  camera.position.copy(viewPose.position)
  camera.up.copy(viewPose.up)
  camera.lookAt(viewPose.target)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)

  if (keyLight && keyLightTarget) {
    keyLight.position.copy(viewPose.position)
    keyLightTarget.position.copy(viewPose.target)
    keyLightTarget.updateMatrixWorld(true)
  }

  renderer.render(scene, camera)
}

function initRenderer() {
  if (!rendererHostRef.value) return

  scene = new THREE.Scene()
  scene.background = new THREE.Color(0xffffff)
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000)
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  rendererHostRef.value.appendChild(renderer.domElement)

  toothMaterial = new THREE.MeshStandardMaterial({
    color: 0xdfd0c7,
    roughness: 0.72,
    metalness: 0.01,
    side: THREE.DoubleSide,
  })
  scene.add(new THREE.HemisphereLight(0xffffff, 0x87909c, 1.45))

  keyLight = new THREE.DirectionalLight(0xffffff, 2)
  keyLightTarget = new THREE.Object3D()
  keyLight.target = keyLightTarget
  scene.add(keyLight, keyLightTarget)

  const rimLight = new THREE.DirectionalLight(0xc9dcff, 0.65)
  rimLight.position.set(-30, 24, 40)
  scene.add(rimLight)

  resizeObserver = new ResizeObserver(renderView)
  resizeObserver.observe(rendererHostRef.value)
  renderView()
}

watch(
  () => [props.geometry, props.pose, props.view, props.revision],
  renderView,
)

onMounted(initRenderer)

onUnmounted(() => {
  resizeObserver?.disconnect()
  if (scene && toothMesh) scene.remove(toothMesh)
  toothMesh = null
  toothMaterial?.dispose()
  renderer?.dispose()
  renderer?.domElement.remove()
  scene = null
  camera = null
  renderer = null
  toothMaterial = null
  keyLight = null
  keyLightTarget = null
})
</script>

<style scoped>
.slice-viewport {
  display: grid;
  grid-template-rows: 34px minmax(0, 1fr);
  min-height: 0;
  overflow: hidden;
  background: #ffffff;
  border: 1px solid #dfe3ea;
  border-radius: 6px;
}

.slice-viewport header {
  display: flex;
  align-items: center;
  padding: 0 12px;
  color: #30343b;
  font-size: 13px;
  font-weight: 600;
  border-bottom: 1px solid #edf0f4;
}

.viewport-stage {
  position: relative;
  min-height: 0;
  overflow: hidden;
  background: #ffffff;
}

.tooth-view,
.tooth-view :deep(canvas) {
  display: block;
  width: 100%;
  height: 100%;
}

.crosshair {
  position: absolute;
  z-index: 2;
  pointer-events: none;
}

.crosshair.horizontal {
  top: 50%;
  left: 0;
  width: 100%;
  height: 1.5px;
  transform: translateY(-0.75px);
}

.crosshair.vertical {
  top: 0;
  left: 50%;
  width: 1.5px;
  height: 100%;
  transform: translateX(-0.75px);
}

.empty-state {
  position: absolute;
  top: calc(50% + 18px);
  left: 50%;
  z-index: 3;
  color: #98a0ad;
  font-size: 13px;
  transform: translateX(-50%);
}
</style>
