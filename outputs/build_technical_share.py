from pathlib import Path
from docx import Document
from docx.shared import Cm, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

OUT = Path(__file__).parent / '牙齿三维编辑技术路线与协作分享.docx'
doc = Document()
s = doc.sections[0]
s.page_width, s.page_height = Cm(21), Cm(29.7)
s.top_margin, s.bottom_margin = Cm(1.6), Cm(1.5)
s.left_margin = s.right_margin = Cm(2)
styles = doc.styles
for border in styles['Title']._element.xpath('.//w:pBdr'):
    border.getparent().remove(border)
for name in ['Normal','Title','Subtitle','Heading 1','Heading 2','Heading 3']:
    st = styles[name]
    st.font.name = 'Microsoft YaHei'
    st._element.get_or_add_rPr().rFonts.set(qn('w:eastAsia'), 'Microsoft YaHei')
    st.font.color.rgb = RGBColor(0,0,0)
styles['Normal'].font.size = Pt(10)
styles['Normal'].paragraph_format.line_spacing = 1.15
styles['Normal'].paragraph_format.space_after = Pt(5)
styles['Title'].font.size = Pt(24)
styles['Title'].paragraph_format.space_after = Pt(12)
styles['Subtitle'].font.size = Pt(11)
for name, size in [('Heading 1',17),('Heading 2',12),('Heading 3',11)]:
    styles[name].font.size = Pt(size)
    styles[name].paragraph_format.space_before = Pt(10)
    styles[name].paragraph_format.space_after = Pt(6)
footer = s.footer.paragraphs[0]
footer.alignment = WD_ALIGN_PARAGRAPH.RIGHT
r=footer.add_run('技术路线分享  |  '); r.font.size=Pt(8)
fld=OxmlElement('w:fldSimple'); fld.set(qn('w:instr'),'PAGE'); footer._p.append(fld)

def p(text, bold=False):
    para=doc.add_paragraph(); run=para.add_run(text); run.bold=bold; return para
def h(text): doc.add_heading(text,2)
def page(title):
    doc.add_page_break(); doc.add_heading(title,1)
def table(headers, rows, widths):
    t=doc.add_table(rows=1, cols=len(headers)); t.alignment=WD_TABLE_ALIGNMENT.CENTER; t.autofit=False
    for cell,w in zip(t.rows[0].cells,widths): cell.width=Cm(w)
    for cell,txt in zip(t.rows[0].cells,headers): cell.text=txt
    repeat=OxmlElement('w:tblHeader'); t.rows[0]._tr.get_or_add_trPr().append(repeat)
    for row in rows:
        cells=t.add_row().cells
        for cell,w,txt in zip(cells,widths,row): cell.width=Cm(w); cell.text=txt
    for ri,row in enumerate(t.rows):
        trpr=row._tr.get_or_add_trPr(); cant=OxmlElement('w:cantSplit'); trpr.append(cant)
        for ci,cell in enumerate(row.cells):
            cell.vertical_alignment=WD_CELL_VERTICAL_ALIGNMENT.CENTER
            tcpr=cell._tc.get_or_add_tcPr()
            borders=OxmlElement('w:tcBorders')
            for edge in ['top','left','bottom','right']:
                el=OxmlElement('w:'+edge); el.set(qn('w:val'),'single'); el.set(qn('w:sz'),'4'); el.set(qn('w:color'),'D9D9D9'); borders.append(el)
            tcpr.append(borders)
            margins=OxmlElement('w:tcMar')
            for edge in ['top','left','bottom','right']:
                el=OxmlElement('w:'+edge); el.set(qn('w:w'),'85'); el.set(qn('w:type'),'dxa'); margins.append(el)
            tcpr.append(margins)
            shade=OxmlElement('w:shd'); shade.set(qn('w:fill'),'DCE6F1' if ri==0 else ('F5F7FA' if ri%2==0 else 'FFFFFF')); tcpr.append(shade)
            for para in cell.paragraphs:
                para.paragraph_format.space_after=Pt(2); para.paragraph_format.line_spacing=1.1
                for run in para.runs: run.font.size=Pt(9); run.bold=ri==0
    doc.add_paragraph().paragraph_format.space_after=Pt(0)
    return t
def code(lines):
    for line in lines.split('\n'):
        para=p(line); para.paragraph_format.space_after=Pt(1)
        for r in para.runs: r.font.size=Pt(9)

