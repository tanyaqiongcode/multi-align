'use strict';
/* 多语平行语料对齐工作台 —— 主控制器 */
(function () {
  const U = PA.util, Seg = PA.Seg, Aligner = PA.Aligner, Merge = PA.Merge, Imp = PA.Import, Exp = PA.Export;

  const LS_KEY = 'multialign_autosave_v1';
  const CHUNK = 300;
  const DEFAULT_LANGS = ['zh-CN', 'en', 'ja', 'fr', 'de', 'es', 'ru', 'ko', 'pt', 'it'];

  const state = {
    view: 'home',
    step: 1,
    versions: [],            // {id, name, lang, text}
    pivotId: null,
    settings: { usePara: true, splitSemi: false, lexWeight: 40, numWeight: 60, variance: 0, srtWeight: 80 },
    segs: {},                // vid -> [{text, para}]
    tus: [],                 // {cells:{vid:text}, conf, locked, modified}
    alignMeta: null,
    selectedRow: -1,
    selectedCell: null,      // {rid, vid}
    undo: [], redo: [],
    search: null,            // {term, scope, matches, idx}
    filter: 'all',
    fontSize: 14,
    hiddenCols: new Set(),
    dirtyText: false,
    renderFrom: 0, renderTo: 0,
    focusOrig: null
  };

  const el = {};
  const missingEls = [];
  function E(id) {
    const node = document.getElementById(id);
    if (!node) missingEls.push(id);
    return node;
  }
  function esc(s) { return U.escapeHtml(s); }
  function byId(id) { return state.versions.find(v => v.id === id) || null; }
  function colColor(vid) {
    let h = 0;
    for (let i = 0; i < vid.length; i++) h = (h * 31 + vid.charCodeAt(i)) >>> 0;
    return 'hsl(' + (h % 360) + ',72%,52%)';
  }
  function sepFor(text) { return Seg.isCJKText(text) ? '' : ' '; }

  /* ==================== 初始化 ==================== */
  function init() {
    el.views = { home: E('view-home'), work: E('view-work'), docs: E('view-docs'), about: E('view-about') };
    el.navLinks = Array.prototype.slice.call(document.querySelectorAll('.nav-link'));
    el.brandBtn = E('brandBtn');

    // step1
    el.vlist = E('vlist');
    el.addVersionBtn = E('addVersionBtn');
    el.toStep2Btn = E('toStep2Btn');
    el.btnSample = E('btnSample');
    el.btnOpenProj = E('btnOpenProj');
    el.btnClearProj = E('btnClearProj');
    el.projFileInput = E('projFileInput');
    el.restoreBanner = E('restoreBanner');
    el.step1Hint = E('step1Hint');

    // step2
    el.step2Chips = E('step2Chips');
    el.setUsePara = E('setUsePara');
    el.setSplitSemi = E('setSplitSemi');
    el.setLexWeight = E('setLexWeight');
    el.setNumWeight = E('setNumWeight');
    el.setSrtWeight = E('setSrtWeight');
    el.setVariance = E('setVariance');
    el.lexWeightVal = E('lexWeightVal');
    el.numWeightVal = E('numWeightVal');
    el.srtWeightVal = E('srtWeightVal');
    el.runAlignBtn = E('runAlignBtn');
    el.alignLog = E('alignLog');
    el.alignProgressBar = E('alignProgressBar');
    el.alignResult = E('alignResult');
    el.backTo1Btn = E('backTo1Btn');

    // step3
    el.dirtyBanner = E('dirtyBanner');
    el.editorInfo = E('editorInfo');
    el.filterSel = E('filterSel');
    el.eThead = E('eThead');
    el.eTbody = E('eTbody');
    el.editorWrap = E('editorWrap');
    el.rowCount = E('rowCount');
    el.btnCols = E('btnCols');
    el.colsPanel = E('colsPanel');

    // step4
    el.expOnlyLocked = E('expOnlyLocked');
    el.expSkipEmpty = E('expSkipEmpty');
    el.expIncludeConf = E('expIncludeConf');
    el.expBaseName = E('expBaseName');
    el.exportPreview = E('exportPreview');
    el.exportCards = E('exportCards');

    // modals
    el.modalConfirm = E('modalConfirm');
    el.confirmTitle = E('confirmTitle');
    el.confirmMsg = E('confirmMsg');
    el.confirmOk = E('confirmOk');
    el.confirmCancel = E('confirmCancel');
    el.modalSearch = E('modalSearch');
    el.searchTerm = E('searchTerm');
    el.searchReplace = E('searchReplace');
    el.searchScope = E('searchScope');
    el.searchInfo = E('searchInfo');
    el.modalStats = E('modalStats');
    el.statsBody = E('statsBody');
    el.toastRoot = E('toastRoot');

    bindNav();
    bindStep1();
    bindStep2();
    bindEditor();
    bindSearch();
    bindExport();
    bindGlobal();

    renderVersionCards();
    showView('home');
    checkAutosave();
    PA.Analytics.init();
    setInterval(autosave, 25000);
    if (missingEls.length) {
      const msg = '页面缺少元素: ' + missingEls.join(', ') + '（相关功能未绑定）';
      console.error('[MultiAlign] ' + msg);
      const banner = document.createElement('div');
      banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#B42318;color:#fff;' +
        'padding:10px 18px;font-size:13px;font-family:monospace';
      banner.textContent = '⚠ ' + msg;
      document.body.appendChild(banner);
    }
  }

  /* ==================== 视图路由 ==================== */
  function showView(name) {
    state.view = name;
    Object.keys(el.views).forEach(k => { el.views[k].classList.toggle('view-on', k === name); });
    el.navLinks.forEach(a => a.classList.toggle('nav-on', a.dataset.view === name));
    window.scrollTo(0, 0);
    if (location.hash !== '#/' + name) {
      try { history.replaceState(null, '', '#/' + name); } catch (e) { }
    }
  }
  function bindNav() {
    el.navLinks.forEach(a => a.addEventListener('click', e => { e.preventDefault(); showView(a.dataset.view); }));
    el.brandBtn.addEventListener('click', () => showView('home'));
    Array.prototype.forEach.call(document.querySelectorAll('[data-goto]'), b => {
      b.addEventListener('click', () => {
        const t = b.dataset.goto;
        if (t === 'work') { showView('work'); }
        else if (t === 'docs') { showView('docs'); }
      });
    });
    window.addEventListener('hashchange', () => {
      const m = (location.hash || '').match(/^#\/(\w+)/);
      if (m && el.views[m[1]]) showView(m[1]);
    });
  }

  /* ==================== 步骤切换 ==================== */
  function setStep(n, opts) {
    opts = opts || {};
    if (n === 3 && !state.tus.length && !opts.force) { toast('请先完成自动对齐', 'warn'); return; }
    if (n === 4 && !state.tus.length) { toast('请先完成自动对齐', 'warn'); return; }
    state.step = n;
    for (let i = 1; i <= 4; i++) {
      const li = E('step' + i);
      if (li) { li.classList.toggle('step-on', i === n); li.classList.toggle('step-done', i < n); }
      const pane = E('pane' + i);
      if (pane) pane.classList.toggle('pane-on', i === n);
    }
    if (n === 2) renderStep2();
    if (n === 3) { renderEditor(); updateEditorInfo(); }
    if (n === 4) renderExportPane();
    if (state.view !== 'work') showView('work');
    window.scrollTo(0, 0);
  }

  /* ==================== 第一步：版本管理 ==================== */
  function bindStep1() {
    E('textFilesInput').addEventListener('change', async e => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      for (const file of files) {
        if (state.versions.length >= 10) { toast('最多支持 10 个版本，其余文件未导入', 'warn'); break; }
        const v = addVersion();
        v.name = file.name.replace(/\.[^.]+$/, '').slice(0, 30) || v.name;
        const card = Array.from(el.vlist.querySelectorAll('.vcard')).find(c => c.dataset.vid === v.id);
        card.querySelector('.vname').value = v.name;
        if (!await importFileToVersion(v, file, card)) {
          state.versions = state.versions.filter(x => x.id !== v.id);
          if (state.pivotId === v.id) state.pivotId = state.versions[0]?.id || null;
          renderVersionCards();
        }
      }
    });
    el.addVersionBtn.addEventListener('click', () => {
      if (state.versions.length >= 10) { toast('最多支持 10 个版本', 'warn'); return; }
      addVersion();
    });
    el.btnSample.addEventListener('click', () => {
      const hasData = state.versions.some(v => (v.text || '').trim()) || state.tus.length;
      if (hasData) {
        confirmDlg('载入示例', '载入示例将替换当前已录入的版本与审校结果，确定继续？').then(ok => { if (ok) loadSample(); });
      } else loadSample();
    });
    el.btnOpenProj.addEventListener('click', () => el.projFileInput.click());
    el.projFileInput.addEventListener('change', e => {
      const f = e.target.files && e.target.files[0];
      if (f) openProjectFile(f);
      el.projFileInput.value = '';
    });
    el.btnClearProj.addEventListener('click', () => {
      if (!state.versions.length && !state.tus.length) return;
      confirmDlg('清空工程', '将清空所有版本文本、对齐结果与审校记录，确定继续？').then(ok => {
        if (!ok) return;
        resetProject();
        toast('已清空');
      });
    });
    el.toStep2Btn.addEventListener('click', () => goStep2());

    // 卡片事件（委托）
    el.vlist.addEventListener('input', e => {
      const card = e.target.closest('.vcard'); if (!card) return;
      const vid = card.dataset.vid, v = byId(vid); if (!v) return;
      if (e.target.classList.contains('vname')) { v.name = e.target.value; }
      else if (e.target.classList.contains('vtext')) {
        v.text = e.target.value;
        if (v.cues) { v.cues = null; } // 手工编辑使字幕时间轴失效
        if (state.tus.length) markDirty();
        scheduleStats(vid, card);
      }
    });
    el.vlist.addEventListener('change', e => {
      const card = e.target.closest('.vcard'); if (!card) return;
      const vid = card.dataset.vid, v = byId(vid); if (!v) return;
      if (e.target.classList.contains('vlang')) {
        v.lang = e.target.value;
        scheduleStats(vid, card, true);
      } else if (e.target.classList.contains('vpivot')) {
        state.pivotId = vid;
        refreshPivotRadios();
      } else if (e.target.classList.contains('vfile')) {
        const f = e.target.files && e.target.files[0];
        if (f) importFileToVersion(v, f, card);
        e.target.value = '';
      }
    });
    el.vlist.addEventListener('paste', e => {
      const ta = e.target.closest('.vtext');
      if (!ta) return;
      const pasted = e.clipboardData ? e.clipboardData.getData('text') : '';
      if (!pasted || !PA.SRT.looksLikeSrt(pasted)) return;
      e.preventDefault();
      const card = ta.closest('.vcard');
      const v = byId(card.dataset.vid);
      if (v) { applySrtToVersion(v, pasted, '粘贴的字幕', card); updateStep1Bar(); }
    });

    el.vlist.addEventListener('click', e => {
      const del = e.target.closest('.vdel');
      if (del) {
        const card = del.closest('.vcard'); const vid = card.dataset.vid;
        removeVersion(vid);
      }
    });
  }

  function addVersion(lang) {
    const idx = state.versions.length;
    const v = {
      id: U.uid('v'),
      name: '版本' + (idx + 1),
      lang: lang || DEFAULT_LANGS[idx % DEFAULT_LANGS.length],
      text: ''
    };
    state.versions.push(v);
    if (!state.pivotId) state.pivotId = v.id;
    renderVersionCards();
    return v;
  }

  function removeVersion(vid) {
    const v = byId(vid);
    if (!v) return;
    if ((v.text || '').trim() || state.tus.length) {
      confirmDlg('移除版本', '确定移除「' + (v.name || '版本') + '」？其文本将同时从工程中删除。').then(ok => {
        if (!ok) return;
        doRemove(vid);
      });
    } else doRemove(vid);
    function doRemove(vid) {
      state.versions = state.versions.filter(x => x.id !== vid);
      if (state.pivotId === vid) state.pivotId = state.versions.length ? state.versions[0].id : null;
      if (state.tus.length) { state.tus.forEach(tu => { delete tu.cells[vid]; }); markDirty(); }
      renderVersionCards();
    }
  }

  function refreshPivotRadios() {
    Array.prototype.forEach.call(el.vlist.querySelectorAll('.vcard'), card => {
      const rb = card.querySelector('.vpivot');
      if (rb) rb.checked = card.dataset.vid === state.pivotId;
    });
  }

  function cardHTML(v, i) {
    const opts = Seg.LANGS.map(l =>
      '<option value="' + esc(l.code) + '"' + (l.code === v.lang ? ' selected' : '') + '>' + esc(l.name) + '</option>').join('');
    const isPivot = v.id === state.pivotId;
    return '<div class="vcard" data-vid="' + esc(v.id) + '">' +
      '<div class="vcard-head">' +
      '<span class="col-dot" style="background:' + colColor(v.id) + '"></span>' +
      '<input class="vname" value="' + esc(v.name) + '" placeholder="版本名称" maxlength="30">' +
      '<select class="vlang" title="选择语言">' + opts + '</select>' +
      '<button class="icon-btn vdel" title="移除此版本">✕</button>' +
      '</div>' +
      '<div class="vcard-pivot"><label><input type="radio" class="vpivot" name="pivotRadio"' + (isPivot ? ' checked' : '') + '> 设为基准语' + (isPivot ? '（当前）' : '') + '</label></div>' +
      '<textarea class="vtext" placeholder="粘贴该语言文本…（也可导入 txt / md / docx / srt / vtt）"></textarea>' +
      '<div class="vcard-foot">' +
      '<label class="file-btn">导入文件<input type="file" class="vfile" accept=".txt,.md,.docx,.csv,.srt,.vtt" hidden></label>' +
      '<span class="vstats" data-stats>0 字符</span>' +
      '</div></div>';
  }

  function renderVersionCards() {
    const n = state.versions.length;
    el.vlist.innerHTML = state.versions.map(cardHTML).join('');
    // 回填文本（避免转义问题：textarea 用 value 赋值）
    Array.prototype.forEach.call(el.vlist.querySelectorAll('.vcard'), card => {
      const v = byId(card.dataset.vid);
      if (v) {
        card.querySelector('.vtext').value = v.text || '';
        scheduleStats(v.id, card, true);
      }
    });
    el.addVersionBtn.disabled = n >= 10;
    el.addVersionBtn.textContent = n >= 10 ? '已达上限（10 个版本）' : '＋ 添加版本';
    updateStep1Bar();
  }

  const statsTimers = {};
  function scheduleStats(vid, card, immediate) {
    clearTimeout(statsTimers[vid]);
    const run = () => updateCardStats(vid, card);
    if (immediate) run(); else statsTimers[vid] = setTimeout(run, 500);
  }
  function updateCardStats(vid, card) {
    const v = byId(vid); if (!v) return;
    const span = card.querySelector('[data-stats]'); if (!span) return;
    const text = v.text || '';
    if (!text.trim()) { span.textContent = '0 字符'; return; }
    if (v.cues && v.cues.length) {
      const dur = Math.max(0, Math.round((v.cues[v.cues.length - 1].end - v.cues[0].start) / 60000));
      span.textContent = '🎬 ' + v.cues.length + ' 条台词 · 约 ' + dur + ' 分钟';
      return;
    }
    const sents = Seg.segmentRich(text, v.lang, state.settings);
    const paras = text.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n+/).filter(p => p.trim()).length;
    span.textContent = U.fmt(text.length) + ' 字符 · ' + paras + ' 段 · 约 ' + U.fmt(sents.length) + ' 句';
  }

  function updateStep1Bar() {
    const filled = state.versions.filter(v => (v.text || '').trim()).length;
    el.step1Hint.textContent = state.versions.length < 2
      ? '提示：至少需要 2 个版本的文本（推荐 5–10 个）'
      : '已录入 ' + filled + '/' + state.versions.length + ' 个版本的文本，基准语：' + esc((byId(state.pivotId) || {}).name || '未设置');
    el.toStep2Btn.disabled = filled < 2;
  }

  function markDirty() {
    state.dirtyText = true;
    el.dirtyBanner.classList.add('banner-on');
  }

  async function importFileToVersion(v, file, card) {
    try {
      const name = (file.name || '').toLowerCase();
      let r;
      if (name.endsWith('.srt') || name.endsWith('.vtt')) {
        r = { text: await Imp.readTextFile(file), type: 'srt' };
      } else {
        r = await Imp.readAny(file);
      }
      let text = (r.text || '').replace(/\u00a0/g, ' ');
      if (!text.trim()) { toast('文件内容为空', 'warn'); return; }
      if (r.type === 'srt' || PA.SRT.looksLikeSrt(text)) {
        const ok = applySrtToVersion(v, text, file.name, card);
        updateStep1Bar();
        return ok;
      }
      v.cues = null;
      v.text = text;
      card.querySelector('.vtext').value = text;
      const det = Seg.detectLang(text);
      if (det && det !== v.lang) {
        v.lang = det;
        card.querySelector('.vlang').value = det;
        toast('已导入 ' + file.name + '（识别为 ' + Seg.langInfo(det).name + '）');
      } else {
        toast('已导入 ' + file.name);
      }
      if (state.tus.length) markDirty();
      scheduleStats(v.id, card, true);
      updateStep1Bar();
      autosave();
      return true;
    } catch (err) {
      toast('导入失败：' + (err && err.message || err), 'err');
    }
  }

  /* 字幕文件 → 版本：解析时间轴，正文以 cue 文本按行重建 */
  function applySrtToVersion(v, rawText, fname, card) {
    const cues = PA.SRT.parse(rawText);
    if (!cues.length) { toast('字幕解析失败或没有有效台词', 'warn'); return; }
    v.cues = cues;
    v.text = cues.map(c => c.text).join('\n');
    if (card) card.querySelector('.vtext').value = v.text;
    const det = Seg.detectLang(v.text);
    if (det && det !== v.lang && card) { v.lang = det; card.querySelector('.vlang').value = det; }
    const dur = Math.round((cues[cues.length - 1].end - cues[0].start) / 60000);
    toast('已导入字幕 ' + fname + '：' + cues.length + ' 条台词' + (dur > 0 ? '，约 ' + dur + ' 分钟' : ''), 'ok');
    if (state.tus.length) markDirty();
    if (card) scheduleStats(v.id, card, true);
    PA.Analytics.send('srt_import');
    autosave();
    return true;
  }

  function loadSample() {
    state.versions = PA.SAMPLE.versions.map(s => ({
      id: U.uid('v'), name: s.name, lang: s.lang, text: s.text
    }));
    state.pivotId = state.versions.length ? state.versions[0].id : null;
    state.tus = []; state.undo = []; state.redo = []; state.dirtyText = false;
    el.dirtyBanner.classList.remove('banner-on');
    renderVersionCards();
    toast('已载入示例：' + PA.SAMPLE.versions.length + ' 个版本（' + PA.SAMPLE.name + '）');
    autosave();
  }

  function resetProject() {
    state.versions = []; state.pivotId = null; state.segs = {}; state.tus = [];
    state.undo = []; state.redo = []; state.search = null; state.alignMeta = null;
    state.dirtyText = false; state.hiddenCols = new Set();
    el.dirtyBanner.classList.remove('banner-on');
    renderVersionCards();
    try { localStorage.removeItem(LS_KEY); } catch (e) { }
  }

  /* ==================== 第二步：对齐参数与运行 ==================== */
  function bindStep2() {
    el.setUsePara.addEventListener('change', () => state.settings.usePara = el.setUsePara.checked);
    el.setSplitSemi.addEventListener('change', () => state.settings.splitSemi = el.setSplitSemi.checked);
    el.setLexWeight.addEventListener('input', () => {
      state.settings.lexWeight = +el.setLexWeight.value;
      el.lexWeightVal.textContent = el.setLexWeight.value;
    });
    el.setNumWeight.addEventListener('input', () => {
      state.settings.numWeight = +el.setNumWeight.value;
      el.numWeightVal.textContent = el.setNumWeight.value;
    });
    el.setSrtWeight.addEventListener('input', () => {
      state.settings.srtWeight = +el.setSrtWeight.value;
      el.srtWeightVal.textContent = el.setSrtWeight.value;
    });
    el.setVariance.addEventListener('change', () => state.settings.variance = +el.setVariance.value || 0);
    el.backTo1Btn.addEventListener('click', () => setStep(1));
    el.runAlignBtn.addEventListener('click', () => runAlignment());
  }

  function goStep2() {
    const act = state.versions.filter(v => (v.text || '').trim());
    if (act.length < 2) { toast('至少需要两个包含文本的版本', 'warn'); return; }
    const dropped = state.versions.length - act.length;
    if (dropped > 0) toast('已忽略 ' + dropped + ' 个空版本');
    state.versions = act;
    if (!state.pivotId || !byId(state.pivotId)) state.pivotId = state.versions[0].id;
    state.versions.forEach((v, i) => { if (!v.name.trim()) v.name = '版本' + (i + 1); });
    // 重新分句（设置可能变化）；字幕版本直接以 cue 为句子单位并携带时间轴
    state.segs = {};
    for (const v of state.versions) {
      state.segs[v.id] = (v.cues && v.cues.length)
        ? v.cues.map(c => ({ text: c.text, para: 0, t0: c.start, t1: c.end }))
        : Seg.segmentRich(v.text, v.lang, state.settings);
    }
    const emptyOnes = state.versions.filter(v => !state.segs[v.id].length);
    if (emptyOnes.length) {
      toast('以下版本未分出任何句子：' + emptyOnes.map(v => v.name).join('、'), 'err');
      return;
    }
    setStep(2);
  }

  function renderStep2() {
    el.step2Chips.innerHTML = state.versions.map(v => {
      const g = Seg.langInfo(v.lang);
      const n = (state.segs[v.id] || []).length;
      const hasT = (state.segs[v.id] || [{}])[0].t0 !== undefined;
      return '<span class="chip' + (v.id === state.pivotId ? ' chip-pivot' : '') + '">' +
        '<span class="chip-dot" style="background:' + colColor(v.id) + '"></span>' +
        esc(v.name) + '<em>' + esc(g.name) + '</em><b>' + U.fmt(n) + ' 句</b>' +
        (hasT ? '<i>🎬 时间轴</i>' : '') +
        (v.id === state.pivotId ? '<i>基准语</i>' : '') + '</span>';
    }).join('');
    el.setUsePara.checked = !!state.settings.usePara;
    el.setSplitSemi.checked = !!state.settings.splitSemi;
    el.setLexWeight.value = state.settings.lexWeight; el.lexWeightVal.textContent = state.settings.lexWeight;
    el.setNumWeight.value = state.settings.numWeight; el.numWeightVal.textContent = state.settings.numWeight;
    el.setSrtWeight.value = state.settings.srtWeight; el.srtWeightVal.textContent = state.settings.srtWeight;
    el.setVariance.value = state.settings.variance || 0;
  }

  function logLine(html) {
    const div = document.createElement('div');
    div.className = 'log-line';
    div.innerHTML = html;
    el.alignLog.appendChild(div);
    el.alignLog.scrollTop = el.alignLog.scrollHeight;
  }
  function setProgress(f) {
    el.alignProgressBar.style.width = Math.round(f * 100) + '%';
  }

  async function runAlignment() {
    if (state.tus.length || state.dirtyText) {
      const ok = await confirmDlg('重新对齐', '重新对齐将覆盖当前的审校结果（含锁定状态），确定继续？');
      if (!ok) return;
    }
    const versions = state.versions;
    const pivot = byId(state.pivotId) || versions[0];
    el.runAlignBtn.disabled = true;
    el.runAlignBtn.textContent = '正在对齐…';
    el.alignLog.innerHTML = '';
    el.alignResult.innerHTML = '';
    setProgress(0.02);
    await U.tick();

    const t0 = performance.now();
    // 准备句子特征
    const prep = {};
    for (const v of versions) {
      prep[v.id] = (state.segs[v.id] || Seg.segmentRich(v.text, v.lang, state.settings)).map(s => ({
        text: s.text, para: s.para,
        len: U.weightedLen(s.text),
        nums: Seg.extractNums(s.text),
        tokens: Seg.simTokens(s.text),
        t0: s.t0, t1: s.t1
      }));
    }
    const pS = prep[pivot.id];
    if (!pS.length) { toast('基准语无有效句子', 'err'); endAlign(); return; }

    const gPivot = Seg.langGroup(pivot.lang);
    const others = versions.filter(v => v.id !== pivot.id);
    const pairResults = [];
    for (let k = 0; k < others.length; k++) {
      const v = others[k];
      const s = prep[v.id];
      const g = Seg.langGroup(v.lang);
      const bothSrt = (pS[0] || {}).t0 !== undefined && (s[0] || {}).t0 !== undefined;
      const o = {
        usePara: state.settings.usePara,
        variance: state.settings.variance > 0 ? state.settings.variance : Seg.autoVariance(gPivot, g),
        lexWeight: Seg.lexCompatible(gPivot, g) ? state.settings.lexWeight : 0,
        numWeight: state.settings.numWeight,
        srtWeight: bothSrt ? state.settings.srtWeight : 0,
        sameScript: Seg.lexCompatible(gPivot, g)
      };
      const t1 = performance.now();
      const beads = s.length ? Aligner.alignTexts(pS, s, o) : [];
      const c11 = beads.filter(b => b.type === '1-1').length;
      logLine('基准语 ↔ ' + esc(v.name) + '（' + esc(Seg.langInfo(v.lang).name) + '）：' +
        beads.length + ' 个句对，其中 1-1 对齐 ' + c11 + ' 个，耗时 ' + Math.round(performance.now() - t1) + ' ms');
      pairResults.push({ vid: v.id, beads: beads });
      setProgress((k + 1) / (others.length + 0.0001));
      await U.tick();
    }

    let tus;
    try {
      tus = Merge.buildTUs(versions, pivot.id, state.segs, pairResults);
      PA.SRT.attachTiming(tus, pivot.id, state.segs[pivot.id]); // 字幕版本：为 TU 附基准语时间轴
    } catch (err) {
      toast('合并失败：' + (err && err.message || err), 'err');
      endAlign();
      return;
    }
    state.tus = tus;
    state.dirtyText = false;
    el.dirtyBanner.classList.remove('banner-on');
    state.alignMeta = { pivotId: pivot.id, time: Math.round(performance.now() - t0), pairs: pairResults.map(p => ({ vid: p.vid, n: p.beads.length })) };
    state.undo = []; state.redo = [];
    state.selectedRow = -1; state.selectedCell = null;
    state.search = null; state.filter = 'all'; el.filterSel.value = 'all';
    endAlign();

    const hi = tus.filter(t => t.conf >= 0.9).length;
    const mid = tus.filter(t => t.conf >= 0.6 && t.conf < 0.9).length;
    const lo = tus.filter(t => t.conf < 0.6).length;
    el.alignResult.innerHTML =
      '<div class="result-card"><div class="result-title">对齐完成</div>' +
      '<div class="result-grid"><span>翻译单元 <b>' + U.fmt(tus.length) + '</b></span>' +
      '<span>高置信 <b class="c-hi">' + U.fmt(hi) + '</b></span>' +
      '<span>中置信 <b class="c-mid">' + U.fmt(mid) + '</b></span>' +
      '<span>低置信 <b class="c-lo">' + U.fmt(lo) + '</b></span>' +
      '<span>总耗时 <b>' + state.alignMeta.time + ' ms</b></span></div>' +
      '<div class="result-tip">建议优先审校“低置信”行（多为 1-2 合并或未匹配句段）。</div></div>';
    toast('对齐完成：' + tus.length + ' 个翻译单元，正在进入审校…', 'ok');
    PA.Analytics.send('align', { versions: versions.length, srt: (pS[0] || {}).t0 !== undefined ? 1 : 0 });
    setStep(3);
    autosave();

    function endAlign() {
      el.runAlignBtn.disabled = false;
      el.runAlignBtn.textContent = '开始自动对齐';
    }
  }

  /* ==================== 第三步：审校编辑器 ==================== */
  function visibleVersions() { return state.versions.filter(v => !state.hiddenCols.has(v.id)); }

  function bindEditor() {
    // 工具栏
    const bind = (id, fn) => { const b = E(id); if (b) b.addEventListener('click', fn); };
    bind('btnUndo', () => doUndo());
    bind('btnRedo', () => doRedo());
    bind('btnMergeRow', () => opMergeRows());
    bind('btnInsertRow', () => opInsertRow());
    bind('btnDeleteRow', () => opDeleteRow());
    bind('btnRowUp', () => opMoveRow(-1));
    bind('btnRowDown', () => opMoveRow(1));
    bind('btnCellMerge', () => opCellMergeDown());
    bind('btnCellSplit', () => opCellSplit());
    bind('btnCellClear', () => opCellClear());
    bind('btnLockRow', () => opToggleLock());
    bind('btnLockAll', () => opLockAll(true));
    bind('btnUnlockAll', () => opLockAll(false));
    bind('btnSearch', () => openSearch());
    bind('btnStats', () => openStats());
    bind('btnSaveProj2', () => saveProjectFile());
    bind('btnRealign', () => setStep(2));
    bind('btnRealign2', () => setStep(2));
    bind('fontMinus', () => { state.fontSize = Math.max(12, state.fontSize - 1); el.editorWrap.style.fontSize = state.fontSize + 'px'; });
    bind('fontPlus', () => { state.fontSize = Math.min(20, state.fontSize + 1); el.editorWrap.style.fontSize = state.fontSize + 'px'; });
    bind('toStep4Btn', () => setStep(4));
    bind('backTo3Btn', () => setStep(3));
    bind('btnBackTo2From3', () => setStep(2));

    el.filterSel.addEventListener('change', () => {
      state.filter = el.filterSel.value;
      applyFilterClasses();
      updateEditorInfo();
    });

    el.btnCols.addEventListener('click', e => {
      e.stopPropagation();
      renderColsPanel();
      el.colsPanel.classList.toggle('cols-on');
    });
    document.addEventListener('click', e => {
      if (!el.colsPanel.contains(e.target) && e.target !== el.btnCols) el.colsPanel.classList.remove('cols-on');
    });

    // 表格事件委托
    el.eTbody.addEventListener('click', e => {
      const tr = e.target.closest('tr.trow');
      if (!tr) return;
      const rid = +tr.dataset.rid;
      state.selectedRow = rid;
      const cell = e.target.closest('td.cell');
      if (cell) state.selectedCell = { rid: rid, vid: cell.dataset.vid };
      updateRowSelClass();
      updateToolbarState();
    });
    el.eTbody.addEventListener('change', e => {
      if (e.target.classList.contains('lockcb')) {
        const tr = e.target.closest('tr.trow');
        if (!tr) return;
        const rid = +tr.dataset.rid;
        state.tus[rid].locked = e.target.checked;
        tr.classList.toggle('row-locked', e.target.checked);
        tr.dataset.locked = e.target.checked ? 1 : 0;
        updateEditorInfo();
        autosaveSoon();
      }
    });
    el.eTbody.addEventListener('focusin', e => {
      const cell = e.target.closest('td.cell');
      if (!cell) return;
      const tr = cell.closest('tr.trow');
      state.focusOrig = {
        rid: +tr.dataset.rid, vid: cell.dataset.vid,
        text: cell.textContent
      };
      state.selectedCell = { rid: +tr.dataset.rid, vid: cell.dataset.vid };
      state.selectedRow = +tr.dataset.rid;
      updateRowSelClass();
      updateToolbarState();
    });
    el.eTbody.addEventListener('focusout', e => {
      const cell = e.target.closest('td.cell');
      if (!cell || !state.focusOrig) return;
      const tr = cell.closest('tr.trow');
      const rid = +tr.dataset.rid, vid = cell.dataset.vid;
      const newText = cell.textContent.replace(/\u00a0/g, ' ').trim();
      const oldText = (state.focusOrig.rid === rid && state.focusOrig.vid === vid) ? state.focusOrig.text.trim() : null;
      if (oldText !== null && newText !== oldText) {
        pushUndoCell(rid, vid, state.focusOrig.text);
        state.tus[rid].cells[vid] = newText;
        state.tus[rid].modified = true;
        tr.classList.add('row-mod');
        autosaveSoon();
      }
      if (!newText) cell.innerHTML = '';
      state.focusOrig = null;
    });
    el.eTbody.addEventListener('input', e => {
      const cell = e.target.closest('td.cell');
      if (!cell) return;
      const tr = cell.closest('tr.trow');
      state.tus[+tr.dataset.rid].cells[cell.dataset.vid] = cell.textContent;
    });
    el.eTbody.addEventListener('keydown', e => {
      const cell = e.target.closest('td.cell');
      if (!cell) return;
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        document.execCommand('insertText', false, '\n');
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const cells = Array.prototype.slice.call(el.eTbody.querySelectorAll('td.cell'));
        const i = cells.indexOf(cell);
        const next = cells[e.shiftKey ? i - 1 : i + 1];
        if (next) next.focus();
      } else if (e.key === 'Escape') {
        cell.blur();
      }
    });
  }

  function confDot(tu) {
    let cls = 'conf-lo';
    if (tu.modified) { cls = 'conf-mod'; }
    else if (tu.conf >= 0.9) { cls = 'conf-hi'; }
    else if (tu.conf >= 0.6) { cls = 'conf-mid'; }
    return '<span class="conf-dot ' + cls + '" title="置信度 ' + Math.round((tu.conf || 0) * 100) + '%"></span>';
  }

  function filteredOut(tu) {
    switch (state.filter) {
      case 'unlocked': return !!tu.locked;
      case 'modified': return !tu.modified;
      case 'low': return (tu.conf || 0) >= 0.6;
      default: return false;
    }
  }

  function highlightCell(text, rid, vid) {
    const ms = state.search.matches.filter(m => m.rid === rid && m.vid === vid);
    if (!ms.length) return esc(text) || '<span class="cell-ph">—</span>';
    let out = '', pos = 0;
    ms.forEach((m, i) => {
      out += esc(text.slice(pos, m.start));
      const cur = state.search.idx >= 0 && state.search.matches[state.search.idx] === m;
      out += '<mark class="hl' + (cur ? ' hl-cur' : '') + '">' + esc(text.substr(m.start, m.len)) + '</mark>';
      pos = m.start + m.len;
    });
    out += esc(text.slice(pos));
    return out;
  }

  function cellHTML(tu, rid, vid) {
    const text = tu.cells[vid] || '';
    let inner;
    if (state.search && (state.search.scope === 'all' || state.search.scope === vid)) {
      inner = highlightCell(text, rid, vid);
    } else {
      inner = esc(text);
    }
    const sel = state.selectedCell && state.selectedCell.rid === rid && state.selectedCell.vid === vid ? ' cell-sel' : '';
    return '<td class="cell' + sel + '" data-vid="' + esc(vid) + '" contenteditable="' + (state.search ? 'false' : 'true') +
      '" spellcheck="false">' + inner + '</td>';
  }

  function rowHTML(tu, rid) {
    const vis = visibleVersions();
    const cls = ['trow'];
    if (rid === state.selectedRow) cls.push('row-sel');
    if (tu.locked) cls.push('row-locked');
    if (tu.modified) cls.push('row-mod');
    if (filteredOut(tu)) cls.push('f-hidden');
    const cells = vis.map(v => cellHTML(tu, rid, v.id)).join('');
    return '<tr class="' + cls.join(' ') + '" data-rid="' + rid + '" data-locked="' + (tu.locked ? 1 : 0) + '">' +
      '<td class="c-num">' + (rid + 1) + '</td>' + cells +
      '<td class="c-conf">' + confDot(tu) + '</td>' +
      '<td class="c-lock"><input type="checkbox" class="lockcb"' + (tu.locked ? ' checked' : '') + ' title="锁定此行"></td></tr>';
  }

  function renderEditor() {
    const vis = visibleVersions();
    const ths = ['<th class="c-num">#</th>'].concat(vis.map(v => {
      const g = Seg.langInfo(v.lang);
      const isP = v.id === state.pivotId;
      return '<th class="col-v" data-vid="' + esc(v.id) + '"><div class="col-head">' +
        '<span class="col-dot" style="background:' + colColor(v.id) + '"></span>' +
        '<span class="col-name" title="' + esc(v.name) + '">' + esc(v.name) + '</span>' +
        '<span class="col-lang">' + esc(g.name) + '</span>' +
        (isP ? '<span class="badge-pivot">基准</span>' : '') +
        '<button class="icon-btn col-hide" data-vid="' + esc(v.id) + '" title="隐藏此列">✕</button>' +
        '</div></th>';
    })).concat(['<th class="c-conf">置信</th>', '<th class="c-lock">锁</th>']);
    el.eThead.innerHTML = '<tr>' + ths.join('') + '</tr>';

    el.eTbody.innerHTML = '';
    state.renderFrom = 0; state.renderTo = 0;
    if (!state.tus.length) {
      el.eTbody.innerHTML = '<tr class="empty-row"><td colspan="' + (vis.length + 3) + '">暂无对齐结果，请先完成自动对齐</td></tr>';
      updateToolbarState();
      return;
    }
    renderMoreRows();
    updateToolbarState();
    updateEditorInfo();
  }

  function renderMoreRows() {
    const total = state.tus.length;
    if (state.renderTo >= total) return;
    const end = Math.min(total, state.renderTo + CHUNK);
    const frag = [];
    for (let i = state.renderTo; i < end; i++) frag.push(rowHTML(state.tus[i], i));
    let sentinel = el.eTbody.querySelector('.sentinel-row');
    if (sentinel) sentinel.remove();
    el.eTbody.insertAdjacentHTML('beforeend', frag.join(''));
    state.renderTo = end;
    if (end < total) {
      el.eTbody.insertAdjacentHTML('beforeend',
        '<tr class="sentinel-row"><td colspan="' + (visibleVersions().length + 3) + '">向下滚动加载更多…（' + U.fmt(end) + ' / ' + U.fmt(total) + '）</td></tr>');
    }
    observeSentinel();
  }

  let sentinelObs = null;
  function observeSentinel() {
    if (sentinelObs) sentinelObs.disconnect();
    const s = el.eTbody.querySelector('.sentinel-row');
    if (!s) return;
    sentinelObs = new IntersectionObserver(entries => {
      if (entries.some(en => en.isIntersecting)) renderMoreRows();
    }, { root: el.editorWrap, rootMargin: '600px' });
    sentinelObs.observe(s);
  }

  function updateRowSelClass() {
    Array.prototype.forEach.call(el.eTbody.querySelectorAll('tr.trow'), tr => {
      tr.classList.toggle('row-sel', +tr.dataset.rid === state.selectedRow);
    });
    Array.prototype.forEach.call(el.eTbody.querySelectorAll('td.cell'), td => {
      const tr = td.closest('tr');
      const on = state.selectedCell && state.selectedCell.rid === +tr.dataset.rid && state.selectedCell.vid === td.dataset.vid;
      td.classList.toggle('cell-sel', !!on);
    });
  }

  function updateToolbarState() {
    const hasRow = state.selectedRow >= 0 && state.selectedRow < state.tus.length;
    const hasCell = hasRow && state.selectedCell && state.selectedCell.rid === state.selectedRow;
    const set = (id, on) => { const b = E(id); if (b) b.disabled = !on; };
    set('btnMergeRow', hasRow && state.selectedRow < state.tus.length - 1);
    set('btnInsertRow', hasRow);
    set('btnDeleteRow', hasRow);
    set('btnRowUp', hasRow && state.selectedRow > 0);
    set('btnRowDown', hasRow && state.selectedRow < state.tus.length - 1);
    set('btnCellMerge', hasCell && state.selectedRow < state.tus.length - 1);
    set('btnCellSplit', hasCell);
    set('btnCellClear', hasCell);
    set('btnLockRow', hasRow);
    set('btnUndo', state.undo.length > 0);
    set('btnRedo', state.redo.length > 0);
  }

  function updateEditorInfo() {
    const vis = visibleVersions().length;
    const total = state.tus.length;
    let shown = total;
    if (state.filter !== 'all') shown = state.tus.filter(t => !filteredOut(t)).length;
    const pivot = byId(state.pivotId);
    el.editorInfo.innerHTML = '共 <b>' + U.fmt(total) + '</b> 个翻译单元 · ' + vis + ' 列' +
      (pivot ? ' · 基准语：<b>' + esc(pivot.name) + '</b>' : '') +
      (state.filter !== 'all' ? ' · 筛选后 ' + U.fmt(shown) + ' 行' : '') +
      ' · 已锁定 ' + state.tus.filter(t => t.locked).length + ' 行';
    el.rowCount.textContent = '已渲染 ' + U.fmt(Math.min(state.renderTo, total)) + ' / ' + U.fmt(total) + ' 行（滚动加载）';
  }

  function applyFilterClasses() {
    Array.prototype.forEach.call(el.eTbody.querySelectorAll('tr.trow'), tr => {
      const tu = state.tus[+tr.dataset.rid];
      if (tu) tr.classList.toggle('f-hidden', filteredOut(tu));
    });
  }

  function renderColsPanel() {
    el.colsPanel.innerHTML = '<div class="cols-title">显示列</div>' + state.versions.map(v =>
      '<label class="cols-item"><input type="checkbox" data-vid="' + esc(v.id) + '"' + (state.hiddenCols.has(v.id) ? '' : ' checked') + '> ' +
      '<span class="col-dot" style="background:' + colColor(v.id) + '"></span>' + esc(v.name) + '</label>').join('');
    el.colsPanel.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', () => {
        const vid = cb.dataset.vid;
        if (cb.checked) state.hiddenCols.delete(vid); else state.hiddenCols.add(vid);
        renderEditor();
      });
    });
  }

  // 隐藏列（表头 ✕）
  document.addEventListener('click', e => {
    const hide = e.target.closest('.col-hide');
    if (hide) {
      state.hiddenCols.add(hide.dataset.vid);
      renderEditor();
      toast('已隐藏列，可通过“列显示”恢复');
    }
  });

  /* ---------- 撤销 / 重做 ---------- */
  function trimStack(st) { if (st.length > 60) st.shift(); }
  function pushUndoFull() {
    state.undo.push({ t: 'full', data: JSON.stringify(state.tus) });
    trimStack(state.undo); state.redo.length = 0;
    updateToolbarState();
  }
  function pushUndoCell(rid, vid, oldText) {
    state.undo.push({ t: 'cell', rid: rid, vid: vid, text: oldText });
    trimStack(state.undo); state.redo.length = 0;
    updateToolbarState();
  }
  function doUndo() {
    const u = state.undo.pop();
    if (!u) return;
    if (u.t === 'cell') {
      if (state.tus[u.rid]) {
        state.redo.push({ t: 'cell', rid: u.rid, vid: u.vid, text: state.tus[u.rid].cells[u.vid] });
        state.tus[u.rid].cells[u.vid] = u.text;
        state.tus[u.rid].modified = true;
      }
    } else {
      state.redo.push({ t: 'full', data: JSON.stringify(state.tus) });
      state.tus = JSON.parse(u.data);
    }
    renderEditorKeepSel();
    updateToolbarState();
    autosaveSoon();
  }
  function doRedo() {
    const u = state.redo.pop();
    if (!u) return;
    if (u.t === 'cell') {
      if (state.tus[u.rid]) {
        state.undo.push({ t: 'cell', rid: u.rid, vid: u.vid, text: state.tus[u.rid].cells[u.vid] });
        state.tus[u.rid].cells[u.vid] = u.text;
        state.tus[u.rid].modified = true;
      }
    } else {
      state.undo.push({ t: 'full', data: JSON.stringify(state.tus) });
      state.tus = JSON.parse(u.data);
    }
    renderEditorKeepSel();
    updateToolbarState();
    autosaveSoon();
  }
  function renderEditorKeepSel() {
    const rid = state.selectedRow;
    renderEditor();
    if (rid >= 0 && rid < state.tus.length) selectAndScroll(rid);
  }
  function selectAndScroll(rid) {
    state.selectedRow = rid;
    if (rid >= state.renderTo) {
      // 扩展渲染范围
      const end = Math.min(state.tus.length, rid + CHUNK);
      const frag = [];
      for (let i = state.renderTo; i < end; i++) frag.push(rowHTML(state.tus[i], i));
      const s = el.eTbody.querySelector('.sentinel-row'); if (s) s.remove();
      el.eTbody.insertAdjacentHTML('beforeend', frag.join(''));
      state.renderTo = end;
      if (end < state.tus.length) {
        el.eTbody.insertAdjacentHTML('beforeend', '<tr class="sentinel-row"><td colspan="' + (visibleVersions().length + 3) + '">滚动加载更多…</td></tr>');
        observeSentinel();
      }
    }
    updateRowSelClass();
    const tr = el.eTbody.querySelector('tr[data-rid="' + rid + '"]');
    if (tr) tr.scrollIntoView({ block: 'center' });
    updateToolbarState();
    updateEditorInfo();
  }

  /* ---------- 行/单元格操作 ---------- */
  function opMergeRows() {
    const rid = state.selectedRow;
    if (rid < 0 || rid >= state.tus.length - 1) return;
    pushUndoFull();
    const a = state.tus[rid], b = state.tus[rid + 1];
    state.versions.forEach(v => {
      const ta = a.cells[v.id] || '', tb = b.cells[v.id] || '';
      a.cells[v.id] = ta ? (ta + sepFor(ta + tb) + tb) : tb;
    });
    a.conf = Math.min(a.conf, b.conf);
    a.locked = a.locked && b.locked;
    a.modified = true;
    state.tus.splice(rid + 1, 1);
    renderEditorKeepSel();
    autosaveSoon();
  }
  function opInsertRow() {
    const rid = state.selectedRow;
    if (rid < 0 || rid >= state.tus.length) return;
    pushUndoFull();
    const cells = {};
    state.versions.forEach(v => cells[v.id] = '');
    state.tus.splice(rid + 1, 0, { cells: cells, conf: 1, locked: false, modified: true });
    renderEditorKeepSel();
    state.selectedRow = rid + 1;
    selectAndScroll(rid + 1);
    autosaveSoon();
  }
  function opDeleteRow() {
    const rid = state.selectedRow;
    if (rid < 0 || rid >= state.tus.length) return;
    pushUndoFull();
    state.tus.splice(rid, 1);
    const next = Math.min(rid, state.tus.length - 1);
    state.selectedRow = next;
    renderEditor();
    if (next >= 0) selectAndScroll(next);
    updateEditorInfo();
    autosaveSoon();
  }
  function opMoveRow(dir) {
    const rid = state.selectedRow;
    const to = rid + dir;
    if (rid < 0 || rid >= state.tus.length || to < 0 || to >= state.tus.length) return;
    pushUndoFull();
    const tmp = state.tus[rid];
    state.tus[rid] = state.tus[to];
    state.tus[to] = tmp;
    renderEditorKeepSel();
    state.selectedRow = to;
    selectAndScroll(to);
    autosaveSoon();
  }
  function opCellMergeDown() {
    const sc = state.selectedCell;
    if (!sc || sc.rid >= state.tus.length - 1) return;
    pushUndoFull();
    const a = state.tus[sc.rid], b = state.tus[sc.rid + 1];
    const ta = a.cells[sc.vid] || '', tb = b.cells[sc.vid] || '';
    a.cells[sc.vid] = ta ? (ta + sepFor(ta + tb) + tb) : tb;
    b.cells[sc.vid] = '';
    a.modified = b.modified = true;
    renderEditorKeepSel();
    autosaveSoon();
  }
  function opCellSplit() {
    const sc = state.selectedCell;
    if (!sc) return;
    const tu = state.tus[sc.rid];
    const v = byId(sc.vid);
    if (!tu || !v) return;
    const text = tu.cells[sc.vid] || '';
    const parts = Seg.segmentPlain(text, v.lang, state.settings);
    if (parts.length < 2) { toast('该单元格无法拆分为多个句子', 'warn'); return; }
    pushUndoFull();
    tu.cells[sc.vid] = parts[0];
    tu.modified = true;
    const cells = {};
    state.versions.forEach(x => cells[x.id] = '');
    cells[sc.vid] = parts.slice(1).join(Seg.isCJKText(text) ? '' : ' ');
    state.tus.splice(sc.rid + 1, 0, { cells: cells, conf: tu.conf, locked: false, modified: true });
    renderEditorKeepSel();
    state.selectedRow = sc.rid + 1;
    selectAndScroll(sc.rid + 1);
    autosaveSoon();
  }
  function opCellClear() {
    const sc = state.selectedCell;
    if (!sc || !state.tus[sc.rid]) return;
    if (!(state.tus[sc.rid].cells[sc.vid] || '').trim()) return;
    pushUndoCell(sc.rid, sc.vid, state.tus[sc.rid].cells[sc.vid]);
    state.tus[sc.rid].cells[sc.vid] = '';
    state.tus[sc.rid].modified = true;
    renderEditorKeepSel();
    autosaveSoon();
  }
  function opToggleLock() {
    const rid = state.selectedRow;
    if (rid < 0 || !state.tus[rid]) return;
    state.tus[rid].locked = !state.tus[rid].locked;
    const tr = el.eTbody.querySelector('tr[data-rid="' + rid + '"]');
    if (tr) {
      tr.classList.toggle('row-locked', state.tus[rid].locked);
      const cb = tr.querySelector('.lockcb');
      if (cb) cb.checked = state.tus[rid].locked;
    }
    updateEditorInfo();
    autosaveSoon();
  }
  function opLockAll(lock) {
    state.tus.forEach(tu => tu.locked = lock);
    applyFilterClasses();
    Array.prototype.forEach.call(el.eTbody.querySelectorAll('tr.trow'), tr => {
      tr.classList.toggle('row-locked', lock);
      const cb = tr.querySelector('.lockcb');
      if (cb) cb.checked = lock;
    });
    updateEditorInfo();
    autosaveSoon();
  }

  /* ==================== 搜索替换 ==================== */
  function bindSearch() {
    E('btnSearchRun').addEventListener('click', () => runSearch());
    E('searchTerm').addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); });
    E('searchPrev').addEventListener('click', () => navMatch(-1));
    E('searchNext').addEventListener('click', () => navMatch(1));
    E('searchReplaceBtn').addEventListener('click', () => replaceCurrent());
    E('searchReplaceAll').addEventListener('click', () => replaceAll());
    E('searchClose').addEventListener('click', () => closeSearch());
    el.modalSearch.addEventListener('click', e => { if (e.target === el.modalSearch) closeSearch(); });
  }
  function openSearch() {
    if (!state.tus.length) { toast('暂无可搜索内容', 'warn'); return; }
    el.searchScope.innerHTML = '<option value="all">所有列</option>' +
      state.versions.map(v => '<option value="' + esc(v.id) + '">' + esc(v.name) + '</option>').join('');
    if (state.search) {
      el.searchTerm.value = state.search.term;
      el.searchReplace.value = '';
      el.searchScope.value = state.search.scope;
    }
    el.modalConfirm.classList.remove('modal-on');
    el.modalSearch.classList.add('modal-on');
    el.searchInfo.textContent = '';
    setTimeout(() => el.searchTerm.focus(), 50);
  }
  function closeSearch() {
    el.modalSearch.classList.remove('modal-on');
    state.search = null;
    if (state.tus.length) renderEditor();
  }
  function computeMatches(term, scope) {
    const t = term.toLowerCase();
    const out = [];
    if (!t) return out;
    state.tus.forEach((tu, rid) => {
      state.versions.forEach(v => {
        if (scope !== 'all' && v.id !== scope) return;
        const text = tu.cells[v.id] || '';
        const low = text.toLowerCase();
        let p = 0;
        for (; ;) {
          const i = low.indexOf(t, p);
          if (i < 0) break;
          out.push({ rid: rid, vid: v.id, start: i, len: term.length });
          p = i + term.length;
        }
      });
    });
    return out;
  }
  function runSearch() {
    const term = el.searchTerm.value;
    const scope = el.searchScope.value;
    if (!term) { el.searchInfo.textContent = '请输入查找内容'; return; }
    const matches = computeMatches(term, scope);
    state.search = { term: term, scope: scope, matches: matches, idx: matches.length ? 0 : -1 };
    renderEditor();
    if (matches.length) {
      updateSearchInfo();
      selectAndScroll(matches[0].rid);
      flashRow(matches[0].rid);
    } else {
      el.searchInfo.textContent = '未找到匹配';
    }
  }
  function updateSearchInfo() {
    const s = state.search;
    if (!s) return;
    el.searchInfo.textContent = s.matches.length ? ('共 ' + s.matches.length + ' 处匹配，当前第 ' + (s.idx + 1) + ' 处') : '未找到匹配';
  }
  function navMatch(dir) {
    const s = state.search;
    if (!s || !s.matches.length) return;
    s.idx = (s.idx + dir + s.matches.length) % s.matches.length;
    const m = s.matches[s.idx];
    updateSearchInfo();
    renderEditor();
    selectAndScroll(m.rid);
    flashRow(m.rid);
  }
  function flashRow(rid) {
    const tr = el.eTbody.querySelector('tr[data-rid="' + rid + '"]');
    if (tr) {
      tr.classList.add('row-flash');
      setTimeout(() => tr.classList.remove('row-flash'), 1200);
    }
  }
  function replaceCurrent() {
    const s = state.search;
    if (!s || !s.matches.length || s.idx < 0) return;
    const m = s.matches[s.idx];
    const rep = el.searchReplace.value;
    const tu = state.tus[m.rid];
    const text = tu.cells[m.vid] || '';
    pushUndoCell(m.rid, m.vid, text);
    tu.cells[m.vid] = text.slice(0, m.start) + rep + text.slice(m.start + m.len);
    tu.modified = true;
    const matches = computeMatches(s.term, s.scope);
    let idx = -1;
    for (let i = 0; i < matches.length; i++) {
      if (matches[i].rid > m.rid || (matches[i].rid === m.rid && matches[i].start >= m.start)) { idx = i; break; }
    }
    state.search = { term: s.term, scope: s.scope, matches: matches, idx: idx < 0 ? (matches.length ? 0 : -1) : idx };
    renderEditor();
    updateSearchInfo();
    if (idx >= 0 && matches[idx]) { selectAndScroll(matches[idx].rid); flashRow(matches[idx].rid); }
    autosaveSoon();
  }
  function replaceAll() {
    const s = state.search;
    if (!s || !s.matches.length) { toast('请先执行查找', 'warn'); return; }
    const rep = el.searchReplace.value;
    pushUndoFull();
    const escTerm = s.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escTerm, 'gi');
    let count = 0;
    state.tus.forEach(tu => {
      state.versions.forEach(v => {
        if (s.scope !== 'all' && v.id !== s.scope) return;
        const text = tu.cells[v.id] || '';
        if (!text) return;
        const before = text;
        const after = text.replace(re, () => { count++; return rep; });
        if (after !== before) { tu.cells[v.id] = after; tu.modified = true; }
      });
    });
    state.search = { term: s.term, scope: s.scope, matches: [], idx: -1 };
    renderEditor();
    updateSearchInfo();
    toast('已替换 ' + count + ' 处');
    autosaveSoon();
  }

  /* ==================== 统计 ==================== */
  function openStats() {
    if (!state.tus.length) { toast('暂无统计数据', 'warn'); return; }
    const total = state.tus.length;
    const hi = state.tus.filter(t => t.conf >= 0.9).length;
    const mid = state.tus.filter(t => t.conf >= 0.6 && t.conf < 0.9).length;
    const lo = total - hi - mid;
    let html = '<div class="stats-total">共 ' + U.fmt(total) + ' 个翻译单元 · 平均置信度 ' +
      Math.round(state.tus.reduce((s, t) => s + (t.conf || 0), 0) / total * 100) + '%</div>';
    html += '<div class="stats-bars"><span class="c-hi">高置信 ' + U.fmt(hi) + '</span><span class="c-mid">中置信 ' + U.fmt(mid) + '</span><span class="c-lo">低置信 ' + U.fmt(lo) + '</span></div>';
    html += '<table class="stats-table"><tr><th>版本</th><th>非空句段</th><th>字符数</th><th>完整度</th></tr>';
    state.versions.forEach(v => {
      const filled = state.tus.filter(t => (t.cells[v.id] || '').trim()).length;
      const chars = state.tus.reduce((s, t) => s + (t.cells[v.id] || '').length, 0);
      const pct = total ? Math.round(filled / total * 100) : 0;
      html += '<tr><td><span class="col-dot" style="background:' + colColor(v.id) + '"></span>' + esc(v.name) +
        (v.id === state.pivotId ? ' <span class="badge-pivot">基准</span>' : '') + '</td>' +
        '<td>' + U.fmt(filled) + '</td><td>' + U.fmt(chars) + '</td>' +
        '<td><div class="pbar"><i style="width:' + pct + '%"></i></div><em>' + pct + '%</em></td></tr>';
    });
    html += '</table>';
    el.statsBody.innerHTML = html;
    E('modalStats').classList.add('modal-on');
  }

  /* ==================== 第四步：导出 ==================== */
  function bindExport() {
    E('btnStatsClose').addEventListener('click', () => E('modalStats').classList.remove('modal-on'));
    E('modalStats').addEventListener('click', e => { if (e.target === E('modalStats')) E('modalStats').classList.remove('modal-on'); });
    el.exportCards.addEventListener('click', e => {
      const btn = e.target.closest('[data-export]');
      if (btn) doExport(btn.dataset.export);
    });
    [el.expOnlyLocked, el.expSkipEmpty, el.expIncludeConf].forEach(cb =>
      cb.addEventListener('change', () => renderExportPreview()));
    el.expBaseName.addEventListener('input', U.debounce(renderExportPreview, 400));
  }

  function exportRows() {
    const onlyLocked = el.expOnlyLocked.checked;
    const skipEmpty = el.expSkipEmpty.checked;
    return state.tus.map((tu, idx) => ({ idx: idx, tu: tu })).filter(r =>
      (!onlyLocked || r.tu.locked) &&
      (!skipEmpty || state.versions.every(v => (r.tu.cells[v.id] || '').trim()))
    );
  }

  function renderExportPane() {
    if (!el.expBaseName.value.trim()) {
      el.expBaseName.value = '对齐语料库_' + U.timestamp();
    }
    renderExportPreview();
  }

  function renderExportPreview() {
    const rows = exportRows();
    const show = rows.slice(0, 5);
    let html = '<div class="exp-note">当前选项下将导出 <b>' + U.fmt(rows.length) + '</b> 行' +
      (rows.length !== state.tus.length ? '（共 ' + U.fmt(state.tus.length) + ' 行）' : '') + '，预览前 5 行：</div>';
    html += '<div class="exp-table-wrap"><table class="exp-table"><tr><th>#</th>' +
      state.versions.map(v => '<th>' + esc(v.name) + '</th>').join('') + '</tr>';
    show.forEach(r => {
      html += '<tr><td>' + (r.idx + 1) + '</td>' + state.versions.map(v => {
        const t = (r.tu.cells[v.id] || '').trim();
        return '<td title="' + esc(t) + '">' + esc(t.length > 60 ? t.slice(0, 60) + '…' : t) + '</td>';
      }).join('') + '</tr>';
    });
    html += '</table></div>';
    el.exportPreview.innerHTML = html;
  }

  function doExport(kind) {
    if (!state.tus.length) { toast('暂无对齐结果', 'warn'); return; }
    const rows = exportRows();
    if (!rows.length) { toast('当前筛选条件下没有可导出的行', 'warn'); return; }
    const base = (el.expBaseName.value.trim() || '对齐语料库').replace(/[\\/:*?"<>|]/g, '_');
    const o = { srclang: (byId(state.pivotId) || state.versions[0]).lang, includeConf: el.expIncludeConf.checked, filename: base };
    const versions = state.versions;
    try {
      if (kind === 'tmx') {
        U.download(base + '.tmx', new Blob([Exp.buildTMX(versions, rows, o)], { type: 'application/x-tmx+xml;charset=utf-8' }));
      } else if (kind === 'tmxzip') {
        const zip = Exp.buildPairwiseZip(versions, state.pivotId, rows, o);
        if (!zip) { toast('只有一个版本，无法生成两两 TMX', 'warn'); return; }
        U.download(base + '_两两TMX.zip', zip);
      } else if (kind === 'srt') {
        const hasTiming = (state.tus[0] || {}).t0 !== undefined ||
          (state.segs[state.pivotId] || [{}])[0].t0 !== undefined;
        if (!hasTiming) {
          toast('当前对齐无时间轴：请让基准语使用字幕文件（SRT/VTT）导入', 'warn'); return;
        }
        const groups = Exp.srtGroups(versions, rows);
        if (!groups.length) { toast('没有可导出的字幕行', 'warn'); return; }
        U.download(base + '_多语字幕.srt', new Blob([Exp.formatSrtGroups(groups)], { type: 'application/x-subrip;charset=utf-8' }));
      } else if (kind === 'srtzip') {
        const hasTimingZ = (state.tus[0] || {}).t0 !== undefined ||
          (state.segs[state.pivotId] || [{}])[0].t0 !== undefined;
        if (!hasTimingZ) {
          toast('当前对齐无时间轴：请让基准语使用字幕文件（SRT/VTT）导入', 'warn'); return;
        }
        const groups = Exp.srtGroups(versions, rows);
        if (!groups.length) { toast('没有可导出的字幕行', 'warn'); return; }
        U.download(base + '_字幕SRT.zip', Exp.buildSrtsZip(groups, versions, base));
      } else if (kind === 'xlsx') {
        U.download(base + '.xlsx', Exp.buildXLSX(versions, rows, o));
      } else if (kind === 'csv') {
        U.download(base + '.csv', new Blob(['\ufeff' + Exp.buildDelimited(versions, rows, { sep: ',', includeConf: o.includeConf })], { type: 'text/csv;charset=utf-8' }));
      } else if (kind === 'tsv') {
        U.download(base + '.tsv', new Blob(['\ufeff' + Exp.buildDelimited(versions, rows, { sep: '\t', includeConf: o.includeConf })], { type: 'text/tab-separated-values;charset=utf-8' }));
      } else if (kind === 'txt') {
        U.download(base + '.txt', new Blob([Exp.buildTXT(versions, rows)], { type: 'text/plain;charset=utf-8' }));
      } else if (kind === 'json') {
        U.download(base + '.json', new Blob([JSON.stringify(projectJSON(), null, 2)], { type: 'application/json;charset=utf-8' }));
      }
      toast('已导出：' + base + '（' + rows.length + ' 行）', 'ok');
      PA.Analytics.send('export', { fmt: String(kind).slice(0, 12) });
    } catch (err) {
      toast('导出失败：' + (err && err.message || err), 'err');
    }
  }

  /* ==================== 工程保存 / 自动保存 ==================== */
  function projectJSON() {
    return PA.Project.serialize(state);
  }
  function saveProjectFile() {
    if (!state.versions.length) { toast('当前工程为空', 'warn'); return; }
    const name = '对齐工程_' + U.timestamp() + '.json';
    U.download(name, new Blob([JSON.stringify(projectJSON(), null, 2)], { type: 'application/json;charset=utf-8' }));
    toast('工程已保存：' + name, 'ok');
  }
  function openProjectFile(file) {
    if (!/\.json$/i.test(file.name || '')) {
      toast('此入口仅打开工程 JSON；TXT、SRT 等请使用「导入文本／字幕」', 'warn');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = JSON.parse(reader.result);
        const norm = PA.Project.normalize(raw);
        if (!norm.ok) { toast(norm.error, 'err'); return; }
        loadProject(norm.data);
        const cuesN = state.versions.filter(v => v.cues).length;
        toast('工程已打开：' + state.versions.length + ' 个版本' + (state.tus.length ? '，' + state.tus.length + ' 个翻译单元' : '')
          + (cuesN ? '，' + cuesN + ' 个字幕时间轴' : ''), 'ok');
      } catch (err) {
        toast('读取失败：' + (err && err.message || err), 'err');
      }
    };
    reader.onerror = () => toast('读取失败', 'err');
    reader.readAsText(file, 'utf-8');
  }
  function loadProject(data) {
    state.versions = data.versions.map(v => ({
      id: v.id, name: v.name, lang: v.lang, text: v.text,
      cues: v.cues || null  // 字幕时间轴恢复（此前被丢弃，重对齐后 SRT 导出失效）
    }));
    state.pivotId = data.pivotId && byId(data.pivotId) ? data.pivotId : (state.versions[0] && state.versions[0].id);
    state.settings = Object.assign({ usePara: true, splitSemi: false, lexWeight: 40, numWeight: 60, variance: 0, srtWeight: 80 }, data.settings || {});
    state.tus = Array.isArray(data.tus) ? data.tus : [];
    state.segs = {};
    state.undo = []; state.redo = []; state.search = null;
    state.dirtyText = false; state.hiddenCols = new Set();
    state.selectedRow = -1; state.selectedCell = null;
    el.dirtyBanner.classList.remove('banner-on');
    renderVersionCards();
    if (state.tus.length) setStep(3, { force: true }); else setStep(1);
  }
  function autosave() {
    if (!state.versions.length && !state.tus.length) return;
    try { localStorage.setItem(LS_KEY, JSON.stringify(projectJSON())); } catch (e) { }
  }
  const autosaveSoon = U.debounce(autosave, 4000);
  function checkAutosave() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { data = null; }
    if (!data) return;
    // 自动保存与工程文件同等不可信：先经 PA.Project.normalize 校验归一（id 白名单等），
    // 损坏/非法的自动保存直接丢弃，不再弹恢复横幅。
    let norm = null;
    try { norm = PA.Project.normalize(data); } catch (e) { norm = null; }
    if (!norm || !norm.ok) {
      try { localStorage.removeItem(LS_KEY); } catch (e) { }
      return;
    }
    const nd = norm.data;
    const t = new Date(+data.savedAt || Date.now());
    el.restoreBanner.innerHTML =
      '<span>检测到自动保存的工程（' + esc(t.toLocaleString('zh-CN')) + '，' + nd.versions.length + ' 个版本' +
      (nd.tus.length ? '，' + nd.tus.length + ' 个翻译单元' : '') + '）</span>' +
      '<button class="btn btn-sm btn-primary" id="btnRestore">恢复</button>' +
      '<button class="btn btn-sm" id="btnDiscard">忽略</button>';
    el.restoreBanner.classList.add('banner-on');
    E('btnRestore').addEventListener('click', () => {
      el.restoreBanner.classList.remove('banner-on');
      try {
        loadProject(nd);
        toast('已恢复上次工程');
      } catch (err) {
        toast('自动保存已损坏，无法恢复：' + (err && err.message || err), 'err');
        try { localStorage.removeItem(LS_KEY); } catch (e) { }
      }
    });
    E('btnDiscard').addEventListener('click', () => {
      el.restoreBanner.classList.remove('banner-on');
      try { localStorage.removeItem(LS_KEY); } catch (e) { }
    });
  }

  /* ==================== 通用 UI ==================== */
  function toast(msg, type) {
    const div = document.createElement('div');
    div.className = 'toast toast-' + (type || 'info');
    div.textContent = msg;
    el.toastRoot.appendChild(div);
    setTimeout(() => div.classList.add('toast-out'), 2400);
    setTimeout(() => div.remove(), 2800);
  }
  let confirmResolve = null;
  function confirmDlg(title, msg) {
    el.confirmTitle.textContent = title;
    el.confirmMsg.textContent = msg;
    el.modalConfirm.classList.add('modal-on');
    return new Promise(resolve => { confirmResolve = resolve; });
  }
  function bindGlobal() {
    el.confirmOk.addEventListener('click', () => {
      el.modalConfirm.classList.remove('modal-on');
      if (confirmResolve) { confirmResolve(true); confirmResolve = null; }
    });
    el.confirmCancel.addEventListener('click', () => {
      el.modalConfirm.classList.remove('modal-on');
      if (confirmResolve) { confirmResolve(false); confirmResolve = null; }
    });
    el.modalConfirm.addEventListener('click', e => {
      if (e.target === el.modalConfirm) {
        el.modalConfirm.classList.remove('modal-on');
        if (confirmResolve) { confirmResolve(false); confirmResolve = null; }
      }
    });

    // 步骤条点击
    for (let i = 1; i <= 4; i++) {
      const li = E('step' + i);
      if (li) li.addEventListener('click', () => {
        if (i === state.step) { showView('work'); return; }
        if ((i === 3 || i === 4) && !state.tus.length) { toast('请先完成自动对齐', 'warn'); return; }
        if (i === 2 && !state.versions.length) { toast('请先录入版本', 'warn'); return; }
        setStep(i);
      });
    }

    // 快捷键
    document.addEventListener('keydown', e => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey && state.view === 'work' && state.step === 3) {
        const editing = document.activeElement && document.activeElement.closest && document.activeElement.closest('td.cell');
        if (!editing) { e.preventDefault(); doUndo(); }
      } else if (mod && ((e.key.toLowerCase() === 'y') || (e.shiftKey && e.key.toLowerCase() === 'z')) && state.view === 'work' && state.step === 3) {
        const editing = document.activeElement && document.activeElement.closest && document.activeElement.closest('td.cell');
        if (!editing) { e.preventDefault(); doRedo(); }
      } else if (mod && e.key.toLowerCase() === 'f' && state.view === 'work') {
        e.preventDefault(); openSearch();
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault(); saveProjectFile();
      } else if (e.key === 'Escape') {
        el.modalSearch.classList.remove('modal-on');
        el.modalStats.classList.remove('modal-on');
      }
    });

    window.addEventListener('beforeunload', autosave);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
