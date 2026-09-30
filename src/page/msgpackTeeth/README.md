# Msgpack 牙齿查看器

运行项目后访问 `/msgpackTeeth`。将文件放到 `public/models/jaw.msgpack` 后点击“加载 URL”，或直接选择电脑上的 msgpack 文件。两种入口都走 `fetch → msgpack.decode → DRACOLoader → seg_labels 分组 → MeshStandardMaterial → OrbitControls`。

默认数据结构（伪代码）：

```js
{
  mesh: Uint8Array, // MessagePack bin，内容是带 DRACO 文件头的独立 .drc 网格
  seg_labels: [11, 11, 12, 12] // 每个解压后顶点或三角面的整数标签
}
```

也支持实际牙科数据包结构：`lower_seg` / `upper_seg` 下分别包含 `mesh: { type: 'drcp', data: Uint8Array }` 和 `seg_labels`。加载后自动识别并提供上下颌切换，默认显示下颌。已在用户提供的样本中确认标签按三角面排列。

若没有整颌分割数据，但含 `lower_teeth` / `upper_teeth`（牙号 → `{ type: 'drc' 或 'drcp', data: Uint8Array }`），直接加载各牙网格，以字典键作为牙号，无需 `seg_labels`。若存在 `lower_gum.gum` / `upper_gum.gum`，一起加载为标签 0。两种结构同时存在时优先整颌分割数据。每次选择新文件会清除旧字段路径并重新识别；不含已知牙颌结构的附件/填充数据包会明确报错，不猜测模型和标签的配对。

其他结构可填写点分隔的 Draco 字段路径和标签字段路径，例如 `lower_seg.mesh.data`、`lower_seg.seg_labels`，然后点击“应用字段路径”，无需重新选择文件。“文件结构”支持单独查看一个顶层对象。

- 标签长度与顶点数相同则按顶点分组，与面数相同则按面分组；两者都匹配时必须手动指定。
- **标签必须对应 Draco 解压后的顺序。** Draco 编码可能重排顶点和面；原始网格标签需要由数据生产端同步重排或提供映射。仅检查长度不能识别顺序错误。
- 按面标签可准确分离三角面。按顶点标签时，跨标签三角面归多数标签；三个标签各不相同则取首顶点标签。页面会提示跨标签面数量。这是现有三角面的归属分组，不会生成新的切口、封口或精确边界。
- 标签 0 默认作为背景/牙龈保留。每个标签生成独立 Mesh，保留原坐标，并提供显隐开关。
- `seg_labels` 支持整数数组或每标签一字节的 bin，不自动猜测 NumPy 扩展类型、压缩标签或多字节整数的字节序。
- 解码器文件位于 `public/draco/`，来自当前安装的 Three.js。升级 Three.js 时同步更新这些文件。

接口参考：[DRACOLoader](https://threejs.org/docs/pages/DRACOLoader.html)、[@msgpack/msgpack](https://github.com/msgpack/msgpack-javascript)。

## 边界编辑

加载模型后，每颗牙显示绿色边界和蓝色控制点。优先读取当前颌位的 `tooth_boundary_dict`；没有边界数据时，从牙齿网格开放边缘提取最长闭环，无法提取的牙号会在页面提示。

点击线或点选中牙齿，线和所有控制点变白。拖动点时优先吸附当前牙齿或牙龈表面，未命中时沿起始点的视平面移动；原轮廓相邻控制点之间的线段实时跟随。拖动期间暂停 OrbitControls，松开或取消后恢复。支持边界显隐、重置选中边界；隐藏牙齿时同步隐藏其边界。

全部边界和控制点在独立 Scene 中最后绘制（包含模型透明绘制之后），清除深度后绘制覆盖层。拖动后每帧更新牙齿区域颜色，重置边界同时恢复原颜色。

颜色预览使用片元着色器，将模型表面位置投影到牙齿原始边界的固定局部平面，并逐像素判断是否在当前闭环内。同一三角面可以在边界内外显示不同颜色，不再按面中心给整面染色。只影响当前牙齿和牙龈，限制法向厚度以排除远处背面。此方式仍是局部投影的颜色预览：非平面边界存在投影近似，不生成切割网格，也不更新 `seg_labels`。

边界和着色调整仅保存在当前加载模型的内存中，重新加载或切换颌位会还原，不写回 msgpack。