doc.add_heading('牙齿三维编辑技术路线与协作分享',0)
p('从数据加载到边界编辑 牙根模拟与跨团队联调',True)
p('分享对象  前端开发 后端开发 算法工程师\n建议时长  30 分钟讲解 加 10 分钟讨论\n代码范围  msgpackTeeth 与 toothRoots 页面及其直接依赖\n日期  2026 年 10 月 27 日')
h('分享要解决的问题')
p('同一份牙颌数据，在算法端看起来正确，进入浏览器后却可能出现标签错位、牙轴方向反转、边界与颜色不一致，或者保存后无法复现。要快速解决这些问题，先让三方对数据和坐标有同一份解释，再讨论具体实现。')
p('这套实现把工作分为原始数据、编辑状态和显示副本三层。浏览器用显示副本完成交互，把需要保留的结果写入标签或版本化元数据，后端负责将完整快照与病例版本关联。算法侧需要明确每个结果的坐标、索引顺序、适用条件和可验证含义。')
h('先用两个页面讲清技术路线')
table(['页面','输入到输出的路线','主要改动'],[
('msgpackTeeth','MessagePack → Draco → 标签分区 → 曲面边界 → 完整导出','顶点标签或边界元数据'),
('toothRoots','整颌分割 → 单牙坐标系 → 根模板 → 位姿 → 咬合分析','单牙姿态 根参数 下颌整体参数')],[3.1,9.2,4.7])
h('建议讲解顺序')
p('前 5 分钟讲数据与职责；接着 10 分钟讲边界编辑、牙根拟合和坐标变换；再用 10 分钟讲后端协议、算法口径及问题定位；最后 5 分钟演示一次编辑、保存和重新加载。')
p('讲解主线：一个界面效果，必须能对应到一种明确的数据变化；一次保存，必须能解释由谁消费并如何复现。',True)

page('一 先对齐职责和数据契约')
p('联调开始时，先拿一份能被三方共同使用的最小样本。不要只发截图或一段压缩字节；同时给出字段定义、坐标说明、顶点数、面数和标签数，才能判断问题发生在哪一层。')
table(['参与方','主要责任','交接产物'],[
('前端','解码 渲染 交互 校验 编辑快照','字段错误报告 编辑前后对比 可复现步骤'),
('后端','病例与版本管理 上传授权 持久化','接口契约 版本规则 对象存储地址 错误码'),
('算法','几何与标签语义 轴与边界定义 计算正确性','样本与期望结果 坐标约定 容差和局限')],[2,7.6,7.4])
h('第一份契约至少写清这些字段')
table(['数据项','当前约定','需要共同确认'],[
('网格','{jaw}_seg.mesh 的 type 与 data；Draco 需有真实文件头','编码器是否重排顶点或面'),
('标签','seg_labels 为整数数组或单字节 bin','按顶点还是按面；与解压后顺序对应'),
('牙号','0 为背景或牙龈；牙根页使用有效 FDI 牙位','缺牙 智齿 其他标签的业务含义'),
('边界','{jaw}_gum.tooth_boundary_dict[牙号] 为 XYZ 闭环','点是否有序 是否重复首点 属于哪个坐标系'),
('牙轴','{jaw}_axis[牙号] 为矩阵 bin','变换方向 行列布局 字节序 长轴是哪一方向'),
('编辑','boundary_editor editor occlusal_jump','谁写入 谁读取 版本如何升级')],[2.2,7.7,7.1])
h('三个容易被漏掉的约定')
p('单位：所有长度先称为模型单位。只有数据生产端确认单位是 mm，界面、算法和接口才能统一使用毫米。')
p('索引：标签长度匹配只是必要条件。Draco 可能重排顺序，生产端要提供与解压结果对应的标签或显式映射；否则网格正常也可能整片染错。')
p('坐标：模型坐标、单牙局部坐标、世界显示坐标需要分别命名。矩阵应写明 A 到 B、向量乘法约定和存储布局，不能只说“这是对齐矩阵”。')

