# 方案2: 直接添加到 Mesh - 实施说明

## 📋 方案概述

将分析策略的渲染元素（线、标签等）直接添加到对应的 mesh 上，而不是创建独立的 group 结构。

### 核心理念

- **上颌的元素** → 添加到 `upperMeshLabel`
- **下颌的元素** → 添加到 `lowerMeshLabel`  
- **Mesh 隐藏时，子对象自动隐藏** → 不需要复杂的同步逻辑

## ✅ 已完成的改造

### 1. BaseAnalysisStrategy 简化

#### 移除的内容
```typescript
// ❌ 不再需要
protected upperGroup: THREE.Group
protected lowerGroup: THREE.Group
```

#### 新增的辅助方法

```typescript
/**
 * 添加对象到对应的 mesh
 * @param object 要添加的 3D 对象
 * @param fdi 牙齿的 FDI 号码
 */
protected addToMesh(object: THREE.Object3D, fdi: number): void {
  const isUpper = this.isUpper(fdi)
  const targetMesh = isUpper ? this.context.upperMeshLabel : this.context.lowerMeshLabel
  
  if (!targetMesh) {
    console.warn(`⚠️ 目标 mesh 不存在: ${isUpper ? '上颌' : '下颌'}，FDI: ${fdi}`)
    return
  }
  
  // 设置名称前缀，方便后续识别和清理
  if (!object.name.startsWith(this.taskName)) {
    object.name = `${this.taskName}_${object.name || 'object'}`
  }
  
  targetMesh.add(object)
}

/**
 * 智能添加线到对应的 mesh
 * 根据连接的两个牙齿的 FDI 号码自动判断
 */
protected addLineToMesh(line: THREE.Object3D, fdi1: number, fdi2: number): void {
  const isUpper1 = this.isUpper(fdi1)
  const isUpper2 = this.isUpper(fdi2)
  
  if (isUpper1 && isUpper2) {
    this.addToMesh(line, fdi1)  // 都在上颌
  } else if (!isUpper1 && !isUpper2) {
    this.addToMesh(line, fdi1)  // 都在下颌
  } else {
    // 跨颌的线（如咬合关系），添加到主 group
    if (!line.name.startsWith(this.taskName)) {
      line.name = `${this.taskName}_${line.name || 'cross_jaw'}`
    }
    this.group.add(line)
  }
}

/**
 * 批量添加对象到对应的 mesh
 */
protected addMultipleToMesh(objects: THREE.Object3D[], fdi: number): void {
  objects.forEach(obj => this.addToMesh(obj, fdi))
}
```

### 2. BoltonAnalysisStrategy 改造

**改造前：**
```typescript
this.group.add(measureLine)
this.group.add(label)
```

**改造后：**
```typescript
const fdi = Number(fdiStr)

// 直接添加到对应的 mesh
this.addToMesh(measureLine, fdi)
this.addToMesh(label, fdi)

// 信息面板保持添加到主 group
this.group.add(frontPanel)  // 全局信息，不属于特定牙齿
```

### 3. ArchWidthAnalysisStrategy 改造

**改造前：**
```typescript
this.group.add(line)
this.group.add(marker1)
this.group.add(marker2)
this.group.add(widthLabel)
this.group.add(tooth1Label)
this.group.add(tooth2Label)
```

**改造后：**
```typescript
// 智能添加线（自动判断上下颌或跨颌）
this.addLineToMesh(line, fdi1, fdi2)
this.addLineToMesh(widthLabel, fdi1, fdi2)

// 直接添加标签到对应的 mesh
this.addToMesh(tooth1Label, fdi1)
this.addToMesh(tooth2Label, fdi2)
```

### 4. ToothNumberAnalysisStrategy 改造

**改造前：**
```typescript
// 手动判断上下颌
const isUpperTooth = this.isUpper(fdi)
const targetMesh = isUpperTooth ? this.context.upperMeshLabel : this.context.lowerMeshLabel

if (!targetMesh) {
  console.warn(`⚠️ 未找到目标 mesh: ${isUpperTooth ? '上颌' : '下颌'}`)
  return
}

// 手动设置名称前缀
label.name = `${this.taskName}_label_${fdi}`

// 手动添加到 mesh
targetMesh.add(label)
```

**改造后：**
```typescript
// 创建标签
const label = LabelRenderer.createLabel(fdiStr, {
  position: center,
  fontSize: 14,
  backgroundColor: 'transparent',
  fontColor: '#ffffff',
})
label.name = `label_${fdi}`

// 使用方案2：一行代码搞定（自动判断上下颌、自动添加前缀）
this.addToMesh(label, fdi)
```

