# 基于种子的牙齿 Graph Cut 分割 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 `toothSegmentationTest` 页面中加入“冠面圈选种子 → 粉色种子预览 → 局部几何 Graph Cut 自动生成牙龈边界 → 表面吸附拖拽编辑 → 确认后生成独立牙齿 Mesh 和原格式标签 JSON”的完整工作流。

**Architecture:** 保留现有 STL/BVH 加载、相机交互和局部表面路径能力，把页面权威状态收敛为 `Map<number, ToothSegmentationState>`。主线程缓存每个颌的网格拓扑和几何特征，负责屏幕圈选、ROI、边界提取和 Three.js 派生视图；模块 Worker 只执行确定性的二元最大流/最小割。拖拽只更新命中的控制点及相邻两段表面路径，确认操作才分类三角面、检查重叠并构建独立 Mesh。

**Tech Stack:** Vue 3、TypeScript 5.9、Three.js 0.181、three-mesh-bvh、Vite 7、Web Worker、Playwright Test、ESLint。

**Spec:** `docs/superpowers/specs/2026-09-03-seeded-tooth-graph-cut-design.md`

## Global Constraints

- 原始上、下颌 STL 均继续从 `allStl` 页面现有资源加载，不改变数据源和路由。
- 原始标签仅用于推断 `toothId`；Graph Cut 的 unary、pairwise、ROI 和最终边界不得读取原始牙位标签。
- BVH、面邻接、面中心、法向和几何特征均在模型加载后建立并缓存；不得在 `pointermove` 中重建。
- `pointermove` 只允许：BVH 最近命中、更新一个控制点、重算相邻两条表面路径、更新 Boundary Points/Curve 的 Three.js 属性。
- `pointermove` 不得修改 STL `BufferGeometry`、执行 Graph Cut、重新分类全部三角面或重建原始 Mesh。
- 一切 Graph Cut 结果带递增 `jobId`；页面只接受与当前牙位最新任务一致的返回值。
- 确认分牙必须先完整检查区域重叠；失败时标签和独立 Mesh 都不得发生部分更新。
- 页面可视颜色固定为：画笔紫色、种子粉色、当前边界白线/绿色圆点、非当前边界绿线/蓝色圆点、确认区域半透明绿色。
- 测试命令使用项目随 Codex 提供的 Node 运行时，避免系统 Node 20 与 Vite 7 的版本冲突：
  `& 'C:\Users\Lenovo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\node_modules\@playwright\test\cli.js test ... --project=chromium --reporter=line`
- 每个任务只提交该任务列出的文件；不得带入工作区中已有的无关改动。

---

### Task 1: 建立统一分牙状态模型和纯状态转换

**Files:**
- Create: `src/page/toothSegmentationTest/utils/toothSegmentationState.ts`
- Test: `tests/toothSegmentationState.spec.ts`

- [ ] **Step 1: 写失败测试，固定状态结构和转换规则**

测试必须覆盖：创建 `seeded` 状态、设置边界后转为 `boundary-ready`、确认后保存排序后的 `triangleIndices`、拖动已确认边界后清空三角面并退回 `boundary-ready`、用 `jaw:toothId` 生成稳定键。

```ts
import { expect, test } from '@playwright/test'
import {
  createSeededState,
  markBoundaryReady,
  markBoundaryEdited,
  markConfirmed,
  segmentationKey,
} from '../src/page/toothSegmentationTest/utils/toothSegmentationState'

test('editing a confirmed boundary invalidates only its confirmed triangles', () => {
  const seeded = createSeededState(11, 'upper', [7, 3, 7])
  const ready = markBoundaryReady(seeded, boundary)
  const confirmed = markConfirmed(ready, [9, 2, 4])
  expect(markBoundaryEdited(confirmed, boundary)).toMatchObject({
    status: 'boundary-ready',
    triangleIndices: [],
  })
  expect(segmentationKey('upper', 11)).toBe('upper:11')
})
```

- [ ] **Step 2: 运行测试并确认因模块不存在而失败**

Run:
`& 'C:\Users\Lenovo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\node_modules\@playwright\test\cli.js test "toothSegmentationState" --project=chromium --reporter=line`

Expected: FAIL，提示无法解析 `toothSegmentationState`。

- [ ] **Step 3: 实现最小状态模型**