page('二 模型加载与边界编辑怎样实现')
h('加载链路')
p('msgpackTeeth 接收 URL 或本地文件，识别二进制 MessagePack 或完整 hex，优先选择上下颌分割对象；不存在分割对象时再读取独立单牙字典。Draco 解压后的几何按 seg_labels 生成各牙 Mesh，标签 0 保留为背景或牙龈。')
p('自动标签模式用标签数与顶点数、面数比较。两者都匹配时必须显式指定。按顶点分组时，跨标签三角面采用多数归属，三标签各异取首顶点；这是已有面的归属，不是精确切割。')
h('有原始顶点标签时')
p('先在跨标签三角面上连接边中点，三标签交汇处通过面重心连接，提取每牙最长闭环。控制点生成闭合 Catmull–Rom 曲线，再把采样点和路径约束在真实三角面表面，避免在三维凹曲面上悬空画线。')
p('会话在原边界周围建立 4 圈相邻面编辑带，并选取牙内和牙外种子。松手后，边界阻断面邻接图的连接，按种子连通区域判断牙齿侧，再让相邻三角面对原顶点投票。仅修改允许范围内的标签；越界或内外分隔失败则拒绝提交。')
code('相邻面内部票数超过一半 → 当前牙标签\n低于一半 → 外侧标签\n恰好一半 → 保留当前归属')
h('只有面标签或独立单牙模型时')
p('此时不能沿用原顶点标签编辑。代码把边界关联到三角面，将显示三角面划分为多边形单元，按连通性和边界方向确定内外，再生成颜色预览副本。它可以改变显示三角面的数量，但不会重新编码原网格，也不修改 seg_labels。')
h('提交和保存分别做什么')
p('顶点模式先校验并准备显示几何，再写标签及 boundary_editor；预览模式只保存基准轮廓与控制点。最后导出完整数据包。切换颌位可复用会话，重新加载靠标签与元数据恢复；原始 mesh.data 保留，独立单牙网格没有重新生成。')
p('对算法的关键表述：本页是边界约束的拓扑分类与标签量化。颜色预览成功，不等于已经产生新的分割标签或新的可下载单牙网格。',True)

page('三 单牙坐标系与模拟牙根怎样实现')
h('先把整颌转换成可独立操作的牙齿')
p('toothRoots 当前从 lower_seg 和 upper_seg 提取牙冠，复用标签分组，只复制已有三角面。有效 FDI 标签成为可编辑牙齿；仅有独立单牙字典还不能走完当前加载流程。')
p('牙颈优先读原始 tooth_boundary_dict，缺失才从牙冠开放边提取闭环。坐标量化焊接用于识别重复位置，只在副本上进行。分叉、开口或缺少可靠闭环时保留牙冠并跳过牙根。')
h('坐标系优先使用原始轴')
p('原轴 bin 尾部携带 |4,4,<f8 或 |4,4,<f4。按小端序读取，校验仿射矩阵、正交性和行列式。数据表示模型到单牙局部的行主序矩阵，转置适配 Three.js 后求逆，恢复局部到模型的基准。')
p('当前数据以原第二方向为长轴，显示 Z 取该方向，X 取原第一方向，Y = Z × X。根据牙颈到牙冠的方向修正 Z 正负，显示 −Z 为根向。这个约定必须和算法端显式确认，不能推广为所有数据通用。')
p('原轴缺失或无效才用 PCA 估计：对唯一牙冠点求协方差，Jacobi 分解后选择与牙颈到牙冠提示最一致的特征方向，而非直接取最大特征值方向；再用邻牙中心方向确定局部 X。')
h('牙根由单位模板贴合牙颈')
p('每个牙位有独立 OBJ 模板，也可用 PLY。模板颈圈在 z=0、径向半径为 1、根尖在 z=−1。把牙颈按角度排序，对模板顶点查相同角度的边界位置，径向贴合牙颈，轴向按根长缩放。')
p('轮廓形变仅在根颈上部 25% 过渡，其余保留模板的椭圆缩放形状，减少不规则牙颈被拉成长尖刺。生成后只焊接牙根并重算法线。')
h('为什么不改原始顶点')
code('原牙冠 p → inverse(B) × p → 单牙局部牙冠\n当前显示 p_display = P_tooth × inverse(B) × p')
p('B 是原始局部到模型基准，P_tooth 是当前 Group 位姿。牙冠和根挂在同一个 Group，移动时一起变换，原始压缩字节保持不变。默认模板是程序生成的示意形状；这种径向拟合依赖近似星形牙颈，不代表患者真实牙根重建。')

