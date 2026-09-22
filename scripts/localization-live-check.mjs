// Test real DOM/ShadowRoot behavior in a disposable blank iframe, not user content.
import assert from 'node:assert/strict';
import { connect, discoverPort, resolveProfile, loopbackUrl } from '../src/watch_context_widget.mjs';
import { localizationScript } from '../src/localization/index.mjs';

const port = discoverPort(resolveProfile());
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find(t => t.type === 'page' && loopbackUrl(t.url, ['http:', 'https:']));
assert.ok(target, 'Open Antigravity first');
const client = await connect(target.webSocketDebuggerUrl);
try {
  const result = await client.call('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: `(async () => {
    const frame = document.createElement('iframe');
    frame.hidden = true;
    document.body.append(frame);
    const w = frame.contentWindow, d = w.document;
    const original = w.Element.prototype.attachShadow;
    const results = {};
    const check = (name, condition) => { if (!condition) throw new Error(name); results[name] = true; };
    const install = () => {
      const window = w, document = d, Element = w.Element, Node = w.Node, MutationObserver = w.MutationObserver;
      const setTimeout = w.setTimeout.bind(w), clearTimeout = w.clearTimeout.bind(w);
      const setInterval = w.setInterval.bind(w), clearInterval = w.clearInterval.bind(w);
      ${localizationScript()}
    };
    const settle = () => new Promise(resolve => setTimeout(resolve, 30));
    try {
      d.body.innerHTML = '<button id="menu">Settings</button><span id="agy-model-context-widget"></span><button data-testid="model-selector-trigger"><span title="Settings">Settings</span></button><div id="ordinary"></div>';
      const widget = d.getElementById('agy-model-context-widget');
      const outer = widget.attachShadow({mode:'open'});
      outer.innerHTML = '<span></span>';
      const nested = outer.firstChild.attachShadow({mode:'open'});
      nested.innerHTML = '<button title="Settings">Settings</button>';
      const ordinary = d.getElementById('ordinary').attachShadow({mode:'open'});
      ordinary.innerHTML = '<button title="Settings">Settings</button>';
      install();
      check('initialTranslation', d.getElementById('menu').textContent === '设置');
      check('nestedShadowExclusion', nested.firstChild.textContent === 'Settings' && nested.firstChild.title === 'Settings');
      check('modelExclusion', d.querySelector('[data-testid] span').textContent === 'Settings' && d.querySelector('[data-testid] span').title === 'Settings');
      check('existingShadowTranslation', ordinary.firstChild.textContent === '设置' && ordinary.firstChild.title === '设置');
      ordinary.firstChild.textContent = 'Search';
      ordinary.firstChild.title = 'Search';
      await settle();
      check('shadowMutation', ordinary.firstChild.textContent === '搜索' && ordinary.firstChild.title === '搜索');
      const lateHost = d.createElement('div');
      d.body.append(lateHost);
      const late = lateHost.attachShadow({mode:'open'});
      late.innerHTML = '<button title="Search">Search</button>';
      await settle();
      check('newShadowTranslation', late.firstChild.textContent === '搜索' && late.firstChild.title === '搜索');
      install();
      w.__ag_hanhua_engine__.disconnect();
      check('hookRestoredAfterReinstall', w.Element.prototype.attachShadow === original);
      late.firstChild.textContent = 'Settings';
      await settle();
      check('observerStopped', late.firstChild.textContent === 'Settings');
      install();
      const ownHook = w.Element.prototype.attachShadow;
      const foreign = function () { return ownHook.apply(this, arguments); };
      w.Element.prototype.attachShadow = foreign;
      w.__ag_hanhua_engine__.disconnect();
      check('foreignHookPreserved', w.Element.prototype.attachShadow === foreign);
      w.Element.prototype.attachShadow = original;
      const NativeObserver = w.MutationObserver;
      w.MutationObserver = class { observe() { throw new Error('startup failure'); } disconnect() {} };
      let threw = false;
      try { install(); } catch { threw = true; }
      w.MutationObserver = NativeObserver;
      check('partialStartupCleaned', threw && !w.__ag_hanhua_engine__ && w.Element.prototype.attachShadow === original);
      return results;
    } finally {
      w.__ag_hanhua_engine__?.disconnect();
      frame.remove();
    }
  })()` });
  console.log(JSON.stringify(result.result.value, null, 2));
} finally { client.socket.close(); }
