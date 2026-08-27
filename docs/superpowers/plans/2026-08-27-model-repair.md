# 模型修复页面实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 在 `allStl` 后新增独立模型修复页面，实现升高、压低、平滑、撤销/重做，以及修复结果的 JSON/STL 保存与导出。

**架构：** `allStl` 将当前上下颌网格转换为统一几何数据，通过 Pinia 和 IndexedDB 以任务 ID 传入 `/modelRepair`。修复页使用逻辑顶点拓扑和 `three-mesh-bvh` 定位笔刷范围，所有几何修改只改变顶点位置，不改变三角面和标签；历史记录只保存每次笔刷涉及的顶点坐标差异。

**技术栈：** Vue 3、TypeScript、Pinia、Vue Router、Three.js 0.181、three-mesh-bvh、three-stdlib、Playwright Test、IndexedDB。

**设计文档：** `docs/superpowers/specs/2026-08-27-model-repair-design.md`

## 全局约束

- 第一版只包含升高、压低、平滑、撤销和重做；不包含裁剪、补洞、重新划分网格和移动端触摸雕刻。
- 上下颌一起传入修复页面，一次笔刷只作用于鼠标按下时命中的颌骨。
- 修复操作不得改变顶点数量、三角面顺序、牙齿标签、删除统计和上下颌身份。
- 非索引 STL 中位于同一位置的重复顶点必须同步移动，避免出现三角形裂缝。
- 路由只携带任务 ID，模型数组保存到 Pinia，并备份到 IndexedDB；禁止写入 URL 或 `sessionStorage`。
- 历史记录上限为 50 次或 128 MB，先达到任一限制时清理最早记录。
- 鼠标移动计算按动画帧节流；完整序列化只发生在页面跳转、保存或导出时。
- 继续沿用项目现有依赖，不新增网格雕刻依赖。

---

## 文件结构

### 新增文件

- `src/utils/geometryPayloadUtils.ts`：公共几何序列化实现。
- `src/stores/modelRepair.ts`：当前修复任务的 Pinia 状态和恢复操作。
- `src/page/modelRepair/index.vue`：模型修复页面壳、Three.js 场景和指针交互。
- `src/page/modelRepair/utils/modelTransferUtils.ts`：任务类型、任务创建、IndexedDB 持久化和网格转换。
- `src/page/modelRepair/utils/meshTopologyUtils.ts`：逻辑顶点组、邻接关系和边界顶点。
- `src/page/modelRepair/utils/sculptUtils.ts`：笔刷衰减、BVH 候选查询和三种修复算法。
- `src/page/modelRepair/utils/historyUtils.ts`：顶点差异命令、撤销/重做和内存限制。
- `tests/modelRepairTransfer.spec.ts`：模型任务传递和持久化接口测试。
- `tests/modelRepairTopology.spec.ts`：重复顶点、邻接关系和边界测试。
- `tests/modelRepairSculpt.spec.ts`：升高、压低、平滑和笔刷范围测试。
- `tests/modelRepairHistory.spec.ts`：撤销、重做和历史记录限制测试。
- `tests/modelRepairPage.spec.ts`：新页面加载、工具状态和笔刷历史测试。
- `tests/allStlToModelRepair.spec.ts`：`allStl` 到修复页的流程测试。

### 修改文件

- `src/page/allStl/utils/geometryPayloadUtils.ts`：改为重新导出公共实现，保留现有导入兼容性。
- `src/page/allStl/index.vue:1-170`：增加“保存并下一步”按钮、Router 和 Store 引用。
- `src/page/allStl/index.vue:1188-1335`：复用现有 JSON 构造逻辑创建修复任务。
- `src/router/index.ts:89-101`：注册 `/modelRepair` 路由。

---

### 任务 1：公共几何格式和模型任务传递

**文件：**

- 创建：`src/utils/geometryPayloadUtils.ts`
- 创建：`src/page/modelRepair/utils/modelTransferUtils.ts`
- 创建：`src/stores/modelRepair.ts`
- 修改：`src/page/allStl/utils/geometryPayloadUtils.ts`
- 测试：`tests/modelRepairTransfer.spec.ts`
- 测试：`tests/allStlGeometryUtils.spec.ts`

**接口：**

- 输入：现有 `MeshGeometryPayload` 和上/下颌网格。
- 输出：`ModelRepairTransfer`、`ModelRepairRepository`、`createModelRepairTransfer()`、`createIndexedDbModelRepairRepository()`、`useModelRepairStore()`。

- [ ] **步骤 1：编写模型任务往返和 Store 恢复的失败测试**

```ts
import { createPinia, setActivePinia } from 'pinia'
import { expect, test } from '@playwright/test'

import { useModelRepairStore } from '../src/stores/modelRepair'
import {
  createModelRepairTransfer,
  type ModelRepairRepository,
} from '../src/page/modelRepair/utils/modelTransferUtils'

test('creates and restores a transfer without losing deletion metadata', async () => {
  const records = new Map<string, unknown>()
  const repository: ModelRepairRepository = {
    save: async (value) => void records.set(value.id, structuredClone(value)),
    load: async (id) => (records.get(id) as ReturnType<typeof createModelRepairTransfer>) ?? null,
  }
  const upper = {
    formatVersion: 1 as const,
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    labels: [11, 11, 11],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
    gumRemoved: true,
    removedFaceCount: 3,
    sourceFaceCount: 4,
  }
  const transfer = createModelRepairTransfer({ upper }, 'repair-1', '2026-08-27T00:00:00.000Z')

  setActivePinia(createPinia())
  const store = useModelRepairStore()
  await store.setTransfer(transfer, repository)
  store.clearMemory()
  await store.restoreTransfer('repair-1', repository)

  expect(store.activeTransfer?.jaws.upper).toEqual(upper)
  expect(store.activeTransfer?.jaws.lower).toBeUndefined()
})
```

