/* 导出编排 E2E 页面侧脚本（由 test/run_e2e.sh 注入 index.html 副本后无头执行）
 * 全程条件轮询（waitFor）而非固定延时——固定 sleep 在虚拟时钟下存在竞态，
 * 曾致间歇性"下载丢失/页面未产出结果"。
 * 流程：进工作台 → 建两版 → 粘贴中英 SRT → 对齐 → 第四步 → 打桩 download →
 *       真实点击 TMX / SRT / SRT ZIP → 断言写 #e2e-result
 * 覆盖回归点：srtGroups 作用域缺陷、btnSearchRun 缺失（绑定链断裂）、
 *             句序溯源导出路径。
 */
(function () {
  window.__downloads = [];
  window.__errors = [];
  window.addEventListener('error', function (e) {
    window.__errors.push(String(e.message || e) + ' @' + (e.filename || '?').split('/').pop() + ':' + e.lineno + ':' + e.colno);
  });
  function result(o) {
    if (document.getElementById('e2e-result')) return;
    var d = document.createElement('div');
    d.id = 'e2e-result';
    d.setAttribute('data-result', JSON.stringify(o));
    document.body.appendChild(d);
  }
  function paste(ta, text) {
    var ev = new Event('paste', { bubbles: true, cancelable: true });
    ev.clipboardData = { getData: function () { return text; } };
    ta.dispatchEvent(ev);
  }
  function waitFor(cond, timeoutMs, cb) {
    var t0 = Date.now();
    (function poll() {
      var ok = false;
      try { ok = !!cond(); } catch (e) { return cb(e); }
      if (ok) return cb(null);
      if (Date.now() - t0 > timeoutMs) return cb(new Error('waitFor 超时(' + timeoutMs + 'ms)'));
      setTimeout(poll, 50);
    })();
  }
  function stepOn() {
    var li = document.querySelector('.stepper li.step-on');
    return li ? li.id : '';
  }
  function diag(msg) {
    var btn = document.getElementById('addVersionBtn');
    result({
      diag: msg, step: stepOn(),
      hasPA: typeof window.PA !== 'undefined',
      appEvaled: window.__appEvaled || 0,
      hasExport: typeof PA !== 'undefined' && !!PA.Export,
      hasProject: typeof PA !== 'undefined' && !!PA.Project,
      hash: location.hash,
      readyState: document.readyState,
      btnDisabled: btn ? btn.disabled : 'no-btn',
      vlistKids: document.getElementById('vlist') ? document.getElementById('vlist').children.length : 'no-vlist',
      banner: (document.querySelector('#restoreBanner') || {}).className || '',
      rows: document.querySelectorAll('#eTbody tr.trow').length,
      downloads: window.__downloads.map(function (d) { return d.name; }),
      errors: window.__errors,
      errToasts: document.querySelectorAll('.toast-err').length
    });
  }
  window.addEventListener('load', function () {
    setTimeout(function () {
      try {
        PA.util.download = function (name, blob) {
          window.__downloads.push({ name: String(name), size: blob && blob.size || 0 });
        };
        var zhSrt = '1\n00:00:01,000 --> 00:00:03,500\n会议定在周一上午九点。\n\n2\n00:00:03,600 --> 00:00:05,500\n请所有人准时参加。\n\n3\n00:00:05,600 --> 00:00:07,500\n会议室在三楼东侧。';
        var enSrt = zhSrt
          .replace('会议定在周一上午九点。', 'The meeting is set for Monday morning.')
          .replace('请所有人准时参加。', 'Everyone please be on time.')
          .replace('会议室在三楼东侧。', 'The meeting room is on the third floor, east side.');

        document.querySelector('[data-goto="work"]').click();
        waitFor(function () { return !!document.getElementById('addVersionBtn'); }, 5000, function (e1) {
          if (e1) return diag('工作台未就绪: ' + e1.message);
          document.getElementById('addVersionBtn').click();
          waitFor(function () { return document.querySelectorAll('.vcard').length >= 1; }, 5000, function (e2) {
            if (e2) return diag('建卡1失败: ' + e2.message);
            document.getElementById('addVersionBtn').click();
            waitFor(function () { return document.querySelectorAll('.vcard').length >= 2; }, 5000, function (e3) {
              if (e3) return diag('建卡2失败: ' + e3.message);
              var cards = document.querySelectorAll('.vcard');
              paste(cards[0].querySelector('.vtext'), zhSrt);
              paste(cards[1].querySelector('.vtext'), enSrt);
              waitFor(function () { return !document.getElementById('toStep2Btn').disabled; }, 8000, function (e4) {
                if (e4) return diag('字幕粘贴未生效: ' + e4.message);
                document.getElementById('toStep2Btn').click();
                waitFor(function () { return stepOn() === 'step2'; }, 5000, function (e5) {
                  if (e5) return diag('未进入第二步: ' + e5.message);
                  document.getElementById('runAlignBtn').click();
                  waitFor(function () { return stepOn() === 'step3' && document.querySelectorAll('#eTbody tr.trow').length >= 3; }, 15000, function (e6) {
                    if (e6) return diag('对齐未完成: ' + e6.message);
                    document.getElementById('toStep4Btn').click();
                    waitFor(function () { return !!document.querySelector('[data-export="tmx"]'); }, 5000, function (e7) {
                      if (e7) return diag('导出页未就绪: ' + e7.message);
                      document.querySelector('[data-export="tmx"]').click();
                      document.querySelector('[data-export="srt"]').click();
                      document.querySelector('[data-export="srtzip"]').click();
                      waitFor(function () { return window.__downloads.length >= 3; }, 8000, function (e8) {
                        if (e8) return diag('下载未触发: ' + e8.message);
                        var names = window.__downloads.map(function (d) { return d.name; });
                        result({
                          count: window.__downloads.length,
                          tmx: names.some(function (n) { return /\.tmx$/.test(n); }) ? 'ok' : 'missing',
                          srt: names.some(function (n) { return /_多语字幕\.srt$/.test(n); }) ? 'ok' : 'missing',
                          srtzip: names.some(function (n) { return /_字幕SRT\.zip$/.test(n); }) ? 'ok' : 'missing',
                          rows: document.querySelectorAll('#eTbody tr.trow').length,
                          errors: window.__errors,
                          errToasts: document.querySelectorAll('.toast-err').length
                        });
                      });
                    });
                  });
                });
              });
            });
          });
        });
      } catch (e) {
        result({ fatal: String(e && e.message || e), errors: window.__errors });
      }
    }, 400);
  });
})();
