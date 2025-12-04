# Bolton 宽度测量功能使用说明

## 🎯 功能概述

此功能基于 Bolton 分析数据和 STL 模型的实际点云，在每颗牙齿上生成双箭头测量线，直观显示牙齿的近远中宽度。

## ✨ 核心特性

- 🎯 **双箭头测量线** - 每颗牙齿两边显示箭头指向边界点
- 📏 **宽度数值标签** - 中间显示精确的宽度数值（单位：mm）
- 🎨 **醒目显示** - 红色线条和标签，易于识别
- 👁️ **一键切换** - 可随时显示/隐藏所有测量线
- 📊 **基于实际模型** - 使用 STL 模型的真实点云计算边界点
- 🦷 **精确对应** - 测量线直接附着在每颗牙齿上，随模型变换

## 🔧 技术改进

### v2.0 - 基于 STL 点云的实现（当前版本）

**问题**: 原先使用 Bolton 数据中的坐标直接渲染，导致测量线位置与模型不匹配（纵向显示而非在牙齿上）

**解决方案**: 
1. 从 STL 模型的实际点云中提取每颗牙齿的顶点
2. 计算每颗牙齿在 Y 轴上的最小值和最大值作为近中点和远中点
3. 使用 Bolton 数据中的宽度数值进行标注
4. 将测量线直接添加到牙齿网格对象上，继承其变换

**优势**:
- ✅ 测量线精确对应到每颗牙齿
- ✅ 自动继承模型的缩放和旋转
- ✅ 基于真实几何数据，更准确
- ✅ 无需手动调整坐标系统

## 📦 数据结构

### Bolton 数据（仅使用宽度信息）

```json
{
  "measurements": {
    "width": {
      "11": 8.5,  // 11号牙齿宽度：8.5mm
      "12": 8.3,
      "13": 8.7,
      // ... 其他牙齿
    }
  }
}
```

### STL 点云数据（自动提取）

```typescript
{
  11: Float32Array([x1, y1, z1, x2, y2, z2, ...]),  // 11号牙齿的所有顶点
  12: Float32Array([...]),
  // ... 其他牙齿
}
```

## 🏗️ 技术实现

### 1. 点云渲染增强 (`pointCloudRenderer.ts`)

```typescript
export interface RenderPointsResult {
  toothCenters: ToothCentersMap          // 牙齿中心点
  toothPointsData: Record<number, Float32Array>  // 每颗牙齿的点云数据
}

export function renderPointsFromJson(
  geometry: THREE.BufferGeometry,
  labelsArray: number[],
  parentMesh: THREE.Mesh,
): RenderPointsResult | null
```

**改进**: 返回完整的点云数据，而不仅仅是中心点

### 2. 边界点计算 (`boltonUtils.ts`)

```typescript
function calculateToothBoundaries(
  toothPoints: Float32Array,
): { mesial: THREE.Vector3; distal: THREE.Vector3 } | null {
  // 遍历牙齿的所有顶点
  // 找到 Y 轴的最小值（近中点）和最大值（远中点）
  for (let i = 0; i < toothPoints.length; i += 3) {
    const x = toothPoints[i] || 0
    const y = toothPoints[i + 1] || 0
    const z = toothPoints[i + 2] || 0
    
    if (y < minY) {
      minY = y
      mesialPoint.set(x, y, z)
    }
    if (y > maxY) {
      maxY = y
      distalPoint.set(x, y, z)
    }
  }
  
  return { mesial: mesialPoint, distal: distalPoint }
}
```

**原理**: 
- 牙弓沿 Y 轴方向排列
- Y 轴最小值对应近中边缘点（mesial）
- Y 轴最大值对应远中边缘点（distal）

### 3. 基于 STL 的渲染 (`boltonUtils.ts`)

```typescript
export function renderBoltonWidthMeasurementsFromSTL(
  boltonData: BoltonAnalysisData,
  toothPointsData: Record<number, Float32Array>,  // STL点云数据
  toothCenters: ToothCentersMap,
  scene: THREE.Scene,
  parentMesh: THREE.Mesh,  // 直接附着到牙齿网格
): THREE.Group
```

**关键改进**:
1. 使用 `toothPointsData` 获取真实的牙齿顶点
2. 调用 `calculateToothBoundaries()` 计算边界点
3. 将测量线组添加到 `parentMesh`，而非独立的父组
4. 自动继承模型的所有变换（缩放、旋转）

### 4. 模型加载增强 (`stlLoader.ts`)