- [ ] **步骤 2：运行测试并确认因模块不存在而失败**

运行：`npx playwright test tests/modelRepairTransfer.spec.ts --project=chromium`

预期：失败，并提示无法解析 `modelTransferUtils` 或 `modelRepair` Store。

- [ ] **步骤 3：移动公共几何实现并保留兼容导出**

将 `src/page/allStl/utils/geometryPayloadUtils.ts` 的当前实现移动到 `src/utils/geometryPayloadUtils.ts`，原文件只保留：

```ts
export * from '../../../utils/geometryPayloadUtils'
```

保持 `MeshGeometryPayload`、`buildGeometryPayloadFromMesh()`、`createGeometryFromPayload()`、`filterMeshGeometryFaces()` 和圈选函数签名不变。

- [ ] **步骤 4：实现模型任务类型和 IndexedDB 仓库**

```ts
import type { MeshGeometryPayload } from '@/utils/geometryPayloadUtils'

export type RepairJaw = 'upper' | 'lower'

export type ModelRepairTransfer = {
  version: 1
  id: string
  jaws: Partial<Record<RepairJaw, MeshGeometryPayload>>
  createdAt: string
  updatedAt: string
}

export type ModelRepairRepository = {
  save(transfer: ModelRepairTransfer): Promise<void>
  load(id: string): Promise<ModelRepairTransfer | null>
}

export function createModelRepairTransfer(
  jaws: ModelRepairTransfer['jaws'],
  id = crypto.randomUUID(),
  now = new Date().toISOString(),
): ModelRepairTransfer {
  if (!jaws.upper && !jaws.lower) throw new Error('至少需要一个可修复的颌骨模型。')
  return { version: 1, id, jaws: structuredClone(jaws), createdAt: now, updatedAt: now }
}
```

`createIndexedDbModelRepairRepository()` 使用固定数据库名 `charts-config-model-repair`、版本 `1`、对象仓库 `transfers`，以 `id` 为 keyPath。`load()` 必须校验 `version === 1` 且至少存在一个颌骨，否则返回 `null`。

```ts
const DATABASE_NAME = 'charts-config-model-repair'
const STORE_NAME = 'transfers'

function isModelRepairTransfer(value: unknown): value is ModelRepairTransfer {
  if (!value || typeof value !== 'object') return false
  const transfer = value as Partial<ModelRepairTransfer>
  return (
    transfer.version === 1 &&
    typeof transfer.id === 'string' &&
    !!transfer.jaws &&
    (!!transfer.jaws.upper || !!transfer.jaws.lower)
  )
}

function openDatabase(factory: IDBFactory) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export function createIndexedDbModelRepairRepository(
  factory: IDBFactory = globalThis.indexedDB,
): ModelRepairRepository {
  return {
    async save(transfer) {
      const database = await openDatabase(factory)
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readwrite')
        transaction.objectStore(STORE_NAME).put(structuredClone(transfer))
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
      database.close()
    },
    async load(id) {
      const database = await openDatabase(factory)
      const value = await new Promise<unknown>((resolve, reject) => {
        const request = database.transaction(STORE_NAME).objectStore(STORE_NAME).get(id)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      database.close()
      return isModelRepairTransfer(value) ? value : null
    },
  }
}
```

- [ ] **步骤 5：实现 Pinia Store，并允许测试注入仓库**

```ts
import { shallowRef } from 'vue'
import { defineStore } from 'pinia'

import {
  createIndexedDbModelRepairRepository,
  type ModelRepairRepository,
  type ModelRepairTransfer,
} from '@/page/modelRepair/utils/modelTransferUtils'

export const useModelRepairStore = defineStore('modelRepair', () => {
  const activeTransfer = shallowRef<ModelRepairTransfer | null>(null)

  async function setTransfer(
    transfer: ModelRepairTransfer,
    repository: ModelRepairRepository = createIndexedDbModelRepairRepository(),
  ) {
    activeTransfer.value = transfer
    await repository.save(transfer)
  }

  async function restoreTransfer(
    id: string,
    repository: ModelRepairRepository = createIndexedDbModelRepairRepository(),
  ) {
    if (activeTransfer.value?.id === id) return activeTransfer.value
    activeTransfer.value = await repository.load(id)
    return activeTransfer.value
  }

  function clearMemory() {
    activeTransfer.value = null
  }

  return { activeTransfer, setTransfer, restoreTransfer, clearMemory }
})
```

- [ ] **步骤 6：运行传递测试和原有几何测试**

运行：`npx playwright test tests/modelRepairTransfer.spec.ts tests/allStlGeometryUtils.spec.ts --project=chromium`

预期：所有测试通过，现有牙龈删除 JSON 往返测试没有回归。

- [ ] **步骤 7：提交任务 1**

```bash
git add src/utils/geometryPayloadUtils.ts src/page/allStl/utils/geometryPayloadUtils.ts src/page/modelRepair/utils/modelTransferUtils.ts src/stores/modelRepair.ts tests/modelRepairTransfer.spec.ts
git commit -m "feat: add model repair transfer state"
```

