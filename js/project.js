'use strict';
/* 工程文件的序列化与恢复校验（从 app.js 抽离，便于无头测试与覆盖率统计）
 * 高危回归背景：loadProject 曾丢弃 versions 上的 cues 字段——保存→恢复后
 * 重新对齐会丢失字幕时间轴，SRT 导出随之失效。所有字段校验集中在这里。
 */
PA.Project = (function () {

  var APP_TAG = 'multialign';
  var ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
  var LANG_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8}){0,3}$/;
  var SETTINGS_DEFAULTS = { usePara: true, splitSemi: false, lexWeight: 40, numWeight: 60, variance: 0, srtWeight: 80 };

  function freshId(used) {
    var id;
    do { id = 'v' + Math.random().toString(36).slice(2, 10); } while (used[id] || !ID_RE.test(id));
    return id;
  }

  /* cues 校验：数组、每项 {start,end,text}、start<end、毫秒数字；按开始时间排序 */
  function normalizeCues(cues) {
    if (!Array.isArray(cues)) return null;
    var out = [];
    for (var i = 0; i < cues.length; i++) {
      var c = cues[i];
      if (!c || typeof c !== 'object') continue;
      var s = +c.start, e = +c.end;
      var t = String(c.text == null ? '' : c.text).slice(0, 2000);
      if (!isFinite(s) || !isFinite(e) || e <= s) continue;
      out.push({ start: Math.round(s), end: Math.round(e), text: t });
    }
    out.sort(function (a, b) { return a.start - b.start; });
    return out.length ? out : null;
  }

  /* TU 校验：cells 必须是对象（值为字符串）；保留 locked/modified/conf 与时间轴 */
  function normalizeTu(tu) {
    if (!tu || typeof tu !== 'object' || !tu.cells || typeof tu.cells !== 'object') return null;
    var cells = {};
    for (var k in tu.cells) {
      if (Object.prototype.hasOwnProperty.call(tu.cells, k)) cells[k] = String(tu.cells[k] == null ? '' : tu.cells[k]);
    }
    var out = {
      cells: cells,
      conf: isFinite(+tu.conf) ? Math.max(0, Math.min(1, +tu.conf)) : 0,
      locked: !!tu.locked,
      modified: !!tu.modified
    };
    if (isFinite(+tu.t0) && isFinite(+tu.t1) && +tu.t1 > +tu.t0) { out.t0 = +tu.t0; out.t1 = +tu.t1; }
    var src = [];
    if (Array.isArray(tu.srcIdx)) {
      for (var q = 0; q < tu.srcIdx.length && src.length < 200; q++) {
        var n = +tu.srcIdx[q];
        if (isFinite(n) && n >= 0 && n < 1000000 && src.indexOf(Math.round(n)) < 0) src.push(Math.round(n));
      }
      src.sort(function (a, b) { return a - b; });
      if (src.length) out.srcIdx = src;
    }
    return out;
  }

  /* 工程数据校验与归一。返回 {ok, data|error} */
  function normalize(data) {
    if (!data || typeof data !== 'object' || data.app !== APP_TAG || !Array.isArray(data.versions)) {
      return { ok: false, error: '不是有效的工程文件' };
    }
    var versions = [];
    var idMap = {};   // 原始 id → 归一后 id（非法/重复 id 重新生成后，用于重映射 pivotId 与 TU cells）
    var used = {};
    for (var i = 0; i < data.versions.length && versions.length < 10; i++) {
      var v = data.versions[i];
      if (!v || typeof v !== 'object') continue;
      // 安全：id 会进入 innerHTML 属性（data-vid / option value），只接受安全字符集，
      // 否则（含 "><img onerror> 之类）重新生成唯一 id，杜绝工程文件/自动保存 XSS。
      var id = typeof v.id === 'string' && ID_RE.test(v.id) && !used[v.id] ? v.id : freshId(used);
      used[id] = true;
      if (typeof v.id === 'string' && !Object.prototype.hasOwnProperty.call(idMap, v.id)) idMap[v.id] = id;
      versions.push({
        id: id,
        name: String(v.name == null ? '' : v.name).slice(0, 30) || '版本' + (versions.length + 1),
        lang: typeof v.lang === 'string' && LANG_RE.test(v.lang) ? v.lang : 'en',
        text: String(v.text == null ? '' : v.text),
        cues: normalizeCues(v.cues)
      });
    }
    if (!versions.length) return { ok: false, error: '工程中没有可用版本' };
    var pivotId = typeof data.pivotId === 'string' && Object.prototype.hasOwnProperty.call(idMap, data.pivotId)
      ? idMap[data.pivotId] : versions[0].id;
    var settings = {};
    for (var k in SETTINGS_DEFAULTS) {
      if (Object.prototype.hasOwnProperty.call(SETTINGS_DEFAULTS, k)) {
        settings[k] = typeof data.settings === 'object' && data.settings && isFinite(+data.settings[k])
          ? +data.settings[k] : SETTINGS_DEFAULTS[k];
      }
    }
    settings.usePara = typeof data.settings === 'object' && data.settings
      ? !!data.settings.usePara : SETTINGS_DEFAULTS.usePara;
    settings.splitSemi = typeof data.settings === 'object' && data.settings
      ? !!data.settings.splitSemi : SETTINGS_DEFAULTS.splitSemi;
    var tus = Array.isArray(data.tus) ? data.tus.map(normalizeTu).filter(Boolean) : [];
    // 被重新生成的 id：把 TU cells 的键同步重映射，避免内容"消失"
    tus.forEach(function (tu) {
      var cells = {};
      for (var key in tu.cells) {
        if (Object.prototype.hasOwnProperty.call(tu.cells, key) && Object.prototype.hasOwnProperty.call(idMap, key)) {
          cells[idMap[key]] = tu.cells[key];
        }
      }
      tu.cells = cells;
    });
    return {
      ok: true,
      data: { versions: versions, pivotId: pivotId, settings: settings, tus: tus },
    };
  }

  /* 状态 → 可序列化对象（versions 上的 cues 会随之带上） */
  function serialize(state) {
    return {
      app: APP_TAG,
      v: 1,
      savedAt: Date.now(),
      versions: state.versions,
      pivotId: state.pivotId,
      settings: state.settings,
      tus: state.tus,
      step: state.tus && state.tus.length ? 3 : 1
    };
  }

  return { normalize: normalize, normalizeCues: normalizeCues, normalizeTu: normalizeTu, serialize: serialize, APP_TAG: APP_TAG, ID_RE: ID_RE };
})();
