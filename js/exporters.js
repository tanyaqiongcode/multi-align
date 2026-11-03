'use strict';
/* 多语平行语料对齐工作台 —— 导出（TMX / XLSX / CSV / TSV / TXT / ZIP）
 * XLSX 与 ZIP 由内置写入器生成（STORE 方式），零依赖。
 */
PA.Export = (function () {
  const U = PA.util;
  const crc32 = PA.crc32;
  // 与 package.json 的 version 保持一致（回归测试会校验）
  const TOOL_VERSION = '1.1.0';

  function xmlEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  }

  /* ---------- TMX ---------- */
  function buildTMX(versions, rows, o) {
    // versions: [{id,name,lang}]；rows: [{idx, tu}]
    const srclang = o.srclang || 'en';
    let out = '<?xml version="1.0" encoding="UTF-8"?>\n';
    out += '<tmx version="1.4">\n';
    out += '  <header creationtool="MultiAlign 多语对齐工作台" creationtoolversion="' + TOOL_VERSION + '" segtype="sentence"';
    out += ' o-tmf="multialign" adminlang="zh-CN" srclang="' + xmlEsc(srclang) + '" datatype="plaintext"';
    out += ' o-filename="' + xmlEsc(o.filename || 'corpus') + '"/>\n';
    out += '  <body>\n';
    rows.forEach(r => {
      out += '    <tu tuid="' + (r.idx + 1) + '">\n';
      if (o.includeConf) {
        out += '      <prop type="confidence">' + Math.round((r.tu.conf || 0) * 100) + '</prop>\n';
      }
      if (o.srcIdx) {
        const lbl = srcIdxLabel(r.tu);
        if (lbl) out += '      <prop type="x-src-idx">' + lbl + '</prop>\n';
      }
      versions.forEach(v => {
        const text = (r.tu.cells[v.id] || '').trim();
        if (!text) return;
        out += '      <tuv xml:lang="' + xmlEsc(v.lang) + '"><seg>' + xmlEsc(text) + '</seg></tuv>\n';
      });
      out += '    </tu>\n';
    });
    out += '  </body>\n</tmx>\n';
    return out;
  }

  /* ---------- ZIP 写入器（STORE，不压缩） ---------- */
  function makeZip(files) {
    const enc = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;
    const d = new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();

    files.forEach(f => {
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const nameB = enc.encode(f.name);
      const crc = crc32(data);
      const lh = new Uint8Array(30 + nameB.length);
      const dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 0x0800, true); // UTF-8 文件名
      dv.setUint16(8, 0, true);      // STORE
      dv.setUint16(10, dosTime, true);
      dv.setUint16(12, dosDate, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, data.length, true);
      dv.setUint32(22, data.length, true);
      dv.setUint16(26, nameB.length, true);
      dv.setUint16(28, 0, true);
      lh.set(nameB, 30);
      chunks.push(lh, data);
      central.push({ nameB: nameB, crc: crc, size: data.length, offset: offset });
      offset += lh.length + data.length;
    });

    let cdSize = 0;
    const cdChunks = [];
    central.forEach(c => {
      const ch = new Uint8Array(46 + c.nameB.length);
      const dv = new DataView(ch.buffer);
      dv.setUint32(0, 0x02014b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 20, true);
      dv.setUint16(8, 0x0800, true);
      dv.setUint16(10, 0, true);
      dv.setUint16(12, dosTime, true);
      dv.setUint16(14, dosDate, true);
      dv.setUint32(16, c.crc, true);
      dv.setUint32(20, c.size, true);
      dv.setUint32(24, c.size, true);
      dv.setUint16(28, c.nameB.length, true);
      dv.setUint32(42, c.offset, true);
      ch.set(c.nameB, 46);
      cdChunks.push(ch);
      cdSize += ch.length;
    });

    const eocd = new Uint8Array(22);
    const dv = new DataView(eocd.buffer);
    dv.setUint32(0, 0x06054b50, true);
    dv.setUint16(8, files.length, true);
    dv.setUint16(10, files.length, true);
    dv.setUint32(12, cdSize, true);
    dv.setUint32(16, offset, true);
    return new Blob(chunks.concat(cdChunks, [eocd]), { type: 'application/zip' });
  }

  /* ---------- XLSX（最小实现，inline string） ---------- */
  function colName(n) {
    let s = '';
    n = n + 1;
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function buildXLSX(versions, rows, o) {
    const headers = ['行号'];
    if (o.srcIdx) headers.push('句序');
    headers.push.apply(headers, versions.map(v => v.name + '（' + v.lang + '）'));
    if (o.includeConf) headers.push('置信度(%)');
    const cols = headers.map((h, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (i === 0 ? 7 : (o.srcIdx && i === 1 ? 9 : 44)) + '" customWidth="1"/>').join('');

    let sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    sheet += '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
    sheet += '<cols>' + cols + '</cols><sheetData>';
    sheet += '<row r="1">' + headers.map((h, i) =>
      '<c r="' + colName(i) + '1" t="inlineStr" s="1"><is><t>' + xmlEsc(h) + '</t></is></c>').join('') + '</row>';
    rows.forEach((r, ri) => {
      const rn = ri + 2;
      let cells = '<c r="A' + rn + '" t="inlineStr"><is><t>' + (r.idx + 1) + '</t></is></c>';
      if (o.srcIdx) {
        cells += '<c r="B' + rn + '" t="inlineStr"><is><t>' + xmlEsc(srcIdxLabel(r.tu)) + '</t></is></c>';
      }
      const off = o.srcIdx ? 1 : 0;
      versions.forEach((v, ci) => {
        const text = (r.tu.cells[v.id] || '').trim();
        cells += '<c r="' + colName(ci + 1 + off) + rn + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(text) + '</t></is></c>';
      });
      if (o.includeConf) {
        cells += '<c r="' + colName(versions.length + 1 + off) + rn + '" t="inlineStr"><is><t>' + Math.round((r.tu.conf || 0) * 100) + '</t></is></c>';
      }
      sheet += '<row r="' + rn + '">' + cells + '</row>';
    });
    sheet += '</sheetData></worksheet>';

    const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="对齐结果" sheetId="1" r:id="rId1"/></sheets></workbook>';

    const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
      '<cellStyles count="1"><cellStyle name="常规" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

    const files = [
      {
        name: '[Content_Types].xml',
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          '</Types>'
      },
      {
        name: '_rels/.rels',
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
      },
      { name: 'xl/workbook.xml', data: workbook },
      {
        name: 'xl/_rels/workbook.xml.rels',
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
          '</Relationships>'
      },
      { name: 'xl/styles.xml', data: styles },
      { name: 'xl/worksheets/sheet1.xml', data: sheet }
    ];
    return makeZip(files);
  }

  /* ---------- CSV / TSV / TXT ---------- */
  function csvField(s, sep) {
    s = String(s == null ? '' : s);
    // Excel/LibreOffice 公式注入防护（OWASP）：以 = + @ 或制表/回车开头的单元格
    // 加 ' 前缀（CSV 与 TSV 均防护，见 SECURITY.md）。刻意不防护 '-'：字幕对白常以
    // "- " 开头，加前缀破坏内容（残余风险已记入 SECURITY.md）。
    // XLSX 的 inline string 不经此路径（Excel 不求值）。
    if (/^[=+@\t\r]/.test(s)) s = "'" + s;
    if (sep !== ',') {
      // TSV：无引号转义约定，字段内的制表符/换行替换为空格，保持行列结构
      return s.replace(/\r\n|[\t\r\n]/g, ' ');
    }
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function buildDelimited(versions, rows, o) {
    const sep = o.sep || ',';
    const headers = ['行号'];
    if (o.srcIdx) headers.push('句序');
    headers.push.apply(headers, versions.map(v => v.name));
    if (o.includeConf) headers.push('置信度(%)');
    const lines = [headers.map(h => csvField(h, sep)).join(sep)];
    rows.forEach(r => {
      const fields = [String(r.idx + 1)];
      if (o.srcIdx) fields.push(srcIdxLabel(r.tu));
      fields.push.apply(fields, versions.map(v => (r.tu.cells[v.id] || '').trim()));
      if (o.includeConf) fields.push(String(Math.round((r.tu.conf || 0) * 100)));
      lines.push(fields.map(f => csvField(f, sep)).join(sep));
    });
    return lines.join('\r\n');
  }
  function buildTXT(versions, rows) {
    return rows.map(r => versions.map(v => (r.tu.cells[v.id] || '').trim()).join('\t')).join('\n');
  }

  /* ZIP 条目名去重：同名版本会生成重复文件名（解压时互相覆盖），追加 _2/_3… 序号 */
  function uniqueName(name, used) {
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let out = name, n = 2;
    while (used.has(out.toLowerCase())) out = stem + '_' + (n++) + ext;
    used.add(out.toLowerCase());
    return out;
  }

  /* 两两双语 TMX 打包（基准语 × 每个其他版本） */
  function buildPairwiseZip(versions, pivotId, rows, o) {
    const pivot = versions.find(v => v.id === pivotId) || versions[0];
    const files = [];
    const used = new Set();
    versions.forEach(v => {
      if (v.id === pivot.id) return;
      const pairVers = [pivot, v];
      const pairRows = rows.filter(r =>
        (r.tu.cells[pivot.id] || '').trim() && (r.tu.cells[v.id] || '').trim());
      const tmx = buildTMX(pairVers, pairRows, {
        srclang: pivot.lang, includeConf: o.includeConf,
        filename: o.filename + '_' + U.sanitizeName(pivot.name) + '-' + U.sanitizeName(v.name)
      });
      files.push({ name: uniqueName(U.sanitizeName(pivot.name) + '-' + U.sanitizeName(v.name) + '.tmx', used), data: tmx });
    });
    if (!files.length) return null;
    return makeZip(files);
  }

  /* 句序溯源标签：TU.srcIdx（基准语句子下标）→ "12" / "12-13"（1 基） */
  function srcIdxLabel(tu) {
    if (!tu || !tu.srcIdx || !tu.srcIdx.length) return '';
    const lo = tu.srcIdx[0], hi = tu.srcIdx[tu.srcIdx.length - 1];
    return lo === hi ? String(lo + 1) : (lo + 1) + '-' + (hi + 1);
  }

  /* ---------- SRT 字幕 ---------- */
  /* TU 行 → SRT 字幕组。versions 为当前版本数组（纯函数，不读全局状态）；
   * 缺时间轴（tu.t0 未被 attachTiming 附着）或整行台词全空的行会被过滤。 */
  function srtGroups(versions, rows) {
    return (rows || []).map(r => ({
      t0: r.tu.t0, t1: r.tu.t1,
      lines: versions.map(v => (r.tu.cells[v.id] || '').trim())
    })).filter(g => g.t0 !== undefined && g.t1 !== undefined && g.lines.some(l => l !== ''));
  }

  /* groups: [{t0, t1, lines:[各语言一行]}]（时间取自基准语，由 PA.SRT.attachTiming 附着） */
  function formatSrtGroups(groups) {
    const msToTs = PA.SRT && PA.SRT.msToTs;
    if (!msToTs) throw new Error('SRT 模块未加载');
    return groups
      .filter(g => g.t0 !== undefined && g.t1 !== undefined && g.lines.some(l => l !== ''))
      .map((g, i) => (i + 1) + '\n' + msToTs(g.t0) + ' --> ' + msToTs(g.t1) + '\n' +
        g.lines.filter(l => l !== '').join('\n'))
      .join('\n\n') + '\n';
  }

  /* 多语合并字幕 + 各语言单语字幕，打包 ZIP */
  function buildSrtsZip(groups, versions, base) {
    const name = U.sanitizeName(base);
    const used = new Set();
    const files = [{ name: uniqueName(name + '_多语字幕.srt', used), data: formatSrtGroups(groups) }];
    versions.forEach((v, i) => {
      const mono = groups.map(g => ({ t0: g.t0, t1: g.t1, lines: [g.lines[i]] }));
      files.push({ name: uniqueName(name + '_' + U.sanitizeName(v.name) + '.srt', used), data: formatSrtGroups(mono) });
    });
    return makeZip(files);
  }

  return {
    xmlEsc, buildTMX, makeZip, buildXLSX, buildDelimited, buildTXT, buildPairwiseZip, srcIdxLabel,
    srtGroups, formatSrtGroups, buildSrtsZip, uniqueName, TOOL_VERSION
  };
})();
