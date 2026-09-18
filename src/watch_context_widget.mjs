import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readContext } from './context_core.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const version = '2.0.5-native-context';
export function widgetScript() {
  return `window.__agyReadContext = (${readContext.toString()});\n${fs.readFileSync(path.join(directory, 'widget_client.js'), 'utf8')}`;
}
export function loopbackUrl(value, protocol) {
  try { const url = new URL(value); return protocol.includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname); }
  catch { return false; }
}
export async function connect(url) {
  if (!loopbackUrl(url, ['ws:'])) throw new Error('CDP must use loopback ws://');
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('CDP connection timeout')); }, 4000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connection failed')); }, { once: true });
  });
  let nextId = 0;
  return {
    socket,
    call(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const cleanup = () => { clearTimeout(timer); socket.removeEventListener('message', message); socket.removeEventListener('close', closed); };
        const closed = () => { cleanup(); reject(new Error('CDP connection closed')); };
        const timer = setTimeout(() => { cleanup(); reject(new Error(`${method} timeout`)); }, 15000);
        const message = event => {
          let data;
          try { data = JSON.parse(event.data); } catch { return; }
          if (data.id !== id) return;
          cleanup();
          if (data.error) reject(new Error(`CDP ${data.error.code}: ${data.error.message}`));
          else if (data.result?.exceptionDetails) reject(new Error('Injected script threw an exception'));
          else resolve(data.result);
        };
        socket.addEventListener('message', message);
        socket.addEventListener('close', closed);
        try { socket.send(JSON.stringify({ id, method, params })); } catch (error) { cleanup(); reject(error); }
      });
    },
  };
}
export async function inspectTarget(target, mode = 'check') {
  if (target.type !== 'page' || !loopbackUrl(target.url, ['https:', 'http:'])) return { status: 'ignored' };
  const client = await connect(target.webSocketDebuggerUrl);
  try {
    const evaluate = async expression => (await client.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value;
    const identity = await evaluate(`(() => {const c=window.__APP_CONFIG__; return {product:c?.productName, version:c?.appVersion, hasAuth:typeof c?.csrfToken === 'string', anchor:!!document.querySelector('button[data-testid="model-selector-trigger"]')};})()`);
    if (!/antigravity/i.test(identity?.product || '') || !/^2\./.test(identity?.version || '') || !identity.hasAuth) return { status: 'unsupported', identity };
    if (mode === 'remove') {
      await evaluate('window.__agyContextMonitor?.dispose(); delete window.__agyReadContext; true');
      return { status: 'removed', version: identity.version };
    }
    if (mode === 'install') await evaluate(widgetScript());
    const widget = await evaluate(`(() => {const s=window.__agyContextMonitor;return {installed:s?.version === '${version}',status:s?.status,snapshot:s?.snapshot,mounted:!!document.getElementById('agy-model-context-widget')};})()`);
    return { status: 'supported', version: identity.version, anchor: identity.anchor, widget };
  } finally { client.socket.close(); }
}
export async function scan(port, mode) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`CDP HTTP ${response.status}`);
  const targets = await response.json();
  if (!Array.isArray(targets)) throw new Error('Invalid CDP target list');
  const results = [];
  for (const target of targets) {
    try { results.push(await inspectTarget(target, mode)); }
    catch (error) { results.push({ status: 'error', message: error.message }); }
  }
  return results;
}
async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('node src/watch_context_widget.mjs [--check|--once|--remove] [--port N] [--profile ABSOLUTE_PATH]'); return;
  }
  const allowed = new Set(['--check', '--once', '--remove', '--port', '--profile']);
  for (let i = 0; i < args.length; i++) {
    if (!allowed.has(args[i])) throw new Error(`Unknown option: ${args[i]}`);
    if (['--port', '--profile'].includes(args[i]) && !args[++i]) throw new Error('Option value missing');
  }
  if (args.filter(a => ['--check', '--once', '--remove'].includes(a)).length > 1) throw new Error('Choose one mode');
  const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : null;
  const profile = option('--profile') || (process.env.APPDATA && path.join(process.env.APPDATA, 'Antigravity'));
  if (!profile || !path.isAbsolute(profile)) throw new Error('Specify --profile with an absolute Antigravity user-data path');
  const explicitPort = option('--port');
  const getPort = () => {
    const raw = explicitPort || fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0];
    const port = /^\d+$/.test(raw.trim()) ? Number(raw) : NaN;
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid CDP port');
    return port;
  };
  const once = args.some(a => ['--check', '--once', '--remove'].includes(a));
  const mode = args.includes('--remove') ? 'remove' : args.includes('--check') ? 'check' : 'install';
  if (once) {
    const results = await scan(getPort(), mode);
    console.log(JSON.stringify(results, null, 2));
    if (!results.some(r => ['supported', 'removed'].includes(r.status))) process.exitCode = 1;
    return;
  }
  const lock = net.createServer();
  try {
    await new Promise((resolve, reject) => { lock.once('error', reject); lock.listen(29876, '127.0.0.1', resolve); });
  } catch (error) {
    if (error.code === 'EADDRINUSE') { console.log('Monitor already running (or lock port 29876 in use).'); return; }
    throw error;
  }
  let stop = false, lastMessage = '', missing = 0, connectedOnce = false;
  process.on('SIGINT', () => { stop = true; });
  process.on('SIGTERM', () => { stop = true; });
  try {
    while (!stop) {
      let message;
      try {
        const results = await scan(getPort(), mode);
        connectedOnce ||= results.some(r => r.status === 'supported');
        missing = 0;
        message = JSON.stringify(results.map(r => ({ status: r.status, version: r.version, mounted: r.widget?.mounted, message: r.message })));
      } catch (error) {
        missing++;
        message = error.code === 'ENOENT' ? 'Waiting for Antigravity DevToolsActivePort…' : `Waiting for CDP: ${error.message}`;
      }
      if (message !== lastMessage) { console.log(message); lastMessage = message; }
      if (connectedOnce && missing >= 12) break;
      await new Promise(resolve => setTimeout(resolve, 2500));
    }
  } finally {
    try { await scan(getPort(), 'remove'); } catch { /* Client already exited. */ }
    lock.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
