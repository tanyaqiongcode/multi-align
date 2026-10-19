# 多语平行语料对齐工作台 MultiAlign

[![CI](https://github.com/tanyaqiongcode/multi-align/actions/workflows/ci.yml/badge.svg)](https://github.com/tanyaqiongcode/multi-align/actions/workflows/ci.yml)

[![在线版](https://img.shields.io/badge/在线版-GitHub%20Pages-3C5488)](https://tanyaqiongcode.github.io/multi-align/)

**MultiAlign** — a zero-dependency, fully client-side workbench for building sentence-aligned multilingual parallel corpora (5–10 language versions at once), with Gale-Church automatic alignment, human review, and TMX/Excel export.

一个**纯前端、零依赖、双击即用**的多版本双语/多语句子对齐语料库构建工具。参考 tmxmall 等专业对齐平台的四步式工作流，支持 5–10 个语言版本一次生成句句对齐的多语对照表，并可导出 TMX 等标准格式。

👉 **在线使用**：https://tanyaqiongcode.github.io/multi-align/ （纯静态页面，语料仅在浏览器本地处理）

导入 TXT / SRT / VTT 等原始文件：进入工作台，点击「导入文本／字幕」，可多选文件自动建立版本；已有版本可用卡片中的「导入文件」替换。「打开工程（JSON）」仅用于恢复此前保存的工程，不用于导入文本或字幕。

| 首页 | 审校编辑器（6 语对照） |
|---|---|
| ![首页](docs/screenshots/home.png) | ![审校编辑器](docs/screenshots/align-editor.png) |

## 快速开始

**无需安装任何东西**：双击 `index.html`（推荐 Chrome / Edge / Safari 16.4+），点击「📚 载入多语示例」即可看到 6 个语言版本的完整对齐演示。也可以直接把它部署到任意静态托管（GitHub Pages / Vercel / Nginx）后在线使用。

## 使用流程（四步）

| 步骤 | 做什么 | 说明 |
|---|---|---|
| 1️⃣ 导入文本 | 添加 2–10 个语言版本 | 粘贴文本，或导入 `.txt` / `.md`（自动识别 UTF-8/GBK/Big5）/ `.docx`；指定语言、勾选**基准语**（通常是原文） |
| 2️⃣ 自动对齐 | 一键运行 | Gale-Church 统计算法 + 数字锚点 + 词汇相似度；每个译本与基准语对齐后自动合并成多语对照表 |
| 3️⃣ 审校编辑 | 人工修正 | 单击单元格直接改；行合并/拆分/增删/移动、单元格拆分、行锁定、置信度筛选、搜索替换、撤销重做 |
| 4️⃣ 导出语料 | 产出成果 | TMX / 两两双语 TMX(ZIP) / XLSX / CSV / TSV / TXT / JSON 工程文件 |

## 核心特性

- **多版本对齐**：以基准语为枢纽，各版本独立对齐后经并查集合并为翻译单元（TU），一行即一条多语对照记录
- **智能句对齐**：1-1 / 1-2 / 2-1 / 2-2 / 1-0 / 0-1 六种句对自动识别；长文本自动滑窗分块，数千句可流畅处理
- **多语分句**：中/日/韩/西文各自规则；识别缩写（e.g.、Mr.、Dr.）、小数、引号闭合，避免误切
- **SRT/VTT 字幕对齐**：导入双语字幕文件，按台词时间轴自动对齐，导出多语合并字幕（播放器可直接挂载）与各语言单语字幕
- **可选私有统计**：站长可部署自建端点查看使用数据（匿名事件计数，不含文本），默认关闭
- **跨文种长度校准**：汉字≈2.3 个西文字符的加权长度，使中英对齐同样可靠
- **精细审校**：置信度分级标色（🟢高/🟡中/🔴低/🟣已改），支持只看低置信行，批量锁定后按锁定导出
- **隐私安全**：全部计算在浏览器本地完成，文本永不上传任何服务器；可选匿名统计只记事件计数、默认关闭；工程可存 JSON、浏览器自动保存防丢失

## 导出格式说明

- **TMX 多语言版**：TMX 1.4 标准，一个 `<tu>` 内含全部语言 `<tuv>`，OmegaT / Trados / memoQ 均可导入
- **两两双语 TMX（ZIP）**：基准语 × 每个译本各一个双语 TMX，适合按语向分发
- **XLSX / CSV / TSV**：行号 + 各语言列（可选置信度列）；CSV 带 BOM，Excel 打开不乱码
- **TXT**：制表符分隔的平行文本，可直接用于机器翻译训练流水线
- **SRT 字幕**：多语合并字幕（每条台词多行对照）+ 各语言单语字幕 ZIP，时间轴取自基准语
- **JSON 工程文件**：完整工程（文本+参数+审校结果），随时打开继续

## 目录结构

```
index.html          页面骨架（首页 / 工作台四步 / 使用指南 / 关于）
css/style.css       全部样式
js/util.js          字符类别、加权长度（汉字≈2.3 西文字符）、通用工具
js/segmenter.js     多语分句、语言检测、数字/词汇特征
js/aligner.js       Gale-Church 动态规划对齐 + 段落锚定 + 滑窗分块
js/merge.js         基准语枢纽 + 并查集 → 多语翻译单元
js/docximport.js    DOCX 解包（内置 ZIP 读取）与 TXT 编码识别
js/exporters.js     TMX / XLSX（内置 ZIP 写入）/ CSV / TSV / TXT 导出
js/sample.js        内置 6 语示例（中/英/日/法/德/西）
js/app.js           界面状态机：四步流程、审校编辑器、搜索替换、自动保存
agent-skill/        AI 开发技能包（见下节）
```

## 用 AI Agent 持续开发本工具（agent-skill/）

仓库附带一份 [ZCode](https://zcode.ai) 技能包 `agent-skill/`：封装了本工具的算法规格、模块约定、已知陷阱与一条**无头回归测试**。把你的 AI 编码助手指向本仓库时，让它先读 `agent-skill/SKILL.md`，即可安全地扩展语言、调参、加导出格式而不破坏现有行为。

运行回归测试（无需浏览器，约 2 秒；数量以脚本输出为准）：

```bash
node agent-skill/scripts/pipeline_test.js          # 默认测试仓库自身
node agent-skill/scripts/pipeline_test.js <目录>    # 测试其他副本
```

## 质量保障

每次推送都会在 GitHub Actions 上自动执行两层检查：

1. **回归测试**：当前 58 项断言（数量以脚本输出为准），覆盖多语分句（缩写/小数/引号/有序列表标号）、对齐珠型、翻译单元合并、导出器 ZIP/XML 完整性与 openpyxl 打开校验、DOCX 导入、GBK 编码识别、SRT/VTT 字幕全链路、导出编排层与统计模块默认静默。其中 1 项为**环境可选检查**（DOCX 往返需要 python-docx）：缺库时自动跳过而非失败，CI 环境已安装故全量执行；
2. **导出编排 E2E**：无头 Chrome 走完"导入字幕 → 对齐 → 导出"，真实点击 TMX / SRT / SRT ZIP 三条路径并断言下载触发（`bash test/run_e2e.sh`）；
3. **金标准对齐基准**：内部小型回归集（自建用例、人工标注），16 个多语用例（中英 / 中日 / 英法 / 英德 / 英西）覆盖 1-1 / 1-2 / 2-1 句对变换、段落锚定、数字锚点、字幕时间轴锚点、学术结构（标题/列表/脚注上标）、OCR 轻噪声、错段兜底与 1800 句滑窗长文本；13 个计分用例**宏平均 F1 = 100%**（衡量"已声明能力不被改动破坏"，不代表公开大规模语料上的通用准确率），另有 3 个 xfail 用例如实标注长度模型的已知局限；包含 Tatoeba 真实公开语料用例（CC-BY 2.0 FR，100 对）；CI 在计分用例 F1 < 97% 时拒绝合并。核心模块设有覆盖率门槛（`test/check_coverage.js`，c8 统计，CI 版本锁定）；CI 含依赖审计（npm audit，high 级阻断）；CSV/TSV 导出内置公式注入防护（详见 [SECURITY.md](SECURITY.md)）。

```bash
node benchmark/run_benchmark.js --verbose   # 本地复跑基准，查看逐珠差异
```

能力边界（诚实声明）：孤立的句中漏译/增译（1-0/0-1）检测是长度统计模型的原理性局限，详见 [benchmark/README.md](benchmark/README.md) 路线图。

## 私有使用统计（可选，站长专属）

自托管于 [Cloudflare Worker](analytics/worker.js)（免费额度）：统计独立访客（UV）、浏览量（PV）、复访率、平均停留时长与对齐/导出/字幕导入等事件计数。设计原则：

- **匿名**：无 Cookie，客户端标识为本地随机 UUID；只上报事件计数，**用户的文本内容永远不会被发送**；
- **私有**：数据存在站长自己的 KV 存储，查看需管理密钥，第三方（包括本项目作者之外的人）无法读取；
- **默认关闭**：`js/analytics.js` 的端点未配置时，页面保持零统计请求。

部署约 10 分钟，步骤见 [analytics/README.md](analytics/README.md)；查看数据用 [analytics/dashboard.html](analytics/dashboard.html) 仪表盘（输入你的 Worker 地址与密钥，密钥只存本机浏览器）。

## 开发与本地预览

```bash
# 任意静态服务器即可
python3 -m http.server 8000
# 打开 http://localhost:8000
```

无构建步骤、无 npm 依赖；改动 js 后刷新页面即生效。算法层（segmenter/aligner/merge/exporters）可在 Node 中直接 require 做无头测试。

## 对齐质量建议

1. **保持各版本自然段数量一致**（空行分段）——段落数一致时自动启用段落锚定，准确率提升最明显
2. 译文中保留**数字、日期、百分比**——它们是对齐的强锚点
3. 优先审校**红色（低置信）行**：多为长句合并或未匹配句段
4. 法律/新闻类长句可开启「分号视为句界」

## 隐私与离线

- 文本内容零上传：断网也能完整使用；默认状态下页面无任何网络请求
- 可选的匿名使用统计（仅事件计数，不含文本）为站长自建端点，见 [analytics/README.md](analytics/README.md)
- 浏览器本地自动保存（localStorage），可一键恢复；`Ctrl+S` 随时导出工程 JSON 备份

## 引用

**引用本项目**：

```bibtex
@misc{multialign2026,
  title        = {MultiAlign: A Zero-Dependency Client-Side Workbench for Multilingual Sentence Alignment},
  author       = {tanyaqiong31029},
  year         = {2026},
  howpublished = {\url{https://github.com/tanyaqiongcode/multi-align}},
  note         = {Online demo: https://tanyaqiongcode.github.io/multi-align/}
}
```

对齐算法基于：William A. Gale & Kenneth W. Church (1993). *A Program for Aligning Sentences in Bilingual Corpora*. Computational Linguistics 19(1):75–102.

```bibtex
@article{gale1993program,
  author  = {Gale, William A. and Church, Kenneth W.},
  title   = {A Program for Aligning Sentences in Bilingual Corpora},
  journal = {Computational Linguistics},
  volume  = {19},
  number  = {1},
  pages   = {75--102},
  year    = {1993}
}
```

## License

[MIT](LICENSE) © 2026 tanyaqiong31029
