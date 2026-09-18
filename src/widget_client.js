(() => {
  const VERSION = '2.0.5-native-context';
  if (window.__agyContextMonitor?.version === VERSION) return;
  window.__agyContextMonitor?.dispose();
  if (window.__agyContextCircleTimer) clearInterval(window.__agyContextCircleTimer);
  document.querySelectorAll('#agy-model-context-widget').forEach(el => el.remove());
  const readContext = window.__agyReadContext;
  if (typeof readContext !== 'function') throw new Error('Context parser not loaded');
  const root = document.createElement('span');
  root.id = 'agy-model-context-widget';
  const shadow = root.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host{display:inline-flex;vertical-align:middle;margin-left:2px;flex-shrink:0;width:28px;height:28px;font:12px/1.5 system-ui;color:var(--foreground,#222)}
    button{display:flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;cursor:pointer}
    button:hover{background:var(--secondary,#8882)}button:focus-visible{outline:2px solid var(--primary,#007acc);outline-offset:2px}
    svg{width:16px;height:16px;transform:rotate(-90deg)}circle{fill:none;stroke-width:3}
    .track{stroke:currentColor;opacity:.15}.fill{stroke:var(--primary,#007acc);stroke-dasharray:81.6814;stroke-dashoffset:81.6814}
    .panel{position:fixed;box-sizing:border-box;width:300px;max-width:calc(100vw - 16px);max-height:70vh;overflow:auto;padding:14px 16px;background:var(--card,#fff);color:var(--foreground,#222);border:1px solid var(--border,#8885);border-radius:12px;box-shadow:0 6px 24px #0003;z-index:2147483647;white-space:normal}
    .panel[hidden]{display:none}
    header{display:flex;align-items:baseline;justify-content:space-between;gap:12px}header strong{font-size:14px}
    .numbers{font-size:14px;font-weight:600;font-variant-numeric:tabular-nums;opacity:.9}
    .bar{height:8px;border-radius:99px;background:var(--secondary,#8883);margin:10px 0 4px;overflow:hidden}.bar i{display:block;height:100%;width:0;border-radius:99px;background:linear-gradient(90deg,#2563eb,#60a5fa);transition:width .2s}
    ul.breakdown{list-style:none;margin:6px 0 0;padding:0}ul.breakdown li{display:flex;align-items:center;gap:8px;padding:3px 0}
    ul.breakdown i{width:8px;height:8px;border-radius:50%;background:var(--c,#2563eb);flex-shrink:0}
    ul.breakdown span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}ul.breakdown b{font-weight:600;font-variant-numeric:tabular-nums}
    p{margin:8px 0 0;font-size:11px}.muted{opacity:.75}
  </style><button type="button" aria-label="上下文监控" aria-expanded="false">
    <svg viewBox="0 0 32 32" aria-hidden="true"><circle class="track" cx="16" cy="16" r="13"/><circle class="fill" cx="16" cy="16" r="13"/></svg>
  </button><section class="panel" hidden aria-label="上下文详情"><header><strong>上下文容量</strong><span class="numbers">—</span></header><div class="bar"><i></i></div><ul class="breakdown"></ul><p class="model"></p><p class="detail"></p><p class="updated muted"></p></section>`;
  const $ = selector => shadow.querySelector(selector);
  const button = $('button'), panel = $('.panel');
  let disposed = false, timer, controller, mountedModel, lastRoute = '', failures = 0;
  let busy = false, urgent = false, generation = 0, idle = false;
  let configs = [], configsAt = 0, previous = null;
  const route = () => location.pathname.match(/^\/c\/([a-zA-Z0-9_-]+)(?:\/|$)/)?.[1] || '';
  const modelButton = () => {
    const visible = [...document.querySelectorAll('button[data-testid="model-selector-trigger"]')].filter(el => el.getClientRects().length);
    return visible.length === 1 ? visible[0] : null;
  };
  const label = () => (modelButton()?.textContent || '').replace(/\s+/g, ' ').trim();
  const normalizeLabel = value => value.replace(/[()（）]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  function mount() {
    const trigger = modelButton();
    // The trigger's immediate parent is a block. Join its outer flex row,
    // as the original widget did, instead of creating a second line inside it.
    const anchor = trigger?.closest('.no-focus-agent-input');
    if (anchor && (root.previousElementSibling !== anchor || !root.isConnected)) anchor.after(root);
    if (!anchor) root.remove();
    return Boolean(anchor);
  }
  function show(open) {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) {
      const rect = button.getBoundingClientRect();
      panel.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - 308))}px`;
      panel.style.top = `${Math.max(8, rect.top - panel.offsetHeight - 8)}px`;
    }
  }
  button.addEventListener('click', () => show(panel.hidden));
  button.addEventListener('mouseenter', () => show(true));
  root.addEventListener('mouseleave', () => { if (!shadow.activeElement) show(false); });
  button.addEventListener('focus', () => show(true));
  button.addEventListener('blur', () => show(false));
  button.addEventListener('keydown', event => { if (event.key === 'Escape') { show(false); event.stopPropagation(); } });
  const outside = event => { if (!event.composedPath().includes(root)) show(false); };
  document.addEventListener('pointerdown', outside);
  const format = n => n.toLocaleString('en-US');
  const wan = n => n >= 10000 ? `${(n / 10000).toFixed(1).replace(/\.0$/, '')}万` : String(n);
  const pct = p => `${p.toFixed(1).replace(/\.0$/, '')}%`;
  const DOTS = ['#1d4ed8', '#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe'];
  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function render(result, detail, model = '') {
    const ready = result?.state === 'ready';
    const percent = ready ? result.percent : null;
    $('.numbers').textContent = ready ? `~${wan(result.used)}/${wan(result.limit)} (${pct(percent)})` : '—';
    $('.bar i').style.width = `${Math.min(100, percent || 0)}%`;
    $('.fill').style.strokeDashoffset = String(81.6814 * (1 - Math.min(100, percent || 0) / 100));
    $('.fill').style.stroke = percent >= 80 ? 'var(--error,#d33)' : percent >= 50 ? 'var(--warning,#a77a00)' : 'var(--primary,#007acc)';
    const groups = ready && result.used > 0 ? result.breakdown : [];
    $('.breakdown').innerHTML = groups.map((g, i) => `<li><i style="--c:${DOTS[i % DOTS.length]}"></i><span>${esc(g.name)}</span><b>${pct(g.tokens / result.used * 100)}</b></li>`).join('');
    $('.model').textContent = model;
    $('.detail').textContent = detail;
    $('.updated').textContent = ready ? `读取于 ${new Date().toLocaleTimeString()} · 请求关联步骤 ${result.step + 1} · 剩余约 ${format(result.remaining)} tokens` : '';
    button.setAttribute('aria-label', ready ? `上下文原生估算 ${pct(percent)}，${format(result.used)} / ${format(result.limit)} tokens` : detail);
    state.snapshot = ready ? { used: result.used, limit: result.limit, step: result.step } : null;
    state.status = result?.state || 'unavailable';
    if (!panel.hidden) show(true);
  }
  async function rpc(method, body = {}) {
    const token = window.__APP_CONFIG__?.csrfToken;
    if (typeof token !== 'string' || !token) throw new Error('客户端认证配置不可用');
    const response = await fetch(`/exa.language_server_pb.LanguageServerService/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-codeium-csrf-token': token },
      body: JSON.stringify(body), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
    });
    if (!response.ok) throw new Error(`本地接口 HTTP ${response.status}`);
    return response.json();
  }
  async function update() {
    if (disposed) return;
    const id = route(), selected = label(), epoch = generation;
    if (!mount() || !id) { render(null, '请打开一条会话'); return; }
    controller = new AbortController();
    try {
      if (Date.now() - configsAt > 60000) {
        try {
          const data = await rpc('GetUserStatus');
          configs = data.userStatus?.cascadeModelConfigData?.clientModelConfigs || [];
          if (!Array.isArray(configs)) configs = [];
          configsAt = Date.now();
        } catch { /* Keep last-known-good configs; stale configsAt retries each cycle. */ }
      }
      const summaries = await rpc('GetAllCascadeTrajectories');
      const summary = summaries.trajectorySummaries?.[id];
      if (!summary) throw new Error('当前会话尚未出现在本地接口');
      idle = summary.status !== 'CASCADE_RUN_STATUS_RUNNING';
      const count = Number(summary.stepCount ?? 0);
      const data = count ? await rpc('GetCascadeTrajectoryGeneratorMetadata', { cascadeId: id }) : { generatorMetadata: [] };
      if (disposed || epoch !== generation || id !== route() || selected !== label()) return;
      const result = readContext(data.generatorMetadata ?? [], count);
      const config = configs.find(c => c.modelOrAlias?.model === result.model);
      const selectedConfig = configs.find(c => typeof c.label === 'string' && normalizeLabel(c.label) === normalizeLabel(selected));
      const model = config?.label || result.model || selected;
      const rewound = previous?.id === id && count < previous.count;
      previous = { id, count };
      // Ready requires positive attribution; a non-empty but stale config list proves nothing.
      const attributable = (selectedConfig && selectedConfig.modelOrAlias?.model === result.model) || (config && normalizeLabel(config.label) === normalizeLabel(selected));
      const switched = (selectedConfig && selectedConfig.modelOrAlias?.model !== result.model) || (config && normalizeLabel(config.label) !== normalizeLabel(selected));
      if (selected && result.model && !attributable) {
        if (switched) render(null, '模型已切换；等待新模型的下一次请求后读取其上下文上限', `当前选择：${selected}`);
        else { configsAt = 0; render(null, '模型配置不可用或缺少映射，无法校验快照模型与当前选择；下一轮自动重试', `当前选择：${selected}`); }
      } else if (result.state === 'ready') {
        render(result, `Antigravity 原生估算，统计时点为最近一次模型请求开始；未包含该次输出和之后的新增内容。${result.stepsAfterSnapshot ? ` 此后还有 ${result.stepsAfterSnapshot} 步。` : ''}${rewound ? ' 检测到回退，已重新读取。' : ''}${result.checkpointChanged ? ' 原生 checkpoint 已推进，可能发生上下文整理。' : ''}`, `快照模型：${model}`);
      } else render(result, result.state === 'empty' ? '新会话：等待第一次模型请求' : '当前请求未提供原生上下文数据；不以累计用量代替', model);
      failures = 0;
    } catch (error) {
      if (!disposed && epoch === generation && id === route() && selected === label()) {
        failures++;
        render(null, controller.signal.aborted ? '会话已变化，正在重新读取' : `读取失败：${error.message}；自动重试中`);
      }
    }
  }
  async function poll() {
    if (busy || disposed) return;
    busy = true;
    await update();
    busy = false;
    if (!disposed) timer = setTimeout(poll, urgent ? 0 : failures ? Math.min(30000, 3000 * 2 ** Math.min(failures, 4)) : idle ? 15000 : 3000);
    urgent = false;
  }
  // Invalidate changed routes/models without patching host history APIs.
  const routeTimer = setInterval(() => {
    mount();
    const current = route(), selected = label();
    if (current !== lastRoute || selected !== mountedModel) {
      lastRoute = current; mountedModel = selected; generation++; controller?.abort();
      render(null, current ? '正在读取当前会话上下文…' : '请打开一条会话');
      if (busy) urgent = true;
      else { clearTimeout(timer); timer = setTimeout(poll, 0); }
    }
  }, 250);
  const state = window.__agyContextMonitor = {
    version: VERSION, status: 'loading', snapshot: null,
    dispose() { disposed = true; clearTimeout(timer); clearInterval(routeTimer); controller?.abort(); document.removeEventListener('pointerdown', outside); root.remove(); delete window.__agyContextMonitor; },
  };
  lastRoute = route(); mountedModel = label();
  render(null, '正在读取当前会话上下文…');
  poll();
})();