```ts
export type JawType = 'upper' | 'lower'
export type ToothSegmentationStatus = 'seeded' | 'boundary-ready' | 'confirmed'

export type ToothSegmentationState = {
  toothId: number
  jaw: JawType
  seedFaceIndices: number[]
  boundary: ToothBoundary | null
  triangleIndices: number[]
  status: ToothSegmentationStatus
}
```

所有转换返回新对象；面索引去重并升序；`seeded` 不允许带 boundary，`confirmed` 必须有 boundary 且三角面非空。

- [ ] **Step 4: 运行测试并确认通过**

Run: Task 1 Step 2 的命令。

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add src/page/toothSegmentationTest/utils/toothSegmentationState.ts tests/toothSegmentationState.spec.ts
git commit -m "feat: add tooth segmentation state model"
```

### Task 2: 实现闭合笔迹到 STL 种子面的 BVH 采样

**Files:**
- Create: `src/page/toothSegmentationTest/utils/seedSelectionUtils.ts`
- Test: `tests/seedSelectionUtils.spec.ts`
- Reference: `src/page/toothSegmentationTest/utils/bvhRaycastUtils.ts`

- [ ] **Step 1: 写失败测试，覆盖屏幕多边形采样和连通分量过滤**

测试一个凹多边形，断言采样包含描边点和内部 6 CSS px 网格点；构造两个断开的三角面簇，断言 `keepLargestFaceComponent` 只保留最大簇，数量相同则选择最小面索引所在簇；混合上下颌命中时只保留第一个有效命中的颌。

```ts
export type ScreenPoint = { x: number; y: number }
export type SeedRayHit = { jaw: JawType; faceIndex: number }

export function sampleClosedScreenPolygon(
  stroke: ScreenPoint[],
  spacing = 6,
): ScreenPoint[]

export function collectSeedFaces(
  samples: ScreenPoint[],
  raycast: (point: ScreenPoint) => SeedRayHit | null,
  faceNeighbors: readonly (readonly number[])[],
): { jaw: JawType; faceIndices: number[] }
```

- [ ] **Step 2: 运行测试并确认失败**

Run:
`& 'C:\Users\Lenovo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\node_modules\@playwright\test\cli.js test "seedSelectionUtils" --project=chromium --reporter=line`

Expected: FAIL，提示模块不存在。

- [ ] **Step 3: 实现纯采样与选择函数**

使用偶奇规则判断网格点是否位于闭合多边形内；保留原始 stroke 点；对所有采样点调用注入的 BVH raycast；第一个命中确定 jaw；面索引去重后按面邻接 BFS，只返回最大连通分量。

- [ ] **Step 4: 运行测试并确认通过**

Run: Task 2 Step 2 的命令。

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add src/page/toothSegmentationTest/utils/seedSelectionUtils.ts tests/seedSelectionUtils.spec.ts
git commit -m "feat: sample tooth seed faces from screen stroke"
```

### Task 3: 构建并缓存 Graph Cut 拓扑、ROI 和几何代价

**Files:**
- Create: `src/page/toothSegmentationTest/utils/toothGraphCutUtils.ts`
- Test: `tests/toothGraphCutUtils.spec.ts`
- Modify: `src/page/toothSegmentationTest/utils/toothRegionClassifier.ts`
- Test: `tests/toothRegionClassifier.spec.ts`

- [ ] **Step 1: 写失败测试，固定拓扑与 ROI 边界行为**

用小型折面网格测试：共享边产生双向面邻接；法向、面中心、面积、共享边长、signed dihedral 和曲率差均为有限值；种子直径按面中心最大距离计算；ROI 按测地距离限制在 `3 * seedDiameter`；超过 40,000 面时返回明确错误而不是截断后继续。

```ts
export type ToothGraphTopology = {
  faceCenters: Float32Array
  faceNormals: Float32Array
  faceAreas: Float32Array
  neighborOffsets: Uint32Array
  neighborFaces: Uint32Array
  sharedEdgeLengths: Float32Array
  signedDihedrals: Float32Array
  curvatureDiffs: Float32Array
}

export type ToothGraphCutRoi = {
  faceIndices: Uint32Array
  foregroundMask: Uint8Array
  backgroundMask: Uint8Array
  seedDiameter: number
}

export function buildToothGraphTopology(
  geometry: THREE.BufferGeometry,
): ToothGraphTopology