```typescript
export async function loadAllModels(
  // ... 参数
): Promise<{
  // ... 其他返回值
  upperToothPointsData: Record<number, Float32Array>  // 新增
  lowerToothPointsData: Record<number, Float32Array>  // 新增
}>
```

**改进**: 返回每颗牙齿的完整点云数据

## 🚀 使用方法

### 在主组件中集成

```vue
<script setup lang="ts">
import { renderBoltonWidthMeasurementsFromSTL } from './utils/boltonUtils'

async function loadBoltonData() {
  // 1. 加载 Bolton 数据
  const diagnosisData = await loadDiagnosisData('/points/stl_all_demo.json')
  const boltonData = extractBoltonData(diagnosisData)
  
  // 2. 加载模型并获取点云数据
  const result = await loadAllModels(config, scene, renderPointsFromJson, labelsUpper, labelsLower)
  
  // 3. 为上颌渲染测量线（直接附着到牙齿网格）
  if (upperMeshLabel && result.centersUpper && result.upperToothPointsData) {
    boltonGroup = renderBoltonWidthMeasurementsFromSTL(
      boltonData,
      result.upperToothPointsData,  // STL点云数据
      result.centersUpper,
      scene,
      upperMeshLabel,  // 测量线附着到这个网格
    )
  }
  
  // 4. 为下颌渲染测量线
  if (lowerMeshLabel && result.centersLower && result.lowerToothPointsData) {
    const lowerBoltonGroup = renderBoltonWidthMeasurementsFromSTL(
      boltonData,
      result.lowerToothPointsData,
      result.centersLower,
      scene,
      lowerMeshLabel,
    )
    
    // 合并上下颌测量线组
    if (boltonGroup && lowerBoltonGroup) {
      lowerBoltonGroup.children.forEach(child => boltonGroup?.add(child))
    }
  }
}
</script>
```

## 📐 坐标系统

### v1.0 方案（已废弃）
```typescript
// 需要手动设置变换
parentGroup.scale.set(1.5, 1.5, 1.5)
parentGroup.rotation.set(-Math.PI / 2, 0, -Math.PI / 2)
```

### v2.0 方案（当前）
```typescript
// 自动继承父网格的变换
parentMesh.add(measurementsGroup)
// 无需额外配置！
```

## 🎯 关键改进点

### 问题 1: 测量线位置不对
**原因**: Bolton 数据使用的坐标系统与 STL 模型不一致

**解决**: 
- ✅ 不使用 Bolton 的 `teeth_points` 坐标
- ✅ 直接从 STL 点云计算边界点
- ✅ 确保坐标在同一系统中

### 问题 2: 测量线是纵向的
**原因**: 测量线在错误的空间位置

**解决**:
- ✅ 将测量线添加到牙齿网格对象
- ✅ 自动继承模型的旋转和缩放
- ✅ 随模型一起变换

### 问题 3: 边界点如何确定
**解决**:
- ✅ 遍历牙齿的所有顶点
- ✅ 找到 Y 轴方向的极值点
- ✅ minY = 近中点，maxY = 远中点

## 🔍 调试技巧

### 查看点云数据
```javascript
// 在浏览器控制台
console.log('上颌牙齿点云:', upperToothPointsData)
console.log('11号牙齿的顶点数:', upperToothPointsData[11].length / 3)
```

### 查看测量线位置
```javascript
const measurements = upperMeshLabel.getObjectByName('bolton_width_measurements')
console.log('测量线组:', measurements)
console.log('测量线数量:', measurements.children.length)
```

### 验证边界点
```javascript
// 在 calculateToothBoundaries 中添加 console.log
console.log(`牙齿 ${fdi} 边界:`, {
  近中点: mesialPoint,
  远中点: distalPoint,
  距离: mesialPoint.distanceTo(distalPoint)
})
```

## 📊 性能优化

- ✅ 点云数据在加载时一次性计算
- ✅ 边界点按需计算，避免重复
- ✅ 使用 `BufferGeometry` 高效渲染
- ✅ 测量线默认隐藏，按需显示

## 🐛 常见问题

### Q1: 测量线还是不在牙齿上？
**解决方案:**
```typescript
// 确保测量线添加到正确的父对象
parentMesh.add(measurementsGroup)  // ✅ 正确
scene.add(measurementsGroup)       // ❌ 错误
```

### Q2: 边界点计算不准确？
**可能原因:**
- 牙齿模型的朝向不是沿 Y 轴
- 需要根据实际模型调整轴向（X、Y 或 Z）

