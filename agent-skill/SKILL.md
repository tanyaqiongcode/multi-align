---
name: multi-align-skill
description: 多语平行语料对齐工具（MultiAlign）的构建、测试、维护与扩展规范。只要用户提到平行语料/句句对齐/句对齐/语料库构建/TMX 导出/多语对照表/multi-align，或要求修改、扩展、修复、重建一个多版本（5-10 语种）自动句对齐工具——即使没说"MultiAlign"这个名字——都应使用本技能。包含算法规格、架构约定、无头回归测试与浏览器截图验证流程。
---

# Multi-Align-Skill：多语平行语料对齐工具规范

本技能封装一套**已验证可工作**的纯前端多语平行语料对齐工具（MultiAlign）的完整知识：算法、架构、测试方法。用于继续开发、修复、扩展，或在别处重建同类工具。

## 工具实例位置

本工具实例就是本仓库根目录（`index.html` + `js/` + `css/`，零依赖、双击即用）。

若路径不存在或用户指向别处，先确认目标目录里有 `index.html` 且其脚本使用 `window.PA` 命名空间；都没有则按 references/architecture.md 从零重建。

## 立即执行：回归测试与基准

动手改代码**之前和之后**都先跑无头检查（不需要浏览器，约 2 秒）：

```bash
node agent-skill/scripts/pipeline_test.js          # 回归：分句/对齐/合并/导出/导入/SRT/统计 58 项断言
node benchmark/run_benchmark.js --min-f1 0.97      # 金标准基准：6 用例宏平均 F1 ≥ 97%（CI 同款）
```

覆盖率门槛（核心模块行覆盖）：`npx c8 --reporter=json-summary --include "js/aligner.js" --include "js/segmenter.js" --include "js/exporters.js" --include "js/srt.js" --include "js/merge.js" bash -c "node agent-skill/scripts/pipeline_test.js && node benchmark/run_benchmark.js --min-f1 0" && node test/check_coverage.js`。

再跑导出编排 E2E（无头 Chrome 真实点击 TMX/SRT/SRT ZIP 下载路径）：`bash test/run_e2e.sh`（CI 同款）。三道全绿才继续（回归当前 58 项断言，含 1 项环境可选跳过，覆盖 SRT/VTT 字幕全链路、导出编排层与统计模块默认静默）。回归失败的排查顺序见下文"已知陷阱"；基准掉点先跑 `--verbose` 看逐珠差异（改 aligner 代价函数/罚分表时尤其要逐用例核对），能力边界与路线图见 `benchmark/README.md`。

## 架构速览

流水线：**文本 → 分句 → 两两对齐（各版本 × 基准语）→ 并查集合并 → 翻译单元（TU）表 → 审校 → 导出**。

```
js/util.js        字符类别 / 加权长度（汉字≈2.3 西文字符）/ 下载 / 杂项
js/segmenter.js   多语分句（缩写库、小数、引号闭合）、语言检测、数字与词汇特征
js/aligner.js     Gale-Church 动态规划对齐（1-1/1-2/2-1/2-2/1-0/0-1）+ 段落锚定 + 滑窗分块
js/merge.js       基准语枢纽 + 并查集连通分量 → 多语 TU
js/docximport.js  迷你 ZIP 读取器 + DOCX 正文提取 + TXT 编码识别（UTF-8/GBK/Big5）
js/srt.js         SRT/VTT 字幕解析、多语 SRT 生成、TU 时间轴附着
js/analytics.js   匿名统计客户端（ENDPOINT 为空时完全静默；只上报事件计数，永不含文本）
js/exporters.js   TMX / 两两 TMX ZIP / XLSX（内置 ZIP 写入器）/ CSV / TSV / TXT / SRT 字幕 / JSON
js/sample.js      内置 6 语示例（自创文本，英文含 1-2 对齐演示）
js/app.js         UI 状态机：四步流程（导入→对齐→审校→导出）、编辑器、搜索替换、撤销、自动保存
```

字幕对齐：SRT/VTT 版本以 cue 为句子单位（segs 带 t0/t1 毫秒），对齐时按时间重合度 IoU 打分（settings.srtWeight，默认 80，仅双方都有时间轴时生效）；TU 时间轴由 `PA.SRT.attachTiming` 顺序消费基准语 cue 附着，SRT 导出（含多语合并与单语 ZIP）取该时间轴。
UI 是参考 tmxmall 的四步式流程，工作台视图路由用 hash（`#/home` `#/work` `#/docs` `#/about`）。TU 数据结构：

```js
{ cells: { versionId: '文本' }, conf: 0.95, locked: false, modified: false }
```

工程 JSON（`Ctrl+S` 导出 / localStorage 键 `multialign_autosave_v1`）：`{ app:'multialign', versions:[{id,name,lang,text}], pivotId, settings, tus }`。加载时必须校验 `data.app === 'multialign'`。

## 常见任务与做法

**加一种语言**：只在 `js/segmenter.js` 的 `LANGS` 加条目（code/name/group）。`group` 决定三件事——长度方差（同组 6.8 / 跨组 9.0，见 `autoVariance`）、词汇相似度是否启用（`lexCompatible`，仅同组或中↔日）、合并句子的连接符（CJK 无空格）。`util.js` 的 `charClass`/`weightedLen` 若遇新文字（如天城文、希腊文）需同步加权重。

