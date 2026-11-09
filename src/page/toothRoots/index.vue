<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import * as T from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import {
  decodeSurface,
  demoDocument,
  extractTeeth,
  fitRoot,
  loadRootTemplate,
  parseDocument,
  restoreTooth,
  saveDocument,
  uploadDocument,
  type Document,
  type Jaw,
  type Tooth,
  type SaveApi,
} from './core'
import type { LabelMode } from '../msgpackTeeth/geometry'
import { decodePoints, inspectValue } from './inspection'
import { detectToothPair, collisionOverlay, type ToothContact } from './collision'
import { createCrownCap } from './crownClosure'
import { adjacentPairs, surfaceGap, sectionSegments, pointDistance } from './measurements'
import { toothSectionFrame, projectSection, type SectionFrame } from './sectionView'
import { defaultJump, readJump, jumpFrame, jumpMatrix, type JumpParameters } from './occlusalJump'

const jumpPanel = ref(false),
  jumpPreview = ref(true),
  jumpParameters = ref(defaultJump()),
  jumpError = ref('')
const jumpControls = [
  { key: 'forward', label: '前后位移', help: '正值前移', min: -20, max: 20, unit: '模型单位' },
  { key: 'lateral', label: '左右位移', help: '正值向右', min: -20, max: 20, unit: '模型单位' },
  { key: 'vertical', label: '上下位移', help: '正值抬高', min: -20, max: 20, unit: '模型单位' },
  { key: 'opening', label: '张口角度', help: '正值张口', min: 0, max: 30, unit: '°' },
] as const
let lowerJumpFrame: ReturnType<typeof jumpFrame>
const hasBothJaws = computed(() => {
  void revision.value
  return teeth.some((t) => t.jaw === 'lower') && teeth.some((t) => t.jaw === 'upper')
})
const jumpAdjusted = computed(() => Object.values(jumpParameters.value).some((n) => n !== 0))

function applyJump() {
  if (!lowerJumpFrame) return
  const matrix = jumpPreview.value
    ? jumpMatrix(jumpParameters.value, lowerJumpFrame)
    : new T.Matrix4()
  matrix.decompose(lowerMotion.position, lowerMotion.quaternion, lowerMotion.scale)
  lowerMotion.updateMatrixWorld(true)
  invalidateCollision()
  invalidateAnalysis()
  syncGizmo()
  if (analysisTool.value === 'section') updateSection(false)
}
function changeJump(key: keyof JumpParameters, event: Event) {
  const input = event.target as HTMLInputElement
  const value = input.valueAsNumber
  const control = jumpControls.find((c) => c.key === key)!
  if (!Number.isFinite(value) || value < control.min || value > control.max) {
    jumpError.value = `${control.label}请输入 ${control.min} 至 ${control.max} 的有效数值`
    input.value = String(jumpParameters.value[key])
    return
  }
  jumpError.value = ''
  jumpParameters.value = { ...jumpParameters.value, [key]: value }
  jumpPreview.value = true
  dirty.value = true
  applyJump()
}
function compareJump(adjusted: boolean) {
  jumpPreview.value = adjusted
  applyJump()
}
function resetJump() {
  jumpParameters.value = defaultJump()
  jumpError.value = ''
  jumpPreview.value = true
  dirty.value = true
  applyJump()
}
function toggleJump() {
  jumpPanel.value = !jumpPanel.value
  if (jumpPanel.value) {
    showBoth.value = true
    updateLayers()
    frameModel()
  }
}
function saveCurrentDocument() {
  return saveDocument(
    {
      ...source,
      occlusal_jump: {
        ...source.occlusal_jump,
        schema: 'occlusal-jump-v1',
        parameters: { ...jumpParameters.value },
      },
    },
    teeth,
  )
}

const viewport = ref<HTMLDivElement>(),
  jaw = ref<Jaw>('lower'),
  mode = ref<LabelMode>('auto')
const format = ref<'auto' | 'float32'>('auto'),
  rootDirection = ref('-Z')
const status = ref('正在准备演示…'),
  warnings = ref<string[]>([]),
  busy = ref(false),
  dirty = ref(false)
const selectedId = ref<number>(),
  selectedLength = ref(12),
  revision = ref(0),
  showRoots = ref(true)
const templateFolder = ref('/root-templates/'),
  url = ref('/models/jaw.msgpack'),
  hex = ref(''),
  showHex = ref(false)
const apiBase = ref(''),
  caseId = ref(''),
  isDemo = ref(true),
  step = ref(1)
const list = ref<number[]>([])
const showBoth = ref(false),
  showGums = ref(true),
  showAxes = ref(false),
  showBoundaries = ref(false),
  showLandmarks = ref(false)
const dataFields = ref<{ name: string; text: string }[]>([])
const collisionMode = ref(false),
  collisionThreshold = ref(0.2),
  contacts = ref<ToothContact[]>([]),
  collisionStatus = ref(''),
  collisionStale = ref(false),
  collisionProgress = ref(0),
  wireframe = ref(false)
const collisionCount = computed(
  () => contacts.value.filter((p) => p.kind === 'intersection').length,
)
let collisionRun = 0
let beforeCollision = { both: false, roots: true }
const collisionMarkers = new T.Group()
type AnalysisTool = 'gaps' | 'distance' | 'section'
const analysisTool = ref<AnalysisTool | null>(null),
  analysisStatus = ref('')
const gapResults = ref<{ first: number; second: number; distance: number }[]>([])
const measurePoints = ref<T.Vector3[]>([]),
  measureDistance = computed(() =>
    measurePoints.value.length === 2
      ? pointDistance(measurePoints.value[0]!, measurePoints.value[1]!)
      : null,
  )
const sectionAxis = ref<'tooth' | 'X' | 'Y' | 'Z'>('tooth'),
  sectionOffset = ref(0)
const sectionRange = ref({ min: -50, max: 50 }),
  analysisMarkers = new T.Group()
const sectionPaths = ref<{ jaw: Jaw; path: string }[]>([]),
  sectionViewBox = ref('-10 -10 20 20')
const sectionTooth = ref('—')
let sectionPointerStart: { x: number; y: number } | undefined

function clearAnalysisMarkers() {
  disposeGroup(analysisMarkers)
  analysisMarkers.clear()
  sectionPaths.value = []
}
function analysisLine(points: T.Vector3[], color = '#ffd166') {
  const line = new T.Line(
    new T.BufferGeometry().setFromPoints(points),
    new T.LineBasicMaterial({ color, depthTest: false }),
  )
  line.renderOrder = 12
  analysisMarkers.add(line)
  for (const p of points) {
    const dot = new T.Mesh(
      new T.SphereGeometry(0.16, 10, 8),
      new T.MeshBasicMaterial({ color, depthTest: false }),
    )
    dot.position.copy(p)
    dot.renderOrder = 12
    analysisMarkers.add(dot)
  }
}
function invalidateAnalysis() {
  if (!analysisTool.value) return
  clearAnalysisMarkers()
  gapResults.value = []
  measurePoints.value = []
  analysisStatus.value =
    analysisTool.value === 'distance'
      ? '按住 Shift 点击原牙冠表面，依次选择两个测量点'
      : '模型或颌位已变化，请重新计算'
}
function closeAnalysis() {
  analysisTool.value = null
  clearAnalysisMarkers()
  gapResults.value = []
  measurePoints.value = []
}
async function calculateGaps() {
  if (busy.value || analysisTool.value !== 'gaps') return
  const current = teeth.filter((t) => t.jaw === jaw.value)
  const pairs = adjacentPairs(
    current.map((t) => t.id),
    jaw.value,
  )
  invalidateAnalysis()
  await run(async () => {
    const results: typeof gapResults.value = []
    try {
      for (const [first, second] of pairs) {
        if (disposed) return
        const a = current.find((t) => t.id === first)!,
          b = current.find((t) => t.id === second)!
        const gap = surfaceGap(a.crown, b.crown)
        results.push({ first, second, distance: gap.distance })
        analysisLine([gap.a, gap.b])
        analysisStatus.value = `正在计算 ${results.length}/${pairs.length} 对邻牙`
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      gapResults.value = results
      analysisStatus.value = pairs.length
        ? `已计算 ${pairs.length} 对邻牙间隙`
        : '当前颌位没有可测量的相邻牙对'
    } catch (error) {
      clearAnalysisMarkers()
      analysisStatus.value = `间隙计算失败：${message(error)}`
    }
  })
}
function updateSection(resetRange = false) {
  if (analysisTool.value !== 'section' || disposed) return
  const visible = teeth.filter((t) => showBoth.value || t.jaw === jaw.value)
  clearAnalysisMarkers()
  const tooth = selected() ?? visible.find((t) => t.jaw === jaw.value) ?? visible[0]
  if (!tooth) {
    analysisStatus.value = '请先加载牙齿模型'
    return
  }
  sectionTooth.value = `${tooth.jaw === 'lower' ? '下颌' : '上颌'} ${tooth.id}`
  const bounds = new T.Box3()
  for (const t of visible) bounds.union(new T.Box3().setFromObject(t.crown))
  const size = bounds.getSize(new T.Vector3()).length()
  if (resetRange) {
    sectionOffset.value = 0
    sectionRange.value = { min: -size / 2, max: size / 2 }
  }
  if (!Number.isFinite(sectionOffset.value)) {
    analysisStatus.value = '请输入有效截面位置'
    return
  }
  let frame: SectionFrame = toothSectionFrame(tooth.crown, sectionOffset.value)
  if (sectionAxis.value !== 'tooth') {
    const normal = new T.Vector3(
      sectionAxis.value === 'X' ? 1 : 0,
      sectionAxis.value === 'Y' ? 1 : 0,
      sectionAxis.value === 'Z' ? 1 : 0,
    )
    const origin = toothSectionFrame(tooth.crown).origin.addScaledVector(
      normal,
      sectionOffset.value,
    )
    const v = sectionAxis.value === 'Z' ? new T.Vector3(0, 1, 0) : new T.Vector3(0, 0, 1)
    frame = {
      origin,
      normal,
      v,
      u: new T.Vector3().crossVectors(v, normal).normalize(),
      plane: new T.Plane().setFromNormalAndCoplanarPoint(normal, origin),
    }
  }
  // The translucent panel intersects the complete model. No clipping planes are applied.
  const toothSize = new T.Box3().setFromObject(tooth.crown).getSize(new T.Vector3()).length()
  const slice = new T.Mesh(
    new T.PlaneGeometry(Math.max(toothSize * 1.1, size * 0.12), size * 1.25),
    new T.MeshBasicMaterial({
      color: '#69aff5',
      transparent: true,
      opacity: 0.25,
      side: T.DoubleSide,
      depthWrite: false,
      depthTest: false,
    }),
  )
  slice.name = 'sectionSlice'
  slice.position.copy(frame.origin)
  slice.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(frame.u, frame.v, frame.normal))
  slice.renderOrder = 6
  analysisMarkers.add(slice)
  const projectedByJaw: Record<Jaw, T.Vector2[]> = { upper: [], lower: [] }
  let count = 0
  for (const t of visible) {
    const points = sectionSegments(t.crown, frame.plane)
    if (!points.length) continue
    const line = new T.LineSegments(
      new T.BufferGeometry().setFromPoints(points),
      new T.LineBasicMaterial({
        color: t.jaw === 'lower' ? '#5ee1e6' : '#ffb38a',
        depthTest: false,
      }),
    )
    line.renderOrder = 12
    analysisMarkers.add(line)
    projectedByJaw[t.jaw].push(...projectSection(points, frame))
    count += points.length / 2
  }
  const all = [...projectedByJaw.upper, ...projectedByJaw.lower]
  if (all.length) {
    const box = new T.Box2().setFromPoints(all),
      extent = box.getSize(new T.Vector2())
    const margin = Math.max(extent.x, extent.y, 1) * 0.12
    sectionViewBox.value = `${box.min.x - margin} ${box.min.y - margin} ${Math.max(extent.x, 0.1) + margin * 2} ${Math.max(extent.y, 0.1) + margin * 2}`
  }
  sectionPaths.value = (['upper', 'lower'] as const).map((j) => ({
    jaw: j,
    path: projectedByJaw[j]
      .map((p, i) => `${i % 2 === 0 ? 'M' : 'L'}${p.x.toFixed(4)},${p.y.toFixed(4)}`)
      .join(' '),
  }))
  analysisStatus.value = `当前截面：${count} 条三角面交线段`
}
function toggleAnalysis(tool: AnalysisTool) {
  if (busy.value) return
  if (analysisTool.value === tool) {
    closeAnalysis()
    return
  }
  if (collisionMode.value) toggleCollision()
  closeAnalysis()
  analysisTool.value = tool
  if (tool === 'gaps') void calculateGaps()
  else if (tool === 'section') {
    showBoth.value = true
    updateLayers()
    frameModel()
    gizmo.visible = false
    updateSection(true)
  } else invalidateAnalysis()
}
function pickMeasurePoint() {
  const meshes = teeth.filter((t) => t.group.visible).map((t) => t.crown)
  const hit = raycaster.intersectObjects(meshes, false)[0]
  if (!hit) {
    analysisStatus.value = '请点击可见的原牙冠表面'
    return
  }
  if (measurePoints.value.length === 2) {
    measurePoints.value = []
    clearAnalysisMarkers()
  }
  measurePoints.value.push(hit.point.clone())
  clearAnalysisMarkers()
  analysisLine(measurePoints.value)
  analysisStatus.value =
    measurePoints.value.length === 1
      ? '已选择第一个点，请 Shift 点击第二个点'
      : '测量完成；继续 Shift 点击可开始新测量'
}

