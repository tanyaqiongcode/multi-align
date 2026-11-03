#!/usr/bin/env bash
# 导出编排 E2E：生成 index.html 的临时副本（注入 test/e2e_snippet.js），
# 无头 Chrome 真实点击 TMX / SRT / SRT ZIP 三条导出路径并断言下载被触发。
# 本地：bash test/run_e2e.sh   （CI 中同名步骤自动执行；可用 CHROME= 指定浏览器）
set -e
cd "$(dirname "$0")/.."

# 1. 生成 E2E 页面：内联全部本地脚本（零脚本网络请求）。
#    动机：Chrome 虚拟时钟下随机截断脚本加载（实测每次缺失不同脚本：
#    app.js/exporters.js 等），导致间歇性失败——与被测代码无关。
python3 - <<'PY'
import re
s = open('index.html', encoding='utf-8').read()
def inline(m):
    src = m.group(1)
    code = open(src, encoding='utf-8').read()
    return '<script>\n' + code.replace('</script', '<\/script') + '\n</script>'
s = re.sub(r'<script src="(js/[^"]+)"></script>', inline, s)
snippet = open('test/e2e_snippet.js', encoding='utf-8').read()
marker = '<script>\n' + open('js/app.js', encoding='utf-8').read().replace('</script', '<\/script') + '\n</script>'
assert marker in s, 'index.html 缺少 app.js（内联后）'
s = s.replace(marker, marker + '\n<script>\n' + snippet + '\n</script>')
open('_e2e_export.html', 'w', encoding='utf-8').write(s)
print('E2E 页面已生成（脚本全内联）')
PY

# 2. 定位浏览器
CHROME_BIN="${CHROME:-}"
if [ -z "$CHROME_BIN" ]; then
  if command -v google-chrome >/dev/null 2>&1; then CHROME_BIN="google-chrome";
  elif command -v google-chrome-stable >/dev/null 2>&1; then CHROME_BIN="google-chrome-stable";
  elif [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
    CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  else echo "未找到 Chrome（可用 CHROME= 路径 指定）"; exit 1; fi
fi

# 3. 本地起 HTTP 服务（file:// 下 Chrome 会把错误掩码为 "Script error."）；端口动态分配
PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
python3 -m http.server "$PORT" --bind 127.0.0.1 > /dev/null 2>&1 &
SERVER_PID=$!
trap '{ kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; rm -f _e2e_export.html; [ -n "${PROFILE_DIR:-}" ] && rm -rf "$PROFILE_DIR"; }' EXIT
for i in $(seq 1 20); do curl -s -o /dev/null "http://127.0.0.1:$PORT/index.html" && break; sleep 0.2; done

# 4. 无头执行并抓取 DOM（独立临时 profile：避免与常驻 Chrome 争用默认
#    user-data-dir 的单例锁——曾致间歇性"页面未产出结果标记/下载丢失"）
PROFILE_DIR=$(mktemp -d)
"$CHROME_BIN" --headless --disable-gpu --no-sandbox --hide-scrollbars \
  --user-data-dir="$PROFILE_DIR" --virtual-time-budget=25000 --dump-dom \
  "http://127.0.0.1:$PORT/_e2e_export.html" > /tmp/e2e_dom.html 2>/dev/null
rm -rf "$PROFILE_DIR"

# 5. 断言
python3 - <<'PY'
import re, json, sys
dom = open('/tmp/e2e_dom.html', encoding='utf-8').read()
m = re.search(r'<div id="e2e-result" data-result="([^"]*)"', dom)
if not m:
    print('E2E 失败：页面未产出结果标记（脚本未跑完或报错）'); sys.exit(1)
r = json.loads(m.group(1).replace('&quot;', '"').replace('&amp;', '&'))
print('E2E 结果:', json.dumps(r, ensure_ascii=False))
if r.get('fatal'):
    print('E2E 失败：致命异常', r['fatal']); sys.exit(1)
if r.get('diag'):
    print('E2E 失败：流程中断 —', r['diag'], '| step:', r.get('step'), '| downloads:', r.get('downloads')); sys.exit(1)
for k in ('tmx', 'srt', 'srtzip'):
    assert r.get(k) == 'ok', f'{k} 导出路径失败: {r.get(k)}'
assert r.get('errors') == [], '页面存在未捕获异常: %s' % r.get('errors')
assert r.get('errToasts', 1) == 0, '出现错误提示 toast'
print('E2E 通过：TMX / SRT / SRT ZIP 三条导出编排路径全部正常')
PY