---

### 任务 2：逻辑顶点拓扑

**文件：**

- 创建：`src/page/modelRepair/utils/meshTopologyUtils.ts`
- 测试：`tests/modelRepairTopology.spec.ts`

**接口：**

- 输入：非索引 `THREE.BufferGeometry`。
- 输出：`LogicalMeshTopology`、`buildLogicalMeshTopology()`、`readLogicalPosition()`、`writeLogicalPosition()`。

- [ ] **步骤 1：编写重复顶点分组和邻接关系的失败测试**

```ts
import { expect, test } from '@playwright/test'
import * as THREE from 'three'
import { buildLogicalMeshTopology } from '../src/page/modelRepair/utils/meshTopologyUtils'

test('groups duplicate STL vertices and builds logical adjacency', () => {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3),
  )

  const topology = buildLogicalMeshTopology(geometry)

  expect(topology.groups).toHaveLength(4)
  expect(topology.vertexToGroup[1]).toBe(topology.vertexToGroup[3])
  expect(topology.vertexToGroup[2]).toBe(topology.vertexToGroup[5])
  expect(topology.neighbors[topology.vertexToGroup[1]]).toEqual(
    expect.arrayContaining([topology.vertexToGroup[0], topology.vertexToGroup[4]]),
  )
})
```

另加测试验证共享边两侧的逻辑顶点不是边界，外轮廓顶点是边界，以及写入一个逻辑顶点时所有重复 BufferAttribute 顶点同步更新。

- [ ] **步骤 2：运行测试并确认失败**

运行：`npx playwright test tests/modelRepairTopology.spec.ts --project=chromium`

预期：失败，并提示 `meshTopologyUtils` 不存在。

- [ ] **步骤 3：实现逻辑顶点分组**

```ts
export type LogicalMeshTopology = {
  groups: number[][]
  vertexToGroup: Int32Array
  neighbors: number[][]
  boundaryGroups: Set<number>
}

function positionKey(x: number, y: number, z: number, tolerance: number) {
  return `${Math.round(x / tolerance)},${Math.round(y / tolerance)},${Math.round(z / tolerance)}`
}

export function buildLogicalMeshTopology(
  geometry: THREE.BufferGeometry,
  tolerance = 1e-5,
): LogicalMeshTopology {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const groups: number[][] = []
  const vertexToGroup = new Int32Array(position.count)
  const keyToGroup = new Map<string, number>()

  for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex++) {
    const key = positionKey(
      position.getX(vertexIndex),
      position.getY(vertexIndex),
      position.getZ(vertexIndex),
      tolerance,
    )
    let groupIndex = keyToGroup.get(key)
    if (groupIndex === undefined) {
      groupIndex = groups.length
      keyToGroup.set(key, groupIndex)
      groups.push([])
    }
    groups[groupIndex].push(vertexIndex)
    vertexToGroup[vertexIndex] = groupIndex
  }

  const neighborSets = groups.map(() => new Set<number>())
  const edgeCounts = new Map<string, number>()
  for (let base = 0; base + 2 < position.count; base += 3) {
    const faceGroups = [vertexToGroup[base], vertexToGroup[base + 1], vertexToGroup[base + 2]]
    for (const [left, right] of [
      [0, 1],
      [1, 2],
      [2, 0],
    ] as const) {
      const a = faceGroups[left]
      const b = faceGroups[right]
      if (a === b) continue
      neighborSets[a].add(b)
      neighborSets[b].add(a)
      const edgeKey = a < b ? `${a}:${b}` : `${b}:${a}`
      edgeCounts.set(edgeKey, (edgeCounts.get(edgeKey) ?? 0) + 1)
    }
  }

  const boundaryGroups = new Set<number>()
  edgeCounts.forEach((count, key) => {
    if (count !== 1) return
    const [a, b] = key.split(':').map(Number)
    boundaryGroups.add(a)
    boundaryGroups.add(b)
  })

  return {
    groups,
    vertexToGroup,
    neighbors: neighborSets.map((set) => [...set]),
    boundaryGroups,
  }
}
```

实现 `readLogicalPosition()` 读取组内第一个实际顶点，`writeLogicalPosition()` 将同一坐标写入组内所有实际顶点。

- [ ] **步骤 4：运行拓扑测试**

运行：`npx playwright test tests/modelRepairTopology.spec.ts --project=chromium`

预期：全部通过，两个共享顶点分别只形成一个逻辑顶点组。

- [ ] **步骤 5：提交任务 2**

```bash
git add src/page/modelRepair/utils/meshTopologyUtils.ts tests/modelRepairTopology.spec.ts
git commit -m "feat: build logical topology for repair meshes"
```

---

### 任务 3：笔刷选择和升高、压低、平滑算法

**文件：**

- 创建：`src/page/modelRepair/utils/sculptUtils.ts`
- 测试：`tests/modelRepairSculpt.spec.ts`

**接口：**

- 输入：几何、逻辑拓扑、笔刷中心、半径、强度、工具类型和候选逻辑顶点。
- 输出：`calculateBrushFalloff()`、`collectBrushGroupsFromBvh()`、`applySculptSample()`，以及发生变化的逻辑顶点集合。

- [ ] **步骤 1：编写衰减和升高/压低的失败测试**