export function buildToothGraphCutRoi(
  topology: ToothGraphTopology,
  seedFaceIndices: readonly number[],
  backgroundFaceIndices: readonly number[],
  options?: { radiusScale?: number; maxFaces?: number },
): ToothGraphCutRoi
```

- [ ] **Step 2: 写失败测试，固定 robust normalization 和容量数组**

测试 median/MAD；MAD 为 0 时除数固定为 1；默认权重必须精确为 `2.5/3.0/1.5/2.0/1.0/0.75`；生成的 unary/pairwise capacity 均有限且非负；输入顺序变化不改变按全局面索引排序后的结果。

```ts
export const graphCutWeights = {
  normalAngle: 2.5,
  concavity: 3.0,
  curvature: 1.5,
  geodesic: 2.0,
  foregroundNormal: 1.0,
  relativeHeight: 0.75,
} as const

export type GraphCutProblem = {
  roiFaceIndices: Uint32Array
  edgeFrom: Uint32Array
  edgeTo: Uint32Array
  edgeCapacity: Float32Array
  sourceCapacity: Float32Array
  sinkCapacity: Float32Array
  foregroundMask: Uint8Array
  backgroundMask: Uint8Array
}
```

- [ ] **Step 3: 运行测试并确认失败**

Run:
`& 'C:\Users\Lenovo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\node_modules\@playwright\test\cli.js test "toothGraphCutUtils|toothRegionClassifier" --project=chromium --reporter=line`

Expected: FAIL，新模块缺失或新增断言失败。

- [ ] **Step 4: 实现拓扑缓存所需的纯计算**

在新模块中计算 TypedArray 拓扑和特征；用 Dijkstra 计算 ROI 测地距离；背景种子由调用方提供但必须同时包含屏幕环命中和 ROI 外圈；前景或背景少于 3 个有效面时抛出中文错误。复用 `toothRegionClassifier.ts` 的边键/面邻接思想，导出公共拓扑所需信息，避免页面为同一 geometry 重复构图。

- [ ] **Step 5: 实现 Graph Cut 容量构造**

pairwise 仅由 normal angle、signed concavity、curvature difference、shared edge length 构成；unary 仅由前景/背景测地距离、前景中位法向差、相对高度构成。对各特征使用 median/MAD 归一化，最后转换为非负有限容量；硬种子容量设为所有有限容量总和加 1，确保不可被普通边代价切断。

- [ ] **Step 6: 运行测试并确认通过**

Run: Task 3 Step 3 的命令。

Expected: PASS。

- [ ] **Step 7: 提交**

```powershell
git add src/page/toothSegmentationTest/utils/toothGraphCutUtils.ts src/page/toothSegmentationTest/utils/toothRegionClassifier.ts tests/toothGraphCutUtils.spec.ts tests/toothRegionClassifier.spec.ts
git commit -m "feat: build tooth graph cut geometry problem"
```

### Task 4: 实现确定性最大流 Worker 和过期任务保护

**Files:**
- Create: `src/page/toothSegmentationTest/workers/toothGraphCut.worker.ts`
- Create: `src/page/toothSegmentationTest/utils/toothGraphCutWorkerClient.ts`
- Test: `tests/toothGraphCutWorker.spec.ts`

- [ ] **Step 1: 写失败测试，固定 min-cut 结果和消息协议**

将最大流核心导出为可直接测试的函数。覆盖单路径、双路径、硬前景/背景、相同容量 tie 按 local face index 升序处理；客户端测试模拟 Worker，断言 transfer list 包含所有 TypedArray buffer，且较旧 `jobId` 的返回值被标记为 stale。

```ts
export type GraphCutWorkerRequest = GraphCutProblem & { jobId: number }
export type GraphCutWorkerResponse = {
  jobId: number
  foregroundMask: Uint8Array
}

export function solveBinaryMinCut(problem: GraphCutProblem): Uint8Array

export type GraphCutRunResult =
  | { stale: false; jobId: number; foregroundMask: Uint8Array }
  | { stale: true; jobId: number }
```

- [ ] **Step 2: 运行测试并确认失败**

Run:
`& 'C:\Users\Lenovo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\node_modules\@playwright\test\cli.js test "toothGraphCutWorker" --project=chromium --reporter=line`