function clearCollision() {
  for (const tooth of teeth) {
    const layer = tooth.group.getObjectByName('collision')
    if (layer) {
      disposeGroup(layer)
      layer.removeFromParent()
    }
  }
  disposeGroup(collisionMarkers)
  collisionMarkers.clear()
}
function invalidateCollision() {
  if (!collisionMode.value) return
  clearCollision()
  contacts.value = []
  collisionStale.value = true
  collisionStatus.value = '模型或阈值已变化，请重新检测'
}
function addCollisionResult(results: ToothContact[]) {
  const faces = new Map<Tooth, Set<number>>()
  for (const result of results) {
    for (const [j, id, indices] of [
      ['upper', result.upperId, result.upperFaces],
      ['lower', result.lowerId, result.lowerFaces],
    ] as const) {
      const tooth = teeth.find((t) => t.jaw === j && t.id === id)!
      const set = faces.get(tooth) ?? new Set<number>()
      indices.forEach((f) => set.add(f))
      faces.set(tooth, set)
    }
    if (result.kind === 'near') {
      const line = new T.Line(
        new T.BufferGeometry().setFromPoints([result.upperPoint, result.lowerPoint]),
        new T.LineBasicMaterial({ color: '#ffd166', depthTest: false }),
      )
      line.renderOrder = 10
      collisionMarkers.add(line)
      for (const point of [result.upperPoint, result.lowerPoint]) {
        const dot = new T.Mesh(
          new T.SphereGeometry(0.16, 10, 8),
          new T.MeshBasicMaterial({ color: '#ffd166', depthTest: false }),
        )
        dot.position.copy(point)
        dot.renderOrder = 10
        collisionMarkers.add(dot)
      }
    }
  }
  for (const [tooth, indices] of faces) {
    if (!indices.size) continue
    const mesh = new T.Mesh(
      collisionOverlay(tooth.crown.geometry, [...indices]),
      new T.MeshBasicMaterial({
        color: '#ff4059',
        side: T.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    )
    mesh.name = 'collision'
    mesh.renderOrder = 4
    tooth.group.add(mesh)
  }
}
async function detectCollision() {
  if (busy.value || !collisionMode.value) return
  if (!Number.isFinite(collisionThreshold.value) || collisionThreshold.value < 0) {
    collisionStatus.value = '接触阈值必须为非负数'
    return
  }
  const upper = teeth.filter((t) => t.jaw === 'upper'),
    lower = teeth.filter((t) => t.jaw === 'lower')
  clearCollision()
  contacts.value = []
  if (!upper.length || !lower.length) {
    collisionStatus.value = '需要同时加载上颌和下颌牙齿'
    collisionStale.value = true
    return
  }
  const token = ++collisionRun
  await run(async () => {
    const results: ToothContact[] = []
    collisionStale.value = true
    collisionProgress.value = 0
    try {
      let checked = 0
      for (const a of upper)
        for (const b of lower) {
          if (disposed || token !== collisionRun) return
          const hit = detectToothPair(
            { id: a.id, jaw: a.jaw, mesh: a.crown },
            { id: b.id, jaw: b.jaw, mesh: b.crown },
            collisionThreshold.value,
          )
          if (hit) results.push(hit)
          collisionProgress.value = Math.round((++checked / (upper.length * lower.length)) * 100)
          collisionStatus.value = `正在检测 ${checked}/${upper.length * lower.length} 对牙齿`
          if (checked % 4 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
        }
      if (disposed || token !== collisionRun) return
      addCollisionResult(results)
      contacts.value = results.sort((a, b) =>
        a.kind === b.kind ? a.distance - b.distance : a.kind === 'intersection' ? -1 : 1,
      )
      collisionStale.value = false
      collisionStatus.value = `检测完成：${collisionCount.value} 对表面相交，${results.length - collisionCount.value} 对近接触`
    } catch (error) {
      clearCollision()
      collisionStatus.value = `检测失败：${message(error)}`
    }
  })
}
function toggleCollision() {
  if (busy.value) return
  if (!collisionMode.value) closeAnalysis()
  collisionMode.value = !collisionMode.value
  if (collisionMode.value) {
    beforeCollision = { both: showBoth.value, roots: showRoots.value }
    showBoth.value = true
    showRoots.value = false
    updateLayers()
    frameModel()
    void detectCollision()
  } else {
    collisionRun++
    clearCollision()
    contacts.value = []
    showBoth.value = beforeCollision.both
    showRoots.value = beforeCollision.roots
    updateLayers()
    frameModel()
  }
}
function toggleWireframe() {
  wireframe.value = !wireframe.value
  for (const t of teeth) (t.crown.material as T.MeshStandardMaterial).wireframe = wireframe.value
}
function toggleLayer(name: 'axes' | 'landmarks' | 'boundaries' | 'gums' | 'roots') {
  const layer = {
    axes: showAxes,
    landmarks: showLandmarks,
    boundaries: showBoundaries,
    gums: showGums,
    roots: showRoots,
  }[name]
  layer.value = !layer.value
  updateLayers()
}
function focusContact(pair: ToothContact) {
  switchJaw('upper')
  select(pair.upperId)
}
function setView(view: 'front' | 'upper' | 'lower' | 'left' | 'right') {
  frameModel()
  const distance = camera.position.distanceTo(controls.target)
  const front = new T.Vector3(0, -1, 0),
    up = new T.Vector3(0, 0, 1)
  const tooth = teeth.find((t) => t.jaw === jaw.value)
  if (tooth?.frameSource === 'stored-axis') {
    up.applyQuaternion(tooth.originalQuaternion)
    front.applyQuaternion(tooth.originalQuaternion)
  }
  const right = new T.Vector3().crossVectors(front, up).normalize()
  const direction =
    view === 'upper'
      ? up
      : view === 'lower'
        ? up.clone().negate()
        : view === 'left'
          ? right.clone().negate()
          : view === 'right'
            ? right
            : front
  camera.up.copy(view === 'upper' || view === 'lower' ? front.clone().negate() : up)
  camera.position.copy(controls.target).addScaledVector(direction, distance)
  // OrbitControls caches camera.up at construction.
  const target = controls.target.clone()
  controls.dispose()
  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.enabled = !busy.value
  controls.target.copy(target)
  controls.update()
}
const selectedInfo = computed(() => {
  void revision.value
  const t = selected()
  if (!t) return ''
  return inspectValue({
    id: t.id,
    jaw: t.jaw,
    position: t.group.position.toArray(),
    rotation: t.group.quaternion.toArray(),
    axis: new T.Vector3(0, 0, 1).applyQuaternion(t.group.quaternion).toArray(),
    rootParams: t.root,
    frameSource: t.frameSource,
    neckSource: t.neckSource,
    boundaryPointCount: t.neck.length,
    originalAxis: source[`${t.jaw}_axis`]?.[String(t.id)],
    landmarks: source[`${t.jaw}_landmarks`]?.[String(t.id)] ?? null,
    originalTooth: source[`${t.jaw}_teeth`]?.[String(t.id)] ?? null,
    crownClosure: t.group.userData.crownClosure,
  })
})
const steps = [
  {
    title: '加载并解析',
    text: '读取 hex / MessagePack，保留上下颌分割与单牙数据。支持 Draco 或显式 float32 XYZ（小端序）。',
  },
  {
    title: '提取牙齿与牙颈',
    text: '按 seg_labels 分组原三角面；优先使用原始 axis 矩阵和 tooth_boundary_dict 牙颈。缺少字段时以 PCA、邻牙方向和开放边估计。',
  },
  {
    title: '贴合牙根模板',
    text: '每牙位 OBJ / PLY：颈圈半径 1、z=0、根尖 z=-1。缩放并变形颈圈至边界，牙根为独立灰绿色网格。',
  },
  {
    title: '局部坐标与拖拽',
    text: 'Ctrl+点击牙冠或牙根选中。红 X、蓝 Z 轴平移，红弧绕局部 Z 轴旋转。牙冠与牙根共用 Group，操作仅更新内存。',
  },
  {
    title: '保存与上传',
    text: '完整 MessagePack 编码，姿态和牙根参数写入 teeth[牙号].editor。依次获取版本、获取地址、PUT 完整数据、提交 update。',
  },
]
let source: Document,
  teeth: Tooth[] = []
let renderer: T.WebGLRenderer, camera: T.PerspectiveCamera, scene: T.Scene, overlay: T.Scene
let controls: OrbitControls,
  draco: DRACOLoader,
  resize: ResizeObserver,
  frame = 0,
  disposed = false
const models = new T.Group(),
  lowerMotion = new T.Group(),
  gizmo = new T.Group(),
  raycaster = new T.Raycaster()
const handles: T.Mesh[] = []
const selected = () => teeth.find((t) => t.id === selectedId.value && t.jaw === jaw.value)
const pose = computed(() => {
  void revision.value
  const t = selected()
  return t
    ? {
        position: t.group.position
          .toArray()
          .map((n) => n.toFixed(2))
          .join(', '),
        angle: T.MathUtils.radToDeg(new T.Euler().setFromQuaternion(t.group.quaternion).z).toFixed(
          1,
        ),
        vertices: t.vertexIndices.length,
        frame: t.frameSource === 'stored-axis' ? '原始单牙坐标系' : '几何估计坐标系',
        neck: t.neckSource === 'stored-boundary' ? '原始牙颈边界' : '开放边估计牙颈',
      }
    : null
})
const hasRoot = computed(() => {
  void revision.value
  return !!selected()?.group.getObjectByName('root')
})

function disposeGroup(group: T.Object3D) {
  group.traverse((child) => {
    if (child instanceof T.Mesh || child instanceof T.Line || child instanceof T.Points) {
      child.geometry.dispose()
      const mats = Array.isArray(child.material) ? child.material : [child.material]
      mats.forEach((m) => m.dispose())
    }
    if (child.userData.template instanceof T.BufferGeometry) child.userData.template.dispose()
  })
}
function updateLayers() {
  for (const object of [
    ...models.children.filter((o) => o !== lowerMotion),
    ...lowerMotion.children,
  ]) {
    const j = object.userData.jaw as Jaw
    object.visible = showBoth.value || j === jaw.value
    if (object.userData.layer === 'gum') object.visible &&= showGums.value && !showAxes.value
  }
  for (const t of teeth) {
    const material = t.crown.material as T.MeshStandardMaterial
    material.color.set(showAxes.value ? '#ffffff' : t.group.userData.crownColor)
    material.emissive.set(!showAxes.value && t === selected() ? '#3b1728' : '#000000')
    const cap = t.group.getObjectByName('crownCap') as T.Mesh | undefined
    for (const surface of [material, cap?.material as T.MeshStandardMaterial | undefined]) {
      if (!surface) continue
      if (surface.transparent !== showAxes.value) surface.needsUpdate = true
      surface.transparent = showAxes.value
      surface.opacity = showAxes.value ? 0.35 : 1
      surface.depthWrite = !showAxes.value
    }
    for (const [name, visible] of [
      ['axes', showAxes.value],
      ['crownCap', showAxes.value],
      ['boundary', showBoundaries.value],
      ['landmarks', showLandmarks.value],
      ['root', showRoots.value && !showAxes.value],
    ] as const) {
      const object = t.group.getObjectByName(name)
      if (object) object.visible = visible
    }
  }
}
let beforeAxes = { gums: true, roots: true }
watch(
  showAxes,
  (active) => {
    if (active) {
      beforeAxes = { gums: showGums.value, roots: showRoots.value }
      showGums.value = false
      showRoots.value = false
    } else {
      showGums.value = beforeAxes.gums
      showRoots.value = beforeAxes.roots
    }
    updateLayers()
  },
  { flush: 'sync' },
)
function toggleBoth() {
  updateLayers()
  frameModel()
  if (analysisTool.value === 'section') updateSection(true)
  if (analysisTool.value === 'distance') invalidateAnalysis()
}

function addToothLayers(tooth: Tooth, value: Document) {
  tooth.group.userData.jaw = tooth.jaw
  tooth.group.userData.crownColor = (tooth.crown.material as T.MeshStandardMaterial).color.getHex()
  const closure = createCrownCap(tooth.crown.geometry)
  tooth.group.userData.crownClosure = {
    closedLoops: closure.closedLoops,
    fallbackLoops: closure.fallbackLoops,
    unresolvedEdges: closure.unresolvedEdges,
  }
  if (closure.geometry) {
    const cap = new T.Mesh(
      closure.geometry,
      new T.MeshStandardMaterial({
        color: '#ffffff',
        roughness: 0.52,
        side: T.DoubleSide,
      }),
    )
    cap.name = 'crownCap'
    cap.visible = showAxes.value
    tooth.group.add(cap)
  }
  const axes = new T.AxesHelper(5)
  axes.name = 'axes'
  axes.material.depthTest = false
  axes.material.depthWrite = false
  axes.renderOrder = 8
  tooth.group.add(axes)
  if (tooth.neck.length) {
    const boundary = new T.LineLoop(
      new T.BufferGeometry().setFromPoints(tooth.neck),
      new T.LineBasicMaterial({ color: '#ffd166', depthTest: false }),
    )
    boundary.name = 'boundary'
    boundary.renderOrder = 5
    tooth.group.add(boundary)
  }
  const landmarks = new T.Group()
  landmarks.name = 'landmarks'
  const inverse = new T.Matrix4().fromArray(tooth.group.userData.baseFrame).invert()
  const colors: Record<string, string> = {
    fa: '#ff6289',
    fa_slope: '#e9aaff',
    cusp: '#4de4ff',
    fissure: '#ffb347',
    inner_cusp: '#7aed9c',
    outer_cusp: '#7895ff',
  }
  for (const [name, raw] of Object.entries(
    value[`${tooth.jaw}_landmarks`]?.[String(tooth.id)] ?? {},
  )) {
    const points = decodePoints(raw).map((p) => new T.Vector3().fromArray(p).applyMatrix4(inverse))
    if (!points.length) continue
    const markers = new T.Points(
      new T.BufferGeometry().setFromPoints(points),
      new T.PointsMaterial({
        color: colors[name] ?? '#ffffff',
        size: 7,
        sizeAttenuation: false,
        depthTest: false,
      }),
    )
    markers.name = name
    markers.renderOrder = 6
    landmarks.add(markers)
  }
  tooth.group.add(landmarks)
}
function direction(j: Jaw) {
  const sign = rootDirection.value[0] === '-' ? -1 : 1
  const v = new T.Vector3(
    rootDirection.value.endsWith('X') ? sign : 0,
    rootDirection.value.endsWith('Y') ? sign : 0,
    rootDirection.value.endsWith('Z') ? sign : 0,
  )
  return j === 'lower' ? v : v.negate()
}

// 第 1–3 步：完整构建成功后才替换当前场景；切换颌位不丢失未保存操作。
async function install(value: Document, demo = false) {
  console.log(demo ? '演示数据完整内容：' : 'MessagePack 解码后的完整内容：', value)
  const next: Tooth[] = [],
    nextModels = new T.Group(),
    notices: string[] = []
  try {
    const nextJump = readJump(value.occlusal_jump)
    for (const j of ['lower', 'upper'] as const) {
      const seg = value[`${j}_seg`]
      if (!seg) continue
      const geometry = await decodeSurface(seg, format.value, draco)
      let result: ReturnType<typeof extractTeeth>
      try {
        const labels = seg.seg_labels
        if ((!Array.isArray(labels) && !(labels instanceof Uint8Array)) || !labels.length)
          throw new Error(`${j}_seg.seg_labels 必须为非空整数数组`)
        result = extractTeeth(
          geometry,
          Array.from(labels as ArrayLike<number>),
          j,
          mode.value,
          direction(j),
          value,
        )
      } finally {
        geometry.dispose()
      }
      next.push(...result.teeth)
      result.teeth.forEach((t) => nextModels.add(t.group))
      notices.push(...result.warnings)
      let gumGeometry = result.gum
      const gumData = value[`${j}_gum`]?.gum
      if (gumData) {
        try {
          const original = await decodeSurface({ mesh: gumData }, 'auto', draco)
          gumGeometry?.dispose()
          gumGeometry = original
        } catch (error) {
          notices.push(`${j} 原始牙龈未加载：${message(error)}`)
        }
      }
      if (gumGeometry) {
        gumGeometry.computeVertexNormals()
        const gum = new T.Mesh(
          gumGeometry,
          new T.MeshStandardMaterial({
            color: '#dd7c88',
            roughness: 0.55,
            side: T.DoubleSide,
          }),
        )
        gum.userData = { jaw: j, layer: 'gum' }
        nextModels.add(gum)
      }
      for (const tooth of result.teeth) {
        restoreTooth(value, tooth)
        addToothLayers(tooth, value)
        if (tooth.group.userData.crownClosure.unresolvedEdges)
          notices.push(
            `牙 ${tooth.id} 有 ${tooth.group.userData.crownClosure.unresolvedEdges} 条边无法自动封闭，牙轴模式仅封闭可识别的闭环`,
          )
        if (!tooth.neck.length) continue
        try {
          const template = await loadRootTemplate(
            templateFolder.value.replace(/\/?$/, '/') + tooth.root.template,
          )
          tooth.group.userData.template = template
          const root = new T.Mesh(
            fitRoot(template, tooth.neck, tooth.root.length),
            new T.MeshStandardMaterial({ color: '#899c8b', roughness: 0.72, side: T.DoubleSide }),
          )
          root.name = 'root'
          root.visible = showRoots.value
          tooth.group.add(root)
        } catch (error) {
          notices.push(`牙 ${tooth.id} 牙根未加载：${message(error)}`)
        }
      }
    }
    if (!next.length) throw new Error('未发现 lower_seg / upper_seg；当前演示需要整颌分割数据')
    if (disposed) {
      disposeGroup(nextModels)
      return
    }
    clearCollision()
    disposeGroup(models)
    models.clear()
    lowerMotion.clear()
    lowerMotion.position.set(0, 0, 0)
    lowerMotion.quaternion.identity()
    models.add(lowerMotion)
    while (nextModels.children.length) {
      const object = nextModels.children[0]!
      ;(object.userData.jaw === 'lower' ? lowerMotion : models).add(object)
    }
    source = value
    invalidateAnalysis()
    contacts.value = []
    if (collisionMode.value) {
      collisionStale.value = true
      collisionStatus.value = '已加载新模型，请点击重新检测'
    }
    dataFields.value = Object.entries(value).map(([name, item]) => ({
      name,
      text: inspectValue(item),
    }))
    teeth = next
    lowerJumpFrame = jumpFrame(teeth)
    jumpParameters.value = nextJump
    jumpPreview.value = true
    jumpError.value = ''
    applyJump()
    for (const t of teeth) (t.crown.material as T.MeshStandardMaterial).wireframe = wireframe.value
    warnings.value = notices
    isDemo.value = demo || value.demo === true
    dirty.value = false
    selectedId.value = undefined
    if (!next.some((t) => t.jaw === jaw.value)) jaw.value = next[0]!.jaw
    updateJaw()
    if (analysisTool.value === 'section') updateSection(true)
    frameModel()
    status.value = `已加载 ${next.length} 颗牙 · ${isDemo.value ? '内置示意数据' : '用户数据'} · 原始轴 ${next.filter((t) => t.frameSource === 'stored-axis').length}/${next.length} · 原始牙颈 ${next.filter((t) => t.neckSource === 'stored-boundary').length}/${next.length}`
  } catch (error) {
    disposeGroup(nextModels)
    throw error
  }
}
function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
async function run(action: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  controls.enabled = false
  try {
    await action()
  } catch (error) {
    status.value = message(error)
  } finally {
    busy.value = false
    if (!disposed) controls.enabled = true
  }
}
async function loadFile(event: Event) {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0]
  if (file)
    await run(async () => {
      status.value = '加载文件中…'
      await install(parseDocument(new Uint8Array(await file.arrayBuffer())))
    })
  input.value = ''
}
function loadUrl() {
  void run(async () => {
    status.value = '加载 URL 中…'
    const response = await fetch(url.value)
    if (!response.ok) throw new Error(`加载失败 HTTP ${response.status}`)
    await install(parseDocument(new Uint8Array(await response.arrayBuffer())))
  })
}
function loadHex() {
  void run(async () => {
    await install(parseDocument(hex.value))
  })
}
function loadDemo() {
  void run(async () => {
    await install(demoDocument(), true)
  })
}

function switchJaw(next: Jaw) {
  jaw.value = next
  updateJaw()
  invalidateAnalysis()
  if (analysisTool.value === 'section') updateSection(true)
}
function updateJaw() {
  selectedId.value = undefined
  gizmo.visible = false
  for (const t of teeth) {
    ;(t.crown.material as T.MeshStandardMaterial).emissive.set('#000000')
  }
  updateLayers()
  list.value = teeth
    .filter((t) => t.jaw === jaw.value)
    .map((t) => t.id)
    .sort((a, b) => a - b)
  revision.value++
  frameModel()
}
function toggleRoots() {
  updateLayers()
}
function select(id: number) {
  if (busy.value || drag) return
  selectedId.value = id
  const t = selected()!
  console.log(`选中牙齿：${t.jaw === 'lower' ? '下颌' : '上颌'} ${t.id}`, {
    tooth: t,
    originalData: source[`${t.jaw}_teeth`]?.[String(t.id)],
    originalAxis: source[`${t.jaw}_axis`]?.[String(t.id)],
    originalBoundary: source[`${t.jaw}_gum`]?.tooth_boundary_dict?.[String(t.id)],
  })
  selectedLength.value = t.root.length
  for (const item of teeth)
    (item.crown.material as T.MeshStandardMaterial).emissive.set(
      item === t && !showAxes.value ? '#3b1728' : '#000000',
    )
  gizmo.visible = analysisTool.value !== 'section'
  syncGizmo()
  revision.value++
  if (analysisTool.value === 'section') updateSection(true)
}
function syncGizmo() {
  const t = selected()
  if (!t) {
    gizmo.visible = false
    return
  }
  t.group.getWorldPosition(gizmo.position)
  t.group.getWorldQuaternion(gizmo.quaternion)
  gizmo.updateMatrixWorld(true)
}
function changed() {
  invalidateCollision()
  invalidateAnalysis()
  dirty.value = true
  revision.value++
  syncGizmo()
  if (analysisTool.value === 'section') updateSection(false)
}
function rebuildRoot() {
  const t = selected()
  if (!t || !hasRoot.value || busy.value) return
  const root = t.group.getObjectByName('root') as T.Mesh
  try {
    const next = fitRoot(t.group.userData.template, t.neck, selectedLength.value)
    root.geometry.dispose()
    root.geometry = next
    t.root.length = selectedLength.value
    changed()
  } catch (error) {
    selectedLength.value = t.root.length
    status.value = `牙根长度未修改：${message(error)}`
  }
}
function nudge() {
  const t = selected()
  if (!t || busy.value) return
  t.group.position.add(new T.Vector3(0.5, 0, 0).applyQuaternion(t.group.quaternion))
  changed()
}
function rotate() {
  const t = selected()
  if (!t || busy.value) return
  t.group.rotateZ(T.MathUtils.degToRad(5))
  changed()
}
function reset() {
  const t = selected()
  if (!t || busy.value) return
  t.group.position.copy(t.originalPosition)
  t.group.quaternion.copy(t.originalQuaternion)
  changed()
}
function frameModel() {
  if (!camera) return
  const box = new T.Box3()
  for (const t of teeth)
    if (showBoth.value || t.jaw === jaw.value) box.union(new T.Box3().setFromObject(t.crown))
  if (box.isEmpty()) return
  const currentTeeth = teeth.filter((t) => t.jaw === jaw.value)
  const usesStoredFrame = currentTeeth.some((t) => t.frameSource === 'stored-axis')
  const up = new T.Vector3(),
    front = new T.Vector3()
  if (usesStoredFrame) {
    for (const t of currentTeeth) {
      up.add(new T.Vector3(0, 0, 1).applyQuaternion(t.originalQuaternion))
      front.add(new T.Vector3(0, -1, 0).applyQuaternion(t.originalQuaternion))
    }
    if (up.lengthSq() < 1e-8) up.set(0, 0, 1)
    up.normalize()
    front.addScaledVector(up, -front.dot(up)).normalize()
    if (front.lengthSq() < 1e-8) front.set(0, -1, 0).addScaledVector(up, up.y).normalize()
    camera.up.copy(up)
  } else {
    up.set(0, 0, 1)
    front.set(0, -1, 0)
    camera.up.copy(up)
  }
  const center = box.getCenter(new T.Vector3()),
    size = box.getSize(new T.Vector3()).length()
  // OrbitControls 在构造时缓存相机 up 的球坐标基准；重置视角时重新创建，
  // 同时清除旧拖动的惯性，避免换颌位后仍绕原世界 Z 旋转。
  controls.dispose()
  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.enabled = !busy.value
  controls.target.copy(center)
  camera.position.copy(center).add(
    front
      .multiplyScalar(0.9)
      .addScaledVector(up, 0.75)
      .normalize()
      .multiplyScalar(size * 1.35),
  )
  camera.near = Math.max(0.01, size / 1000)
  camera.far = Math.max(1000, size * 20)
  camera.updateProjectionMatrix()
  controls.update()
  // 手柄大小随模型包围盒缩放，支持 mm 或其他模型单位。
  gizmo.scale.setScalar(Math.max(size / 75, 0.01))
}

// 第 4 步：同时显示轴与弧，射线拾取手柄；投影到固定拖动平面，避免轴向拖动跳跃。
type Drag = {
  tooth: Tooth
  kind: string
  axis: T.Vector3
  plane: T.Plane
  start: T.Vector3
  position: T.Vector3
  quaternion: T.Quaternion
  previousAngle: number
  totalAngle: number
}
let drag: Drag | undefined
function material(color: string) {
  return new T.MeshBasicMaterial({ color, depthTest: false, depthWrite: false })
}
function buildGizmo() {
  for (const [kind, color, axis] of [
    ['X', '#e85a69', new T.Vector3(1, 0, 0)],
    ['Z', '#599cff', new T.Vector3(0, 0, 1)],
  ] as const) {
    const shaft = new T.Mesh(new T.CylinderGeometry(0.085, 0.085, 5.5, 12), material(color))
    shaft.position.copy(axis).multiplyScalar(2.75)
    shaft.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), axis)
    gizmo.add(shaft)
    const tip = new T.Mesh(new T.ConeGeometry(0.3, 0.9, 16), material(color))
    tip.position.copy(axis).multiplyScalar(6)
    tip.quaternion.copy(shaft.quaternion)
    gizmo.add(tip)
    const hit = new T.Mesh(
      new T.CylinderGeometry(0.32, 0.32, 6.5, 8),
      new T.MeshBasicMaterial({ visible: false }),
    )
    hit.position.copy(axis).multiplyScalar(3.1)
    hit.quaternion.copy(shaft.quaternion)
    hit.userData.kind = kind
    gizmo.add(hit)
    handles.push(hit)
  }
  const arc = new T.Mesh(new T.TorusGeometry(4, 0.1, 8, 64, Math.PI * 1.65), material('#e85a69'))
  gizmo.add(arc)
  const arcHit = new T.Mesh(
    new T.TorusGeometry(4, 0.35, 8, 64, Math.PI * 1.65),
    new T.MeshBasicMaterial({ visible: false }),
  )
  arcHit.userData.kind = 'R'
  gizmo.add(arcHit)
  handles.push(arcHit)
  const a = Math.PI * 1.65,
    tip = new T.Mesh(new T.ConeGeometry(0.27, 0.8, 16), material('#e85a69'))
  tip.position.set(4 * Math.cos(a), 4 * Math.sin(a), 0)
  tip.quaternion.setFromUnitVectors(
    new T.Vector3(0, 1, 0),
    new T.Vector3(-Math.sin(a), Math.cos(a), 0),
  )
  gizmo.add(tip)
  const dot = new T.Mesh(new T.SphereGeometry(0.15, 12, 8), material('#ffffff'))
  gizmo.add(dot)
  overlay.add(gizmo)
  gizmo.visible = false
}
function pointerRay(event: PointerEvent) {
  const rect = renderer.domElement.getBoundingClientRect()
  raycaster.setFromCamera(
    new T.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((event.clientY - rect.top) / rect.height) * 2,
    ),
    camera,
  )
}
function pointerDown(event: PointerEvent) {
  if (busy.value || event.button !== 0) return
  pointerRay(event)
  if (analysisTool.value === 'section') {
    sectionPointerStart = { x: event.clientX, y: event.clientY }
    return
  }
  if (analysisTool.value === 'distance' && event.shiftKey) {
    pickMeasurePoint()
    event.stopImmediatePropagation()
    event.preventDefault()
    return
  }
  if (event.ctrlKey) {
    const picks: T.Mesh[] = []
    for (const t of teeth)
      if (t.jaw === jaw.value)
        t.group.traverse((o) => {
          if (o instanceof T.Mesh && o.visible) picks.push(o)
        })
    const hit = raycaster.intersectObjects(picks, false)[0]
    if (hit) {
      let object: T.Object3D | null = hit.object
      while (object && !object.userData.toothId) object = object.parent
      if (object) select(object.userData.toothId)
    }
    event.stopImmediatePropagation()
    return
  }
  const t = selected(),
    hit = gizmo.visible ? raycaster.intersectObjects(handles, false)[0] : undefined
  if (!t || !hit) return
  const kind = String(hit.object.userData.kind),
    axis = new T.Vector3(kind === 'X' ? 1 : 0, 0, kind === 'X' ? 0 : 1).applyQuaternion(
      t.group.getWorldQuaternion(new T.Quaternion()),
    )
  const worldPosition = t.group.getWorldPosition(new T.Vector3())
  const worldQuaternion = t.group.getWorldQuaternion(new T.Quaternion())
  const view = camera.position.clone().sub(worldPosition).normalize()
  const normal =
    kind === 'R' ? axis : view.clone().addScaledVector(axis, -view.dot(axis)).normalize()
  if (normal.lengthSq() < 1e-6) return
  const plane = new T.Plane().setFromNormalAndCoplanarPoint(normal, worldPosition),
    start = raycaster.ray.intersectPlane(plane, new T.Vector3())
  if (!start) return
  const local = start.clone().sub(worldPosition).applyQuaternion(worldQuaternion.clone().invert())
  drag = {
    tooth: t,
    kind,
    axis,
    plane,
    start,
    position: t.group.position.clone(),
    quaternion: t.group.quaternion.clone(),
    previousAngle: Math.atan2(local.y, local.x),
    totalAngle: 0,
  }
  controls.enabled = false
  renderer.domElement.setPointerCapture(event.pointerId)
  event.stopImmediatePropagation()
  event.preventDefault()
}
function pointerMove(event: PointerEvent) {
  if (!drag) return
  pointerRay(event)
  const point = raycaster.ray.intersectPlane(drag.plane, new T.Vector3())
  if (!point) return
  if (drag.kind === 'R') {
    const worldPosition = drag.tooth.group.parent!.localToWorld(drag.position.clone())
    const parentQuaternion = drag.tooth.group.parent!.getWorldQuaternion(new T.Quaternion())
    const local = point
        .sub(worldPosition)
        .applyQuaternion(parentQuaternion.multiply(drag.quaternion).invert()),
      angle = Math.atan2(local.y, local.x)
    // 展开 atan2 跨 ±π 的跳变，允许连续旋转。
    drag.totalAngle += Math.atan2(
      Math.sin(angle - drag.previousAngle),
      Math.cos(angle - drag.previousAngle),
    )
    drag.previousAngle = angle
    drag.tooth.group.quaternion
      .copy(drag.quaternion)
      .multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), drag.totalAngle))
  } else {
    const parent = drag.tooth.group.parent!
    const next = parent
      .localToWorld(drag.position.clone())
      .addScaledVector(drag.axis, point.sub(drag.start).dot(drag.axis))
    drag.tooth.group.position.copy(parent.worldToLocal(next))
  }
  changed()
  event.stopImmediatePropagation()
}
function pointerUp(event: PointerEvent) {
  if (sectionPointerStart) {
    const start = sectionPointerStart
    sectionPointerStart = undefined
    if (
      !busy.value &&
      analysisTool.value === 'section' &&
      event.type === 'pointerup' &&
      Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5
    ) {
      pointerRay(event)
      const hit = raycaster.intersectObjects(
        teeth.filter((t) => t.group.visible).map((t) => t.crown),
        false,
      )[0]
      const tooth = hit && teeth.find((t) => t.crown === hit.object)
      if (tooth) {
        if (jaw.value !== tooth.jaw) {
          jaw.value = tooth.jaw
          list.value = teeth
            .filter((t) => t.jaw === tooth.jaw)
            .map((t) => t.id)
            .sort((a, b) => a - b)
        }
        select(tooth.id)
      }
    }
  }
  if (!drag) return
  if (event.type === 'pointercancel') {
    drag.tooth.group.position.copy(drag.position)
    drag.tooth.group.quaternion.copy(drag.quaternion)
    changed()
  }
  drag = undefined
  controls.enabled = !busy.value
  if (renderer.domElement.hasPointerCapture(event.pointerId))
    renderer.domElement.releasePointerCapture(event.pointerId)
}

