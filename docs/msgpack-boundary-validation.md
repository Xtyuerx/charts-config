# 验证结果

验证环境：本地 Node.js 24.19.0，Chromium，单个 Vite 服务 `127.0.0.1:4175`。

- 保存点位修复后，35 项 MessagePack 相关测试通过，含真实 Draco 编码与浏览器解码、实际控制点拖动、局部标签 diff、完整下载、上下颌切换与重置、取消拖动、候选文件恢复和方向反转拒绝。顶点标签与预览两种模式均测试了保存后刷新页面再加载；画布截图与保存前逐字节一致。
- `vue-tsc -p tsconfig.msgpack-check.json --pretty false` 通过。
- `src/page/msgpackTeeth` 的 ESLint 通过。
- `git diff --check` 通过。
- 此前全项目 Chromium 回归：205 通过、5 失败、2 跳过、4 未运行。保存点位修复后未重复全项目回归。完整输出保留在工作区 `full-regression.log`（日志被仓库忽略规则排除）。

全项目失败项（均位于本次未修改的页面测试文件）：

1. `allStlToModelRepair.spec.ts:13` — `saves current jaws and navigates to model repair`。
2. `toothSegmentationTestPage.spec.ts:98` — `displays the allStl upper and lower jaw data in a standalone workspace`。
3. `toothSegmentationTestPage.spec.ts:160` — `keeps the seed preview when a generated boundary cannot be prepared`。
4. `toothSegmentationTestPage.spec.ts:188` — `confirms a lower-jaw region with its jaw key and required independent Mesh material`。
5. `toothSegmentationTestPage.spec.ts:233` — `reconfirms the same tooth by replacing its Mesh at the same jaw key`。

`toothSegmentationTestPage` 中存在匹配多个 canvas 或多个“分牙”按钮的严格选择器失败。其他失败详情及未运行用例见完整日志。没有把全项目回归报告为全部通过。

全项目 `vue-tsc --build` 还报告了其他页面中的类型错误，例如 `baseTest.vue` 的 TrackballControls 导入，以及多个旧模型页面的空值/类型错误。本次页面及其依赖链的独立类型检查通过。

项目没有用户描述的 154987 顶点真实 MessagePack 文件；真实样本的几何质量、标签是否遵循 Draco 解码顶点顺序，以及大模型的交互性能尚未验收。