Expected: FAIL，提示 Worker 或客户端模块不存在。

- [ ] **Step 3: 实现确定性 max-flow/min-cut**

使用邻接残量图和确定顺序的 Dinic：添加边时按 `(from, to)` 排序，BFS/DFS 遍历顺序稳定。求最大流后从 source 在正残量边上遍历得到前景 mask。Worker 只接收/返回数字 TypedArray，不引用 Vue、Three.js 或 DOM。

- [ ] **Step 4: 实现 Worker 客户端生命周期**

客户端用 `new Worker(new URL('../workers/toothGraphCut.worker.ts', import.meta.url), { type: 'module' })`；每次运行递增 jobId；发送前复制会被 transfer 的数组，避免转移主缓存；新任务开始或客户端销毁时拒绝/忽略旧任务；错误统一转为中文状态文本可展示的 `Error`。

- [ ] **Step 5: 运行测试并确认通过**

Run: Task 4 Step 2 的命令。

Expected: PASS。

- [ ] **Step 6: 提交**

```powershell
git add src/page/toothSegmentationTest/workers/toothGraphCut.worker.ts src/page/toothSegmentationTest/utils/toothGraphCutWorkerClient.ts tests/toothGraphCutWorker.spec.ts
git commit -m "feat: solve tooth graph cut in worker"
```

### Task 5: 从 Graph Cut 面掩码提取可编辑闭合表面边界

**Files:**
- Create: `src/page/toothSegmentationTest/utils/toothBoundaryExtractionUtils.ts`
- Test: `tests/toothBoundaryExtractionUtils.spec.ts`
- Modify: `src/page/toothSegmentationTest/utils/surfaceBoundaryUtils.ts`
- Test: `tests/surfaceBoundaryUtils.spec.ts`

- [ ] **Step 1: 写失败测试，固定后处理拒绝条件**

覆盖：保留包含最多前景种子的前景连通分量；结果小于 seed face 数时报错；结果超过 ROI 90% 时报错；开放边链时报错；短于 `0.15 * seedDiameter` 的环被删除；多个闭环时选择包围种子侧且前景面积最大的环。

```ts
export type ExtractedToothBoundary = {
  triangleIndices: number[]
  loop: THREE.Vector3[]
  boundary: ToothBoundary
}

export function extractToothBoundary(
  geometry: THREE.BufferGeometry,
  topology: ToothGraphTopology,
  roi: ToothGraphCutRoi,
  foregroundMask: Uint8Array,
  toothId: number,
): ExtractedToothBoundary
```

- [ ] **Step 2: 写失败测试，固定简化、重采样和表面路径**

断言简化公差为 `max(0.15, seedDiameter * 0.01)`；控制点数量限制 24–64；目标间距为 `seedDiameter / 12`；首尾不重复存储但渲染路径闭合；每段曲线点来自 `createSurfaceSegmentPoints`，不是 Catmull-Rom 空间插值。

- [ ] **Step 3: 运行测试并确认失败**

Run:
`& 'C:\Users\Lenovo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\node_modules\@playwright\test\cli.js test "toothBoundaryExtractionUtils|surfaceBoundaryUtils" --project=chromium --reporter=line`

Expected: FAIL，新提取模块不存在或新断言失败。

- [ ] **Step 4: 实现闭环提取和控制点生成**

从前景/背景共享边构造量化顶点图；逐边消费得到闭环；发现度数不是 2 的开放/分叉边界立即报错。计算每环长度和关联前景面积，过滤短环并稳定选主环。对主环做闭合 Douglas-Peucker 简化，再按弧长重采样为 24–64 个 `control` 点。

- [ ] **Step 5: 调整表面曲线接口，显式保存分段点**

在 `surfaceBoundaryUtils.ts` 增加从控制点批量构造闭合 surface segments 的纯函数；保留现有 `moveClosedSurfacePathAnchor` 的局部两段更新语义。不得把 `createBoundaryCurvePoints` 的 Catmull-Rom 结果用于新 Graph Cut 边界渲染。

- [ ] **Step 6: 运行测试并确认通过**

Run: Task 5 Step 3 的命令。

Expected: PASS。

- [ ] **Step 7: 提交**

