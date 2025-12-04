# Overbite 深覆合分析功能文档

## 功能概述

Overbite（深覆合）分析功能用于可视化上下前牙的垂直覆盖关系，帮助医生诊断深覆合程度。

## 数据结构

### 输入数据 (从 `stl_all_demo.json` 提取)

```typescript
interface OverbiteAnalysisData {
  teeth_points: OverbitePoint[]
  measurements: {
    H_total: number      // 总高度（下牙切端到龈缘的距离，mm）
    H_overlap: number    // 覆合高度（上下牙切端垂直重叠，mm）
    ratio: number        // 覆合比例
    diagnosis: string    // 诊断结果，如 "I度深覆合"
    severity: string     // 严重程度，如 "轻度"
  }
}

interface OverbitePoint {
  fdi: number                                    // 牙齿 FDI 编号
  type: 'incisal_edge' | 'gingiva_margin'       // 点类型
  type_cn: string                                // 中文名称
  point: [number, number, number]                // 3D 坐标 [x, y, z]
}
```

### 示例数据

```json
{
  "task_name": "overbite",
  "diagnosis_result": {
    "teeth_points": [
      {
        "fdi": 11,
        "type": "incisal_edge",
        "type_cn": "切端点",
        "point": [32.45, 24.12, -12.34]
      },
      {
        "fdi": 41,
        "type": "incisal_edge",
        "type_cn": "切端点",
        "point": [29.12, 18.45, -14.67]
      },
      {
        "fdi": 41,
        "type": "gingiva_margin",
        "type_cn": "龈缘点",
        "point": [29.34, 16.23, -10.89]
      }
    ],
    "measurements": {
      "H_total": 8.5,      // 下牙冠高度
      "H_overlap": 3.2,    // 覆合量
      "ratio": 0.376,      // 覆合比例
      "diagnosis": "I度深覆合",
      "severity": "轻度"
    }
  }
}
```

## 可视化元素

### 1. 测量线

#### H_total（绿色）
- **起点**：下牙龈缘点（gingiva_margin）
- **终点**：下牙切端点（incisal_edge）
- **含义**：下前牙临床冠高度
- **颜色**：绿色 (#00ff00)
- **标签**：显示数值（如 "H_total: 8.5mm"）

#### H_overlap（红色）
- **起点**：下牙切端点（incisal_edge）
- **终点**：下牙切端点向上偏移 H_overlap 距离
- **含义**：上下前牙切端的垂直重叠量
- **颜色**：红色 (#ff0000)
- **标签**：显示数值（如 "H_overlap: 3.2mm"）

### 2. 标记点

- **上牙切端点**：蓝色球体 (#0000ff) + 标签（如 "上11切端"）
- **下牙切端点**：黄色球体 (#ffff00) + 标签（如 "下41切端"）
- **下牙龈缘点**：青色球体 (#00ffff) + 标签（如 "下41龈缘"）

### 3. 诊断结果标签

- 显示在上牙切端点上方
- 白色背景，黑色文字
- 内容：诊断 + 严重程度（如 "I度深覆合 (轻度)"）

## 渲染特性

- **depthTest: false**：确保测量线和标签始终可见，不被模型遮挡
- **renderOrder: 999**：提高渲染优先级，保证显示在最上层
- **双箭头**：测量线两端带箭头，方向指示测量范围

## 使用方法

### 代码集成

```typescript
import { 
  renderOverbiteAnalysis, 
  toggleOverbiteAnalysis,
  extractOverbiteData 
} from './utils/overbiteUtils'

// 1. 加载数据
const diagnosisData = await loadDiagnosisData('/points/stl_all_demo.json')
const overbiteData = extractOverbiteData(diagnosisData)

// 2. 渲染
if (overbiteData) {
  const overbiteGroup = renderOverbiteAnalysis(overbiteData, scene)
  overbiteGroup.visible = false // 默认隐藏
}

// 3. 切换显示
toggleOverbiteAnalysis(scene, true)  // 显示
toggleOverbiteAnalysis(scene, false) // 隐藏
```

### UI 控制

在界面上添加了切换按钮：

```vue
<el-button @click="toggleOverbiteDisplay" type="success">
  {{ showOverbite ? '隐藏' : '显示' }} 深覆合分析
</el-button>
```

## 临床意义

### 正常覆合
- H_overlap / H_total ≈ 1/3（约 33%）
- 上前牙覆盖下前牙切端约 2-3mm

### 深覆合分类
- **I度（轻度）**：覆盖 1/3 - 1/2
- **II度（中度）**：覆盖 1/2 - 2/3
- **III度（重度）**：覆盖 > 2/3 或咬到牙龈

## 文件结构

```
src/page/newModel/
├── utils/
│   └── overbiteUtils.ts          # Overbite 核心功能
├── index.vue                      # 主页面（集成）
└── OVERBITE_FEATURE.md           # 本文档
```

## API 参考

### extractOverbiteData()

从完整诊断数据中提取 Overbite 数据。

**参数**：
- `diagnosisData`: 完整的诊断数据对象

**返回**：
- `OverbiteAnalysisData | null`: 提取的 Overbite 数据，如果不存在则返回 null

### renderOverbiteAnalysis()

渲染 Overbite 深覆合分析到场景中。

**参数**：
- `overbiteData`: Overbite 分析数据
- `scene`: Three.js 场景对象

**返回**：
- `THREE.Group`: 包含所有测量元素的组对象

### toggleOverbiteAnalysis()

切换 Overbite 测量的显示状态。

**参数**：
- `scene`: Three.js 场景对象
- `visible`: 是否显示（true/false）

## 注意事项

1. **坐标系统**：确保 STL 模型和 JSON 点位数据使用相同的坐标系
2. **Y 轴方向**：通常 Y 轴正方向为向上（咬合面到龈缘）
3. **多牙平均**：如果有多颗前牙数据，会自动计算平均位置
4. **标签缩放**：标签大小会随相机距离自动调整（Sprite 特性）

## 后续扩展

- [ ] 支持单颗牙齿的独立测量
- [ ] 添加覆合曲线可视化
- [ ] 支持动态测量（用户交互选点）
- [ ] 导出测量报告

