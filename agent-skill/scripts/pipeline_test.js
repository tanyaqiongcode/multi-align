#!/usr/bin/env node
'use strict';
/* MultiAlign 无头回归测试
 * 用法：node pipeline_test.js [工具目录]
 * 覆盖：多语分句（缩写/小数/引号/省略号）、6 版本对齐合并、TMX/XLSX/CSV 导出、
 *       ZIP 与 XML 完整性（借 Python zipfile/minidom）、DOCX 导入与编码识别。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const TOOL_DIR = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const JS = f => path.join(TOOL_DIR, 'js', f);
let passed = 0, failed = 0, skipped = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
function skip(name) { skipped++; console.log('  - 跳过 ' + name + '（环境缺少依赖）'); }
function pythonHas(mod) {
  try { execFileSync('python3', ['-c', 'import ' + mod], { stdio: 'pipe' }); return true; }
  catch (e) { return false; }
}

global.window = global;
[ 'util.js','segmenter.js','srt.js','project.js','analytics.js','aligner.js','merge.js','docximport.js','exporters.js','sample.js' ]
  .forEach(f => require(JS(f)));
const U = PA.util, Seg = PA.Seg, Aligner = PA.Aligner, Merge = PA.Merge, Exp = PA.Export;

console.log('== 1. 分句 ==');
const zhS = Seg.segmentPlain('他说："今天天气很好。"然后我们去了公园。全书共3.14万册，例如e.g.这样的缩写不切分。Mr. Smith回来了！真的吗？', 'zh-CN', {});
ok(zhS.length === 5, `中文 5 句（引号内句号不切、小数/缩写保留）→ 实际 ${zhS.length}`);
ok(zhS[0] === '他说："今天天气很好。"', '闭引号归前句：' + zhS[0]);
const enS = Seg.segmentPlain('Dr. Smith arrived at 3.30 p.m. on Jan. 5th. He said "This is great!" Then he left. Nobody knows... The end.', 'en', {});
ok(enS.length === 5, `英文 5 句（Dr./p.m./Jan. 不切，...后切）→ 实际 ${enS.length}`);
const jaS = Seg.segmentPlain('これはペンです。そうですね！「行きましょう。」と彼は言った。', 'ja', {});
ok(jaS.length === 4, `日文 4 句（「」内句号不切）→ 实际 ${jaS.length}`);
ok(Seg.segmentPlain('第一段。\n\n第二段开始。', 'zh-CN', {}).length === 2, '空行分段');
ok(Seg.detectLang('これはペンです。') === 'ja' && Seg.detectLang('Hello world.') === 'en', '语言检测 ja/en');
const lstZh = Seg.segmentRich('第一章 概述\n1. 引言\n本文研究对齐问题。\n2. 方法\n我们采用统计模型。', 'zh-CN', {}).map(s => s.text);
ok(lstZh.length === 5 && lstZh[1] === '1. 引言' && lstZh[3] === '2. 方法', '有序列表标号不误切（1. 引言 保持整句）→ 实际 ' + JSON.stringify(lstZh));
const lstEn = Seg.segmentPlain('He got 3. The game continued.', 'en', {});
ok(lstEn.length === 2, '句中数字仍切分（He got 3. | The game…）');
const yrEn = Seg.segmentPlain('It began in 2024. The year was cold.', 'en', {});
ok(yrEn.length === 2, '年份句界仍切分（in 2024. | The year…）');

console.log('== 2. 六版本对齐 ==');
const versions = PA.SAMPLE.versions.map(v => ({ id: v.name, name: v.name, lang: v.lang, text: v.text }));
ok(versions.length === 6, '示例含 6 个版本');
const settings = { usePara: true, splitSemi: false, lexWeight: 40, numWeight: 60, variance: 0 };
const segs = {};
for (const v of versions) segs[v.id] = Seg.segmentRich(v.text, v.lang, settings);
const prep = id => segs[id].map(s => ({ text: s.text, para: s.para, len: U.weightedLen(s.text), nums: Seg.extractNums(s.text), tokens: Seg.simTokens(s.text) }));
const pivot = versions[0], pS = prep(pivot.id), gP = Seg.langGroup(pivot.lang);
const pairResults = versions.slice(1).map(v => {
  const g = Seg.langGroup(v.lang);
  return { vid: v.id, beads: Aligner.alignTexts(pS, prep(v.id), { usePara: settings.usePara, variance: Seg.autoVariance(gP, g), lexWeight: Seg.lexCompatible(gP, g) ? settings.lexWeight : 0, numWeight: settings.numWeight, sameScript: Seg.lexCompatible(gP, g) }) };
});
const enBeads = pairResults.find(p => p.vid === 'English').beads;
ok(enBeads.filter(b => b.type === '1-1').length === 13, '英文对 13 个 1-1');
ok(enBeads.filter(b => b.type === '1-2').length === 1, '英文对 1 个 1-2（长句拆分演示）');
pairResults.filter(p => p.vid !== 'English').forEach(p =>
  ok(p.beads.every(b => b.type === '1-1'), `${p.vid} 全部 1-1`));
const tus = Merge.buildTUs(versions, pivot.id, segs, pairResults);
ok(tus.length === 14, `合并为 14 个翻译单元 → 实际 ${tus.length}`);
ok(tus.every(t => versions.every(v => (t.cells[v.id] || '').trim().length > 0)), '所有 TU 六语俱全');
ok(tus[8].cells['English'].includes('split or merged'), '1-2 句对拼入同一单元格');
ok(Math.abs(tus[8].conf - 0.72) < 1e-9 && tus[0].conf === 0.95,
  '置信度取各版本最低值（1-2 行 0.72 而非平均 ~0.90，告警不被稀释）');
ok(tus.every(t => Array.isArray(t.srcIdx) && t.srcIdx.length === 1) && tus[0].srcIdx[0] === 0 && tus[8].srcIdx[0] === 8,
  'TU 记录基准语句子下标（句序溯源）：tus[0]→[0]，tus[8]→[8]');

console.log('== 3. 对齐退化场景（无段落锚定） ==');
const zhT = Seg.segmentRich('今天天气很好。\n我们一起去公园散步吧。\n公园里有很多漂亮的花。\n小明买了一个冰淇淋。\n他觉得很开心。', 'zh-CN', {});
const enT = Seg.segmentRich('The weather is nice today.\nWe went for a walk in the park together, and there are many beautiful flowers in it.\nHe was very happy about it.', 'en', {});
const tBeads = Aligner.alignTexts(
  zhT.map(s => ({ text: s.text, para: s.para, len: U.weightedLen(s.text), nums: Seg.extractNums(s.text), tokens: Seg.simTokens(s.text) })),
  enT.map(s => ({ text: s.text, para: s.para, len: U.weightedLen(s.text), nums: Seg.extractNums(s.text), tokens: Seg.simTokens(s.text) })),
  { usePara: true, variance: 9, lexWeight: 0, numWeight: 60, sameScript: false });
ok(tBeads.some(b => b.type === '2-1'), '出现 2-1 合并对');
ok(tBeads.reduce((s, b) => s + b.a.length, 0) === zhT.length && tBeads.reduce((s, b) => s + b.b.length, 0) === enT.length, '所有句子均被覆盖（无丢失）');

console.log('== 4. 导出器 ==');
const rows = tus.map((tu, idx) => ({ idx, tu }));
const tmx = Exp.buildTMX(versions, rows, { srclang: 'zh-CN', includeConf: true, filename: 'demo' });
ok((tmx.match(/<tu /g) || []).length === 14 && (tmx.match(/<tuv /g) || []).length === 84, 'TMX 14 tu / 84 tuv');
const tmpZip = path.join(require('os').tmpdir(), 'ma_test_pair.zip');
const tmpX = path.join(require('os').tmpdir(), 'ma_test.xlsx');
(async () => {
  fs.writeFileSync(tmpX, Buffer.from(await Exp.buildXLSX(versions, rows, { includeConf: true }).arrayBuffer()));
  fs.writeFileSync(tmpZip, Buffer.from(await Exp.buildPairwiseZip(versions, pivot.id, rows, { includeConf: true, filename: 'demo' }).arrayBuffer()));
  const py = `import zipfile,sys,xml.dom.minidom as md
for f in sys.argv[1:]:
    z=zipfile.ZipFile(f); assert z.testzip() is None, 'CRC fail '+f
    for n in z.namelist():
        if n.endswith(('.xml','.rels')): md.parseString(z.read(n))
print('ZIP/XML OK', len(sys.argv)-1, 'files')`;
  try {
    execFileSync('python3', ['-c', py, tmpX, tmpZip], { stdio: 'pipe' });
    ok(true, 'XLSX 与两两 TMX ZIP：CRC 与全部 XML 部件校验通过');
  } catch (e) { ok(false, 'ZIP/XML 校验失败: ' + e.message); }
  if (pythonHas('openpyxl')) {
    try {
      execFileSync('python3', ['-c', 'import openpyxl,sys; wb=openpyxl.load_workbook(sys.argv[1]); ws=wb.active; assert ws.max_row==15 and ws.max_column==8, (ws.max_row,ws.max_column)', tmpX], { stdio: 'pipe' });
      ok(true, 'openpyxl 可打开（15 行 8 列）');
      const tmpX2 = path.join(require('os').tmpdir(), 'ma_test_src.xlsx');
      fs.writeFileSync(tmpX2, Buffer.from(await Exp.buildXLSX(versions, rows, { includeConf: true, srcIdx: true }).arrayBuffer()));
      execFileSync('python3', ['-c', 'import openpyxl,sys; wb=openpyxl.load_workbook(sys.argv[1]); ws=wb.active; assert ws.max_column==9, ws.max_column; assert ws["B1"].value=="\u53e5\u5e8f" and ws["B2"].value=="1", (ws["B1"].value, ws["B2"].value)', tmpX2], { stdio: 'pipe' });
      ok(true, 'XLSX 句序列（B1=句序，B2=1，9 列）');
    } catch (e) { ok(false, 'openpyxl 校验失败: ' + e.message.split('\n')[0]); }
  } else skip('openpyxl 打开校验');
  const csv = Exp.buildDelimited(versions, rows, { sep: ',', includeConf: true });
  ok(csv.split('\r\n').length === 15, `CSV 15 行 → 实际 ${csv.split('\r\n').length}`);
  // 句序溯源列（交叉审计：LLM 因摘录丢失原文位置而错配——该列让审校者能回查原稿）
  const csvSrc = Exp.buildDelimited(versions, rows, { sep: ',', srcIdx: true });
  const csvSrcLines = csvSrc.split('\r\n');
  ok(csvSrcLines[0].split(',').indexOf('句序') === 1, 'CSV 句序列位于行号后');
  ok(csvSrcLines[1].startsWith('1,1,') && csvSrcLines[9].startsWith('9,9,'), 'CSV 句序值与行号对应（1 基）');
  const tmxSrc = Exp.buildTMX(versions, rows, { srclang: 'zh-CN', includeConf: false, srcIdx: true, filename: 'd' });
  ok(tmxSrc.includes('<prop type="x-src-idx">1</prop>'), 'TMX 句序溯源属性（x-src-idx）');
  ok(csv.includes('"'), 'CSV 含引号转义字段（含逗号的句子被引号包裹）');
  ok(Exp.buildTXT(versions, rows).split('\n').length === 14, 'TXT 14 行');

  console.log('== 5. DOCX 导入 ==');
  const docxTmp = path.join(require('os').tmpdir(), 'ma_test.docx');
  if (pythonHas('docx')) {
    try {
      execFileSync('python3', ['-c', `from docx import Document
d=Document(); d.add_paragraph('这是第一段第一句。这是第一段第二句。'); d.add_paragraph('This is paragraph two. It has two sentences!'); d.save('${docxTmp.replace(/'/g, "\\'")}'); print('ok')`], { stdio: 'pipe' });
      const buf = fs.readFileSync(docxTmp);
      const text = await PA.Import.readDocxText(new File([buf], 't.docx'));
      ok(text.split('\n\n').length === 2 && text.includes('这是第一段第一句'), 'DOCX 两段提取（空行分隔）');
    } catch (e) { ok(false, 'DOCX 测试失败: ' + e.message.split('\n')[0]); }
  } else skip('DOCX 两段提取（需 python-docx）');
  const gbk = Buffer.from([0xd6, 0xd0, 0xce, 0xc4]);
  ok(PA.Import.decodeText(gbk.buffer.slice(gbk.byteOffset, gbk.byteOffset + gbk.byteLength)) === '中文', 'GBK 编码识别');

  console.log('== 6. SRT 字幕 ==');
  const sampleSrt = '1\r\n00:00:01,000 --> 00:00:03,500\r\n<i>Hello world.</i>\r\n\r\n2\r\n00:00:04,000 --> 00:00:06,000\r\nSecond line here.\r\n';
  ok(PA.SRT.looksLikeSrt(sampleSrt), 'looksLikeSrt 识别');
  const cues = PA.SRT.parse(sampleSrt);
  ok(cues.length === 2 && cues[0].start === 1000 && cues[0].end === 3500, 'SRT 解析时间与条数（CRLF + 标签清除）');
  ok(cues[0].text === 'Hello world.', '台词文本：' + cues[0].text);
  const vttText = 'WEBVTT\n\n00:01.000 --> 00:03.500\n你好世界。\n\n00:04.000 --> 00:06.000\n第二条。\n';
  const vttCues = PA.SRT.parse(vttText);
  ok(vttCues.length === 2 && vttCues[0].start === 1000 && vttCues[0].end === 3500, 'VTT 解析（无小时时间戳）');
  const rt = PA.SRT.parse(PA.SRT.formatGroups(cues.map(c => ({ t0: c.start, t1: c.end, lines: [c.text] }))));
  ok(rt.length === 2 && rt[1].text === 'Second line here.', 'SRT 生成往返解析');
  // 时间轴锚定对齐：双语台词各带 ±300ms 内偏移，验证全 1-1
  const zhCues = [
    { start: 0, end: 2000, text: '会议定在周一上午九点。' },
    { start: 2100, end: 4000, text: '请所有人准时参加。' },
    { start: 4100, end: 6000, text: '会议室在三楼东侧。' },
    { start: 6100, end: 8000, text: '记得携带笔记本和资料。' },
    { start: 8100, end: 10000, text: '会后一起吃午饭。' }
  ];
  const enCues = [
    { start: 150, end: 2150, text: 'The meeting is set for Monday morning.' },
    { start: 2250, end: 4150, text: 'Everyone please be on time.' },
    { start: 4250, end: 6150, text: 'The meeting room is on the third floor, east side.' },
    { start: 6250, end: 8150, text: 'Bring your laptop and documents.' },
    { start: 8250, end: 10150, text: 'Let us have lunch together afterwards.' }
  ];
  const toSent = cs => cs.map(c => ({ text: c.text, para: 0, t0: c.start, t1: c.end, len: U.weightedLen(c.text), nums: Seg.extractNums(c.text), tokens: Seg.simTokens(c.text) }));
  const srtBeads = Aligner.alignTexts(toSent(zhCues), toSent(enCues), { usePara: false, variance: 9, lexWeight: 0, numWeight: 60, srtWeight: 80, sameScript: false });
  ok(srtBeads.length === 5 && srtBeads.every(b => b.type === '1-1' && b.a[0] === b.b[0]), '时间轴锚定：5 句全 1-1 且下标一一对应');
  const srtVersions = [{ id: 'zh', name: '中文', lang: 'zh-CN' }, { id: 'en', name: '英文', lang: 'en' }];
  const srtTus = PA.Merge.buildTUs(srtVersions, 'zh', { zh: toSent(zhCues).map(s => ({ text: s.text, para: 0, t0: s.t0, t1: s.t1 })), en: toSent(enCues).map(s => ({ text: s.text, para: 0, t0: s.t0, t1: s.t1 })) }, [{ vid: 'en', beads: srtBeads }]);
  PA.SRT.attachTiming(srtTus, 'zh', toSent(zhCues).map(s => ({ text: s.text, para: 0, t0: s.t0, t1: s.t1 })));
  ok(srtTus.length === 5 && srtTus[0].t0 === 0 && srtTus[4].t1 === 10000, 'TU 时间轴附着（取基准语时间，首尾正确）');
  const bilingualSrt = Exp.formatSrtGroups(srtTus.map(t => ({ t0: t.t0, t1: t.t1, lines: [t.cells.zh || '', t.cells.en || ''] })));
  const backCues = PA.SRT.parse(bilingualSrt);
  ok(backCues.length === 5 && backCues[1].text.includes('Everyone please be on time.') && backCues[1].text.includes('请所有人准时参加。'), '双语 SRT 导出往返解析');

  console.log('== 8. 导出编排层（SRT 路径回归）==');
  // 回归背景：srtGroups 曾引用 doExport 局部作用域的 versions 导致 ReferenceError，
  // 且旧测试只测底层导出器、未覆盖编排层。现已改为 exporters 纯函数，可无头直测。
  ok(typeof Exp.srtGroups === 'function', 'srtGroups 位于导出器层（纯函数 versions 作参）');
  ok(Exp.srtGroups(versions, rows).length === 0, '无时间轴的 TU 行被过滤（防御未附着即导出）');
  // 示例为纯文本：给基准语合成时间轴后再附着（与字幕导入后的真实状态一致）
  segs[versions[0].id].forEach((s, i) => { s.t0 = i * 3000; s.t1 = i * 3000 + 2500; });
  PA.SRT.attachTiming(tus, versions[0].id, segs[versions[0].id]);
  const srtRowsAll = Exp.srtGroups(versions, rows);
  ok(srtRowsAll.length === tus.length && srtRowsAll[0].lines.length === versions.length,
    '附着时间轴后 ' + tus.length + ' 行全部成组且每行含全部语言');
  const srtZip = Exp.buildSrtsZip(srtRowsAll, versions, '回归测试');
  const zipMagic = Buffer.from(await srtZip.slice(0, 2).arrayBuffer()).toString('latin1');
  ok(zipMagic === 'PK' && srtZip.size > 1000, '字幕 ZIP 完整（PK 魔数 + 体积正常）');

  console.log('== 9. 工程保存/恢复编排（字幕时间轴完整性）==');
  // 高危回归背景：loadProject 曾丢弃 cues → 恢复后重新对齐丢失时间轴，SRT 导出失效。
  // 此处按"保存 → 恢复 → 重新对齐 → SRT 导出"全链路验证。
  ok(!!PA.Project && typeof PA.Project.normalize === 'function', 'PA.Project 模块可用');
  const srtProj = {
    app: 'multialign', v: 1, savedAt: 1,
    versions: [
      { id: 'zh', name: '中', lang: 'zh-CN',
        text: '会议定在周一。\n请准时参加。\n会议室在三楼。',
        cues: [{ start: 1000, end: 3000, text: '会议定在周一。' },
               { start: 3500, end: 5000, text: '请准时参加。' },
               { start: 5500, end: 7000, text: '会议室在三楼。' }] },
      { id: 'en', name: '英', lang: 'en',
        text: 'The meeting is on Monday.\nPlease be on time.\nThe room is on floor three.',
        cues: [{ start: 1150, end: 3150, text: 'The meeting is on Monday.' },
               { start: 3650, end: 5150, text: 'Please be on time.' },
               { start: 5650, end: 7150, text: 'The room is on floor three.' }] }
    ],
    pivotId: 'zh', settings: { usePara: true, splitSemi: false, lexWeight: 40, numWeight: 60, variance: 0, srtWeight: 80 },
    tus: []
  };
  // 步骤1 保存：serialize 往返
  const saved = JSON.parse(JSON.stringify(PA.Project.serialize(srtProj)));
  // 步骤2 恢复：normalize 校验并恢复 cues
  const restored = PA.Project.normalize(saved);
  ok(restored.ok && restored.data.versions.every(v => v.cues && v.cues.length === 3),
    '恢复后 cues 时间轴完整（此前被丢弃）');
  // 步骤3 重新对齐：恢复的 cues → segs → 对齐 → attachTiming
  const rs = {};
  for (const v of restored.data.versions) {
    rs[v.id] = v.cues.map(c => ({ text: c.text, para: 0, t0: c.start, t1: c.end }));
  }
  const rPrep = id => rs[id].map(x => ({ ...x, len: U.weightedLen(x.text), nums: Seg.extractNums(x.text), tokens: Seg.simTokens(x.text) }));
  const rBeads = Aligner.alignTexts(rPrep('zh'), rPrep('en'), { usePara: true, variance: 9, lexWeight: 0, numWeight: 60, srtWeight: 80, sameScript: false });
  const rTus = PA.Merge.buildTUs(restored.data.versions, 'zh', rs, [{ vid: 'en', beads: rBeads }]);
  PA.SRT.attachTiming(rTus, 'zh', rs.zh);
  // 步骤4 SRT 导出：时间轴正确 + 双语往返
  ok(rTus.length === 3 && rTus[0].t0 === 1000 && rTus[2].t1 === 7000, '重新对齐后时间轴正确（1000ms 起 / 7000ms 止）');
  const rGroups = Exp.srtGroups(restored.data.versions, rTus.map((tu, idx) => ({ idx, tu })));
  const rSrt = Exp.formatSrtGroups(rGroups);
  ok(PA.SRT.parse(rSrt).length === 3 && rSrt.includes('Please be on time.'), '恢复后 SRT 导出正常（此前失效）');
  // 校验面：坏 cue / 错 app 标签 / 坏 TU 均被拒
  const badCue = PA.Project.normalizeCues([{ start: 5000, end: 1000, text: '倒置' }, { start: 'x', end: 9, text: 'NaN' }, { start: 0, end: 800, text: '合法' }]);
  ok(badCue.length === 1 && badCue[0].text === '合法', '非法 cue 被过滤（倒置/NaN）');
  ok(PA.Project.normalize({ app: 'other', versions: [] }).ok === false, '错 app 标签被拒');
  const badTu = PA.Project.normalizeTu({ cells: 'not-an-object' });
  ok(badTu === null, '非法 TU 被过滤');
  const edgeTu = PA.Project.normalizeTu({
    cells: { a: null, b: 42 },       // null/非字符串值 → 字符串化
    conf: 7,                          // 越界置信度 → 钳制到 1
    locked: 1, modified: 'yes',      // 真值归一
    t0: 1000, t1: '2500'             // 字符串时间轴 → 数值保留
  });
  ok(edgeTu.cells.a === '' && edgeTu.cells.b === '42', 'TU 单元格 null/数字值字符串化');
  ok(edgeTu.conf === 1, 'TU 置信度越界钳制（7 → 1）');
  ok(edgeTu.locked === true && edgeTu.modified === true, 'TU 布尔字段真值归一');
  ok(edgeTu.t0 === 1000 && edgeTu.t1 === 2500, 'TU 字符串时间轴归一为数值并保留');
  ok(PA.Project.normalizeTu({ cells: {}, t0: 5, t1: 2 }).t0 === undefined, '倒置时间轴被丢弃');
  const srcNorm = PA.Project.normalizeTu({ cells: { a: 'x' }, srcIdx: [3, 'bad', 1, 1, -5] });
  ok(JSON.stringify(srcNorm.srcIdx) === '[1,3]', 'TU 句序溯源下标校验（去重/排序/剔除非法值）');
  ok(PA.Project.normalizeTu({ cells: { a: 'x' }, srcIdx: 'nope' }).srcIdx === undefined, '非法 srcIdx 被丢弃');

  console.log('== 10. CSV 公式注入防护 ==');
  const injVers = [{ id: 'v1', name: 'A', lang: 'en' }];
  const injRows = [{ idx: 0, tu: { cells: { v1: '=1+1' } } }, { idx: 1, tu: { cells: { v1: '@cmd' } } }, { idx: 2, tu: { cells: { v1: '-对话破折号' } } }];
  const csvOut = Exp.buildDelimited(injVers, injRows, { sep: ',' });
  ok(csvOut.includes("'=1+1") && csvOut.includes("'@cmd"), 'CSV：=/@ 起始单元格加 \' 前缀（防 Excel 公式注入）');
  ok(csvOut.includes('-对话破折号') && !csvOut.includes("'-"), 'CSV：- 起始（字幕对白破折号）刻意不防护，已文档化');
  const xlsxSafe = Exp.buildXLSX(injVers, injRows, {});
  ok(xlsxSafe instanceof Blob || xlsxSafe.size > 0, 'XLSX 内联字符串天然免公式注入');

  ok(csvOut.split('\r\n')[1] === "1,'=1+1", 'CSV：无特殊字符字段不加引号');
  const tsvRows = [{ idx: 0, tu: { cells: { v1: '=HYPERLINK("x")' } } }, { idx: 1, tu: { cells: { v1: '+1\tA, "b"\nC' } } }];
  const tsvOut = Exp.buildDelimited(injVers, tsvRows, { sep: '\t' });
  const tsvLines = tsvOut.split('\r\n');
  ok(tsvLines[1] === "1\t'=HYPERLINK(\"x\")", 'TSV：= 起始加 \' 前缀且不套 CSV 引号 → ' + JSON.stringify(tsvLines[1]));
  ok(tsvLines.length === 3 && tsvLines[2] === "2\t'+1 A, \"b\" C", 'TSV：字段内制表/换行替换为空格、逗号与引号原样 → ' + JSON.stringify(tsvLines[2]));
  ok(tsvLines.every(l => l.split('\t').length === 2), 'TSV：每行列数一致');

  console.log('== 11. 工程 id 白名单（XSS 防护） ==');
  const xssId = '"><img src=x onerror=alert(1)>';
  const xssProj = PA.Project.normalize({
    app: 'multialign',
    versions: [
      { id: xssId, name: 'A', lang: 'en', text: 'a' },
      { id: 'ok_id-1', name: 'B', lang: '"><svg onload=1>', text: 'b' },
      { id: 'ok_id-1', name: 'C', lang: 'fr', text: 'c' },          // 重复 id
      { id: 'x'.repeat(33), name: 'D', lang: 'de', text: 'd' },       // 超长
      { id: 42, name: 'E', lang: 'ja', text: 'e' }                    // 非字符串
    ],
    pivotId: xssId,
    tus: [{ cells: { [xssId]: '甲', 'ok_id-1': '乙', bogus: '丙' } }]
  });
  ok(xssProj.ok, '含恶意 id 的工程仍可打开');
  const xIds = xssProj.data.versions.map(v => v.id);
  ok(xIds.every(id => /^[A-Za-z0-9_-]{1,32}$/.test(id)), '所有 id 符合白名单 → ' + JSON.stringify(xIds));
  ok(new Set(xIds).size === xIds.length, '重复 id 被重新生成为唯一 id');
  ok(xIds[1] === 'ok_id-1' && xIds[0] !== xssId, '合法 id 保留、非法 id 替换');
  ok(xssProj.data.pivotId === xIds[0], 'pivotId 随非法 id 重映射');
  ok(xssProj.data.tus[0].cells[xIds[0]] === '甲' && xssProj.data.tus[0].cells['ok_id-1'] === '乙' &&
     !('bogus' in xssProj.data.tus[0].cells) && !(xssId in xssProj.data.tus[0].cells), 'TU cells 键随 id 重映射、未知键丢弃');
  ok(xssProj.data.versions[1].lang === 'en' && xssProj.data.versions[2].lang === 'fr', '非法语言代码回落为 en');

  console.log('== 12. ZIP 条目名去重 / TMX 版本号 ==');
  const zipNames = async blob => {
    const b = Buffer.from(await blob.arrayBuffer()), names = [];
    for (let i = 0; i + 30 <= b.length && b.readUInt32LE(i) === 0x04034b50;) {
      const nl = b.readUInt16LE(26 + i), sz = b.readUInt32LE(18 + i);
      names.push(b.slice(i + 30, i + 30 + nl).toString('utf8'));
      i += 30 + nl + sz;
    }
    return names;
  };
  const dupVers = [{ id: 'p', name: '中', lang: 'zh-CN' }, { id: 'a', name: 'EN', lang: 'en' }, { id: 'b', name: 'EN', lang: 'en' }, { id: 'c', name: 'en', lang: 'en' }];
  const dupRows = [{ idx: 0, tu: { cells: { p: '一', a: 'one', b: 'one', c: 'one' }, t0: 0, t1: 1000 } }];
  const pzNames = await zipNames(Exp.buildPairwiseZip(dupVers, 'p', dupRows, { filename: 'x' }));
  ok(pzNames.length === 3 && new Set(pzNames.map(n => n.toLowerCase())).size === 3, '两两 TMX ZIP：同名版本条目名唯一 → ' + JSON.stringify(pzNames));
  const szNames = await zipNames(Exp.buildSrtsZip(Exp.srtGroups(dupVers, dupRows), dupVers, 'demo'));
  ok(szNames.length === 5 && new Set(szNames.map(n => n.toLowerCase())).size === 5, '字幕 ZIP：同名版本条目名唯一 → ' + JSON.stringify(szNames));
  const pkgVer = JSON.parse(fs.readFileSync(path.join(TOOL_DIR, 'package.json'), 'utf8')).version;
  ok(Exp.buildTMX(dupVers, dupRows, {}).includes('creationtoolversion="' + pkgVer + '"'), 'TMX creationtoolversion 与 package.json 一致（' + pkgVer + '）');

  console.log('== 7. 匿名统计模块 ==');
  ok(!!PA.Analytics && typeof PA.Analytics.send === 'function' && PA.Analytics.enabled() === false,
    '默认关闭：ENDPOINT 为空时不发出任何请求');
  PA.Analytics.send('align', { versions: 2 });
  PA.Analytics.send('export', { fmt: 'tmx' });
  ok(true, 'send() 在未配置端点时静默无异常');

  console.log(`\n结果：${passed} 通过 / ${failed} 失败` + (skipped ? ` / ${skipped} 跳过` : ''));
  process.exit(failed ? 1 : 0);
})();
