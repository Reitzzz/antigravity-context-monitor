// Opt-in integration check: touches only our own injected widget, never the chat.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { connect, widgetScript, loopbackUrl } from '../src/watch_context_widget.mjs';
const port = Number(fs.readFileSync(path.join(process.env.APPDATA, 'Antigravity', 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0]);
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find(t => t.type === 'page' && loopbackUrl(t.url, ['https:', 'http:']) && new URL(t.url).pathname.startsWith('/c/'));
assert.ok(target, 'Open an existing Antigravity conversation');
const client = await connect(target.webSocketDebuggerUrl);
try {
  const evaluate = async expression => (await client.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value;
  assert.equal(await evaluate(`/antigravity/i.test(window.__APP_CONFIG__?.productName || '') && /^2\\./.test(window.__APP_CONFIG__?.appVersion || '')`), true);
  await evaluate(widgetScript());
  assert.equal(await evaluate(`(() => { const first = window.__agyContextMonitor; ${widgetScript()}; return first === window.__agyContextMonitor && document.querySelectorAll('#agy-model-context-widget').length === 1; })()`), true, 'Duplicate injection must preserve singleton');
  await evaluate('window.__agyContextMonitor.dispose(); true');
  assert.equal(await evaluate(`!window.__agyContextMonitor && !document.getElementById('agy-model-context-widget')`), true, 'Dispose removes UI and state');
  await evaluate(widgetScript());
  let status;
  for (let attempt = 0; attempt < 20; attempt++) {
    status = await evaluate(`({status:window.__agyContextMonitor?.status,snapshot:window.__agyContextMonitor?.snapshot})`);
    if (status.status === 'ready') break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.equal(status.status, 'ready', 'Current conversation must have native metadata for this integration check');
  const comparison = await evaluate(`(async () => {
    const cascadeId = location.pathname.split('/')[2];
    const request = async (method, body) => (await fetch('/exa.language_server_pb.LanguageServerService/' + method, {method:'POST', headers:{'Content-Type':'application/json','x-codeium-csrf-token':window.__APP_CONFIG__.csrfToken}, body:JSON.stringify(body)})).json();
    const gm = await request('GetCascadeTrajectoryGeneratorMetadata', {cascadeId});
    const summaries = await request('GetAllCascadeTrajectories', {});
    const count = Number(summaries.trajectorySummaries[cascadeId].stepCount || 0);
    const current = gm.generatorMetadata.filter(g => g.stepIndices?.length && g.stepIndices.every(i => i < count)).sort((a,b) => Math.max(...a.stepIndices)-Math.max(...b.stepIndices)).at(-1);
    // The newest entry can lack metadata while a widget poll above was still ready (live request race); fail with a message, not a TypeError.
    const native = current?.chatModel?.chatStartMetadata?.contextWindowMetadata;
    return {used:native?.estimatedTokensUsed ?? null,limit:native?.maxContextTokens ?? null};
  })()`);
  assert.ok(comparison.used !== null, 'Newest native metadata lacks contextWindowMetadata; rerun while the conversation is idle');
  assert.equal(status.snapshot.used, Number(comparison.used));
  assert.equal(status.snapshot.limit, Number(comparison.limit));
  const alignment = await evaluate(`(() => {
    const m=document.querySelector('button[data-testid="model-selector-trigger"]').getBoundingClientRect();
    const r=document.getElementById('agy-model-context-widget').getBoundingClientRect();
    return {right:r.left>=m.right,centerDifference:Math.abs((m.top+m.height/2)-(r.top+r.height/2)),width:r.width,height:r.height};
  })()`);
  assert.equal(alignment.right, true, 'Ring must be right of the model selector');
  assert.ok(alignment.centerDifference < 2, 'Ring must stay on the same row');
  assert.equal(alignment.width, 28);
  const geometry = await evaluate(`(() => {
    const root=document.getElementById('agy-model-context-widget');const s=root.shadowRoot;
    s.querySelector('button').dispatchEvent(new Event('mouseenter'));
    const b=root.getBoundingClientRect(), p=s.querySelector('.panel').getBoundingClientRect();
    return {x:Math.min(b.left,p.left),y:Math.min(b.top,p.top),width:Math.max(b.right,p.right)-Math.min(b.left,p.left),height:Math.max(b.bottom,p.bottom)-Math.min(b.top,p.top),visible:!s.querySelector('.panel').hidden,viewport:{width:innerWidth,height:innerHeight},text:s.querySelector('.numbers').textContent};
  })()`);
  assert.equal(geometry.visible, true);
  assert.ok(geometry.x >= 0 && geometry.y >= 0 && geometry.x + geometry.width <= geometry.viewport.width + 1);
  if (process.argv.includes('--screenshot')) {
    const screenshot = await client.call('Page.captureScreenshot', {format:'png',clip:{x:geometry.x,y:geometry.y,width:geometry.width,height:geometry.height,scale:1}});
    fs.writeFileSync(new URL('../docs/live-widget.png', import.meta.url), Buffer.from(screenshot.data, 'base64'));
  }
  await evaluate(`document.getElementById('agy-model-context-widget').shadowRoot.querySelector('button').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); true`);
  assert.equal(await evaluate(`document.getElementById('agy-model-context-widget').shadowRoot.querySelector('.panel').hidden`), true);
  console.log(JSON.stringify({result:'PASS',checks:['singleton','dispose','reinstall','native values','same-row alignment','popover bounds','Escape'],alignment,...status,screenshot:process.argv.includes('--screenshot')}, null, 2));
} finally { client.socket.close(); }
