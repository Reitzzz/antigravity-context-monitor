import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { localizationScript, version } from '../src/localization/index.mjs';
import { injections, runInjections, runFailed } from '../src/injections.mjs';

test('translation preserves code, model labels and widget; reinjection cleans resources', () => {
  const timers = new Set(), listeners = new Map(), observers = new Set();
  let id = 0;
  class Element {
    nodeType = 1;
    className = '';
    attrs = {};
    constructor(tagName, text, attrs = {}) {
      this.tagName = tagName;
      this.attrs = attrs;
      this.id = attrs.id;
      this.childNodes = text ? [{ nodeType: 3, nodeValue: text, parentElement: this, parentNode: this }] : [];
    }
    getAttribute(name) { return this.attrs[name] ?? null; }
    hasAttribute(name) { return name in this.attrs; }
    setAttribute(name, value) { this.attrs[name] = value; }
    querySelectorAll() { return []; }
    attachShadow() {
      this.shadowRoot = { nodeType: 11, host: this, childNodes: [] };
      return this.shadowRoot;
    }
    closest() {
      return this.id === 'agy-model-context-widget' || this.attrs['data-testid'] === 'model-selector-trigger' ? this : null;
    }
  }
  const menu = new Element('BUTTON', 'Settings');
  const code = new Element('CODE', 'Settings');
  const model = new Element('BUTTON', 'Settings', { 'data-testid': 'model-selector-trigger', title: 'Settings' });
  const widget = new Element('SPAN', 'Settings', { id: 'agy-model-context-widget' });
  const input = new Element('INPUT', '', { placeholder: 'Search' });
  const originalAttachShadow = Element.prototype.attachShadow;
  const shadow = widget.attachShadow({mode: 'open'});
  const nested = new Element('SPAN');
  nested.parentNode = shadow;
  shadow.childNodes.push(nested);
  const inner = nested.attachShadow({mode: 'open'});
  const shadowLabel = new Element('BUTTON', 'Settings', {title: 'Settings'});
  shadowLabel.parentNode = inner;
  inner.childNodes.push(shadowLabel);
  const phrases = [
    ['thought for 2s', '思考了 2 秒'],
    ['Thinking for 2s...', '正在思考 (2 秒)'],
    ['SHOW BREAKDOWN', '显示明细'],
    ['Show breakdowns', '显示明细'],
    ['work with Google developer products.', ' 中的智能体配合 Google 开发者产品工作。'],
    ["Prototype, build & run modern apps users love with Firebase’s backend, AI, and operational infrastructure.", '借助 Firebase 的后端、AI 和运营基础设施，原型设计、构建并运行深受用户喜爱的现代应用。'],
    ['Enable Antigravity to control and inspect a live Chrome browser with extra details', '让 Antigravity 能够控制并检查运行中的 Chrome 浏览器，利用 Chrome DevTools 的全部能力进行可靠自动化与深度调试。'],
    ['project  found', '未找到项目'],
    ['FilesChanged', '已修改文件'],
    ['See all (', '查看全部 ('],
    ['Cloud CLI MCP Server provides tools to run gcloud and bq CLIcommands today', 'Cloud CLI MCP 服务器提供在远程沙箱环境中运行 gcloud 和 bq CLI 命令的工具。'],
  ];
  const labels = phrases.map(([text]) => new Element('SPAN', text));
  const body = new Element('BODY');
  body.childNodes = [menu, code, model, widget, input, ...labels];
  body.childNodes.forEach(node => { node.parentElement = body; node.parentNode = body; });
  const window = { location: { pathname: '/' } };
  const context = vm.createContext({ window, Element, Node: { ELEMENT_NODE: 1, TEXT_NODE: 3, DOCUMENT_FRAGMENT_NODE: 11 },
    document: { body, title: '', querySelector() { return null; }, querySelectorAll() { return []; },
      addEventListener(name, fn) { listeners.set(fn, name); }, removeEventListener(name, fn) { listeners.delete(fn); } },
    MutationObserver: class {
      observe() { observers.add(this); }
      disconnect() { observers.delete(this); }
    },
    setTimeout() { timers.add(++id); return id; }, clearTimeout(timer) { timers.delete(timer); },
    setInterval() { timers.add(++id); return id; }, clearInterval(timer) { timers.delete(timer); },
  });
  vm.runInContext(localizationScript(), context);
  assert.equal(menu.childNodes[0].nodeValue, '设置');
  assert.equal(input.attrs.placeholder, '搜索');
  for (const node of [code, model, widget]) assert.equal(node.childNodes[0].nodeValue, 'Settings');
  assert.equal(model.attrs.title, 'Settings');
  assert.equal(shadowLabel.childNodes[0].nodeValue, 'Settings');
  assert.equal(shadowLabel.attrs.title, 'Settings');
  labels.forEach((label, i) => assert.equal(label.childNodes[0].nodeValue, phrases[i][1], phrases[i][0]));
  assert.notEqual(Element.prototype.attachShadow, originalAttachShadow);
  assert.equal(window.__ag_hanhua_engine__.version, version);
  const resourceCounts = [timers.size, listeners.size, observers.size];
  vm.runInContext(localizationScript(), context);
  assert.deepEqual([timers.size, listeners.size, observers.size], resourceCounts);
  assert.equal(menu.childNodes[0].nodeValue, '设置');
  window.__ag_hanhua_engine__.disconnect();
  assert.deepEqual([timers.size, listeners.size, observers.size], [0, 0, 0]);
  assert.equal(Element.prototype.attachShadow, originalAttachShadow);
  vm.runInContext(localizationScript(), context);
  const foreignHook = function () {};
  Element.prototype.attachShadow = foreignHook;
  window.__ag_hanhua_engine__.disconnect();
  assert.equal(Element.prototype.attachShadow, foreignHook);
});