**优势：**
- ✅ 代码从 13 行减少到 2 行
- ✅ 自动判断上下颌，不需要手动判断
- ✅ 自动添加 taskName 前缀
- ✅ 自动处理 mesh 不存在的情况

### 5. SceneManager 简化

**改造前：**
```typescript
// 需要手动遍历 scene，设置 group 可见性
const updateStrategyGroups = (showUpper: boolean, showLower: boolean) => {
  this.scene.traverse((obj) => {
    if (obj.name.endsWith('_upper_group')) {
      obj.visible = showUpper
    } else if (obj.name.endsWith('_lower_group')) {
      obj.visible = showLower
    }
  })
}

// 每个 case 都要调用
updateStrategyGroups(true, false)
```

**改造后：**
```typescript
// 只需要控制 mesh 的可见性，子对象自动跟随
upperMesh.visible = true
upperMeshLabel.visible = true
lowerMesh.visible = false
lowerMeshLabel.visible = false

// 不需要任何额外的策略 group 控制！
```

## 🎯 核心优势

### 1. 结构简单
```
改造前：Scene → Strategy Group → Upper/Lower Group → Objects
改造后：Scene → Mesh → Strategy Objects  ✅
```

### 2. 可见性自动同步
```typescript
// 隐藏下颌 mesh
lowerMeshLabel.visible = false

// 所有添加到 lowerMeshLabel 的子对象自动隐藏 ✅
// - Bolton 分析的测量线 → 自动隐藏
// - 牙弓宽度的测量线 → 自动隐藏
// - 所有标签 → 自动隐藏
```

### 3. 代码量减少
- ❌ 不需要创建和管理 `upperGroup/lowerGroup`
- ❌ 不需要 SceneManager 中的 `updateStrategyGroups`
- ❌ 不需要手动同步可见性
- ✅ 只需要一行代码：`this.addToMesh(object, fdi)`

### 4. 与 newModel 一致
```typescript
// newModel 的做法（完全相同的模式）
generateToothLabels(result.centersUpper, upperMeshLabel)
generateToothLabels(result.centersLower, lowerMeshLabel)
```

## 📝 迁移指南

### 识别需要改造的代码

找出所有 `this.group.add(xxx)` 的地方，判断是否需要分配到上下颌：

#### 需要改造：属于特定牙齿的元素
```typescript
// ❌ 改造前
this.group.add(measureLine)
this.group.add(label)

// ✅ 改造后
this.addToMesh(measureLine, fdi)
this.addToMesh(label, fdi)
```

#### 不需要改造：全局元素
```typescript
// ✅ 保持不变（信息面板、诊断结果等）
this.group.add(infoPanel)
this.group.add(diagnosisLabel)
```

### 使用合适的方法

| 元素类型           | 推荐方法                          | 示例               |
| ------------------ | --------------------------------- | ------------------ |
| 单个牙齿的元素     | `addToMesh(object, fdi)`          | 测量线、标签、标记 |
| 连接两颗牙齿的线   | `addLineToMesh(line, fdi1, fdi2)` | 宽度测量线         |
| 同一牙齿的多个对象 | `addMultipleToMesh([...], fdi)`   | 批量添加           |
| 跨颌元素           | `this.group.add(object)`          | 咬合关系线         |
| 全局信息           | `this.group.add(object)`          | 信息面板           |

### 完整示例

```typescript
protected renderSpecificElements(data: AnalysisData): void {
  const { teeth_points, measurements } = data
  
  // 遍历每颗牙齿
  Object.entries(toothGroups).forEach(([fdiStr, points]) => {
    const fdi = Number(fdiStr)
    
    // 创建测量线
    const line = LineRenderer.createMeasurementLine(start, end, { color: 0x00ff00 })
    line.name = `line_${fdi}`
    
    // ✅ 添加到对应的 mesh
    this.addToMesh(line, fdi)
    
    // 创建标签
    const label = LabelRenderer.createLabel(`${width}mm`, { position })
    label.name = `label_${fdi}`
    
    // ✅ 添加到对应的 mesh
    this.addToMesh(label, fdi)
  })
  
  // 全局信息面板
  const infoPanel = LabelRenderer.createInfoPanel(data, {...})
  
  // ✅ 全局元素添加到主 group
  this.group.add(infoPanel)
}
```

## 🔧 注意事项

### 1. 命名规范
所有添加到 mesh 的对象都会自动添加策略名称前缀：
```typescript
// 原始名称
line.name = 'line_11_21'

// 自动添加前缀后
line.name = 'bolton_line_11_21'  // taskName 为 'bolton'
```

### 2. 清理逻辑
`cleanupMeshChildren()` 方法会根据名称前缀清理：
```typescript
if (child.name.startsWith(`${this.taskName}_`)) {
  mesh.remove(child)
  // 释放资源...
}
```