// 第 5 步：明确点击才写数据；导出完整文件也可离线检验，不上传拖动增量。
function download() {
  try {
    const bytes = saveCurrentDocument(),
      blob = new Blob([new Uint8Array(bytes).buffer], { type: 'application/octet-stream' })
    const link = document.createElement('a'),
      objectUrl = URL.createObjectURL(blob)
    link.href = objectUrl
    link.download = 'teeth-edited.msgpack'
    link.click()
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
    status.value = '已导出完整 MessagePack；上传状态仍保留'
  } catch (error) {
    status.value = message(error)
  }
}
function upload() {
  void run(async () => {
    // 默认契约仅为演示适配器，真实项目在这里接入已有接口 client。
    const base = apiBase.value.replace(/\/$/, '')
    if (!base || !caseId.value) throw new Error('请填写接口基础地址与病例 ID')
    async function post(name: string, data: Record<string, unknown>) {
      const res = await fetch(`${base}/${name}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId: caseId.value, ...data }),
      })
      if (!res.ok) throw new Error(`${name} HTTP ${res.status}`)
      const json = await res.json()
      if (json.success === false || (json.code != null && json.code !== 0 && json.code !== 200))
        throw new Error(`${name} 业务失败：${json.message ?? json.code}`)
      return json.data ?? json
    }
    const api: SaveApi = {
      getUpdateEditVersion: async () => {
        status.value = '获取编辑版本…'
        const v = await post('getUpdateEditVersion', {})
        if (typeof v.version !== 'string' && typeof v.version !== 'number')
          throw new Error('版本接口需返回 {version}')
        return v.version
      },
      getUploadPath: async (version) => {
        status.value = '获取 OSS 地址…'
        const p = await post('getUploadPath', { version })
        if (typeof p.url !== 'string' || typeof p.key !== 'string')
          throw new Error('地址接口需返回 {url,key,headers?}')
        status.value = 'PUT 完整数据…'
        return p
      },
      update: async (data) => {
        status.value = '提交更新…'
        await post('update', data)
      },
    }
    const bytes = saveCurrentDocument()
    await uploadDocument(bytes, api)
    // 编码时的快照才是提交成功版本，不因接口失败清除内存操作。
    source = parseDocument(bytes)
    dirty.value = false
    status.value = '完整数据上传并提交成功'
  })
}

onMounted(() => {
  renderer = new T.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.autoClear = false
  viewport.value!.appendChild(renderer.domElement)
  scene = new T.Scene()
  scene.background = new T.Color('#111b27')
  overlay = new T.Scene()
  scene.add(models)
  scene.add(collisionMarkers)
  scene.add(analysisMarkers)
  camera = new T.PerspectiveCamera(42, 1, 0.1, 2000)
  camera.up.set(0, 0, 1)
  scene.add(new T.HemisphereLight('#fff4ef', '#576379', 2.6))
  const light = new T.DirectionalLight('#ffffff', 3)
  light.position.set(20, -40, 80)
  scene.add(light)
  draco = new DRACOLoader().setDecoderPath('/draco/')
  buildGizmo()
  // capture 回调先处理手柄，防止 OrbitControls 同时开始旋转相机。
  const canvas = renderer.domElement
  canvas.addEventListener('pointerdown', pointerDown, true)
  canvas.addEventListener('pointermove', pointerMove, true)
  canvas.addEventListener('pointerup', pointerUp, true)
  canvas.addEventListener('pointercancel', pointerUp, true)
  canvas.addEventListener('lostpointercapture', pointerUp, true)
  controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  resize = new ResizeObserver(() => {
    const w = viewport.value!.clientWidth,
      h = viewport.value!.clientHeight
    renderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  })
  resize.observe(viewport.value!)
  function tick() {
    frame = requestAnimationFrame(tick)
    controls.update()
    renderer.clear()
    renderer.render(scene, camera)
    renderer.clearDepth()
    renderer.render(overlay, camera)
  }
  tick()
  loadDemo()
})
onBeforeUnmount(() => {
  collisionRun++
  clearCollision()
  clearAnalysisMarkers()
  disposed = true
  cancelAnimationFrame(frame)
  resize?.disconnect()
  controls?.dispose()
  draco?.dispose()
  const canvas = renderer?.domElement
  canvas?.removeEventListener('pointerdown', pointerDown, true)
  canvas?.removeEventListener('pointermove', pointerMove, true)
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'])
    canvas?.removeEventListener(name, pointerUp as EventListener, true)
  disposeGroup(models)
  disposeGroup(gizmo)
  renderer?.dispose()
  canvas?.remove()
})
</script>

<template>
  <main class="root-editor">
    <header>
      <div>
        <span class="eyebrow">DENTAL / 3D WORKSPACE</span>
        <h1>牙齿模型 · 数据与图层查看</h1>
      </div>
      <span class="badge" :class="{ edited: dirty }">{{ dirty ? '未保存操作' : '就绪' }}</span>
    </header>
    <nav class="clinical-tools" aria-label="模型工具">
      <button :class="{ active: wireframe }" :disabled="busy" @click="toggleWireframe">
        <span class="tool-icon" aria-hidden="true">▦</span>网格
      </button>
      <button
        :class="{ active: collisionMode }"
        :aria-pressed="collisionMode"
        :disabled="busy"
        @click="toggleCollision"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 4h16v5l-4 2-4-2-4 2-4-2V4Zm0 16h16v-5l-4-2-4 2-4-2-4 2v5Z" />
        </svg>
        咬合碰撞
      </button>
      <button
        :class="{ active: jumpPanel }"
        :aria-pressed="jumpPanel"
        :disabled="busy || !hasBothJaws"
        @click="toggleJump"
      >
        <span class="tool-icon" aria-hidden="true">⇄</span>咬合跳跃
      </button>
      <button :class="{ active: showAxes }" :disabled="busy" @click="toggleLayer('axes')">
        <span class="tool-icon" aria-hidden="true">⊥</span>牙轴
      </button>
      <button
        :class="{ active: analysisTool === 'gaps' }"
        :disabled="busy"
        @click="toggleAnalysis('gaps')"
      >
        <span class="tool-icon" aria-hidden="true">↔</span>邻牙间隙
      </button>
      <button
        :class="{ active: analysisTool === 'distance' }"
        :disabled="busy"
        @click="toggleAnalysis('distance')"
      >
        <span class="tool-icon" aria-hidden="true">⌁</span>测距
      </button>
      <button
        :class="{ active: analysisTool === 'section' }"
        :disabled="busy"
        @click="toggleAnalysis('section')"
      >
        <span class="tool-icon" aria-hidden="true">⊟</span>咬合截面
      </button>
      <button :class="{ active: showLandmarks }" :disabled="busy" @click="toggleLayer('landmarks')">
        <span class="tool-icon" aria-hidden="true">⌖</span>牙尖关键点
      </button>
      <button
        :class="{ active: showBoundaries }"
        :disabled="busy"
        @click="toggleLayer('boundaries')"
      >
        <span class="tool-icon" aria-hidden="true">◌</span>牙颈边界
      </button>
      <button
        :class="{ active: showGums }"
        :disabled="busy || showAxes"
        @click="toggleLayer('gums')"
      >
        <span class="tool-icon" aria-hidden="true">∩</span>牙龈
      </button>
      <button
        :class="{ active: showRoots }"
        :disabled="busy || showAxes"
        @click="toggleLayer('roots')"
      >
        <span class="tool-icon" aria-hidden="true">♧</span>牙根
      </button>
    </nav>
    <div class="layout">
      <aside>
        <div class="section-title">五步实现 <span>01 — 05</span></div>
        <button
          v-for="(item, i) in steps"
          :key="i"
          class="step"
          :class="{ active: step === i + 1 }"
          @click="step = i + 1"
        >
          <span class="step-number">0{{ i + 1 }}</span
          ><span>{{ item.title }}</span
          ><span>›</span>
        </button>
        <p class="step-info">{{ steps[step - 1]?.text }}</p>
        <div class="divider"></div>
        <h2>数据源</h2>
        <p class="subtle">
          {{
            isDemo
              ? '内置牙冠为示意形状；导入口扫数据后显示真实牙冠。'
              : '导入数据优先使用原始单牙坐标系与牙颈边界。'
          }}
        </p>
        <label
          >网格格式<select v-model="format" :disabled="busy">
            <option value="auto">自动识别 Draco / float32</option>
            <option value="float32">显式 float32 XYZ 小端序</option>
          </select></label
        >
        <label
          >标签对应<select v-model="mode" :disabled="busy">
            <option value="auto">自动检测（歧义时报错）</option>
            <option value="vertex">逐顶点</option>
            <option value="face">逐三角面</option>
          </select></label
        >
        <label
          >备用下颌根方向<select v-model="rootDirection" :disabled="busy">
            <option v-for="d in ['-Z', '+Z', '-Y', '+Y', '-X', '+X']" :key="d">{{ d }}</option>
          </select></label
        >
        <label class="file-button"
          >选择本地 msgpack / hex<input
            type="file"
            aria-label="选择本地 msgpack 或 hex"
            accept=".msgpack,.mpk,.bin,.txt,.hex"
            :disabled="busy"
            @change="loadFile"
        /></label>
        <div class="url-row">
          <input v-model="url" aria-label="数据 URL" :disabled="busy" /><button
            :disabled="busy"
            @click="loadUrl"
          >
            加载 URL
          </button>
        </div>
        <div class="button-row">
          <button :disabled="busy" @click="loadDemo">恢复演示数据</button
          ><button :disabled="busy" @click="showHex = !showHex">粘贴 hex</button>
        </div>
        <div v-if="showHex">
          <textarea
            v-model="hex"
            aria-label="hex 文本"
            placeholder="粘贴 MessagePack hex…"
          ></textarea
          ><button :disabled="busy || !hex" @click="loadHex">解析 hex</button>
        </div>
        <details>
          <summary>牙根模板与接口设置</summary>
          <label>模板目录<input v-model="templateFolder" :disabled="busy" /></label>
          <p class="subtle">
            目录内需有 31.obj 等牙位模板；修改目录后重新加载数据。PLY 可在已保存的 root.template
            字段指定。
          </p>
          <label
            >接口基础地址<input
              v-model="apiBase"
              placeholder="https://api.example.com/edit"
              :disabled="busy" /></label
          ><label>病例 ID<input v-model="caseId" placeholder="caseId" :disabled="busy" /></label>
          <p class="subtle">JSON POST 适配器需匹配真实后端契约。演示数据仅支持本地导出。</p>
        </details>
      </aside>
      <section class="workspace">
        <section v-if="jumpPanel" class="collision-panel jump-panel" aria-label="咬合跳跃设计">
          <div class="jump-header">
            <div>
              <strong>咬合跳跃</strong>
              <p class="subtle">整体调整下颌，牙冠、牙根与牙龈同步移动。</p>
            </div>
            <div class="segmented" aria-label="咬合姿态对比">
              <button
                :class="{ chosen: !jumpPreview }"
                :aria-pressed="!jumpPreview"
                :disabled="busy"
                @click="compareJump(false)"
              >
                原始
              </button>
              <button
                :class="{ chosen: jumpPreview }"
                :aria-pressed="jumpPreview"
                :disabled="busy"
                @click="compareJump(true)"
              >
                调整后
              </button>
            </div>
            <button :disabled="busy || !hasBothJaws" @click="resetJump">一键复位</button>
          </div>
          <fieldset class="jump-controls" :disabled="busy || !hasBothJaws">
            <div v-for="control in jumpControls" :key="control.key" class="jump-control">
              <div class="jump-control-title">
                <strong>{{ control.label }}</strong
                ><small>{{ control.help }}</small>
              </div>
              <div class="jump-inputs">
                <input
                  type="range"
                  :aria-label="`${control.label}滑块`"
                  :min="control.min"
                  :max="control.max"
                  step="0.1"
                  :value="jumpParameters[control.key]"
                  @input="changeJump(control.key, $event)"
                />
                <input
                  type="number"
                  :aria-label="`${control.label}数值`"
                  :min="control.min"
                  :max="control.max"
                  step="0.1"
                  :value="jumpParameters[control.key]"
                  @change="changeJump(control.key, $event)"
                />
              </div>
              <small class="subtle"
                >{{ control.min }} ～ {{ control.max }} {{ control.unit }}</small
              >
            </div>
          </fieldset>
          <p v-if="jumpError" class="jump-error" role="alert">{{ jumpError }}</p>
          <p v-if="!hasBothJaws" class="jump-error">需要同时加载上颌和下颌牙齿后才能调整。</p>
          <p class="subtle jump-note">
            {{
              jumpPreview ? '当前显示调整后姿态' : '当前对比原始姿态（保留单牙编辑）'
            }}；碰撞检测以当前显示姿态为准，调整后需重新检测。 位移采用模型单位，仅当模型单位为 mm
            时表示毫米。方向根据原始下颌牙轴与牙弓估算，张口绕磨牙区域估算转轴旋转。
            导出／上传保存调整参数，原始对比不撤销参数；关闭面板保留当前姿态。
          </p>
        </section>
        <section v-if="analysisTool" class="collision-panel analysis-panel" aria-label="模型测量">
          <div class="collision-controls">
            <strong>{{
              analysisTool === 'gaps'
                ? '邻牙间隙'
                : analysisTool === 'distance'
                  ? '两点测距'
                  : '咬合截面'
            }}</strong>
            <button v-if="analysisTool === 'gaps'" :disabled="busy" @click="calculateGaps">
              重新计算间隙
            </button>
            <button v-if="analysisTool === 'distance'" :disabled="busy" @click="invalidateAnalysis">
              清除测量点
            </button>
            <template v-if="analysisTool === 'section'">
              <label class="inline"
                >截面方向<select
                  v-model="sectionAxis"
                  aria-label="截面方向"
                  :disabled="busy"
                  @change="updateSection(true)"
                >
                  <option value="tooth">跟随牙位</option>
                  <option>X</option>
                  <option>Y</option>
                  <option>Z</option>
                </select></label
              >
              <label class="inline"
                >切片偏移<input
                  v-model.number="sectionOffset"
                  aria-label="截面位置"
                  type="number"
                  step="0.1"
                  :disabled="busy"
                  @change="updateSection(false)"
              /></label>
              <button :disabled="busy" @click="updateSection(false)">更新截面</button>
            </template>
            <button :disabled="busy" @click="closeAnalysis">关闭测量工具</button>
          </div>
          <p class="collision-status" aria-live="polite">{{ analysisStatus }}</p>
          <p v-if="analysisTool === 'gaps'" class="subtle">
            按 FDI 牙位计算当前颌位相邻牙冠的最近表面间距，不跨缺牙位。0
            表示接触或表面相交，不代表负间隙或穿透深度；这不是指定近远中点之间的测量。
          </p>
          <div v-if="analysisTool === 'gaps'" class="contact-results">
            <button
              v-for="gap in gapResults"
              :key="`${gap.first}-${gap.second}`"
              :disabled="busy"
              @click="select(gap.first)"
            >
              {{ gap.first }} / {{ gap.second }}：{{ gap.distance.toFixed(3) }}
            </button>
          </div>
          <template v-if="analysisTool === 'distance'">
            <p class="subtle">
              按住 Shift 点击原牙冠表面取两点，黄色点线显示三维直线距离；再次取点开始新测量。
            </p>
            <p v-if="measureDistance !== null" class="measurement-value">
              距离 {{ measureDistance.toFixed(3) }} <small>模型单位</small>
            </p>
          </template>
          <template v-if="analysisTool === 'section'">
            <input
              v-model.number="sectionOffset"
              aria-label="截面滑块"
              type="range"
              :min="sectionRange.min"
              :max="sectionRange.max"
              step="0.1"
              :disabled="busy"
              @input="updateSection(false)"
            />
            <p class="subtle">
              牙位 {{ sectionTooth }} ·
              点击三维牙齿或下方牙号，半透明切片会移动到该牙位。模型保持完整；拖动空白处可旋转视角。上颌轮廓为橙色、下颌为青色。
            </p>
          </template>
          <p class="subtle">
            数值沿用模型单位，文件未提供可确认的毫米标定。牙齿姿态改变后会清除旧测量结果。
          </p>
        </section>
        <section v-if="collisionMode" class="collision-panel" aria-label="咬合碰撞检测">
          <div class="collision-controls">
            <strong>咬合碰撞</strong>
            <label class="inline"
              >近接触阈值<input
                v-model.number="collisionThreshold"
                aria-label="近接触阈值"
                type="number"
                min="0"
                step="0.05"
                :disabled="busy"
                @input="invalidateCollision"
            /></label>
            <span class="subtle">模型单位</span>
            <button :disabled="busy" @click="detectCollision">重新检测</button>
            <span class="contact-key red-key">● 表面相交</span
            ><span class="contact-key yellow-key">● 近接触</span>
          </div>
          <p class="collision-status" aria-live="polite">
            {{ collisionStatus }}<span v-if="busy"> · {{ collisionProgress }}%</span>
          </p>
          <p class="subtle">
            检测当前显示姿态的上下颌牙冠，包含咬合跳跃预览。红色覆盖相交三角面，黄色点线标记最近接触位置；距离为无符号表面间隙，不代表穿透深度。不额外应用文件中的其他咬合矩阵。
          </p>
          <div v-if="contacts.length && !collisionStale" class="contact-results">
            <button
              v-for="pair in contacts"
              :key="pair.key"
              class="contact-pair"
              :class="pair.kind"
              :disabled="busy"
              @click="focusContact(pair)"
            >
              上 {{ pair.upperId }} / 下 {{ pair.lowerId }} ·
              {{
                pair.kind === 'intersection'
                  ? `表面相交（${pair.upperFaces.length + pair.lowerFaces.length} 面）`
                  : `间隙 ${pair.distance.toFixed(3)}`
              }}
            </button>
          </div>
          <p v-else-if="!collisionStale && !busy" class="subtle">
            未发现表面相交或阈值范围内的近接触。
          </p>
        </section>
        <div class="toolbar">
          <div class="segmented">
            <button
              :class="{ chosen: jaw === 'lower' }"
              :disabled="busy"
              @click="switchJaw('lower')"
            >
              下颌</button
            ><button
              :class="{ chosen: jaw === 'upper' }"
              :disabled="busy"
              @click="switchJaw('upper')"
            >
              上颌
            </button>
          </div>
          <label class="inline"
            ><input
              v-model="showRoots"
              type="checkbox"
              :disabled="busy || showAxes"
              @change="toggleRoots"
            />显示牙根</label
          ><button :disabled="busy" @click="frameModel">重置视角</button>
        </div>
        <div class="view-tools" aria-label="模型视角">
          <button :disabled="busy" @click="setView('upper')">上颌面</button>
          <button :disabled="busy" @click="setView('left')">左侧</button>
          <button :disabled="busy" @click="setView('front')">正面</button>
          <button :disabled="busy" @click="setView('right')">右侧</button>
          <button :disabled="busy" @click="setView('lower')">下颌面</button>
        </div>
        <div class="layer-toolbar">
          <label class="inline"
            ><input
              v-model="showBoth"
              type="checkbox"
              :disabled="busy"
              @change="toggleBoth"
            />上下颌同屏</label
          >
          <label class="inline"
            ><input
              v-model="showGums"
              type="checkbox"
              :disabled="busy || showAxes"
              @change="updateLayers"
            />牙龈</label
          >
          <label class="inline"
            ><input
              v-model="showAxes"
              type="checkbox"
              :disabled="busy"
              @change="updateLayers"
            />全部牙轴</label
          >
          <label class="inline"
            ><input
              v-model="showBoundaries"
              type="checkbox"
              :disabled="busy"
              @change="updateLayers"
            />牙颈边界</label
          >
          <label class="inline"
            ><input
              v-model="showLandmarks"
              type="checkbox"
              :disabled="busy"
              @change="updateLayers"
            />关键点</label
          >
        </div>
        <p v-if="showAxes" class="subtle axis-mode-note">
          牙轴模式：半透明白色牙冠 · 牙龈与模拟牙根已隐藏 ·
          牙冠开放边显示封口。关闭牙轴后恢复原显示设置；无法自动封闭的边界会在下方提示。
        </p>
        <p class="subtle layer-help">
          牙轴：X 红 / Y 绿 / Z 蓝；牙颈：黄色。关键点：FA 粉 / FA slope 紫 / 牙尖 青 / 窝沟 橙 /
          内牙尖 绿 / 外牙尖
          蓝。图层仅在存在对应数据时显示；缺少原始边界或牙轴时使用几何估计。同屏时选择当前颌位牙齿。
        </p>
        <div ref="viewport" class="viewport">
          <div v-if="jumpAdjusted" class="jump-badge">
            咬合跳跃 · {{ jumpPreview ? '调整后' : '原始对比' }}
          </div>
          <div v-if="analysisTool === 'section'" class="section-inset" aria-label="咬合截面轮廓">
            <strong>牙号 {{ sectionTooth }}</strong>
            <svg
              :viewBox="sectionViewBox"
              role="img"
              aria-label="上下颌切面轮廓"
              preserveAspectRatio="xMidYMid meet"
            >
              <path
                v-for="contour in sectionPaths"
                :key="contour.jaw"
                :d="contour.path"
                fill="none"
                :stroke="contour.jaw === 'upper' ? '#d98650' : '#178995'"
                stroke-width="1.6"
                vector-effect="non-scaling-stroke"
              />
            </svg>
            <small>上颌 / 下颌截面</small>
          </div>
          <div class="viewport-label">
            <span class="live-dot"></span>{{ jaw === 'lower' ? 'MANDIBLE' : 'MAXILLA'
            }}<small>{{ list.length }} TEETH</small>
          </div>
          <div class="legend">
            <span class="pink-dot"></span>牙冠 <span class="root-dot"></span>模拟牙根
            <span class="red">X / 旋转</span><span class="blue">Z</span>
          </div>
          <div v-if="busy" class="loading">{{ status }}</div>
          <div class="gesture">
            {{ analysisTool === 'section' ? '点击牙齿移动切片' : 'Ctrl + 点击选择牙齿' }}
            <span>拖动轴平移 · 拖动红弧旋转 · 空白处旋转视角</span>
          </div>
        </div>
        <div class="bottom-panel">
          <div class="tooth-picker">
            <span>牙位</span
            ><button
              v-for="id in list"
              :key="id"
              :class="{ chosen: selectedId === id }"
              :disabled="busy"
              @click="select(id)"
            >
              {{ id }}
            </button>
          </div>
          <div v-if="pose" class="selection">
            <div>
              <h2>牙 {{ selectedId }} <span>局部坐标</span></h2>
              <p>位置 {{ pose.position }} · {{ pose.vertices }} 个源顶点</p>
              <small class="frame-details">{{ pose.frame }} · {{ pose.neck }}</small>
            </div>
            <label
              >牙根长度<input
                v-model.number="selectedLength"
                type="number"
                min="1"
                max="40"
                step="0.5"
                :disabled="busy || !hasRoot"
                @change="rebuildRoot" /></label
            ><button :disabled="busy" @click="nudge">沿 X +0.5</button
            ><button :disabled="busy" @click="rotate">绕 Z +5°</button
            ><button :disabled="busy" @click="reset">重置姿态</button>
          </div>
          <p v-else class="empty-selection">选中一颗牙，显示它的局部坐标系与参数。</p>
          <details v-if="pose" class="data-inspector">
            <summary>所选牙齿：姿态、牙根参数、原始坐标系与关键点</summary>
            <pre>{{ selectedInfo }}</pre>
          </details>
        </div>
        <section v-if="dataFields.length" class="bottom-panel data-inspector">
          <h2>MessagePack 数据（{{ dataFields.length }} 个顶层字段）</h2>
          <p class="subtle">
            展开查看原始字段与解码数值。小型 NumPy
            矩阵及点数组自动解码，大型网格和数组显示大小与预览，完整内容仍可在控制台查看。对齐及咬合矩阵仅展示，未额外应用变换。
          </p>
          <p class="subtle">
            牙龈使用 gum.gum，缺失时使用分割中的牙龈；当前牙冠来自 seg
            分割。teeth、seg_teeth、预处理网格等其他版本在下方展示结构。模拟牙根来自外部模板。
          </p>
          <details v-for="field in dataFields" :key="field.name">
            <summary>{{ field.name }}</summary>
            <pre>{{ field.text }}</pre>
          </details>
        </section>
        <footer>
          <p role="status">{{ status }}</p>
          <div>
            <button :disabled="busy || !list.length" @click="download">导出完整数据</button
            ><button
              class="primary"
              :disabled="busy || isDemo || !apiBase || !caseId"
              @click="upload"
            >
              保存并上传
            </button>
          </div>
        </footer>
        <details v-if="warnings.length" class="warnings">
          <summary>{{ warnings.length }} 条几何 / 模板提示</summary>
          <p v-for="(warning, i) in warnings" :key="i">{{ warning }}</p>
        </details>
      </section>
    </div>
  </main>
</template>

<style scoped>
.root-editor {
  min-height: 100vh;
  background: #f2f4f7;
  color: #233144;
  font-family: Inter, 'Microsoft YaHei', sans-serif;
  padding: 26px 32px;
  box-sizing: border-box;
}
.clinical-tools {
  display: flex;
  overflow-x: auto;
  background: #35383d;
  border-radius: 8px;
  margin-bottom: 20px;
  padding: 0 8px;
}
.clinical-tools button {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 76px;
  padding: 12px 14px;
  color: #c8ced5;
  border: 0;
  border-radius: 0;
  border-bottom: 3px solid transparent;
  background: transparent;
  white-space: nowrap;
}
.clinical-tools button:hover {
  background: #43484f;
}
.clinical-tools button.active {
  color: #66b4ff;
  background: #292e35;
  border-bottom-color: #4c9fff;
}
.clinical-tools svg {
  width: 23px;
  height: 23px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
}
.tool-icon {
  height: 23px;
  line-height: 23px;
  font-size: 24px;
}
.view-tools {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin: 8px 0;
  flex-wrap: wrap;
}
.collision-panel {
  padding: 14px 18px;
  background: #fff;
  border: 1px solid #d8e2ee;
  border-radius: 10px;
  margin-bottom: 14px;
}
.jump-panel {
  border-color: #b9cee4;
  background: linear-gradient(115deg, #f6faff, #fff 70%);
}
.jump-header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
.jump-header > div:first-child {
  flex: 1;
  min-width: 210px;
}
.jump-header p {
  margin: 5px 0 0;
}
.jump-header strong {
  font-size: 14px;
}
.jump-controls {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 18px;
  border: 0;
  margin: 18px 0 0;
  padding: 0;
  min-width: 0;
}
.jump-control {
  min-width: 0;
}
.jump-control-title {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
}
.jump-control-title small {
  color: #8390a0;
  font-weight: normal;
}
.jump-inputs {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 10px 0 5px;
}
.jump-inputs input {
  margin: 0;
}
.jump-inputs input[type='range'] {
  flex: 1;
  min-width: 0;
  padding: 0;
  accent-color: #416f9e;
}
.jump-inputs input[type='number'] {
  width: 76px;
  padding: 6px;
}
.jump-note {
  margin-bottom: 0;
}
.jump-error {
  color: #b63650;
  font-size: 12px;
}
.jump-badge {
  position: absolute;
  z-index: 2;
  right: 18px;
  bottom: 18px;
  padding: 7px 10px;
  border: 1px solid #7fa9d166;
  border-radius: 6px;
  color: #c5def5;
  background: #203b55dd;
  font-size: 11px;
  pointer-events: none;
}
.collision-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 12px;
}
.collision-controls input {
  width: 80px;
  margin: 0;
}
.collision-status {
  font-size: 12px;
  color: #37597c;
  margin: 12px 0 6px;
}
.red-key {
  color: #d93d57;
}
.yellow-key {
  color: #a87916;
}
.contact-results {
  max-height: 140px;
  overflow: auto;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.contact-pair.intersection {
  background: #fff1f3;
  color: #b63650;
  border-color: #efb9c3;
}
.contact-pair.near {
  background: #fff8df;
  color: #826215;
  border-color: #e8d69c;
}
.analysis-panel select {
  width: 60px;
  margin: 0;
}
.analysis-panel input[type='checkbox'] {
  width: auto;
}
.analysis-panel select {
  width: auto;
  min-width: 100px;
}
.section-inset {
  position: absolute;
  z-index: 2;
  left: 16px;
  top: 64px;
  width: 185px;
  padding: 12px;
  border-radius: 10px;
  background: #ffffffed;
  color: #4c6076;
  pointer-events: none;
  box-shadow: 0 3px 14px #0002;
}
.section-inset strong {
  font-size: 12px;
}
.section-inset svg {
  display: block;
  width: 100%;
  height: 155px;
  margin: 8px 0;
}
.section-inset small {
  display: block;
  font-size: 10px;
  color: #8491a0;
}
.measurement-value {
  font-size: 22px;
  color: #315a85;
  margin: 12px 0;
}
.measurement-value small {
  font-size: 11px;
  color: #8391a2;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 22px;
}
.eyebrow {
  font-size: 10px;
  letter-spacing: 2px;
  color: #8995a4;
}
h1 {
  font-size: 24px;
  font-weight: 600;
  margin: 7px 0;
}
h2 {
  font-size: 14px;
  margin: 0 0 12px;
}
.badge {
  font-size: 12px;
  background: #e4ece6;
  color: #52735b;
  border-radius: 18px;
  padding: 8px 14px;
}
.badge.edited {
  background: #f9ead9;
  color: #946b39;
}
.layout {
  display: grid;
  grid-template-columns: 282px minmax(0, 1fr);
  gap: 22px;
}
aside {
  background: white;
  border: 1px solid #e3e7ed;
  border-radius: 12px;
  padding: 20px;
  align-self: start;
}
.section-title {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 14px;
  display: flex;
  justify-content: space-between;
}
.section-title span {
  color: #a4acb8;
  font-size: 10px;
}
.step {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  border: 0;
  background: transparent;
  text-align: left;
  margin-bottom: 5px;
  padding: 12px 10px;
  font-size: 12px;
}
.step span:last-child {
  margin-left: auto;
}
.step.active {
  background: #edf2f8;
  color: #315a85;
}
.step-number {
  color: #9aa9ba;
  font-size: 11px;
}
.step-info,
.subtle {
  font-size: 11px;
  line-height: 1.85;
  color: #8390a0;
}
.step-info {
  min-height: 78px;
}
.divider {
  height: 1px;
  background: #e8ebf0;
  margin: 18px 0;
}
label {
  display: block;
  font-size: 11px;
  color: #6e7d8e;
  margin: 12px 0;
}
input,
select,
textarea {
  box-sizing: border-box;
  border: 1px solid #dce2ea;
  border-radius: 6px;
  padding: 8px 10px;
  background: #fff;
  color: #35465b;
  width: 100%;
  font: inherit;
  margin-top: 6px;
}
textarea {
  height: 95px;
  resize: vertical;
}
button {
  border: 1px solid #dce2ea;
  border-radius: 6px;
  padding: 8px 12px;
  background: white;
  color: #52667e;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
button:hover {
  background: #eef3f8;
}
button:disabled {
  opacity: 0.45;
  cursor: default;
}
.file-button {
  border: 1px dashed #c7d1dd;
  text-align: center;
  padding: 12px;
  border-radius: 6px;
  cursor: pointer;
  color: #416185;
}
.file-button input {
  max-width: 100%;
  font-size: 10px;
}
.url-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.url-row input {
  min-width: 0;
  margin: 0;
}
.url-row button {
  white-space: nowrap;
}
.button-row {
  display: flex;
  gap: 6px;
  margin-top: 10px;
}
details {
  font-size: 11px;
  color: #75869a;
  margin-top: 20px;
}
summary {
  cursor: pointer;
}
.workspace {
  min-width: 0;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 12px;
}
.toolbar > button {
  margin-left: auto;
}
.layer-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  padding: 10px 0;
}
.layer-help {
  margin: 0 0 12px;
}
.data-inspector pre {
  max-height: 360px;
  overflow: auto;
  padding: 12px;
  background: #f4f6f9;
  color: #35465b;
  font-size: 11px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.segmented {
  display: flex;
  gap: 3px;
  padding: 3px;
  background: #e5eaf0;
  border-radius: 8px;
}
.segmented button {
  border: 0;
  background: transparent;
  padding: 7px 22px;
}
.segmented .chosen {
  background: #fff;
  color: #2d4e72;
  box-shadow: 0 1px 4px #273a4c12;
}
.inline {
  display: flex;
  align-items: center;
  margin: 0;
  gap: 6px;
}
.inline input {
  width: auto;
  margin: 0;
}
.viewport {
  height: clamp(410px, 60vh, 690px);
  position: relative;
  overflow: hidden;
  border-radius: 12px;
  background: #111b27;
}
.viewport :deep(canvas) {
  display: block;
  touch-action: none;
}
.viewport-label {
  position: absolute;
  left: 22px;
  top: 20px;
  font-size: 10px;
  letter-spacing: 2px;
  color: #bdc9d5;
  pointer-events: none;
}
.viewport-label small {
  display: block;
  color: #718399;
  letter-spacing: 1px;
  margin: 8px 0 0 17px;
}
.live-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  background: #9bb9a0;
  border-radius: 50%;
  margin-right: 10px;
}
.legend {
  position: absolute;
  right: 20px;
  top: 22px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 10px;
  color: #889baf;
  pointer-events: none;
}
.pink-dot,
.root-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
  background: #e7a1ae;
}
.root-dot {
  background: #899c8b;
  margin-left: 9px;
}
.red {
  color: #e85a69;
  margin-left: 10px;
}
.blue {
  color: #599cff;
  margin-left: 6px;
}
.gesture {
  position: absolute;
  bottom: 20px;
  left: 22px;
  font-size: 11px;
  color: #c2cedb;
  pointer-events: none;
}
.gesture span {
  display: block;
  font-size: 10px;
  color: #6e859d;
  margin-top: 7px;
}
.loading {
  position: absolute;
  inset: 0;
  background: #111b2780;
  display: grid;
  place-items: center;
  color: white;
  font-size: 13px;
}
.bottom-panel {
  background: white;
  border: 1px solid #e0e5ec;
  border-radius: 10px;
  margin-top: 14px;
  padding: 17px 20px;
}
.tooth-picker {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.tooth-picker > span {
  font-size: 11px;
  color: #95a1af;
  margin-right: 8px;
}
.tooth-picker button {
  padding: 7px 10px;
  font-size: 11px;
}
.tooth-picker .chosen {
  border-color: #e7a1ae;
  background: #fdf0f3;
  color: #a65970;
}
.selection {
  display: flex;
  align-items: center;
  gap: 8px;
  border-top: 1px solid #edf0f4;
  margin-top: 14px;
  padding-top: 12px;
  flex-wrap: wrap;
}
.selection > div {
  flex: 1;
  min-width: 220px;
}
.selection h2 {
  margin: 0;
  font-size: 13px;
}
.selection h2 span {
  font-size: 10px;
  color: #98a5b4;
  margin-left: 8px;
}
.selection p {
  font-size: 11px;
  color: #8391a2;
  margin: 7px 0 0;
}
.selection label {
  width: 80px;
  margin: 0 8px;
}
.selection input {
  padding: 6px;
}
.empty-selection {
  font-size: 11px;
  color: #95a1af;
  margin: 18px 0 0;
}
footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 16px;
}
footer p {
  font-size: 11px;
  color: #738399;
  margin: 0;
}
footer > div {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.primary {
  background: #345977;
  color: white;
  border-color: #345977;
}
.primary:hover {
  background: #416886;
}
.warnings {
  padding: 12px;
  background: #fff7e9;
  border-radius: 8px;
  line-height: 1.6;
}
@media (max-width: 1050px) {
  .root-editor {
    padding: 20px;
  }
  .layout {
    grid-template-columns: 240px minmax(0, 1fr);
    gap: 14px;
  }
  .legend {
    display: none;
  }
}
@media (max-width: 760px) {
  .layout {
    grid-template-columns: 1fr;
  }
  aside {
    max-height: 360px;
    overflow: auto;
  }
  .viewport {
    height: 440px;
  }
  footer {
    align-items: flex-start;
    flex-direction: column;
  }
  h1 {
    font-size: 20px;
  }
}
</style>