```powershell
git add src/page/toothSegmentationTest/utils/toothBoundaryExtractionUtils.ts src/page/toothSegmentationTest/utils/surfaceBoundaryUtils.ts tests/toothBoundaryExtractionUtils.spec.ts tests/surfaceBoundaryUtils.spec.ts
git commit -m "feat: extract editable tooth surface boundary"
```

### Task 6: 接入页面种子圈选、粉色预览和“生成边界”操作

**Files:**
- Modify: `src/page/toothSegmentationTest/index.vue`
- Modify: `tests/toothSegmentationTestPage.spec.ts`

- [ ] **Step 1: 扩展页面测试，先固定用户可见流程**

为页面增加可测试状态钩子，不要求浏览器测试真实大 STL 算法。断言：进入分牙后出现“生成边界”；无种子时禁用；闭合圈选成功后状态文本包含“种子面”且按钮启用；粉色预览对象存在；生成中按钮禁用且重复点击不会再发任务；成功后显示当前白线和绿色圆点。

```ts
await expect(page.getByRole('button', { name: '生成边界' })).toBeDisabled()
await expect(page.getByTestId('seed-preview')).toHaveAttribute('data-color', '#ef6f91')
await expect(page.getByTestId('active-boundary')).toHaveAttribute('data-line-color', '#ffffff')
```

- [ ] **Step 2: 运行页面测试并确认新增断言失败**

Run:
`& 'C:\Users\Lenovo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\node_modules\@playwright\test\cli.js test "toothSegmentationTestPage" --project=chromium --reporter=line`

Expected: FAIL，找不到“生成边界”或预览状态。

- [ ] **Step 3: 将页面权威状态替换为统一 Map**

把 `toothBoundaries`、已确认 triangleIndices 的权威用途迁移到：

```ts
const toothSegmentations = shallowRef(new Map<number, ToothSegmentationState>())
```

`toothBoundaryGroups`、`confirmedRegionMeshes`、seed preview groups 保留为派生视图；`confirmedTriangleLabels` 保留为每颌确认结果缓存。自动标签边界仅作为背景参考，不进入新状态 Map。

- [ ] **Step 4: 将现有紫色笔迹结束事件改为种子生成**

`finishBoundaryDrawing` 不再直接调用旧 `generateSurfaceBoundary`。它调用 6px 多边形采样，通过 `raycaster.firstHitOnly = true` 依次命中实际 jaw STL Mesh，选定颌、过滤最大连通分量、从原始标签的种子面多数值推断 toothId，然后写入 `seeded` 状态并渲染粉色三角面子集。

- [ ] **Step 5: 在模型加载时建立 Graph Cut 缓存**

在 `createJawMesh` 完成 geometry、BVH 后，仅一次调用 `buildToothGraphTopology` 并存入 `WeakMap<THREE.Mesh, ToothGraphTopology>`。为屏幕外环采样复用同一 Raycaster，绝不在 pointermove 中构图。

- [ ] **Step 6: 实现“生成边界”协调逻辑**

按 1.25x–1.65x 屏幕包围盒环采背景面，加上 ROI 外圈；验证前、背景各至少 3 面；构造 GraphCutProblem 并交给 Worker；忽略 stale 返回；成功后提取 boundary、保存 `boundary-ready` 状态、清除粉色预览并渲染 surface segments。

- [ ] **Step 7: 实现当前/非当前边界样式**

当前牙：`LineBasicMaterial(0xffffff)` + 绿色圆点；其他牙：绿色线 + 蓝色圆点。切换选择只改材质颜色，不重算路径。圆点继续复用现有圆形纹理。

- [ ] **Step 8: 运行页面测试并确认通过**

Run: Task 6 Step 2 的命令。

Expected: PASS。

- [ ] **Step 9: 提交**

```powershell
git add src/page/toothSegmentationTest/index.vue tests/toothSegmentationTestPage.spec.ts
git commit -m "feat: add seeded graph cut boundary workflow"
```

### Task 7: 保证拖拽只重算局部表面边界并使确认失效

**Files:**
- Modify: `src/page/toothSegmentationTest/index.vue`
- Modify: `src/page/toothSegmentationTest/utils/surfaceBoundaryUtils.ts`
- Modify: `tests/surfaceBoundaryUtils.spec.ts`
- Modify: `tests/toothSegmentationTestPage.spec.ts`

- [ ] **Step 1: 写回归测试，禁止整体平移和全路径重算**

