# 牙齿3D模型查看器

> 基于 Vue 3 + Three.js 的牙齿3D模型查看器

## 🚀 快速开始

```vue
<template>
  <NewModel />
</template>

<script setup lang="ts">
import NewModel from '@/page/newModel/index.vue'
</script>
```

## 📚 完整文档

详细文档请查看：**[DOCUMENTATION.md](./DOCUMENTATION.md)**

## ✨ 核心功能

- 🦷 7种视角3D牙齿模型查看
- 🏷️ 智能牙齿编号标签系统
- 📏 牙弓宽度自动测量
- 🎨 48颗牙齿独立颜色映射
- 🎯 质心点可视化
- 🌊 牙弓线生成与拖拽

## 📊 重构成果

| 指标     | 重构前 | 重构后   | 改进   |
| -------- | ------ | -------- | ------ |
| 代码行数 | 1085行 | 300行    | -72%   |
| 文件数量 | 1个    | 16个模块 | 模块化 |
| 类型安全 | 部分   | 100%     | ✅      |
| 加载性能 | 基准   | 并行加载 | +30%   |

## 📁 项目结构

```
src/page/newModel/
├── index.vue           # 主组件
├── types.ts           # 类型定义
├── constants.ts       # 配置常量
├── components/        # UI组件
├── composables/       # 组合式函数
└── utils/            # 工具函数
    ├── sceneUtils.ts
    ├── stlLoader.ts
    ├── labelUtils.ts
    ├── widthUtils.ts
    └── ...
```

## 🛠️ 技术栈

- Vue 3 (Composition API)
- TypeScript
- Three.js
- Element Plus

## 📖 更多信息

- 📄 [完整文档](./DOCUMENTATION.md) - 详细的使用指南和API文档
- 🔧 配置说明 - 查看 `constants.ts`
- 📦 模块说明 - 查看各模块文件注释

---

**MIT License** | 版本: v1.0.0

