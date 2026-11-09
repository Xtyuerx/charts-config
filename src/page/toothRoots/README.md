# 模拟牙根与单牙独立操作

运行项目：`npm run dev`，访问 `/toothRoots`。推荐 Node 22.12+。

技术栈：Vue 3 + TypeScript + Three.js + @msgpack/msgpack。无需新增依赖。默认加载内置上下颌示意牙冠和 32 个独立牙位 OBJ 牙根模板。导入真实文件后，牙冠来自原始口扫网格。

场景只展示独立牙冠与虚拟牙根，不展示标签 0 的牙龈。牙龈的渲染副本释放，原始数据完整保留并参与保存。

## 五步代码

五步组合成一个完整可运行页面，函数均在源码中带有注释。

| 步骤 | 源文件与入口 | 结果 |
| --- | --- | --- |
| 1. 加载并解析 | `core.ts`：`parseDocument`、`decodeSurface`；`index.vue`：`loadFile/loadUrl/loadHex` | hex/bin 解码，分别保留 lower_seg、upper_seg、lower_teeth、upper_teeth |
| 2. 提取牙齿 | `core.ts`：`extractTeeth`、`readStoredFrame`、`cervicalLoop`、`longAxis` | 原顶点索引集合、现有三角面副本；优先原始轴和牙颈，缺失时几何估计 |
| 3. 牙根模板 | `core.ts`：`loadRootTemplate`、`fitRoot`；`index.vue`：`install` | OBJ/PLY 加载，模板颈圈贴合，独立牙根网格 |
| 4. 局部操作 | `index.vue`：`buildGizmo`、`pointerDown/Move/Up` | Ctrl 拾取、X/Z 轴平移、绕局部 Z 红弧旋转、pointer capture 与相机锁定 |
| 5. 保存上传 | `core.ts`：`saveDocument`、`restoreTooth`、`uploadDocument`；`index.vue`：`download/upload` | 完整数据导出/上传、加载时恢复姿态、失败时保留操作 |

## 加载格式

- 二进制 MessagePack 或完整 hex 文本，允许空白、`0x` 前缀。
- `seg.mesh.data` 必须是 bin（Uint8Array）。带 `DRACO` 文件头的数据用现有 `/draco/` 解码器解压，支持 `drcp/dcrp/drc` 等类型标签。
- float32 约定为小端序连续 XYZ。`type: 'float32'` 自动识别；其他 type 必须在界面显式选择 float32，避免把压缩数据当坐标。
- float32 有索引时提供 `mesh.indices: number[]`；无索引时必须为三角形汤（每 9 个 float 组成一个三角形）。单纯点云没有足够信息构建表面，不猜测其拓扑。
- 标签可选逐顶点、逐三角面或自动。顶点数和面数都匹配时要求显式选择。Draco 标签必须已经按解压后顺序排列。
- 顶点标签的跨标签面沿用原查看器的多数归属策略，只分组原有面。显示提示，不重分割、不生成切口。
- 上下颌都有独立对象；切换颌位保留内存操作。FDI 31–37 / 41–47 以及 38/48、上颌牙位均支持。
- 模型在原始 mesh 坐标下显示和保存，`align_matrix` 原样保留。本演示没有猜测其字节布局或额外应用矩阵。

## 牙颈与长轴

优先读取 `{jaw}_gum.tooth_boundary_dict[牙号]` 的真实 XYZ 边界，无需显示牙龈。缺少或格式无效时，从牙冠副本开放边提取闭环：先用界面备用根向消除保存长轴的正负号歧义，再按根向选择闭环。没有可用边界时提示并跳过牙根。

优先读取 `{jaw}_axis[牙号]`，它是行排列的 4×4 模型→单牙局部变换，bin 末尾带 `|4,4,<f8` 或 `|4,4,<f4`。按小端序读取、转置到 Three.js 的列排列、校验刚性旋转并取逆。原点使用逆矩阵的平移；本数据约定第二方向为长轴，因此显示 X=保存的第一方向、Z=保存的第二方向、Y=Z×X。Z 的符号按牙颈→牙冠方向校正，Y 同步保持右手系；根向为显示 −Z。

轴缺失或无效才使用旧的 PCA 与邻牙牙弓方向估计，原点取牙冠唯一顶点平均。界面显示每牙坐标系和牙颈的来源。相机在有原始轴时使用牙冠方向作为画面上方，以便牙冠朝上、根向下；这是视角调整，原始模型坐标保持不变。不猜测或重复应用 auto_plane_matrix。

## 模板约定

`public/root-templates/{FDI}.obj`，每牙位一个模板，OBJ 只有一个对象/网格。上下颌磨牙分别采用三根/二根示意形状，部分上颌前磨牙为二根。**这些是程序生成的示意标准形状，不是解剖牙根库。** 使用正式模板时替换这些文件，或更改页面模板目录后重新加载。