```ts
test('uses smooth falloff and moves duplicate vertices along averaged normal', () => {
  expect(calculateBrushFalloff(0, 2)).toBe(1)
  expect(calculateBrushFalloff(2, 2)).toBe(0)
  expect(calculateBrushFalloff(3, 2)).toBe(0)

  const { geometry, topology, duplicatedGroup } = createFlatTwoTriangleMesh()
  const changed = applySculptSample({
    geometry,
    topology,
    groupIndices: [duplicatedGroup],
    center: new THREE.Vector3(1, 0, 0),
    radius: 2,
    strength: 0.5,
    tool: 'raise',
  })

  expect(changed).toEqual(new Set([duplicatedGroup]))
  for (const vertexIndex of topology.groups[duplicatedGroup]) {
    expect(
      (geometry.getAttribute('position') as THREE.BufferAttribute).getZ(vertexIndex),
    ).toBeCloseTo(0.5)
  }
})
```

增加压低方向测试：相同参数使用 `tool: 'lower'` 后 Z 坐标为 `-0.5`。

- [ ] **步骤 2：编写平滑和范围外保护的失败测试**

构造一个中心顶点 Z 为 1、邻接顶点 Z 为 0 的小网格。执行 `smooth` 后断言中心 Z 下降但仍大于 0，范围外顶点完全不变；边界顶点的位移小于内部顶点。

```ts
const changed = applySculptSample({
  geometry,
  topology,
  groupIndices: [centerGroup, outsideGroup],
  center: new THREE.Vector3(0, 0, 1),
  radius: 1.5,
  strength: 0.5,
  tool: 'smooth',
})
expect(changed.has(centerGroup)).toBe(true)
expect(readLogicalPosition(geometry, topology, centerGroup).z).toBeLessThan(1)
expect(readLogicalPosition(geometry, topology, outsideGroup)).toEqual(outsideBefore)
```

- [ ] **步骤 3：运行算法测试并确认失败**

运行：`npx playwright test tests/modelRepairSculpt.spec.ts --project=chromium`

预期：失败，并提示雕刻函数不存在。

- [ ] **步骤 4：实现平滑笔刷衰减和法线平均**

```ts
export type SculptTool = 'raise' | 'lower' | 'smooth'

export function calculateBrushFalloff(distance: number, radius: number) {
  if (radius <= 0 || distance >= radius) return 0
  const value = 1 - Math.max(0, distance) / radius
  return value * value * (3 - 2 * value)
}
```

升高/压低使用逻辑组内当前顶点法线的平均值并归一化。每个逻辑顶点只计算一次新位置，再通过 `writeLogicalPosition()` 同步写入全部重复顶点。

- [ ] **步骤 5：实现拉普拉斯平滑**

`smooth` 必须先读取所有候选组和邻接组的旧位置，再统一写入，避免迭代顺序影响结果。目标位置为邻接逻辑顶点坐标的平均值；插值比例为 `clamp(strength * falloff * boundaryFactor, 0, 1)`，其中边界顶点 `boundaryFactor = 0.25`，普通顶点为 `1`，孤立顶点不修改。

```ts
const next = current.clone().lerp(neighborAverage, influence)
if (next.distanceToSquared(current) > 1e-12) {
  writeLogicalPosition(geometry, topology, groupIndex, next)
  changed.add(groupIndex)
}
```

- [ ] **步骤 6：实现 BVH 笔刷候选查询**

为几何安装 `computeBoundsTree`、`disposeBoundsTree`，为网格安装 `acceleratedRaycast`。`collectBrushGroupsFromBvh()` 使用局部坐标球体执行 `boundsTree.shapecast()`：包围盒与球不相交时跳过；命中三角形时兼容索引与非索引几何，取得三个实际顶点，再转换为逻辑组并去重。

```ts
type RepairBufferGeometry = THREE.BufferGeometry & {
  boundsTree?: MeshBVH
  computeBoundsTree?: typeof computeBoundsTree
  disposeBoundsTree?: typeof disposeBoundsTree
}

export function collectBrushGroupsFromBvh(
  geometry: RepairBufferGeometry,
  topology: LogicalMeshTopology,
  center: THREE.Vector3,
  radius: number,
) {
  const groups = new Set<number>()
  const sphere = new THREE.Sphere(center, radius)
  geometry.boundsTree?.shapecast({
    intersectsBounds: (box) => sphere.intersectsBox(box),
    intersectsTriangle: (_triangle, triangleIndex) => {
      const base = triangleIndex * 3
      for (let offset = 0; offset < 3; offset++) {
        const vertexIndex = geometry.index?.getX(base + offset) ?? base + offset
        groups.add(topology.vertexToGroup[vertexIndex])
      }
      return false
    },
  })
  return [...groups]
}
```

- [ ] **步骤 7：运行修复算法和拓扑测试**

运行：`npx playwright test tests/modelRepairSculpt.spec.ts tests/modelRepairTopology.spec.ts --project=chromium`

预期：全部通过，重复顶点同步移动，范围外顶点不变。

- [ ] **步骤 8：提交任务 3**

```bash
git add src/page/modelRepair/utils/sculptUtils.ts tests/modelRepairSculpt.spec.ts
git commit -m "feat: add dental mesh sculpting operations"
```

---

### 任务 4：轻量撤销和重做历史

**文件：**

- 创建：`src/page/modelRepair/utils/historyUtils.ts`
- 测试：`tests/modelRepairHistory.spec.ts`

**接口：**

- 输入：`SculptHistoryCommand`，其中包含颌骨、逻辑顶点索引和前后位置。
- 输出：`createSculptHistory()`、`push()`、`undo()`、`redo()`、`canUndo()`、`canRedo()`、`clear()`。