### 3. 切换策略可见性
```typescript
toggle(visible: boolean): void {
  this.visible = visible
  this.group.visible = visible  // 主 group（信息面板等）
  this.toggleMeshChildren(visible)  // mesh 上的对象
}
```

### 4. 跨颌元素特殊处理
对于连接上下颌的元素（如咬合分析），`addLineToMesh` 会自动添加到主 group：
```typescript
// 自动识别跨颌
this.addLineToMesh(line, 11, 41)  // 11 是上颌，41 是下颌
// → 添加到 this.group（不是 mesh）
```

## 🚀 测试建议

改造完成后，测试以下场景：

### 1. 视角切换测试
- ✅ 全部视图 → 上下颌元素都显示
- ✅ 上颌视图 → 只显示上颌元素
- ✅ 下颌视图 → 只显示下颌元素
- ✅ 角度视图 → 正确显示对应颌的元素

### 2. 策略切换测试
- ✅ 启用策略 → 元素正常显示
- ✅ 禁用策略 → 元素完全隐藏
- ✅ 切换策略 → 旧元素清理，新元素显示

### 3. 资源清理测试
- ✅ 切换策略多次 → 内存不增长
- ✅ 检查 mesh.children 数量 → 正确清理

## 📊 性能对比

| 指标         | 方案1（Group） | 方案2（Mesh） | 提升 |
| ------------ | -------------- | ------------- | ---- |
| 场景对象数量 | 多 2 层        | 少 2 层       | ✅    |
| 可见性同步   | 手动遍历       | 自动继承      | ✅    |
| 代码复杂度   | 高             | 低            | ✅    |
| 维护成本     | 高             | 低            | ✅    |

## 📚 参考文件

- `src/page/oralAnalysis/strategies/base/BaseAnalysisStrategy.ts` - 基类实现
- `src/page/oralAnalysis/strategies/BoltonAnalysisStrategy.ts` - Bolton 改造示例
- `src/page/oralAnalysis/strategies/ArchWidthAnalysisStrategy.ts` - 牙弓宽度改造示例
- `src/page/oralAnalysis/core/SceneManager.ts` - 简化后的场景管理器
- `src/page/newModel/index.vue` - newModel 的参考实现（233-238 行）

## 🎉 迁移状态

### 已完成改造 ✅
- ✅ BaseAnalysisStrategy（基类）
- ✅ BoltonAnalysisStrategy（Bolton 分析）
- ✅ ArchWidthAnalysisStrategy（牙弓宽度）
- ✅ ToothNumberAnalysisStrategy（牙号）

### 待改造 ⏳
- ⏳ ArchSymmetryAnalysisStrategy（牙弓对称性）
- ⏳ CrossbiteAnalysisStrategy（反合）
- ⏳ CrowdingAnalysisStrategy（拥挤度）
- ⏳ LowerCurveAnalysisStrategy（下颌曲线）
- ⏳ MidlineAnalysisStrategy（中线分析）
- ⏳ OcclusionAnalysisStrategy（咬合）
- ⏳ OverbiteAnalysisStrategy（覆合覆盖）
- ⏳ ToothGapAnalysisStrategy（牙间隙）
- ⏳ UpperCurveAnalysisStrategy（上颌曲线）

## 🔑 改造关键点总结

### 核心原则
当元素添加到 mesh 时，**不要应用缩放**，因为 mesh 本身已经有 `scale = 1.5`：

```typescript
// ❌ 错误：双重缩放
sphere.position.set(x * 1.5, y * 1.5, z * 1.5)
const line = LineRenderer.createLine(...)  // 内部会缩放

// ✅ 正确：不缩放
sphere.position.set(x, y, z)
const line = this.createLineUnscaled(...)  // 不缩放
```

### 常用方法对照表

| 用途     | 添加到 Group（缩放）        | 添加到 Mesh（不缩放）                  |
| -------- | --------------------------- | -------------------------------------- |
| 创建线   | `LineRenderer.createLine()` | `this.createLineUnscaled()`            |
| 计算中点 | `this.getMidPoint()`        | `this.getMidPointUnscaled()`           |
| 点位位置 | `position * 1.5`            | `position`                             |
| 添加对象 | `this.group.add()`          | `this.addToMesh(obj, fdi)`             |
| 添加线   | `this.group.add()`          | `this.addLineToMesh(line, fdi1, fdi2)` |

### 材质设置（自动处理）

`addToMesh` 方法会自动设置以下属性：
```typescript
object.renderOrder = 999        // 最后渲染
material.depthTest = false      // 不被遮挡
material.depthWrite = false     // 不遮挡其他元素
material.transparent = true     // 支持透明
```

---

**创建时间**: 2025-12-08  
**方案**: 方案2 - 直接添加到 Mesh