- 模板颈圈在 z=0，单位径向半径 1；根尖在 z=-1。
- 运行时颈圈贴合牙颈径向轮廓，Z 按设定长度缩放；轮廓变形仅在根颈上部 25% 过渡，下方保留模板的椭圆缩放形状，避免把牙颈尖角拉长为尖刺。只焊接牙根模板的顶点以计算平滑法线。
- 要求边界关于中心为星形。复杂凹形边界或精细临床贴合需单独的配准算法；当前实现不保证根表面连续曲率和解剖准确性。
- 默认模板为 OBJ；已有保存参数的 `root.template` 可设为 `.ply`，使用同一单位坐标约定。
- 重新生成示意资产：`node scripts/generate-root-templates.mjs`。
- 长度和平移值采用输入模型坐标单位，只有模型单位为 mm 时才表示毫米。

## 咬合跳跃

顶部「咬合跳跃」开启整体下颌调整面板，并显示上下颌。前后、左右、上下位移范围为 −20～20 模型单位，张口角度为 0～30°，滑块与数值输入同步。正值分别为前移、右移、抬高与张口；方向由原始下颌牙轴及牙弓估算，张口转轴取磨牙区域，属于几何模拟。

下颌牙冠、牙根、牙龈、牙轴、边界与关键点共享整体刚性变换。单牙编辑仍使用原有局部姿态。「原始」临时移除整体变换并保留单牙编辑，「调整后」恢复参数，「一键复位」将四项参数归零。关闭面板保留当前显示姿态。碰撞及测量以当前显示的世界姿态为准，变更参数或切换对比后旧结果失效，需要重新计算。

导出及上传在完整数据顶层保存 `occlusal_jump: { schema: 'occlusal-jump-v1', parameters: { forward, lateral, vertical, opening } }`，重新载入默认显示调整后姿态；即使正在查看「原始」，保存时也会保留调整参数。旧数据按零调整加载。非法参数会拒绝载入并保留当前模型。验证用例：`tests/occlusalJump.spec.ts`、`tests/occlusalJumpPage.spec.ts`。

## 交互与保存字段

Ctrl+点击牙冠/牙根，或点击底部牙位按钮选牙。红 X、蓝 Z 轴用于平移，红弧用于绕局部 Z 旋转，普通空白拖动用于视角旋转。也可使用数值操作按钮。取消 pointer 拖动还原拖动起点；“重置姿态”恢复原始几何坐标，不重置牙根长度。

点击导出或上传时才创建完整 MessagePack 快照，示例新增字段如下：

```json
{
  "lower_teeth": {
    "31": {
      "editor": {
        "schema": "tooth-roots-v2",
        "baseFrame": [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1],
        "position": [0, 0, 0],
        "quaternion": [0, 0, 0, 1],
        "root": {"template": "31.obj", "length": 12}
      }
    }
  }
}
```

position/quaternion 是原始模型坐标中的绝对 Group 姿态。baseFrame 是保存时局部基准到模型的 16 元素 column-major 矩阵。加载后使用 `savedPose × inverse(savedBaseFrame) × currentBaseFrame` 恢复，避免更换轴计算方法后编辑漂移。旧 v1 数据以旧开放边/PCA 基准恢复世界变换，并在下次保存升级为 v2。

其他单牙字段、已有 editor 元数据、其他颌位、mesh.data、seg_labels、原始 axis、牙颈边界和未知字段保留。支持 BigInt64，避免未知 uint64 字段精度丢失。数据内容完整上传，MessagePack 编码字节布局不要求和原文件一致。

若实际 teeth 不是牙号对象字典，或后端已有另一套姿态字段，需要修改 `saveDocument/restoreTooth` 的适配入口。此页面不覆盖未知结构。

## 后端适配器

项目没有这三个接口的实现或真实契约，页面提供可配置的 JSON POST 适配器，不宣称已经接入生产服务。填写接口基础地址、病例 ID 后，导入的非演示数据可上传。

1. POST `{base}/getUpdateEditVersion`：请求 `{caseId}`，响应 `{version}`。
2. POST `{base}/getUploadPath`：请求 `{caseId,version}`，响应 `{url,key,headers?}`。headers 为 OSS 签名要求的请求头。
3. PUT `url`：请求体为**完整二进制 MessagePack**，仅使用签名头，不携带应用 Cookie。
4. POST `{base}/update`：请求 `{caseId,version,key}`，必须成功响应 JSON 后才清除未保存标记。

响应也支持 `{data: ...}` 包装；`success:false` 或 `code` 非 0/200 判为业务失败。应用接口携带 credentials。真实响应、鉴权、请求方法不同，请在 `index.vue` 的 `upload` 中替换适配器，`uploadDocument` 的顺序与错误处理可以保留。

拖动不上传。PUT 或 update 失败保留当前编辑；服务端应为版本预留提供重试/回滚策略。成功上传前不会修改 source。演示数据导出再导入仍带 demo 标志并禁止上传。