- [ ] **步骤 1：编写撤销、重做和重做失效的失败测试**

```ts
test('undoes and redoes one stroke and clears redo after a new stroke', () => {
  const history = createSculptHistory({ maxOperations: 50, maxBytes: 128 * 1024 * 1024 })
  const first = createCommand('upper', [2], [0, 0, 0], [0, 0, 1])
  const second = createCommand('upper', [2], [0, 0, 1], [0, 0, 2])

  history.push(first)
  expect(history.undo()).toBe(first)
  expect(history.canRedo()).toBe(true)
  expect(history.redo()).toBe(first)
  expect(history.undo()).toBe(first)
  history.push(second)
  expect(history.canRedo()).toBe(false)
})
```

再增加限制测试：设置 `maxOperations: 2` 后推入三条记录，只保留后两条；设置很小的 `maxBytes` 后清理最早记录。

- [ ] **步骤 2：运行历史测试并确认失败**

运行：`npx playwright test tests/modelRepairHistory.spec.ts --project=chromium`

预期：失败，并提示 `historyUtils` 不存在。

- [ ] **步骤 3：实现命令和历史容器**

```ts
export type SculptHistoryCommand = {
  jaw: RepairJaw
  logicalGroupIndices: Uint32Array
  before: Float32Array
  after: Float32Array
  byteLength: number
}

export function createSculptHistory(
  options = {
    maxOperations: 50,
    maxBytes: 128 * 1024 * 1024,
  },
) {
  const undoStack: SculptHistoryCommand[] = []
  const redoStack: SculptHistoryCommand[] = []

  function trim() {
    let bytes = undoStack.reduce((sum, command) => sum + command.byteLength, 0)
    while (undoStack.length > options.maxOperations || bytes > options.maxBytes) {
      const removed = undoStack.shift()
      if (removed) bytes -= removed.byteLength
    }
  }

  function push(command: SculptHistoryCommand) {
    undoStack.push(command)
    redoStack.length = 0
    trim()
  }

  function undo() {
    const command = undoStack.pop() ?? null
    if (command) redoStack.push(command)
    return command
  }

  function redo() {
    const command = redoStack.pop() ?? null
    if (command) undoStack.push(command)
    return command
  }

  function canUndo() {
    return undoStack.length > 0
  }

  function canRedo() {
    return redoStack.length > 0
  }

  function clear() {
    undoStack.length = 0
    redoStack.length = 0
  }

  return { push, undo, redo, canUndo, canRedo, clear }
}
```

增加 `applyHistoryCommand(geometry, topology, command, 'before' | 'after')`，根据逻辑组索引调用 `writeLogicalPosition()`，然后设置 `position.needsUpdate = true` 并重新计算法线和包围体：

```ts
export function applyHistoryCommand(
  geometry: THREE.BufferGeometry,
  topology: LogicalMeshTopology,
  command: SculptHistoryCommand,
  side: 'before' | 'after',
) {
  const coordinates = command[side]
  const point = new THREE.Vector3()
  command.logicalGroupIndices.forEach((groupIndex, index) => {
    point.fromArray(coordinates, index * 3)
    writeLogicalPosition(geometry, topology, groupIndex, point)
  })
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  position.needsUpdate = true
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
}
```

- [ ] **步骤 4：运行历史测试**

运行：`npx playwright test tests/modelRepairHistory.spec.ts --project=chromium`

预期：全部通过，撤销后新增命令会清空重做栈。

- [ ] **步骤 5：提交任务 4**

```bash
git add src/page/modelRepair/utils/historyUtils.ts tests/modelRepairHistory.spec.ts
git commit -m "feat: add bounded sculpt undo history"
```

---

### 任务 5：从 `allStl` 创建修复任务并跳转

**文件：**

- 修改：`src/page/allStl/index.vue:1-170`
- 修改：`src/page/allStl/index.vue:1188-1335`
- 修改：`src/router/index.ts:89-101`
- 创建：`src/page/modelRepair/index.vue`
- 测试：`tests/allStlToModelRepair.spec.ts`

**接口：**

- 输入：`meshes`、`meshLabelMap`、`hasDeletePreview` 和现有 `buildGeometryPayloadFromMesh()`。
- 输出：`continueToModelRepair()`，以及 `/modelRepair?task=<id>` 路由。

- [ ] **步骤 1：编写路由和跳转按钮的失败页面测试**

```ts
import { expect, test } from '@playwright/test'

const baseUrl = process.env.MODEL_REPAIR_BASE_URL ?? 'http://127.0.0.1:4174'

test('allStl saves current jaws and navigates to model repair', async ({ page }) => {
  await page.goto(`${baseUrl}/allStl`)
  const next = page.getByRole('button', { name: '保存并下一步' })
  await expect(next).toBeVisible()
  await expect(page.locator('.status')).toContainText('已加载', { timeout: 30_000 })
  await next.click()
  await expect(page).toHaveURL(/\/modelRepair\?task=[^&]+$/)
})
```

在 `modelTransferUtils.ts` 中增加纯函数 `getRepairContinuationError(hasDeletePreview, jawCount)`，并在 `tests/modelRepairTransfer.spec.ts` 中断言：预览存在时返回“请先确认或取消删除范围，再进入模型修复。”；颌骨数量为 0 时返回“当前没有可修复的模型。”；其余情况返回空字符串。`continueToModelRepair()` 必须先调用该函数，返回非空信息时写入 `statusText` 并终止跳转。

