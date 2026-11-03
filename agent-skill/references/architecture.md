# MultiAlign 架构参考

供需要深入修改某个模块时查阅。模块加载顺序固定：`util → segmenter → aligner → merge → docximport → exporters → sample → app`（index.html 中的 script 顺序即依赖顺序）。

## analytics/ — 私有使用统计（可选）

- `js/analytics.js`：客户端。`ENDPOINT` 为空 → 整模块静默（不发任何请求）；sendBeacon（text/plain 简单请求，免预检）+ fetch keepalive 兜底；cid = localStorage 随机 UUID；leave 事件在 visibilitychange hidden 时上报停留秒数。事件仅 visit/leave/align/export/srt_import 五类，永不携带文本。
- `analytics/worker.js`：Cloudflare Worker（ESM）。POST /collect 校验负载（≤600B、t≤16 字符）后写 KV `d:YYYY-MM-DD`（uv 数组上限 3000，异常负载一律 204 静默丢弃）；GET /stats?key=ADMIN_KEY 聚合全部天数返回 JSON（totals + days，含复访率）。ADMIN_KEY 是 wrangler secret，不在代码里。
- `analytics/dashboard.html`：站长本地仪表盘，输入 Worker 地址 + 密钥（存本机 localStorage），渲染 PV/UV/复访率/事件/语言分布。

## 模块加载顺序固定
## 全局约定

- 命名空间：`window.PA`，各模块 `PA.util / PA.Seg / PA.Aligner / PA.Merge / PA.Export`；`docximport` 往 `PA` 上挂 `PA.crc32` 供 exporters 复用；`PA.SAMPLE` 为示例数据。
- 所有 js 用 IIFE + 'use strict'，ES2017 级语法（可选链等过新语法避免使用，保证旧 Safari 可跑）。
- 无构建步骤、无外部请求、无第三方库。字体/图标全用系统字体与 emoji/内联 SVG。

## util.js

- `charClass(cp)`：把码点分为 han/hira/kata/hangul/thai/arabic/deva/cyrillic/greek/latin/digit/space/other。**新增文种支持先改这里**。
- `weightedLen(text)`：对齐用的加权长度。权重 han=2.3, kana=1.8, hangul=2.1, thai=1.6, 其他=1。依据：Gale-Church 的长度可比性要求，汉字信息密度约为西文字母的 2.3 倍。
- `isCJKText(text)`：CJK 占比 > 0.3 判真。决定 TU 内多句拼接是否加空格（`merge.js` 与 `app.js` 的 `sepFor`）。
- `uid(prefix)`：版本 id 生成（`v` + 6 位随机）。颜色 `colColor(vid)`（app.js 内）用 id 哈希 → hsl，同 id 恒定。

## segmenter.js

- `LANGS`：20 种预设语言，`group` ∈ zh/latin/ja/ko/ar/th。
- `segmentRich(text, lang, opts)` → `[{text, para}]`。流程：`\r\n` 归一 → 空行切段（para 编号）→ 段内逐行 `segmentLine`。
- `segmentLine`：扫描 ENDERS（`.。！？…!?‼⁇⁈⁉`）。遇到句末标点后，吞掉连续标点与闭引号/括号，再判断下一非空白字符是否为"新句起始"（`isStartChar`：CJK/数字/大写字母等）。回切点取**闭引号之后**（`k`），空白归入下句（`m`）。
- 缩写防误切：`lastWordToken` 取句点前的词元；`[A-Za-z].` 单字母缩写、`ABBREV` 集合（mr/dr/e.g/jan/…约 60 个）不切。小数 `3.14` 由快速跳过处理。
- `splitSemi` 选项：分号视作句界（法律/新闻文本用）。
- 特征提取：
  - `extractNums(text)`：全角归一后提取数字串集合（去千分位逗号点），跨语种对齐最强锚点。
  - `simTokens(text)`：词汇特征。汉字串→相邻二元组（bigram），其他→小写词。供同组文种 Dice 相似度。
- `detectLang(text)`：按文字计数粗判（假名≥汉字×0.25 → ja 等）。用于导入文件后自动设置语言。

## aligner.js