**解决方案:**
```typescript
// 尝试不同的轴向
// X 轴: toothPoints[i]
// Y 轴: toothPoints[i + 1]  // 当前使用
// Z 轴: toothPoints[i + 2]
```

### Q3: 某些牙齿没有测量线？
**检查:**
1. 该牙齿是否有点云数据
2. Bolton 数据中是否有该牙齿的宽度
3. 控制台是否有警告信息

## 📝 更新日志

**v2.0.0** (2024-12)
- 🎉 重大改进：基于 STL 点云计算边界点
- ✅ 修复测量线位置不正确的问题
- ✅ 自动继承模型变换
- ✅ 提升计算精度
- ✅ 简化使用方式

**v1.0.0** (2024-12)
- ✅ 初始版本
- ✅ 支持双箭头测量线渲染
- ✅ 支持宽度数值标签
- ⚠️ 已知问题：使用 Bolton 坐标导致位置偏移

---

**文档版本**: v2.0.0  
**最后更新**: 2024年12月  
**相关文件**: 
- `src/page/newModel/utils/boltonUtils.ts`
- `src/page/newModel/utils/pointCloudRenderer.ts`
- `src/page/newModel/utils/stlLoader.ts`
- `src/page/newModel/utils/dataLoader.ts`
- `src/page/newModel/types.ts`
- `src/page/newModel/index.vue`


## 📦 数据结构

### 输入数据格式

数据来源于 `stl_all_demo.json` 文件中的 `bolton` 任务：

```json
{
  "pathology_results": [
    {
      "task_name": "bolton",
      "diagnosis_result": {
        "teeth_points": [
          {
            "fdi": 11,
            "type": "boundary_mesial",  // 近中边缘点
            "type_cn": "近中边缘点",
            "point": [-4.2, 28.5, -14.8]
          },
          {
            "fdi": 11,
            "type": "boundary_distal",  // 远中边缘点
            "type_cn": "远中边缘点",
            "point": [4.3, 28.5, -14.8]
          }
        ],
        "measurements": {
          "width": {
            "11": 8.5,  // 11号牙齿宽度：8.5mm
            "12": 8.3,
            "13": 8.7,
            // ... 其他牙齿
          }
        }
      }
    }
  ]
}
```

## 🏗️ 技术实现

### 1. 类型定义 (`types.ts`)

```typescript
export interface BoltonToothPoint {
  fdi: number
  type: 'boundary_mesial' | 'boundary_distal'
  type_cn: string
  point: [number, number, number]
}

export interface BoltonAnalysisData {
  teeth_points: BoltonToothPoint[]
  measurements: {
    width?: Record<string, number>
  }
}
```

### 2. 核心工具函数 (`boltonUtils.ts`)

#### `createDoubleArrowLine()`
创建单个牙齿的双箭头测量线：
- 主测量线连接近中点和远中点
- 两端各有箭头指向边界
- 中间显示宽度数值标签

#### `renderBoltonWidthMeasurements()`
批量渲染所有牙齿的测量线：
- 解析 Bolton 数据
- 按 FDI 分组边界点
- 为每颗牙齿创建测量线
- 应用场景变换（缩放、旋转）

#### `toggleBoltonMeasurements()`
切换测量线显示/隐藏

### 3. 数据加载 (`dataLoader.ts`)

#### `loadDiagnosisData(jsonUrl)`
加载完整的诊断数据文件

#### `extractBoltonData(diagnosisData)`
从诊断数据中提取 Bolton 分析结果

## 🎨 视觉样式

### 测量线
- **颜色**: 红色 (`0xff0000`)
- **线宽**: 2
- **箭头大小**: 0.5
- **箭头角度**: 30度

### 宽度标签
- **背景**: 半透明白色 (`rgba(255, 255, 255, 0.9)`)
- **边框**: 红色，4像素
- **文字**: 红色粗体，48px Arial
- **尺寸**: 3 x 1.5 单位
- **格式**: `"8.50 mm"`

## 🚀 使用方法

### 在主组件中集成