function injectionHarness() {
  const context = vm.createContext({ window: {}, document: { body: {}, readyState: 'complete', getElementById() { return null; } } });
  const attempts = { widget: 0, localization: 0 };
  const errors = {};
  const evaluate = async expression => {
    for (const { key, install, version } of injections) {
      if (!expression.includes(install)) continue;
      attempts[key]++;
      if (errors[key] === 'transport') throw new Error('CDP connection closed');
      // Execute the real wrapper/probes/disposal, substituting only the DOM payload.
      const state = key === 'widget' ? '__agyContextMonitor' : '__ag_hanhua_engine__';
      const method = key === 'widget' ? 'dispose' : 'disconnect';
      expression = expression.replace(install, () => errors[key] === 'script'
        ? "throw new Error('broken payload')"
        : `window.${state} = {version: '${version}', ${method}() { delete window.${state}; }};`);
    }
    return vm.runInContext(expression, context);
  };
  return { context, evaluate, attempts, errors };
}

test('table installs each plugin once, check is read-only, remove cleans both', async () => {
  const h = injectionHarness();
  await runInjections(h.evaluate, 'check');
  assert.deepEqual(h.attempts, { widget: 0, localization: 0 });
  for (let i = 0; i < 2; i++) {
    const result = await runInjections(h.evaluate, 'install');
    assert.ok(result.widget.installed && result.localization.installed);
  }
  assert.deepEqual(h.attempts, { widget: 1, localization: 1 });
  await runInjections(h.evaluate, 'remove');
  assert.equal(h.context.window.__agyContextMonitor, undefined);
  assert.equal(h.context.window.__ag_hanhua_engine__, undefined);
});

test('script failure is remembered per page and version, optional failure is nonfatal', async () => {
  const h = injectionHarness();
  h.errors.localization = 'script';
  const result = await runInjections(h.evaluate, 'install');
  assert.equal(result.widget.installed, true);
  assert.match(result.localization.message, /broken payload/);
  assert.equal(runFailed([{status: 'supported', ...result}], 'install'), false);
  await runInjections(h.evaluate, 'install');
  assert.equal(h.attempts.localization, 1);
  h.context.window.__agyInjectionFailures.localization.version = 'previous version';
  await runInjections(h.evaluate, 'install');
  assert.equal(h.attempts.localization, 2);
  h.context.window = {}; // New execution context, same target.
  delete h.errors.localization;
  assert.equal((await runInjections(h.evaluate, 'install')).localization.installed, true);
  assert.equal(h.attempts.localization, 3);
});

test('required failure is fatal but other plugins still run; remove clears failure cache', async () => {
  const h = injectionHarness();
  h.errors.widget = 'script';
  const result = await runInjections(h.evaluate, 'install');
  assert.equal(result.localization.installed, true);
  assert.equal(runFailed([{status: 'supported', ...result}], 'install'), true);
  await runInjections(h.evaluate, 'remove');
  assert.equal(h.context.window.__agyInjectionFailures.widget, undefined);
});

test('transport errors back off and recover; loading DOM is not permanently blocked', async () => {
  const h = injectionHarness(), retries = new Map();
  h.errors.localization = 'transport';
  await runInjections(h.evaluate, 'install', retries, 0);
  await runInjections(h.evaluate, 'install', retries, 2500);
  assert.equal(h.attempts.localization, 1);
  await runInjections(h.evaluate, 'install', retries, 5000);
  assert.equal(h.attempts.localization, 2);
  delete h.errors.localization;
  await runInjections(h.evaluate, 'install', retries, 10000);
  assert.equal(h.attempts.localization, 2);
  assert.equal((await runInjections(h.evaluate, 'install', retries, 15000)).localization.installed, true);
  assert.equal(retries.size, 0);
  h.context.window = {};
  h.context.document.readyState = 'loading';
  assert.equal((await runInjections(h.evaluate, 'install')).localization.waiting, true);
  assert.equal(h.context.window.__agyInjectionFailures, undefined);
  h.context.document.readyState = 'complete';
  assert.equal((await runInjections(h.evaluate, 'install')).localization.installed, true);
});