- 代价函数：`c = -100·ln(2·(1-Φ(|z|))) + PEN[type] - numWeight·dice(nums) - lexWeight·dice(tokens)`，其中 `z = (lb-la)/sqrt((la+lb)·variance)`。
- `PEN`（-100·lnP，Gale-Church Table 5）：1-1=0, 1-2/2-1=230, 2-2=440, 1-0/0-1=450。`CONF`：1-1=.95, 1-2/2-1=.72, 2-2=.5, 删除=.15。
- DP 状态 6 种转移，`Float64Array` + `Int32Array` 平面数组（`i*(m+1)+j`），容量上限 2.6M 状态，超过走 `alignLarge` 滑窗：按累计加权长度比例切 A 侧 1100 句块，B 侧按比例 ±90 句 padding，块间以 `bConsumed` 去重衔接。
- `alignTexts(A,B,o)`：`o.usePara` 且双方段落数相等 → 逐段对齐后拼接 bead（下标映射回原数组）；否则全局。
- bead 结构 `{a:[i...], b:[j...], type:'1-1', conf}`。

## merge.js — buildTUs(versions, pivotId, segs, pairResults)

1. 节点 = `(versionIndex, sentenceIndex)`，键 `vi*1e6+si`，并查集。
2. 每组 pairResults 的 bead 内所有 `a×b` 组合 union 到基准语句子上 → 连通分量。
3. 分量排序键：含基准句取最小基准句号；否则借"该版本句→基准句"映射（`pivotMaps`，取前后邻均值）插入排序，保证无基准句的分量落在合理位置。
4. 分量置信度 = 该分量涉及句对 conf 的**最低值**（min，无句对记 0.2）。2026-11 由均值改为最低：一行是否需要审校取决于对得最差的版本，均值会稀释单版本 1-2/删除告警（交叉审计实测 0.72 被稀释为 0.84）。
5. 输出 TU：分量内各版本句子按序拼接（`isCJKText` 决定空格）；`tu.srcIdx` = 基准语句子下标（升序数组），句序溯源用——app 的 mergeRows 取并集，`PA.Project.normalizeTu` 校验保留。

## docximport.js

- `unzipEntry(buffer, name)`：手写 ZIP central directory 解析 + `DecompressionStream('deflate-raw')`（STORE/DEFLATE 都支持）。EOCD 从尾部扫 64KB+22。
- `readDocxText`：正则提取 `<w:p>` 段 → 段内顺序扫 `<w:t>`/`<w:tab>`/`<w:br>` → 段间以 `\n\n` 连接（**空行分隔能触发段落锚定**，故意的）。不使用 DOMParser（Node 测试兼容）。
- `decodeText`：UTF-8 strict → UTF-16LE BOM → gbk → big5 → shift_jis → euc-kr 逐个尝试。

## srt.js

- `parse(text)`：宽容解析 SRT/VTT（CRLF、`<i>`/`{\an8}` 标签清理、序号行缺失、无小时时间戳、`.`/`,` 毫秒），输出 `[{start,end,text}]`（毫秒，按开始时间排序），cue 内换行合并为空格。
- `formatGroups(groups)` /（exporters 内）`formatSrtGroups`：`[{t0,t1,lines[]}]` → 标准 SRT 文本。
- `attachTiming(tus, pivotId, pivotSegs)`：对齐后为 TU 附基准语时间轴。按序消费 cue，**去空白比对**单元格文本与 cue 拼接（兼容 CJK 无连接符/西文空格两种拼接）；不匹配回退 prevEnd+3s 保证时间轴单调。副作用：写 `tu.t0/tu.t1`，SRT 导出依赖它。
- aligner 时间锚点：beadCost 内两侧句子都有 `t0/t1` 时按合并跨度 IoU 减 `srtWeight·IoU`；**删除珠（ni===i 或 nj===j）不参与**，守卫 `ni>i && nj>j` 必须保留（否则 B[nj-1] 越界崩溃）。

## exporters.js