page('四 姿态 咬合与测量怎样计算')
h('保存位姿需要同时保存基准')
p('只保存位置和四元数，后续轴算法变化可能造成恢复漂移。v2 同时保存 baseFrame，恢复使用下式，把原编辑变换应用到当前坐标基准。')
code('P_restore = P_saved × inverse(B_saved) × B_current')
p('position 是模型坐标中的 Group 位姿，quaternion 顺序为 x y z w，baseFrame 是列主序局部到模型矩阵。下颌整体调整单独保存在 occlusal_jump，不重复烘焙到单牙位姿。')
h('整体下颌变换叠加在父节点')
p('从原始下颌牙轴和牙弓估计前、右、上方向，磨牙中心附近作为张口转轴。前后、左右、上下参数生成平移，张口角生成绕 right 方向的旋转。')
code('J = T(c+s) × R(right, −opening) × T(−c)\n下颌显示 = J × P_tooth × inverse(B) × 原牙冠')
p('前三个位移参数范围为 −20 到 20 模型单位，张口角为 0 到 30 度。比较“原始”和“调整后”只是临时开关 J；保存时保留调整参数。该转轴是几何估计，不是颞下颌关节生物力学模型。')
h('碰撞结果必须先定义含义')
table(['功能','计算方法','结果表示'],[
('上下颌碰撞','包围盒初筛 → BVH 双树遍历 → 三角面相交','红色相交面 距离 0'),
('阈值内接近','无相交后查询最近表面点对','黄色点线 无符号间隙'),
('邻牙间隙','按 FDI 相邻牙位配对 查询最近表面点','不跨缺牙空位连接'),
('测距与截面','世界表面两点欧氏距离 平面与三角面求交','模型单位距离及二维交线预览')],[3,8,6])
p('这些查询采用当前世界姿态和原牙冠，不把模拟根或显示封口纳入碰撞。位姿、阈值或数据变化后旧结果失效，需要重新计算。')
p('无符号间隙不提供穿透深度、体积或完全包容判断。切片也没有完成临床参考平面拟合。与算法讨论时要直接说计算对象和输出含义，避免把界面名称当成完整算法定义。',True)

page('五 怎样快速和后端对齐')
p('建议第一次对接就交付一份样本、一份字段表和一张保存时序。先约定完整数据包能否往返，再逐项接入编辑结果，避免文件成功上传却没有被正确消费。下面的协作步骤为建议；接口顺序对应当前页面适配器。')
h('把保存分成四个可观测步骤')
table(['顺序','当前适配接口','请求与结果'],[
('1','POST getUpdateEditVersion','发送 caseId 获得 version'),
('2','POST getUploadPath','发送 caseId version 获得 url key 和可选签名 headers'),
('3','PUT 签名 URL','发送完整二进制 MessagePack'),
('4','POST update','发送 caseId version key 成功后确认版本')],[1.2,6.2,9.6])
p('当前页面任一步失败即终止，保留编辑；最终更新成功才清除未保存标记。应用 API 携带 credentials，存储 PUT 使用签名头。仓库提供的是可配置适配器，业务接口的服务端实现及生产联调尚未在此完成。')
h('后端会议只需先确认这些决策')
p('版本：version 是预留号还是已提交版本；两个浏览器同时编辑如何冲突；同一版本重复 update 是否幂等。当前页面按顺序调用，但没有实现服务端并发控制。')
p('上传：签名 URL 的有效期、Content-Type、允许请求头、CORS 和失败重试规则。PUT 成功而 update 失败后，应重试哪一步、是否清理孤立对象，都需要后端明确。')
p('消费：服务端以整颌 mesh 加 seg_labels 为准，还是以独立单牙网格为准；谁根据更新标签重建单牙；boundary_editor 与 editor 是否需要透传或解析。')
p('兼容：未知字段是否保留，64 位整数如何处理，旧 schema 如何升级。toothRoots 启用了 BigInt64；msgpackTeeth 使用默认编解码选项，不能统一宣称未知整数都能无损。')
h('可直接使用的沟通话术')
p('“前端上传完整 MessagePack，不把显示副本当原网格。请确认新版本读取哪个对象 key，并保留未知字段。标签编辑后独立单牙网格不会自动更新；若服务消费单牙网格，请明确重建环节。我们先验证下载同一版本能复现，再接入并发和重试。”')
h('一次最小验收')
p('导入样本 → 只改一颗牙 → 导出并重新加载 → 上传并提交版本 → 从后端下载该版本 → 比较标签、姿态、边界及未知字段。不要只检查 HTTP 200 或文件大小。')

