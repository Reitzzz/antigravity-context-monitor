import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { widgetScript } from '../src/watch_context_widget.mjs';

function harness({ count = 1, delay = false, statusFails = false, otherModel = false } = {}) {
  const timers = new Map(), intervals = new Map(); let nextId = 0, release;
  const nodes = new Map();
  const element = () => ({ style: {}, hidden: true, textContent: '', isConnected: false,
    addEventListener() {}, setAttribute() {}, remove() { this.isConnected = false; },
    getBoundingClientRect: () => ({left:10,top:500,height:28}),
    attachShadow() { return this.shadowRoot = {querySelector: selector => { if (!nodes.has(selector)) nodes.set(selector,element()); return nodes.get(selector); }}; },
  });
  const anchor = { after(root) { root.isConnected = true; root.previousElementSibling = this; } };
  const model = {...element(),textContent:'Gemini 3.8 Flash High', getClientRects:()=>[{}],closest:()=>anchor};
  const location = {pathname:'/c/first'};
  const window = {__APP_CONFIG__:{csrfToken:'test-only'}};
  const metadata = {generatorMetadata:[{stepIndices:[0],plannerConfig:{requestedModel:{model:'flash'}},chatModel:{chatStartMetadata:{contextWindowMetadata:{estimatedTokensUsed:100,maxContextTokens:256000}}}}]};
  const context = vm.createContext({window,location,document:{
    createElement:element,querySelectorAll:selector=>selector.startsWith('button')?[model]:[],addEventListener(){},removeEventListener(){},
  }, AbortSignal,AbortController, console,
    setInterval:fn=>{const id=++nextId;intervals.set(id,fn);return id;},clearInterval:id=>intervals.delete(id),
    setTimeout:fn=>{const id=++nextId;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
    fetch:async url=>{
      let result;
      if(url.endsWith('GetUserStatus')) {
        if(statusFails) throw new Error('local interface HTTP 500');
        result={userStatus:{cascadeModelConfigData:{clientModelConfigs:otherModel?[{label:'Other Model',modelOrAlias:{model:'other'}}]:[{label:'Gemini 3.8 Flash (High)',modelOrAlias:{model:'flash'}}]}}};
      }
      if(url.endsWith('GetAllCascadeTrajectories')) result={trajectorySummaries:{first:{stepCount:count},second:{stepCount:count}}};
      if(url.endsWith('GetCascadeTrajectoryGeneratorMetadata')) {
        if(delay) await new Promise(resolve=>{release=resolve;});
        result=metadata;
      }
      return {ok:true,json:async()=>result};
    },
  });
  vm.runInContext(widgetScript(),context);
  return {window,location,model,nodes,timers,intervals,release:()=>release?.(),tick:()=>[...intervals.values()].forEach(fn=>fn())};
}
const settle = () => new Promise(resolve=>setImmediate(resolve));
test('empty conversation with a selected model reports first request, not a model switch',async()=>{
  const h=harness({count:0});await settle();
  assert.equal(h.window.__agyContextMonitor.status,'empty');
  assert.match(h.nodes.get('.detail').textContent,/第一次模型请求/);
  h.window.__agyContextMonitor.dispose();
  assert.equal(h.intervals.size,0);assert.equal(h.timers.size,0);
});
test('model label formatting agrees with API labels and shows native snapshot',async()=>{
  const h=harness();await settle();
  assert.equal(h.window.__agyContextMonitor.status,'ready');
  assert.equal(h.window.__agyContextMonitor.snapshot.used,100);
  h.window.__agyContextMonitor.dispose();
});
test('route change clears snapshot and rejects an old in-flight response',async()=>{
  const h=harness({delay:true});await settle();
  h.location.pathname='/c/second';h.tick();h.release();await settle();
  assert.equal(h.window.__agyContextMonitor.snapshot,null);
  assert.match(h.nodes.get('.detail').textContent,/正在读取/);
  h.window.__agyContextMonitor.dispose();
});
test('failed first model-config fetch renders unverifiable, never a stale-model ready snapshot',async()=>{
  const h=harness({statusFails:true});await settle();
  assert.equal(h.window.__agyContextMonitor.snapshot,null);
  assert.notEqual(h.window.__agyContextMonitor.status,'ready');
  assert.match(h.nodes.get('.detail').textContent,/无法校验/);
  h.window.__agyContextMonitor.dispose();
});
test('stale non-empty config missing both mappings renders unverifiable, never ready',async()=>{
  const h=harness({otherModel:true});await settle();
  assert.equal(h.window.__agyContextMonitor.snapshot,null);
  assert.notEqual(h.window.__agyContextMonitor.status,'ready');
  assert.match(h.nodes.get('.detail').textContent,/无法校验/);
  h.window.__agyContextMonitor.dispose();
});
test('dispose prevents late response from creating a snapshot or another timer',async()=>{
  const h=harness({delay:true});await settle();
  h.window.__agyContextMonitor.dispose();h.release();await settle();
  assert.equal(h.window.__agyContextMonitor,undefined);
  assert.equal(h.timers.size,0);assert.equal(h.intervals.size,0);
});