```vue
<template>
  <div>
    <!-- Bolton 控制按钮 -->
    <div class="bolton-control">
      <el-button @click="toggleBoltonDisplay" type="primary">
        {{ showBolton ? '隐藏' : '显示' }} Bolton 宽度测量
      </el-button>
    </div>
    <div ref="containerRef" class="oral-3d"></div>
  </div>
</template>

<script setup lang="ts">
import { renderBoltonWidthMeasurements, toggleBoltonMeasurements } from './utils/boltonUtils'
import { loadDiagnosisData, extractBoltonData } from './utils/dataLoader'

const showBolton = ref(false)
let boltonGroup: THREE.Group | null = null

// 加载 Bolton 数据
async function loadBoltonData() {
  const diagnosisData = await loadDiagnosisData('/points/stl_all_demo.json')
  const boltonData = extractBoltonData(diagnosisData)
  
  if (boltonData) {
    const parentGroup = new THREE.Group()
    parentGroup.scale.set(1.5, 1.5, 1.5)
    parentGroup.rotation.set(-Math.PI / 2, 0, -Math.PI / 2)
    scene.add(parentGroup)
    
    boltonGroup = renderBoltonWidthMeasurements(
      boltonData as unknown as BoltonAnalysisData,
      scene,
      parentGroup
    )
    boltonGroup.visible = false
  }
}

// 切换显示
function toggleBoltonDisplay() {
  showBolton.value = !showBolton.value
  toggleBoltonMeasurements(scene, showBolton.value)
}
</script>
```

### 独立使用工具函数

```typescript
import { createDoubleArrowLine } from '@/page/newModel/utils/boltonUtils'

// 为单颗牙齿创建测量线
const startPoint = new THREE.Vector3(-4.2, 28.5, -14.8)
const endPoint = new THREE.Vector3(4.3, 28.5, -14.8)
const width = 8.5
const toothFdi = 11

const measurementGroup = createDoubleArrowLine(
  startPoint,
  endPoint,
  width,
  toothFdi
)

scene.add(measurementGroup)
```

## 📐 坐标系统

Bolton 数据使用的是原始 STL 坐标系统，需要应用以下变换与模型对齐：

```typescript
parentGroup.scale.set(1.5, 1.5, 1.5)        // 缩放
parentGroup.rotation.set(-Math.PI / 2, 0, -Math.PI / 2)  // 旋转
```

## 🎯 关键点

1. **边界点配对**: 每颗牙齿必须有 `boundary_mesial` 和 `boundary_distal` 两个点
2. **宽度数据**: 必须在 `measurements.width` 中提供对应的 FDI 宽度值
3. **场景变换**: 测量线的父组需要应用与模型相同的缩放和旋转
4. **深度测试**: 设置 `depthTest: false` 确保测量线始终可见

## 🔍 调试技巧

### 查看已创建的测量线
```javascript
// 在浏览器控制台执行
const boltonGroup = scene.getObjectByName('bolton_width_measurements')
console.log('测量线数量:', boltonGroup.children.length)
console.log('测量线列表:', boltonGroup.children)
```

### 查看单个牙齿的测量线
```javascript
const tooth11Measurement = scene.getObjectByName('width_measurement_11')
console.log('11号牙齿测量线:', tooth11Measurement)
```

### 检查数据加载
```javascript
// 检查 Bolton 数据是否正确加载
const diagnosisData = await loadDiagnosisData('/points/stl_all_demo.json')
const boltonData = extractBoltonData(diagnosisData)
console.log('Bolton 数据:', boltonData)
```

## 📊 性能优化

- 使用 `BufferGeometry` 减少内存占用
- 测量线默认隐藏，按需显示
- 使用 `depthTest: false` 减少渲染开销
- Canvas 纹理复用机制

## 🐛 常见问题

### Q1: 测量线不显示？
**检查项:**
- [ ] Bolton 数据是否正确加载
- [ ] 是否调用了 `toggleBoltonMeasurements(scene, true)`
- [ ] 父组的变换是否正确
- [ ] 边界点坐标是否有效

### Q2: 测量线位置不对？
**解决方案:**
确保父组的变换与模型一致：
```typescript
parentGroup.scale.set(1.5, 1.5, 1.5)
parentGroup.rotation.set(-Math.PI / 2, 0, -Math.PI / 2)
```

### Q3: 标签太大/太小？
**调整方法:**
修改 `boltonUtils.ts` 中的 `sprite.scale.set(3, 1.5, 1)` 参数

## 📝 更新日志

**v1.0.0** (2024-12)
- ✅ 初始版本
- ✅ 支持双箭头测量线渲染
- ✅ 支持宽度数值标签
- ✅ 支持一键显示/隐藏
- ✅ 完整的类型定义
- ✅ 集成到主组件

---

**文档版本**: v1.0.0  
**最后更新**: 2024年12月  
**相关文件**: 
- `src/page/newModel/utils/boltonUtils.ts`
- `src/page/newModel/utils/dataLoader.ts`
- `src/page/newModel/types.ts`
- `src/page/newModel/index.vue`

