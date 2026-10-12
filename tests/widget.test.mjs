import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { widgetScript } from '../src/watch_context_widget.mjs';

function harness({
  count = 1, delay = false, statusFails = false, otherModel = false,
  configs, noPlannerConfig = false, noContextMetadata = false,
  counts, trajectoryFails = false, selector, metadataSequence, legacyPopover = false,
} = {}) {
  const timers = new Map(), intervals = new Map();
  let nextId = 0, release, statusCalls = 0, trajectoryCalls = 0;
  const flags = { failQuery: false };
  const nodes = new Map();
  const created = [];
  const documentListeners = new Map();
  const element = () => ({
    style: {}, hidden: true, textContent: '', isConnected: false, offsetHeight: 200,
    popoverOpen: false, events: {}, showPopoverCalls: 0, hidePopoverCalls: 0, attrs: {},
    addEventListener(type, fn) { (this.events[type] ??= []).push(fn); },
    dispatch(type) { for (const fn of this.events[type] || []) fn({ composedPath: () => [this], key: '' }); },
    ...(legacyPopover ? {} : {
      showPopover() { this.popoverOpen = true; this.showPopoverCalls++; },
      hidePopover() { this.popoverOpen = false; this.hidePopoverCalls++; },
      matches(selector) { return selector === ':popover-open' && this.popoverOpen; },
    }),
    setAttribute(name, value) { this.attrs[name] = String(value); },
    removeAttribute(name) { delete this.attrs[name]; },
    remove() { this.isConnected = false; },
    getBoundingClientRect: () => ({left:10,top:500,bottom:528,width:28,height:28}),
    attachShadow() { return this.shadowRoot = {querySelector: sel => { if (!nodes.has(sel)) nodes.set(sel,element()); return nodes.get(sel); }}; },
  });
  const anchor = { after(root) { root.isConnected = true; root.previousElementSibling = this; } };
  const model = {...element(),textContent:selector || 'Gemini 3.8 Flash High', getClientRects:()=>[{}],closest:()=>anchor};
  const location = {pathname:'/c/first'};
  const window = {__APP_CONFIG__:{csrfToken:'test-only'}};
  const metadata = {generatorMetadata:[{stepIndices:[0],plannerConfig:{requestedModel:{model:'flash'}},chatModel:{chatStartMetadata:{contextWindowMetadata:{estimatedTokensUsed:100,maxContextTokens:256000}}}}]};
  if (noPlannerConfig) delete metadata.generatorMetadata[0].plannerConfig;
  if (noContextMetadata) delete metadata.generatorMetadata[0].chatModel.chatStartMetadata.contextWindowMetadata;
  const defaultConfigs = otherModel
    ? [{label:'Other Model',modelOrAlias:{model:'other'}}]
    : [{label:'Gemini 3.8 Flash (High)',modelOrAlias:{model:'flash'}}];
  const context = vm.createContext({window,location,innerWidth:1400,innerHeight:810,document:{
    createElement:()=>{ const el = element(); created.push(el); return el; },
    querySelectorAll:sel=>{
      if (flags.failQuery) throw new Error('query failed');
      return sel.startsWith('button')?[model]:[];
    },
    addEventListener(type,fn){ if(!documentListeners.has(type)) documentListeners.set(type,[]); documentListeners.get(type).push(fn); },
    removeEventListener(type,fn){ const list = documentListeners.get(type); if (list) list.splice(list.indexOf(fn),1); },
  }, AbortSignal,AbortController, console,
    setInterval:fn=>{const id=++nextId;intervals.set(id,fn);return id;},clearInterval:id=>intervals.delete(id),
    setTimeout:(fn,ms)=>{const id=++nextId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
    fetch:async url=>{
      let result;
      if(url.endsWith('GetUserStatus')) {
        statusCalls++;
        if(statusFails) throw new Error('local interface HTTP 500');
        result={userStatus:{cascadeModelConfigData:{clientModelConfigs:configs || defaultConfigs}}};
      }
      if(url.endsWith('GetAllCascadeTrajectories')) {
        if(trajectoryFails) throw new Error('trajectory failed');
        const n = Array.isArray(counts) ? counts[Math.min(trajectoryCalls, counts.length - 1)] : count;
        trajectoryCalls++;
        result={trajectorySummaries:{first:{stepCount:n},second:{stepCount:n}}};
      }
      if(url.endsWith('GetCascadeTrajectoryGeneratorMetadata')) {
        if(delay) await new Promise(resolve=>{release=resolve;});
        result = Array.isArray(metadataSequence)
          ? metadataSequence[Math.min(Math.max(trajectoryCalls - 1, 0), metadataSequence.length - 1)]
          : metadata;
      }
      return {ok:true,json:async()=>result};
    },
  });
  vm.runInContext(widgetScript(),context);
  const runTimer = async () => {
    let bestId, best;
    for (const [id, t] of timers) if (!best || t.ms < best.ms) { bestId = id; best = t; }
    if (!best) return;
    timers.delete(bestId);
    await best.fn();
  };
  return {window,location,model,nodes,created,timers,intervals,flags,documentListeners,get statusCalls(){return statusCalls;},
    release:()=>release?.(),tick:()=>[...intervals.values()].forEach(fn=>fn()),runTimer};
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
test('config missing label is ignored when another labelled mapping matches',async()=>{
  const h=harness({configs:[
    {modelOrAlias:{model:'flash'}},
    {label:'Gemini 3.8 Flash (High)',modelOrAlias:{model:'flash'}},
  ]});
  await settle();
  assert.equal(h.window.__agyContextMonitor.status,'ready');
  h.window.__agyContextMonitor.dispose();
});
test('config missing label does not throw and stays unverifiable',async()=>{
  const h=harness({configs:[{modelOrAlias:{model:'flash'}}]});
  await settle();
  assert.notEqual(h.window.__agyContextMonitor.status,'ready');
  assert.match(h.nodes.get('.detail').textContent,/无法校验/);
  h.window.__agyContextMonitor.dispose();
});
test('snapshot without plannerConfig is unverifiable',async()=>{
  const h=harness({noPlannerConfig:true});await settle();
  assert.notEqual(h.window.__agyContextMonitor.status,'ready');
  assert.match(h.nodes.get('.detail').textContent,/未标注模型/);
  h.window.__agyContextMonitor.dispose();
});
test('unavailable snapshot does not display an alias as the snapshot model',async()=>{
  const h=harness({noContextMetadata:true,configs:[{label:'Auto'},{label:'Gemini 3.8 Flash (High)',modelOrAlias:{model:'flash'}}]});
  await settle();
  assert.doesNotMatch(h.nodes.get('.model').textContent,/Auto/);
  h.window.__agyContextMonitor.dispose();
});
test('mapped selector that is not the snapshot model reports a switch',async()=>{
  const h=harness({selector:'Other Model',configs:[{label:'Other Model',modelOrAlias:{model:'other'}}]});
  await settle();
  assert.match(h.nodes.get('.detail').textContent,/模型已切换/);
  h.window.__agyContextMonitor.dispose();
});
test('alias selection is unverifiable rather than a model switch',async()=>{
  const h=harness({configs:[{label:'Gemini 3.8 Flash High'}]});
  await settle();
  assert.match(h.nodes.get('.detail').textContent,/别名/);
  assert.doesNotMatch(h.nodes.get('.detail').textContent,/已切换/);
  h.window.__agyContextMonitor.dispose();
});
test('status is loading before the first response and after a route change',async()=>{
  const h=harness({delay:true});
  assert.equal(h.window.__agyContextMonitor.status,'loading');
  h.location.pathname='/c/second';h.tick();
  assert.equal(h.window.__agyContextMonitor.status,'loading');
  h.window.__agyContextMonitor.dispose();h.release();await settle();
});
test('a step-count rewind is surfaced in the detail line',async()=>{
  const h=harness({counts:[3,2]});await settle();
  await h.runTimer();await settle();
  assert.match(h.nodes.get('.detail').textContent,/检测到回退/);
  h.window.__agyContextMonitor.dispose();
});
const meta = (step, used) => ({ generatorMetadata: [{
  stepIndices: [step], plannerConfig: { requestedModel: { model: 'flash' } },
  chatModel: { chatStartMetadata: { checkpointIndex: -1, contextWindowMetadata: { estimatedTokensUsed: used, maxContextTokens: 256000 } } },
}] });
test('same step count with replaced metadata updates the snapshot and does not report rewind', async () => {
  const h = harness({ count: 4, metadataSequence: [meta(1, 100), meta(1, 180)] });
  await settle();
  assert.equal(h.window.__agyContextMonitor.snapshot.used, 100);
  await h.runTimer(); await settle();
  assert.equal(h.window.__agyContextMonitor.snapshot.used, 180);
  assert.equal(h.window.__agyContextMonitor.snapshot.limit, 256000);
  assert.doesNotMatch(h.nodes.get('.detail').textContent, /检测到回退/);
  h.window.__agyContextMonitor.dispose();
});
test('a rewind keeps the last in-range snapshot', async () => {
  const body = { generatorMetadata: [meta(0, 50).generatorMetadata[0], meta(4, 200).generatorMetadata[0]] };
  const h = harness({ counts: [5, 2], metadataSequence: [body, body] });
  await settle();
  assert.equal(h.window.__agyContextMonitor.snapshot.used, 200);
  await h.runTimer(); await settle();
  assert.equal(h.window.__agyContextMonitor.snapshot.used, 50);
  assert.equal(h.window.__agyContextMonitor.snapshot.limit, 256000);
  assert.match(h.nodes.get('.detail').textContent, /检测到回退/);
  h.window.__agyContextMonitor.dispose();
});
test('progressed steps poll in 3s; idle unchanged steps poll in 15s',async()=>{
  const moved=harness({counts:[1,2]});await settle();
  await moved.runTimer();await settle();
  assert.equal([...moved.timers.values()].at(-1).ms,3000);
  moved.window.__agyContextMonitor.dispose();
  const idle=harness({count:1});await settle();
  await idle.runTimer();await settle();
  assert.equal([...idle.timers.values()].at(-1).ms,15000);
  idle.window.__agyContextMonitor.dispose();
});
test('missing mappings keep the config cache instead of refetching every tick',async()=>{
  const h=harness({otherModel:true});await settle();
  await h.runTimer();await settle();
  assert.equal(h.statusCalls,1);
  h.window.__agyContextMonitor.dispose();
});
test('trajectory errors back off 6s then 12s',async()=>{
  const h=harness({trajectoryFails:true});await settle();
  assert.equal([...h.timers.values()][0].ms,6000);
  await h.runTimer();await settle();
  assert.equal([...h.timers.values()][0].ms,12000);
  h.window.__agyContextMonitor.dispose();
});
test('a throw outside update still releases busy and reschedules',async()=>{
  const h=harness();await settle();
  h.flags.failQuery=true;
  await h.runTimer();await settle();
  assert.match(h.window.__agyContextMonitor.detail,/内部错误/);
  assert.ok(h.timers.size>0);
  h.window.__agyContextMonitor.dispose();
});
test('debug state detail matches the panel detail text',async()=>{
  const h=harness();await settle();
  assert.equal(h.window.__agyContextMonitor.detail,h.nodes.get('.detail').textContent);
  h.window.__agyContextMonitor.dispose();
});
test('an open panel is promoted to the top layer so app chrome cannot cover it',async()=>{
  const h=harness();await settle();
  const panel=h.nodes.get('.panel'),button=h.nodes.get('button');
  button.dispatch('mouseenter');
  assert.equal(panel.popoverOpen,true);
  assert.equal(panel.hidden,false);
  h.window.__agyContextMonitor.dispose();
});
test('without the Popover API the panel still toggles through the hidden attribute',async()=>{
  const h=harness({legacyPopover:true});await settle();
  const panel=h.nodes.get('.panel'),button=h.nodes.get('button');
  button.dispatch('mouseenter');
  assert.equal(panel.hidden,false);
  const outside=h.documentListeners.get('pointerdown')[0];
  outside({composedPath:()=>[]});
  assert.equal(panel.hidden,true);
  h.window.__agyContextMonitor.dispose();
});
test('a click pins the panel so blur and hover leave no longer close it',async()=>{
  const h=harness();await settle();
  const panel=h.nodes.get('.panel'),button=h.nodes.get('button'),root=h.created[0];
  button.dispatch('mouseenter');
  button.dispatch('click');
  assert.equal(panel.popoverOpen,true);
  assert.equal(root.attrs['data-pinned'],'');
  button.dispatch('blur');
  root.dispatch('mouseleave');
  assert.equal(panel.popoverOpen,true,'pinned panel must survive blur and hover leave');
  assert.equal(panel.hidden,false);
  await h.runTimer();await settle();
  assert.equal(panel.popoverOpen,true,'pinned panel must survive a polling re-render');
  h.window.__agyContextMonitor.dispose();
});
test('clicking outside unpins and closes; clicking the pinned ring does the same',async()=>{
  const outside=h=>h.documentListeners.get('pointerdown')[0]({composedPath:()=>[]});
  const first=harness();await settle();
  const panel=first.nodes.get('.panel'),button=first.nodes.get('button'),root=first.created[0];
  button.dispatch('click');
  assert.equal(root.attrs['data-pinned'],'');
  outside(first);
  assert.equal(panel.popoverOpen,false);
  assert.equal(panel.hidden,true);
  assert.equal(root.attrs['data-pinned'],undefined);
  first.window.__agyContextMonitor.dispose();
  const second=harness();await settle();
  const p2=second.nodes.get('.panel'),b2=second.nodes.get('button'),r2=second.created[0];
  b2.dispatch('click');
  assert.equal(p2.popoverOpen,true);
  b2.dispatch('click');
  assert.equal(p2.popoverOpen,false,'second click on a pinned ring closes it');
  assert.equal(r2.attrs['data-pinned'],undefined);
  second.window.__agyContextMonitor.dispose();
});
test('clicking inside the widget keeps it pinned',async()=>{
  const h=harness();await settle();
  const panel=h.nodes.get('.panel'),button=h.nodes.get('button');
  button.dispatch('click');
  const inside=h.documentListeners.get('pointerdown')[0];
  inside({composedPath:()=>[h.created[0]]});
  assert.equal(panel.popoverOpen,true);
  h.window.__agyContextMonitor.dispose();
});
test('the panel opens above the ring, flipping below when it would cover the ring',async()=>{
  const h=harness();await settle();
  const panel=h.nodes.get('.panel'),button=h.nodes.get('button');
  button.dispatch('mouseenter');
  assert.equal(panel.style.top,'292px','500 - 200 - 8');
  assert.equal(panel.style.left,'10px');
  // Ring high up: opening above would clamp back over the ring, so flip below.
  button.getBoundingClientRect=()=>({left:10,top:6,bottom:34,width:28,height:28});
  button.dispatch('mouseenter');
  assert.equal(panel.style.top,'42px','34 + 8');
  h.window.__agyContextMonitor.dispose();
});
test('Escape closes a pinned panel even after the app took the button focus',async()=>{
  const h=harness();await settle();
  const panel=h.nodes.get('.panel'),button=h.nodes.get('button');
  button.dispatch('click');
  assert.equal(panel.popoverOpen,true);
  const escape=[...h.documentListeners.get('keydown')].at(-1);
  escape({key:'Escape'});
  assert.equal(panel.popoverOpen,false);
  assert.equal(panel.hidden,true);
  h.window.__agyContextMonitor.dispose();
});
test('a document Escape does nothing while no panel is pinned',async()=>{
  const h=harness();await settle();
  const panel=h.nodes.get('.panel'),button=h.nodes.get('button');
  button.dispatch('mouseenter');
  assert.equal(panel.hidden,false);
  for(const fn of h.documentListeners.get('keydown') || []) fn({key:'Escape'});
  assert.equal(panel.hidden,false,'hover-opened panel is not a pinned panel');
  h.window.__agyContextMonitor.dispose();
});