构造闭合路径，拖动一个 anchor 到新 STL 命中点；断言仅前一段和后一段数组引用变化，其余段引用和值不变；控制点等于命中 `intersection.point`；不得出现统一 delta。页面测试注入 spies，断言 pointermove 不调用 Graph Cut、`buildToothGraphTopology`、确认分类或 geometry 写方法。

- [ ] **Step 2: 运行测试并确认新断言失败**

Run:
`& 'C:\Users\Lenovo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\node_modules\@playwright\test\cli.js test "surfaceBoundaryUtils|toothSegmentationTestPage" --project=chromium --reporter=line`

Expected: FAIL，页面仍沿用旧边界状态/渲染接口或缺少 spy 钩子。

- [ ] **Step 3: 将拖拽接到新状态和缓存 surface path**

`raycastMeshSurface` 的目标始终为当前 state 对应的原始 STL Mesh。用 `intersection.point.clone()` 更新单一 `boundary[pointIndex]`，调用 `moveClosedSurfacePathAnchor` 只重算 `(index-1,index)` 与 `(index,index+1)` 两段，原位更新 line geometry 的 position attribute。

- [ ] **Step 4: 拖动确认边界时原子失效**

pointerup 后通过 `markBoundaryEdited` 将该牙改为 `boundary-ready`、清除对应 triangle labels 和独立 Mesh；其他牙状态、标签和 Mesh 不变。pointermove 期间不做失效清理，避免每帧扫描标签。

- [ ] **Step 5: 运行回归测试并确认通过**

Run: Task 7 Step 2 的命令。

Expected: PASS。

- [ ] **Step 6: 提交**

```powershell
git add src/page/toothSegmentationTest/index.vue src/page/toothSegmentationTest/utils/surfaceBoundaryUtils.ts tests/surfaceBoundaryUtils.spec.ts tests/toothSegmentationTestPage.spec.ts
git commit -m "fix: keep tooth boundary drag surface local"
```

### Task 8: 确认分牙时原子分类并生成独立牙齿 Mesh

**Files:**
- Modify: `src/page/toothSegmentationTest/utils/toothRegionClassifier.ts`
- Modify: `src/page/toothSegmentationTest/index.vue`
- Modify: `tests/toothRegionClassifier.spec.ts`
- Modify: `tests/toothSegmentationTestPage.spec.ts`

- [ ] **Step 1: 写失败测试，固定确认事务和 Mesh 几何规则**

分类测试覆盖：从编辑后的闭合 surface boundary 得到内部面；与另一牙已确认标签重叠时抛错且输入 labels 不变；同一 toothId 重确认时先清除其旧标签再替换。几何测试断言输出为 non-indexed geometry，position 数量为 `triangleIndices.length * 3`，法向存在，原 geometry 的 position/index/version 不变。

```ts
export function buildConfirmedToothGeometry(
  source: THREE.BufferGeometry,
  triangleIndices: readonly number[],
): THREE.BufferGeometry

export function prepareConfirmedToothRegion(
  currentLabels: readonly number[],
  toothId: number,
  triangleIndices: readonly number[],
): number[]
```

- [ ] **Step 2: 运行测试并确认失败**

Run:
`& 'C:\Users\Lenovo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\node_modules\@playwright\test\cli.js test "toothRegionClassifier|toothSegmentationTestPage" --project=chromium --reporter=line`

Expected: FAIL，新几何/事务断言未满足。

- [ ] **Step 3: 把确认操作拆为 prepare 和 commit**

先计算待确认 `triangleIndices` 和 nextLabels，再检查全部重叠并构建临时 independent geometry；全部成功后才一次性替换 jaw labels、`ToothSegmentationState` 和 `confirmedRegionMeshes`。任何异常都 dispose 临时 geometry，页面保留旧状态。

- [ ] **Step 4: 渲染确认结果**

独立 Mesh 使用 `MeshStandardMaterial({ color: 0x35d07f, transparent: true, opacity: 0.55, depthWrite: false })`，key 为 `jaw:toothId`；同牙重确认先安全 dispose 旧派生 Mesh；源 STL 不删面、不改 attribute。

- [ ] **Step 5: 运行测试并确认通过**

Run: Task 8 Step 2 的命令。

Expected: PASS。

- [ ] **Step 6: 提交**