```ts
export function getRepairContinuationError(hasDeletePreview: boolean, jawCount: number) {
  if (hasDeletePreview) return '请先确认或取消删除范围，再进入模型修复。'
  if (jawCount === 0) return '当前没有可修复的模型。'
  return ''
}
```

- [ ] **步骤 2：运行页面测试并确认失败**

先启动：`npm run dev -- --host 127.0.0.1 --port 4174`

再运行：`npx playwright test tests/allStlToModelRepair.spec.ts --project=chromium`

预期：失败，因为按钮和 `/modelRepair` 路由尚不存在。

- [ ] **步骤 3：注册模型修复路由**

```ts
{
  path: '/modelRepair',
  name: 'modelRepair',
  component: () => import('@/page/modelRepair/index.vue'),
  meta: { title: '模型修复' },
},
```

同时创建最小页面壳 `src/page/modelRepair/index.vue`，读取查询参数并显示“正在加载模型修复数据...”，确保懒加载路由可以独立通过编译和导航测试。完整 Three.js 页面在任务 6 中实现。

- [ ] **步骤 4：在 `allStl` 中实现任务创建**

引入 `useRouter()`、`useModelRepairStore()` 和 `createModelRepairTransfer()`。为每个已加载颌骨读取标签和删除统计，并构造几何数据：

```ts
async function continueToModelRepair() {
  const jawCount = (meshes.upper ? 1 : 0) + (meshes.lower ? 1 : 0)
  const validationError = getRepairContinuationError(hasDeletePreview.value, jawCount)
  if (validationError) {
    statusText.value = validationError
    return
  }

  const jaws: ModelRepairTransfer['jaws'] = {}
  for (const jaw of ['upper', 'lower'] as const) {
    const mesh = meshes[jaw]
    const labels = mesh ? meshLabelMap.get(mesh) : undefined
    if (!mesh || !labels?.length) continue
    jaws[jaw] = buildGeometryPayloadFromMesh(mesh.geometry, labels, {
      sourceFaceCount: Number(mesh.userData.sourceFaceCount),
      removedFaceCount: Number(mesh.userData.removedFaceCount ?? 0),
    })
  }

  const transfer = createModelRepairTransfer(jaws)
  await modelRepairStore.setTransfer(transfer)
  await router.push({ name: 'modelRepair', query: { task: transfer.id } })
}
```

保存失败时捕获异常，停留在 `allStl` 并把错误写入 `statusText`。

- [ ] **步骤 5：增加“保存并下一步”按钮**

按钮在保存期间禁用并显示“正在保存…”。没有任何模型加载完成时禁用。点击后调用 `continueToModelRepair()`。

- [ ] **步骤 6：运行流程测试**

运行：`npx playwright test tests/allStlToModelRepair.spec.ts --project=chromium`

预期：通过，并进入带任务 ID 的 `/modelRepair` 地址。

- [ ] **步骤 7：提交任务 5**

```bash
git add src/page/allStl/index.vue src/router/index.ts src/page/modelRepair/index.vue src/page/modelRepair/utils/modelTransferUtils.ts tests/modelRepairTransfer.spec.ts tests/allStlToModelRepair.spec.ts
git commit -m "feat: continue from segmentation to model repair"
```

---

### 任务 6：模型修复页面和笔刷交互

**文件：**

- 修改：`src/page/modelRepair/index.vue`
- 创建：`tests/modelRepairPage.spec.ts`

**接口：**

- 输入：路由中的 `task`、`useModelRepairStore()`、拓扑/修复/历史工具。
- 输出：可交互的 Three.js 修复页面，以及每次完整拖动对应的一条历史命令。

- [ ] **步骤 1：编写缺失任务和有效任务加载的失败测试**

```ts
test('shows a recoverable empty state when task data is missing', async ({ page }) => {
  await page.goto(`${baseUrl}/modelRepair?task=missing`)
  await expect(page.getByText('未找到可修复的模型数据')).toBeVisible()
  await expect(page.getByRole('button', { name: '返回模型分割' })).toBeVisible()
})

test('restores a persisted transfer and enables the default smooth tool', async ({ page }) => {
  await seedIndexedDbTransfer(page, createSingleTriangleTransfer('repair-page-1'))
  await page.goto(`${baseUrl}/modelRepair?task=repair-page-1`)
  await expect(page.locator('canvas')).toBeVisible()
  await expect(page.getByRole('button', { name: '平滑' })).toHaveClass(/active/)
  await expect(page.getByRole('button', { name: '撤销' })).toBeDisabled()
})
```

`seedIndexedDbTransfer()` 必须通过 `page.addInitScript()` 打开 `charts-config-model-repair` 数据库并写入 `transfers`，从而真实验证刷新恢复路径。

- [ ] **步骤 2：运行页面测试并确认失败**

运行：`npx playwright test tests/modelRepairPage.spec.ts --project=chromium`

预期：失败，因为修复页面尚不存在。

- [ ] **步骤 3：建立页面布局和状态**

页面状态包含：

```ts
const activeTool = ref<SculptTool>('smooth')
const brushRadius = ref(0.68)
const brushStrength = ref(2)
const showUpper = ref(true)
const showLower = ref(true)
const loading = ref(true)
const saving = ref(false)
const errorText = ref('')
const statusText = ref('正在加载模型修复数据...')
```

