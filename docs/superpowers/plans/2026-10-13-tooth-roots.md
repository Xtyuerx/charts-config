# 模拟牙根演示实现计划

> 执行方式：当前会话直接实现，用户已要求跳过 brainstorming。

**目标：** 新增 `/toothRoots` Vue 演示页，按五步交付可运行实现。
**架构：** `core.ts` 提供数据、几何、保存函数；`index.vue` 管理渲染、手柄、界面。牙冠与根共用局部 Group，原数据仅保存时复制更新。
**技术栈：** Vue 3、TypeScript、Three.js、@msgpack/msgpack，使用当前安装依赖。
**需求来源：** 本会话用户给出的五步需求。

## 约束与检查
- 不重新分割，不改原 mesh.data、seg_labels；上传完整 MessagePack。
- 原模型格式必须显式识别；float32 无索引时仅支持三角形汤。
- 颈部开放边缘只是估计，缺少闭环应提示，不能假造精确牙颈。
- 模板为示意标准形状，单牙位 OBJ；不宣称解剖准确。
- 接口缺少真实契约，提供可配置 JSON 适配器，检查 HTTP 和返回结构。
- 测试保存往返、未知字段保留、颌位隔离、失败时不调用 update。

## 五步
- [x] 1. 加载：hex/bin MessagePack、Draco/float32、字段校验；先写解析失败/往返测试。
- [x] 2. 提取：标签顶点索引、现有三角面分组、开放边缘闭环、PCA 与牙弓坐标系；用开放圆柱验证闭环。
- [x] 3. 模板：生成各 FDI 牙位 OBJ，约定颈部 z=0、根向 -Z；缩放并变形颈圈贴合边界。
- [x] 4. 交互：Ctrl 选牙、轴/弧同时展示、pointer capture 拖动、禁用视角旋转、内存更新与重置。
- [x] 5. 保存：仅新增 teeth 的 editor 字段、完整导出、顺序 getUpdateEditVersion → getUploadPath → PUT → update；测试错误传播。

## 验证
运行新核心 Playwright 测试、页面 Chromium 测试、专用 vue-tsc 检查、Vite build；检查新页面截图和 git diff。不提交已有用户改动。

## 执行记录
- 核心四项测试通过（含未知 uint64 和 editor 元数据保留）。
- 浏览器三项测试通过（真实 Ctrl 拾取、轴与弧拖拽、非法参数、导出与恢复）。
- 专用 vue-tsc 检查通过。
- 常规 build 的 components.d.ts 写入被宿主阻断；使用关闭 d.ts 自动写入的同插件构建脚本，3754 模块打包成功。
- Ruling：上传接口使用可配置 JSON POST 契约 — 仓库无真实接口实现 — 生产接入需替换适配器。
- Ruling：牙根模板为每 FDI 的可替换示意 OBJ，牙颈为开放边几何估计 — 没有正式模板与临床牙颈信息 — 不保证解剖准确性。
- 独立审查两项重要问题均以失败测试复现并修复；保留原页面用户改动。