```powershell
git add src/page/toothSegmentationTest/utils/toothRegionClassifier.ts src/page/toothSegmentationTest/index.vue tests/toothRegionClassifier.spec.ts tests/toothSegmentationTestPage.spec.ts
git commit -m "feat: confirm segmented tooth mesh atomically"
```

### Task 9: 实现会话 JSON V2、旧格式兼容和原 allStl 格式结果导出

**Files:**
- Modify: `src/page/toothSegmentationTest/utils/toothSegmentationPersistence.ts`
- Modify: `src/page/toothSegmentationTest/utils/toothRegionClassifier.ts`
- Modify: `src/page/toothSegmentationTest/index.vue`
- Modify: `tests/toothSegmentationPersistence.spec.ts`
- Modify: `tests/toothRegionClassifier.spec.ts`
- Modify: `tests/toothSegmentationTestPage.spec.ts`

- [ ] **Step 1: 写失败测试，固定 V2 往返和兼容输入**

测试 V2 序列化/解析完整保存 `toothId/jaw/status/seedFaceIndices/boundary/triangleIndices` 和两颌 `triangleLabels`；恢复后 `seeded` 有粉色预览、`boundary-ready` 有边界、`confirmed` 有边界和 Mesh；继续接受旧 boundary 数组及当前 `{boundaries,jaws}` 格式并迁移为状态 Map。

```ts
export type SegmentationSessionV2 = {
  version: 2
  teeth: Array<{
    toothId: number
    jaw: JawType
    status: ToothSegmentationStatus
    seedFaceIndices: number[]
    boundary: ToothBoundary['boundary'] | null
    triangleIndices: number[]
  }>
  jaws: {
    upper: { triangleLabels: number[] }
    lower: { triangleLabels: number[] }
  }
}
```

- [ ] **Step 2: 写失败测试，固定每颌原格式标签 JSON**

输入原 label payload 和确认面标签，断言输出保留 `id_patient`、`jaw`、`metadata` 及未知源字段；删除 `faceLabels`；`labels.length` 等于原 STL non-indexed position 顶点数；确认面三个顶点都写 toothId，未确认顶点全为 0；上下颌分别生成文件。

```ts
export function buildOriginalFormatJawExport(
  sourcePayload: Record<string, unknown>,
  vertexCount: number,
  triangleLabels: readonly number[],
): Record<string, unknown>
```

- [ ] **Step 3: 运行测试并确认失败**

Run:
`& 'C:\Users\Lenovo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\node_modules\@playwright\test\cli.js test "toothSegmentationPersistence|toothRegionClassifier|toothSegmentationTestPage" --project=chromium --reporter=line`

Expected: FAIL，V2 或原格式导出接口不存在。

- [ ] **Step 4: 实现严格解析与迁移**

逐字段校验整数、jaw、status、数组长度、面索引范围、boundary 最少 3 点及状态一致性；对旧格式用原始标签定位 jaw，只恢复可证明有效的数据；同一 toothId 重复、跨颌冲突或确认标签与 triangleIndices 不一致时拒绝整个文件，不部分导入。

- [ ] **Step 5: 恢复全部派生视图**

文件验证成功后一次性替换 state Map 和 jaw labels，再按状态重建 seed preview、surface path、Boundary Points/Curve 和 confirmed Mesh。若任一步重建失败，dispose 本次临时对象并保留导入前状态。

- [ ] **Step 6: 分离“导出会话”和“导出分牙结果”按钮**

保留一个按钮导出 V2 编辑会话；新增“导出分牙结果”按钮，下载上颌、下颌两个与原 allStl JSON shape 一致的文件。文件名稳定包含 jaw，未确认区域标签必须为 0。

- [ ] **Step 7: 运行测试并确认通过**

Run: Task 9 Step 3 的命令。

Expected: PASS。

- [ ] **Step 8: 提交**

```powershell
git add src/page/toothSegmentationTest/utils/toothSegmentationPersistence.ts src/page/toothSegmentationTest/utils/toothRegionClassifier.ts src/page/toothSegmentationTest/index.vue tests/toothSegmentationPersistence.spec.ts tests/toothRegionClassifier.spec.ts tests/toothSegmentationTestPage.spec.ts
git commit -m "feat: persist tooth segmentation sessions and results"
```

### Task 10: 集成回归、静态检查和人工验收

