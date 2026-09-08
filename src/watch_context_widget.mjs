import fs from 'fs';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 单实例锁：防止重复启动守护进程
const lockServer = net.createServer();
lockServer.once('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    process.exit(0);
  }
});
lockServer.listen(29876, '127.0.0.1');

// 上下文总上限基准：100万 (1,000,000 / 1.0M)
const CONTEXT_LIMIT = 1000000;

function getCDPPort() {
  try {
    const userProfile = process.env.USERPROFILE || 'C:\\Users\\26818.Administrator';
    const portPath = path.join(userProfile, 'AppData', 'Roaming', 'Antigravity', 'DevToolsActivePort');
    if (fs.existsSync(portPath)) {
      const lines = fs.readFileSync(portPath, 'utf8').trim().split('\n');
      const p = parseInt(lines[0], 10);
      if (p > 0) return p;
    }
  } catch {}

  try {
    const tasklist = execFileSync('tasklist', ['/FI', 'IMAGENAME eq Antigravity.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
    const pids = [];
    for (const line of tasklist.split('\n')) {
      const m = line.match(/"Antigravity\.exe","(\d+)"/i);
      if (m) pids.push(Number(m[1]));
    }
    if (pids.length > 0) {
      const pidSet = new Set(pids);
      const netstat = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8', windowsHide: true });
      for (const line of netstat.split('\n')) {
        if (line.includes('LISTENING')) {
          const parts = line.trim().split(/\s+/);
          const pid = Number(parts[parts.length - 1]);
          if (pidSet.has(pid)) {
            const localAddr = parts[1];
            const port = Number(localAddr.slice(localAddr.lastIndexOf(':') + 1));
            if (port > 0) return port;
          }
        }
      }
    }
  } catch {}

  return null;
}

function getCircleScript() {
  const localScript = path.join(__dirname, 'widget_client.js');
  if (fs.existsSync(localScript)) {
    return fs.readFileSync(localScript, 'utf8');
  }
  const fallbackScript = 'C:/Users/26818.Administrator/Tools/widget_client.js';
  if (fs.existsSync(fallbackScript)) {
    return fs.readFileSync(fallbackScript, 'utf8');
  }
  return '';
}

async function cdpCall(ws, method, params = {}) {
  const id = (cdpCall.nextId = (cdpCall.nextId || 0) + 1);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`${method} timeout`));
    }, 3000);

    function onMessage(event) {
      try {
        const msg = JSON.parse(event.data);
        if (msg.id === id) {
          cleanup();
          resolve(msg.result);
        }
      } catch (err) {
        cleanup();
        reject(err);
      }
    }
    function onError(err) { cleanup(); reject(err); }
    function onClose() { cleanup(); reject(new Error('WebSocket closed')); }

    function cleanup() {
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      ws.removeEventListener('error', onError);
      ws.removeEventListener('close', onClose);
    }

    ws.addEventListener('message', onMessage);
    ws.addEventListener('error', onError);
    ws.addEventListener('close', onClose);

    try {
      ws.send(JSON.stringify({ id, method, params }));
    } catch (e) {
      cleanup();
      reject(e);
    }
  });
}

async function injectTarget(wsUrl, targetId) {
  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (!finished) {
        finished = true;
        try { ws.close(); } catch {}
        resolve(true);
      }
    };

    let ws;
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      return finish();
    }

    const timer = setTimeout(finish, 4000);

    ws.onopen = async () => {
      try {
        const check = await cdpCall(ws, 'Runtime.evaluate', {
          expression: 'window.__agyContextCircleVersion === "1.0M-inline-model-v8" && !!document.getElementById("agy-model-context-widget")',
          returnByValue: true
        }).catch(() => null);

        if (!check?.result?.value) {
          const script = getCircleScript();
          await cdpCall(ws, 'Page.addScriptToEvaluateOnNewDocument', { source: script }).catch(() => {});
          await cdpCall(ws, 'Runtime.evaluate', { expression: script }).catch(() => {});
        }
      } catch (err) {}
      clearTimeout(timer);
      finish();
    };

    ws.onerror = finish;
    ws.onclose = finish;
  });
}

function isAntigravityRunning() {
  try {
    const tasklist = execFileSync('tasklist', ['/FI', 'IMAGENAME eq Antigravity.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
    return tasklist.toLowerCase().includes('antigravity.exe');
  } catch {
    return true;
  }
}

async function scanAndInject() {
  const port = getCDPPort();
  if (!port) return;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return;
    const targets = await res.json();

    for (const target of targets) {
      if (target.type === 'page' && !target.url.includes('devtools') && target.webSocketDebuggerUrl) {
        await injectTarget(target.webSocketDebuggerUrl, target.id).catch(() => {});
      }
    }
  } catch (err) {}
}

let consecutiveDeadCount = 0;

async function main() {
  for (;;) {
    // 检查 Antigravity 是否在运行，若主程序关闭则自动退出守护，零后台残留
    const running = isAntigravityRunning();
    if (!running) {
      consecutiveDeadCount++;
      if (consecutiveDeadCount >= 3) {
        process.exit(0);
      }
    } else {
      consecutiveDeadCount = 0;
      await scanAndInject();
    }
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
}

main();