page('六 怎样快速和算法同学对齐')
p('算法联调应按“输入定义、计算对象、输出含义、误差标准”展开。先在一个固定牙位上验证，再扩展到上下颌；只描述“显示不对”会让问题在解码、坐标和算法之间反复转交。')
table(['主题','直接确认的问题','建议提供的证据'],[
('标签','按点还是按面 对应压缩前还是解压后顺序','V F L 统计及选定面的顶点与标签'),
('牙轴','矩阵从哪里变到哪里 哪一轴是长轴','已知点变换前后坐标 单位基向量示例'),
('牙颈','闭环顺序如何 允许何种凹形和非平面轮廓','单牙边界点和叠加截图'),
('分割编辑','期待更新标签还是输出切割网格','编辑前后标签差异和目标牙区域'),
('牙根','接受示意模板还是要求影像重建精度','模板来源 适用牙位 参考形态'),
('碰撞','接触 相交 穿透分别如何定义','点对 面索引 当前位姿及期望分类')],[2,8.3,6.7])
h('把验收标准变成可计算的量')
p('标签编辑建议比较变化顶点数、变化是否局限于允许范围、内部种子是否仍在牙齿侧、其他牙标签是否受影响。视觉边界顺滑不能替代这些检查。')
p('坐标恢复建议选三个不共线点和三个单位方向，核对变换前后数值与方向；使用导出再导入的往返误差。允许误差由模型单位和样本精度共同确定，文档不预设临床阈值。')
p('曲面边界建议检查到原表面的距离、是否跨不连续面、自交或越入其他牙区域。根拟合建议检查颈圈偏差、退化轮廓和尖刺，不把渲染法线平滑当成几何连续性证明。')
h('三个可直接讨论的案例')
p('标签错位：“解压后 V、F 与 L 的数量能匹配，但选定三角面的三个标签与算法期望不符。请确认编码端是否同步重排；我们提供解压后坐标和索引，不先改前端归属规则。”')
p('牙轴翻转：“当前按模型到局部矩阵读取，第二方向当长轴。请用同一个已知点验证逆变换，并确认牙颈到牙冠正方向；不要用旋转相机掩盖坐标错误。”')
p('碰撞分歧：“前端返回表面相交或无符号间隙。如果算法返回负值，请先说明它是有符号距离、最小平移量还是穿透深度，不能直接比较数值。”')

page('七 用最短路径定位联调问题')
h('先定位层级 再找对应负责人')
table(['现象','首先核对','下一步'],[
('文件不能打开','hex 完整性 MessagePack 顶层字段 Draco 文件头','提供字段类型与长度 找数据生产方'),
('形状正确 颜色错误','标签模式 数量 顺序 FDI 语义','抽查已知面 找算法核对索引'),
('牙齿位置或方向错误','坐标单位 变换方向 行列布局 重复应用矩阵','用已知点做数值变换对照'),
('边界动了 标签没变','是否进入 preview 路径 是否存在原始顶点标签','区分预览需求与标签需求'),
('保存后效果丢失','实际下载的版本和 key 元数据是否被消费','比较上传前快照和下载内容'),
('界面卡顿','网格规模 曲线采样 表面分区 重建及渲染耗时','按阶段采样计时 再优化瓶颈')],[3.7,7.5,5.8])
h('建议固定一份问题反馈模板')
code('病例或样本标识：由团队约定的标识\n数据版本与对象 key：明确实际下载版本\n页面与代码版本：msgpackTeeth 或 toothRoots\n复现步骤：导入 → 选择牙号 → 操作 → 保存或计算\n输入统计：颌位 牙号 V F L 标签模式 模型单位\n预期与实际：写清数值或分类差异\n证据：错误信息 差异字段 关键点坐标 面索引 截图\n待确认项：明确希望哪一方回答哪一个问题')
p('传递最小必要片段即可：字段结构、局部几何或约定样本、确定的版本和操作步骤。截图用于说明现象，数值与文件用于复现。')
h('协作会议建议按这个顺序收敛')
p('前 5 分钟在三方共用样本上复现；接着核对解码统计、标签顺序和坐标变换；确定问题属于生产、展示、保存还是消费；最后只留下负责人、待改字段、验收样本和下一次验证条件。')
p('建议建立固定样本集：正常上下颌、单颌、缺牙、面标签、顶点标签、轴缺失、边界异常和已编辑文件。每类样本都附期望结果，避免版本变化后用不同数据争论同一现象。')