## 验证

### 咬合碰撞

顶部工具栏同时提供三项基于原始牙冠网格的测量：

- 邻牙间隙：按 FDI 邻接顺序逐对计算当前颌位牙冠的最近表面距离，跨中线，跳过缺牙间隔。
  最近点以黄色点线显示；0 为表面接触或相交，无负间隙及穿透深度。
- 测距：Shift 点击可见原牙冠表面取两个点，显示世界坐标中的直线距离；第三次取点开始新测量。
- 咬合截面：完整模型上显示蓝色半透明切片，不裁切或隐藏模型。点击牙齿或牙号后切片移动到该牙冠中心，
  默认以牙齿局部 X 轴为法向，包含局部牙长轴；也可选择世界 X/Y/Z 方向并调整相对牙位的偏移。
  左上角同步显示上下颌的二维截面轮廓。退出工具移除切片和预览；此切片不是临床参考平面拟合结果。

测量使用模型单位，未假定为毫米；牙齿姿态或数据改变后清除旧结果。
Bolton、拥挤度、对称性、覆𬌗覆盖、Spee 深度及错位度需要进一步定义牙宽测量点、牙弓、
参考平面或目标姿态，目前未输出未经这些规则确认的结果。
测试：`tests/toothMeasurements.spec.ts`、`tests/toothMeasurementsPage.spec.ts`。

牙轴查看模式：开启“牙轴”或“全部牙轴”后，隐藏牙龈和模拟牙根，牙冠材质改为白色，
显示 `crownClosure.ts` 基于网格开放边生成的独立封口网格；关闭后恢复原显示设置。
封口通过坐标焊接识别简单边界闭环，投影三角化后使用原边界三维坐标构建。
投影重叠或缺失三角面时，以边界中心扇形生成近似显示封口，保留全部边缘；此封口不代表解剖结构。
原始牙冠顶点、三角索引、牙颈边界和导出数据不变，咬合碰撞仍使用原牙冠。
无法封闭的分叉边界、非流形边等会提示，不将这些缺陷宣称为已修复。

仍使用 `/toothRoots` 页面，顶部横向工具栏的“咬合碰撞”按钮开启检测面板。
开启时自动显示上下颌并隐藏模拟牙根，关闭时恢复这两个开关的原状态。
仅使用牙冠几何及当前世界姿态，原始数据不写入碰撞标记；未额外应用含义尚未确认的咬合矩阵。

`collision.ts` 使用 BVH 包围盒筛选、三角面相交和最近表面距离查询。
红色覆盖实际相交的三角面，黄色点线连接阈值内牙对的最近表面位置。
阈值按模型单位解释，尚未校验为毫米；距离为无符号间隙，不提供穿透深度、重叠体积或完全包容检测。
缺少对颌数据时显示提示。牙齿姿态、阈值或文件改变后清除旧结果，需点击“重新检测”。

验证用例：`tests/occlusalCollision.spec.ts`、`tests/occlusalCollisionPage.spec.ts`。
页面测试默认使用 4176 端口，可通过 `TOOTH_ROOTS_BASE_URL` 指定本地服务地址。

```powershell
node node_modules/@playwright/test/cli.js test tests/toothRootsCore.spec.ts --project=chromium --reporter=line
node node_modules/vue-tsc/bin/vue-tsc.js -p tsconfig.tooth-roots-check.json --noEmit
# 先在另一终端启动 npm run dev -- --host 127.0.0.1 --port 4175
node node_modules/@playwright/test/cli.js test tests/toothRootsPage.spec.ts --project=chromium --reporter=line --workers=1
```

核心测试覆盖未知字段/64 位整数保留、原始 bytes/标签不变、牙颈提取、完整二进制上传顺序与失败短路。页面测试覆盖实际 Ctrl 点击、轴/弧鼠标拖动、非法长度、上下颌切换、导出与恢复。

真实样本测试使用环境变量 `TOOTH_ROOTS_SAMPLE`（默认本机 `E:/rs_zy/python_demo/mesh-processing-and-seg.msgpack`）。文件不存在时跳过此项，不将用户原始文件复制进仓库。此项检查 28 个保存轴、28 条牙颈、原始字段完整保留和编辑导出后恢复。

本机真实样本截图曾因 Playwright 字体等待超时，验证时设置 `$env:PW_TEST_SCREENSHOT_NO_FONTS_READY='1'` 后通过，仍检查实际渲染截图。

本次常规构建遇到宿主对 `components.d.ts` 的写入错误，打包验证使用 `node scripts/build-tooth-roots-check.mjs`：沿用项目插件和源码，只关闭声明文件自动写入。现有项目的大包提示和其他页面的重复属性警告仍保留。专用类型检查只覆盖此功能及其依赖，不表示整个项目的类型检查已通过。

接口参考：[Three.js](https://threejs.org/docs/)、[MessagePack JavaScript](https://github.com/msgpack/msgpack-javascript)。