- `makeZip(files)`：STORE 方式 ZIP 写入器（UTF-8 名字标志 0x0800），XLSX 与两两 TMX ZIP 共用。
- `buildTMX(versions, rows, o)`：TMX 1.4，`segtype="sentence"`，`srclang`=基准语 lang；`includeConf` 时加 `<prop type="confidence">`。空单元格的 tuv 跳过。
- `buildXLSX`：最小 OOXML 包（6 个部件，inline string，首行粗体样式 s=1，列宽 44）。改单元格生成代码时注意 `r` 属性引号完整。
- `buildDelimited`：CSV/TSV 共用，CSV 带 `"` 引号规则 + 公式注入防护（`=+@\t\r` 起始加 `'` 前缀，`-` 刻意不防护）；下载时前置 BOM `\ufeff`（app.js 里拼）。
- `srcIdxLabel(tu)` + `o.srcIdx`：句序溯源——XLSX/CSV/TSV 加「句序」列（行号后）、TMX 加 `<prop type="x-src-idx">`。
- `buildPairwiseZip`：基准语×每个其他版本过滤出双侧非空行，各生成双语 TMX 入 ZIP。

## app.js

- 状态：`state.{versions, pivotId, settings, segs, tus, selectedRow, selectedCell, undo[], redo[], search, filter, hiddenCols, dirtyText}`。
- `setStep(n)`：步骤守卫（3/4 需 `tus.length`）；进入 2 时 `goStep2` 重分句并剔除空版本；进入 3/4 时渲染。
- 编辑器：`contenteditable` 单元格；`focusin/focusout` 差异检测提交编辑（`pushUndoCell` 只存旧值，省内存）；结构操作（合并/插行/删行/移动/单元格合并拆分）用 `pushUndoFull` 全量快照（上限 60）。渲染按 300 行增量 + IntersectionObserver 哨兵。搜索期间单元格置 `contenteditable=false` 并用 `<mark>` 高亮，替换后重建匹配索引。
- `markDirty`：对齐后用户又改了源文本 → 顶部黄条提示可重新对齐。
- 快捷键：Ctrl+Z/Y（编辑器外）、Ctrl+F、Ctrl+S、Esc 关弹窗。
- 自动保存：25s 定时 + 关键操作 debounce 4s + beforeunload，写 localStorage；首页横幅提供恢复/忽略。

## index.html / style.css

- 视图：`#view-home/work/docs/about`，`.view-on` 切换；工作台四步 `#pane1..4` + `.pane-on`。
- 关键 class 契约：`.stepper li.step-on/.step-done`、`tr.trow .row-sel/.row-locked/.row-mod/.f-hidden/.row-flash`、`td.cell`（contenteditable）、`.conf-hi/.conf-mid/.conf-lo/.conf-mod`（置信度圆点配色）。
- 删除/重命名任何带 id 的元素前，先全局搜索 app.js 中的 `E('...')` 引用。

## test/ — 导出编排 E2E

- **页面生成时内联全部 js 脚本**（零脚本网络请求）：Chrome `--virtual-time-budget` 会随机截断脚本网络加载（实测每次缺失不同脚本、window.onerror 不报），曾致本地 9/10 间歇失败——与被测代码无关；CI 的 runner 网络栈无此问题。
- 片段全条件轮询（waitFor）而非固定 sleep；独立临时 user-data-dir 避免与常驻 Chrome 争默认 profile；`PA.util.download` 打桩捕获下载，断言三个文件名 + 零未捕获异常 + 零错误 toast。
- 入口脚本防御模式：DCL 可能早于监听注册（同上虚拟时钟竞态），app.js 已用 `readyState` 判断直接初始化；探针 `window.__appEvaled`、`location.hash` 可区分"脚本未加载"与"init 未跑"。

## 对齐质量调参经验值

| 场景 | 建议 |
|---|---|
| 中↔英（长度比失衡） | 保持 variance=0（自动 9.0），提高 numWeight 至 70+ |
| 中↔日 | lexWeight 生效（共享汉字 bigram），40-60 效果好 |
| 欧语互译 | 同组 variance 6.8，长度信号很强，默认即可 |
| 法律文本长句 | 开 splitSemi；审校阶段用单元格拆分兜底 |
| 各版本段落数一致 | 必须 usePara=true，准确率提升最显著 |