page('八 连续业务流程还需要补齐什么')
p('两个页面共享数据容器和部分几何工具，但编辑元数据尚未被两边统一消费。对接真实业务时，这些差异应先作为协议决策明确，不宜靠页面外观推断行为。')
table(['数据变化','当前实现','建议形成的决策'],[
('顶点标签改变','牙根页按新 seg_labels 提取牙冠，但优先使用原牙颈字典','由谁同步更新牙颈或标记失效'),
('预览边界改变','保存 boundary_editor；牙根页不消费它','是否升级为统一边界来源及优先级'),
('单牙位姿改变','保存 editor；查看页未应用该姿态','两页是否共享姿态恢复逻辑'),
('下颌整体改变','保存 occlusal_jump；查看页未应用它','后端与算法是否按相同 J 计算'),
('独立网格保持旧值','标签变化未触发单牙网格重新编码','谁重建 何时重建 失败如何处理')],[3.4,7.5,6.1])
h('建议按依赖顺序推进')
p('第一步，冻结最小数据契约。确认一份样本、一套单位与坐标、一种标签顺序和 schema；先完成完整包往返，不同时引入新算法和新接口。')
p('第二步，验证一颗牙的编辑闭环。标签改动与预览改动分别验收，姿态与 baseFrame 成对保存，导出后重新加载数值一致。')
p('第三步，接通版本上传。覆盖 PUT 失败、update 失败、重复提交和并发编辑；服务端规则确定后再补客户端处理。')
p('第四步，统一跨页面消费。确定边界、位姿、整体咬合的权威来源，补上单牙网格重建或失效机制，再扩展批量计算和性能优化。')
h('现有实现的能力边界')
p('当前没有从口扫恢复患者真实牙根，没有提供穿透体积或完整临床指标，也没有为这些计算证明临床误差范围。默认模板、PCA 备用轴和几何张口模型适合解释技术路线；生产使用需要算法团队明确目标、输入要求和验证标准。')

page('九 分享演示与会后交接')
h('五分钟演示脚本')
p('第一分钟，在 msgpackTeeth 导入约定样本，展示字段结构、颌位、牙号与标签模式，说明原始数据和显示分区的关系。')
p('第二分钟，拖动一颗牙的边界。指出该样本是顶点标签提交还是预览路径，展示成功修改或越界回退，再导出并重新加载验证。')
p('第三分钟，在 toothRoots 导入同一完整数据包，展示牙轴和牙颈来源、模拟牙根，平移或旋转单牙，解释局部 Group 与原网格的关系。')
p('第四分钟，调整下颌整体位姿，重新检测碰撞或间隙；说明世界姿态、无符号距离，以及结果失效后为什么需要重算。')
p('第五分钟，展示保存快照中的 editor、baseFrame 和 occlusal_jump，对照后端四步时序，说明上传成功与业务版本提交成功的区别。')
h('会后应留下的四份材料')
p('数据契约：字段、单位、坐标、索引、版本及生产方。样本与期望结果：至少包含一个完整往返和一个异常场景。接口契约：版本、签名上传、提交、错误与重试规则。问题清单：每项有负责人、验收样本和完成条件。')
h('代码导航')
table(['需要回答的问题','优先查看的源码'],[
('如何加载与区分编辑模式','src/page/msgpackTeeth/index.vue 与 geometry.ts'),
('边界如何更新标签和颜色','segmentation.ts boundaryEditor.ts surfacePartition.ts boundaryRegionColors.ts'),
('坐标轴 根拟合与保存恢复','src/page/toothRoots/core.ts'),
('整体咬合 碰撞与测量','occlusalJump.ts collision.ts measurements.ts sectionView.ts'),
('上传和交互如何编排','src/page/toothRoots/index.vue 与 core.ts 的 uploadDocument')],[6.3,10.7])
p('源码根目录：E:\\rs_zy\\demo_code\\charts-config。算法与字段说明对应 2026 年 10 月 27 日工作区实现；协作步骤、验收样本和协议补齐顺序是建议方案。')
p('已有 tests 中包含分割编辑、曲面预览、牙根、咬合与测量用例。本次文档编制核对源码，未重新运行功能测试或性能基准，不能把测试文件存在理解为本次验证通过。')
p('分享结束时要确认的决定：这次交付到底更新哪类数据，由哪一方消费，以及用哪个样本证明保存后能够复现。',True)

doc.core_properties.title='牙齿三维编辑技术路线与协作分享'
doc.core_properties.subject='实现路线与前后端算法协作'
doc.core_properties.author=''
doc.save(OUT)
print(OUT)
print('paragraphs', len(doc.paragraphs), 'tables',len(doc.tables))