控制面板使用三个互斥工具按钮、两个范围滑块和数值输入、上下颌开关、撤销/重做图标按钮、“上一步”“保存”按钮。按钮使用项目已有图标库；工具切换不能改变画布尺寸。

- [ ] **步骤 4：初始化 Three.js 场景和颌骨网格**

根据 Store 中的 `MeshGeometryPayload` 调用 `createGeometryFromPayload()`，为每个颌骨创建浅牙龈色 `MeshStandardMaterial` 网格，设置 `mesh.userData.jaw`，构建逻辑拓扑和 BVH。

场景使用透视相机、半球光和两个方向光。`OrbitControls` 使用右键旋转、滚轮缩放，左键保留给修复笔刷。模型加载后根据上下颌包围盒自动适配相机。

- [ ] **步骤 5：实现笔刷指示器和固定目标交互**

使用 `THREE.LineLoop` 创建 64 段圆形指示器。命中模型时将圆心放在命中点法线方向外侧 `0.02` mm，并用四元数将圆的 Z 轴对齐到世界法线。

```ts
type ActiveStroke = {
  jaw: RepairJaw
  mesh: THREE.Mesh
  topology: LogicalMeshTopology
  before: Map<number, THREE.Vector3>
  changedGroups: Set<number>
}
```

只响应主鼠标键。`pointerdown` 命中后创建 `ActiveStroke` 并禁用 controls；`pointermove` 只对同一网格光线拾取，按 `requestAnimationFrame` 节流后调用 `collectBrushGroupsFromBvh()` 和 `applySculptSample()`；首次修改逻辑组时记录 before 坐标。

- [ ] **步骤 6：在松开鼠标时生成一条历史记录**

`pointerup` 将 `changedGroups` 排序，生成连续的 `Uint32Array` 和 before/after `Float32Array`。没有顶点变化时不入栈。完成后重新计算法线、包围盒和包围球，重建 BVH，恢复 controls，并刷新撤销/重做按钮。

`pointercancel`、`pointerleave` 和组件卸载必须调用同一个 `finishStroke()`；卸载时还要移除监听器、取消动画帧、释放几何、材质、BVH、controls 和 renderer。

- [ ] **步骤 7：连接撤销和重做按钮**

```ts
function undo() {
  const command = history.undo()
  if (!command) return
  const state = meshStates[command.jaw]
  if (!state) return
  applyHistoryCommand(state.mesh.geometry, state.topology, command, 'before')
  rebuildBoundsTree(state.mesh.geometry)
}

function redo() {
  const command = history.redo()
  if (!command) return
  const state = meshStates[command.jaw]
  if (!state) return
  applyHistoryCommand(state.mesh.geometry, state.topology, command, 'after')
  rebuildBoundsTree(state.mesh.geometry)
}
```

- [ ] **步骤 8：增加真实笔刷页面测试**

使用一个朝向相机的简单四三角形模型任务。加载后取得 canvas 边界，在中心执行 `mouse.move → mouse.down → mouse.move → mouse.up`，断言“撤销”从禁用变为可用；点击撤销后“重做”可用。切换到“升高”和“压低”时，只允许一个工具拥有 `active` 类。

- [ ] **步骤 9：运行页面和算法测试**

运行：`npx playwright test tests/modelRepairPage.spec.ts tests/modelRepairSculpt.spec.ts tests/modelRepairHistory.spec.ts --project=chromium`

预期：全部通过，页面一次拖动只产生一条可撤销记录。

- [ ] **步骤 10：提交任务 6**

```bash
git add src/page/modelRepair/index.vue tests/modelRepairPage.spec.ts
git commit -m "feat: add interactive model repair page"
```

---

### 任务 7：保存、JSON/STL 导出和完整验证

**文件：**

- 修改：`src/page/modelRepair/index.vue`
- 修改：`src/page/modelRepair/utils/modelTransferUtils.ts`
- 修改：`tests/modelRepairTransfer.spec.ts`
- 修改：`tests/modelRepairPage.spec.ts`

**接口：**

- 输入：修复页当前上下颌 `THREE.Mesh`、原始标签和删除统计。
- 输出：更新后的 `ModelRepairTransfer`、每颌 JSON 文件和每颌二进制 STL 文件。

- [ ] **步骤 1：编写保存后数据完整性的失败测试**

```ts
test('serializes repaired positions without restoring deleted faces', () => {
  const transfer = createSingleTriangleTransfer('save-1', {
    gumRemoved: true,
    removedFaceCount: 2,
    sourceFaceCount: 3,
  })
  const restored = createGeometryFromPayload(transfer.jaws.upper!)
  const mesh = new THREE.Mesh(restored.geometry)
  const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute
  position.setZ(0, 0.75)
  position.needsUpdate = true

  const saved = updateTransferFromMeshes(transfer, { upper: mesh })

  expect(saved.jaws.upper?.positions[2]).toBeCloseTo(0.75)
  expect(saved.jaws.upper?.removedFaceCount).toBe(2)
  expect(saved.jaws.upper?.sourceFaceCount).toBe(3)
  expect(saved.jaws.upper?.labels).toEqual(transfer.jaws.upper?.labels)
})
```

- [ ] **步骤 2：运行测试并确认失败**

运行：`npx playwright test tests/modelRepairTransfer.spec.ts --project=chromium`

预期：失败，因为 `updateTransferFromMeshes()` 尚不存在。

- [ ] **步骤 3：实现模型保存转换**