**Files:**
- Modify only if a failing assertion reveals an in-scope defect in files from Tasks 1–9.
- Verify: `src/page/toothSegmentationTest/**`
- Verify: `tests/*tooth*GraphCut*.spec.ts`, `tests/seedSelectionUtils.spec.ts`, `tests/toothBoundaryExtractionUtils.spec.ts`, `tests/surfaceBoundaryUtils.spec.ts`, `tests/toothRegionClassifier.spec.ts`, `tests/toothSegmentationPersistence.spec.ts`, `tests/toothSegmentationTestPage.spec.ts`, `tests/bvhRaycastUtils.spec.ts`, `tests/toothBoundaryEditorUtils.spec.ts`

- [ ] **Step 1: 运行全部相关自动化测试**

Run:
`& 'C:\Users\Lenovo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\node_modules\@playwright\test\cli.js test "toothSegmentationState|seedSelectionUtils|toothGraphCutUtils|toothGraphCutWorker|toothBoundaryExtractionUtils|surfaceBoundaryUtils|toothRegionClassifier|toothSegmentationPersistence|toothSegmentationTestPage|bvhRaycastUtils|toothBoundaryEditorUtils" --project=chromium --reporter=line`

Expected: 全部 PASS，无 flaky retry。

- [ ] **Step 2: 运行限定范围 ESLint**

Run:
`& 'C:\Users\Lenovo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\node_modules\eslint\bin\eslint.js src/page/toothSegmentationTest tests/toothSegmentationState.spec.ts tests/seedSelectionUtils.spec.ts tests/toothGraphCutUtils.spec.ts tests/toothGraphCutWorker.spec.ts tests/toothBoundaryExtractionUtils.spec.ts tests/surfaceBoundaryUtils.spec.ts tests/toothRegionClassifier.spec.ts tests/toothSegmentationPersistence.spec.ts tests/toothSegmentationTestPage.spec.ts`

Expected: exit code 0。

- [ ] **Step 3: 运行限定范围 Vue/TypeScript 检查**

用 `apply_patch` 临时创建 `tsconfig.tooth-segmentation-verify.json`，只 include `src/page/toothSegmentationTest/**/*.ts`、`src/page/toothSegmentationTest/**/*.vue` 和本计划新增测试；运行：

`& 'C:\Users\Lenovo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\node_modules\vue-tsc\bin\vue-tsc.js --noEmit -p tsconfig.tooth-segmentation-verify.json`

Expected: exit code 0。随后用 `apply_patch` 删除临时 tsconfig。

- [ ] **Step 4: 检查源码约束**

Run:
`rg -n "computeBoundsTree|buildToothGraphTopology|solveBinaryMinCut|classifyToothRegion|setAttribute|\.translate\(|\.add\(.*delta" src/page/toothSegmentationTest`

Expected: BVH/拓扑构建仅在加载流程；Graph Cut/分类仅在按钮操作；拖拽路径中无 geometry 写入、整体 delta 或 STL 变换。

- [ ] **Step 5: 人工浏览器验收**

启动本地页面后依次验证：

1. 初始立即显示 allStl 上、下颌；进入分牙后 STL 统一灰色。
2. 紫色闭合圈画牙冠，生成粉色种子面；圈到两个颌时只采用第一个颌。
3. 点击“生成边界”，界面保持可旋转，完成后显示白线和绿色圆点。
4. 切换牙位后旧边界变成绿线和蓝色圆点。
5. 连续拖动绿色点，点始终吸附 STL，只有邻近线段变化，没有整圈平移、点线脱离或卡顿式整网格重算。
6. 点击“确认分牙”才出现半透明绿色独立牙齿 Mesh；拖动已确认边界后该 Mesh 消失并要求重新确认。
7. 与已确认牙重叠时操作失败且旧结果完整保留。
8. 导出 V2、刷新页面、重新加载后恢复种子/边界/确认状态。
9. 导出上、下颌结果 JSON，其字段 shape 与原 allStl JSON 相同，labels 长度正确，未确认区域为 0。

- [ ] **Step 6: 检查 diff 并提交验证期修复**

Run:
`git diff --check`

Expected: 无空白错误。若 Step 1–5 没有产生修复则不创建空提交；若有修复，仅 add 对应的 tooth segmentation 文件并提交：

```powershell
git commit -m "test: verify seeded tooth segmentation workflow"
```