**调对齐质量**：三个旋钮在 app.js `state.settings`——`numWeight`（数字锚点，跨语种最可靠）、`lexWeight`（同文种词汇）、`variance`（0=自动）。整句不匹配率过高先确认两版本段落数是否一致（段落锚定 `usePara` 要求段数完全相等才生效）。长度比例异常（如中↔英）是预期行为，靠加权长度吸收，不要去改方差公式。

**加导出格式**：在 `js/exporters.js` 加 builder（返回 string 或 Blob），在 `js/app.js` `doExport()` 加分支，在 index.html 导出卡片加按钮（`data-export="xxx"`）。ZIP 类产物必须复用 `Exp.makeZip`。

**改 UI**：改 index.html 结构后，核对 app.js `init()` 的 `E('id')` 清单——所有 `el.xxx` 都必须在页面里存在，否则 `bind` 阶段直接抛错、整页瘫痪（真实事故见已知陷阱 7；现已有红幅诊断与 E2E 双防线）。

## 测试方法

**无头（改动必跑）**：`scripts/pipeline_test.js`，直接 require 各 js（它们挂在 `window.PA` 上，脚本里 `global.window = global` 即可）。断言基准：6 语示例 → 14 TU、全 1-1、英文对允许 1 个 1-2；XLSX 用 Python `zipfile`+`minidom` 校验所有 XML 部件。

**浏览器视觉（改 UI 必做）**：本地起 `python3 -m http.server 8765`，用无头 Chrome 截图（IAB 截图在本环境不稳定，优先此法）：

```bash
# 复制 index.html 并在 app.js 的 <script> 后追加自动执行脚本，再截图后删除
sed 's|<script src="js/app.js"></script>|<script src="js/app.js"></script><script>window.addEventListener("load",function(){setTimeout(function(){document.querySelector("[data-goto=work]").click();setTimeout(function(){document.getElementById("btnSample").click();setTimeout(function(){document.getElementById("toStep2Btn").click();setTimeout(function(){document.getElementById("runAlignBtn").click();},1800);},300);},400);},400);});</script>|' index.html > _demo.html
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu --screenshot=/tmp/editor.png --window-size=1440,900 --virtual-time-budget=9000 --hide-scrollbars "http://localhost:8765/_demo.html"
```

用 Read 工具查看 `/tmp/editor.png`，确认四步状态、表格列、置信度圆点，然后**删除 `_demo.html`**。

**浏览器 DOM 断言（ Playwright evaluate 可用时）**：关键断言点——`.stepper li.step-on` 的 id、`#eTbody tr.trow` 行数、`#editorInfo` 文本、`#alignLog .log-line` 条数。

## 已知陷阱（每条都真实踩过）

1. **`segmenter.js` 的 `ENDERS` 必须含 ASCII 句点 `.`**——漏掉会导致英文完全不切分（中文仍正常，极易漏测）。回归测试覆盖此项。
2. **XLSX 属性引号**：`<c r="A2 t="...">` 这种漏引号会让 Excel/openpyxl 报 invalid token，但 `unzip -t` 仍通过——XML 校验必须用 minidom/openpyxl，不能只测 ZIP 完整性。
3. **Node 环境 vs 浏览器 API**：`DOMParser`、`Blob.arrayBuffer`（写入 fs 时需先转 Buffer）、`DecompressionStream` 都不能在无头测试里直接用；docximport 的 DOCX 解析故意用正则而非 DOMParser 就是为了双端可跑。不要"顺手"改回 DOM API。
4. **`require` 相对路径**：无头脚本放 /tmp 时 require 必须用绝对路径（CJS 以脚本文件位置解析）。
5. **`aligner.js` DP 表**：`(n+1)*(m+1)` 超 260 万元素自动切滑窗模式；滑窗的 `bConsumed` 去重逻辑依赖 bead 有序，改对齐类型集合时要重验长文本路径。
6. **IAB（内置浏览器）截图**可能报 `guest not attached` / `screenshot surface timed out`，标签页也可能变 about:blank——重试前先 `tabs.list()` 重新拿 id；截图验证一律优先无头 Chrome 方案。
7. **el.xxx 单点故障的真实事故**：`btnSearchRun` 自 v1.0 起缺失于 index.html → `bindSearch()` 在 init 抛错 → 排在其后的 `bindExport`/`bindGlobal` 从未运行（导出按钮/确认框/快捷键全灭），而 DOM 冒烟只验证元素存在、从未点击，长期未被发现。防线：`E()` 缺失 id 页底红幅诊断 + `test/run_e2e.sh` 真实点击导出路径；新增绑定前先确认目标 id 存在。
8. **漏 add 单文件**：断言与其实现分属不同文件时（如 CSV 防护的测试在 pipeline_test、实现在 exporters），分小提交极易漏 add 实现文件——本地自测过、CI 按 HEAD 跑必挂。每次 commit 后核对 `git status` 应为空。
9. **无头 Chrome 虚拟时钟两坑（E2E 稳定性）**：(a) `--virtual-time-budget` 会随机截断脚本网络加载（每次缺失不同脚本、window.onerror 不报）——E2E 页面必须内联全部 js；(b) DCL 可能早于监听注册——app.js 已用 `readyState` 判断防御，新增入口脚本沿用该模式。取证探针：`window.__appEvaled`、`location.hash`。

## 详细参考

- 模块级 API、数据结构、算法参数与公式：读 `references/architecture.md`