```ts
export function updateTransferFromMeshes(
  transfer: ModelRepairTransfer,
  meshes: Partial<Record<RepairJaw, THREE.Mesh>>,
  now = new Date().toISOString(),
) {
  const jaws = { ...transfer.jaws }
  for (const jaw of ['upper', 'lower'] as const) {
    const mesh = meshes[jaw]
    const previous = transfer.jaws[jaw]
    if (!mesh || !previous) continue
    mesh.geometry.computeVertexNormals()
    jaws[jaw] = buildGeometryPayloadFromMesh(mesh.geometry, previous.labels, {
      removedFaceCount: previous.removedFaceCount,
      sourceFaceCount: previous.sourceFaceCount,
    })
  }
  return { ...transfer, jaws, updatedAt: now }
}
```

- [ ] **步骤 4：连接“保存”和“上一步”**

“保存”调用 `updateTransferFromMeshes()` 和 `store.setTransfer()`；成功后显示“模型修复结果已保存”，失败时保留当前画布并显示错误。“上一步”结束当前笔刷后跳转 `/allStl`，不清空 IndexedDB 任务。

- [ ] **步骤 5：实现 JSON 和 STL 导出**

JSON 按颌骨导出以下结构，确保可由现有几何恢复逻辑读取：

```ts
{
  jaw,
  labels: geometry.labels,
  geometry,
  instances: [],
  metadata: { source: 'modelRepair', taskId: transfer.id },
}
```

STL 使用 `three-stdlib` 的 `STLExporter`：

```ts
const exporter = new STLExporter()
const data = exporter.parse(mesh, { binary: true })
downloadBlob(`${jaw}-repaired.stl`, new Blob([data], { type: 'model/stl' }))
```

导出前先结束当前笔刷并执行与保存相同的法线和包围体刷新；导出不增加历史记录。

- [ ] **步骤 6：扩展页面测试**

拦截浏览器下载并验证：执行一次升高笔刷后点击“保存”，刷新页面，任务仍可恢复且撤销栈为空；导出 JSON 后读取下载文本，断言 `gumRemoved`、`removedFaceCount`、标签和修改后坐标正确；导出 STL 后断言下载文件名和非零字节数。

- [ ] **步骤 7：运行所有相关测试**

运行：

```bash
npx playwright test tests/allStlGeometryUtils.spec.ts tests/modelRepairTransfer.spec.ts tests/modelRepairTopology.spec.ts tests/modelRepairSculpt.spec.ts tests/modelRepairHistory.spec.ts tests/modelRepairPage.spec.ts tests/allStlToModelRepair.spec.ts --project=chromium
```

预期：全部通过，没有失败、跳过或意外重试。

- [ ] **步骤 8：执行静态检查和格式检查**

运行：

```bash
npx eslint src/utils/geometryPayloadUtils.ts src/stores/modelRepair.ts src/page/modelRepair/utils src/page/modelRepair/index.vue tests/modelRepairTransfer.spec.ts tests/modelRepairTopology.spec.ts tests/modelRepairSculpt.spec.ts tests/modelRepairHistory.spec.ts tests/modelRepairPage.spec.ts tests/allStlToModelRepair.spec.ts
npx prettier --check src/utils/geometryPayloadUtils.ts src/stores/modelRepair.ts src/page/modelRepair src/page/allStl/index.vue src/router/index.ts tests/modelRepairTransfer.spec.ts tests/modelRepairTopology.spec.ts tests/modelRepairSculpt.spec.ts tests/modelRepairHistory.spec.ts tests/modelRepairPage.spec.ts tests/allStlToModelRepair.spec.ts
```

预期：两个命令退出码均为 0。`allStl/index.vue` 如果仍有本任务开始前已经存在的未使用函数告警，应单独记录为既有问题，不通过删除无关函数扩大修改范围。

- [ ] **步骤 9：浏览器人工验证**

在桌面视口打开 `/allStl`，删除一块牙龈并确认；点击“保存并下一步”；在上下颌不同位置分别连续执行升高、压低和平滑；逐次撤销和重做；刷新页面；导出 JSON 和 STL；重新导入 JSON。

确认以下结果：删除区域没有恢复；重复笔刷后模型没有可见裂缝；一次笔刷对应一次撤销；上颌笔刷不会修改下颌；刷新后修复位置保留；JSON 恢复形状与保存前一致；STL 可重新加载且面数与修复前一致。

- [ ] **步骤 10：提交任务 7**

```bash
git add src/page/modelRepair/index.vue src/page/modelRepair/utils/modelTransferUtils.ts tests/modelRepairTransfer.spec.ts tests/modelRepairPage.spec.ts
git commit -m "feat: save and export repaired dental models"
```

---

## 最终验收标准

- `allStl` 能将已经分割并删除牙龈的上下颌模型带入 `/modelRepair`。
- 刷新修复页面后，模型可以从 IndexedDB 恢复。
- 升高、压低和平滑只影响笔刷半径内的命中颌骨。
- 非索引 STL 的重复顶点始终同步移动，不产生三角面裂缝。
- 每次鼠标按下到松开只创建一条历史记录，撤销和重做行为正确。
- 历史记录受到 50 次和 128 MB 双重限制。
- 保存和导出保留牙齿标签、删除统计和修复后的顶点位置。
- 导出的 JSON 不会恢复已经删除的牙龈，STL 保持现有三角面数量。
- 相关 Playwright、ESLint 和 Prettier 检查通过；项目级既有错误单独说明，不混入本功能修改。
