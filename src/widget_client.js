(() => {
  const REQUIRED_VERSION = '1.0M-inline-model-v8';
  const existingWidgets = document.querySelectorAll('#agy-model-context-widget');
  if (window.__agyContextCircleVersion === REQUIRED_VERSION && existingWidgets.length === 1) {
    return;
  }

  // 彻底清理所有旧版与重复挂件
  existingWidgets.forEach(el => el.remove());
  document.querySelectorAll('#agy-context-circle-container, #antigravity-context-monitor-root').forEach(el => el.remove());
  if (window.__agyContextCircleTimer) clearInterval(window.__agyContextCircleTimer);

  window.__agyContextCircleVersion = REQUIRED_VERSION;
  window.__agyContextCircleInstalled = 1000000;

  // 上下文总上限恒定 1,000,000 (100万)
  const CONTEXT_LIMIT = 1000000;
  // 采用 Antigravity 原生配额圆环几何规范：viewBox 0 0 32 32, r=13, C = 2 * Math.PI * 13 ≈ 81.6814
  const CIRCLE_C = 81.6814;

  const MODEL_NAMES = {
    'MODEL_PLACEHOLDER_M318': 'Gemini 3.8 Flash',
    'MODEL_PLACEHOLDER_M319': 'Gemini 3.8 Flash',
    'MODEL_PLACEHOLDER_M320': 'Gemini 3.8 Flash',
    'MODEL_PLACEHOLDER_M298': 'Gemini 3.7 Flash',
    'MODEL_PLACEHOLDER_M71': 'Gemini 3.6 Flash',
    'MODEL_PLACEHOLDER_M35': 'Claude Sonnet 4.6',
    'MODEL_PLACEHOLDER_M26': 'Claude Opus 4.6',
    'MODEL_PLACEHOLDER_M16': 'Gemini 3.1 Pro',
    'default': 'Gemini 3.8 Flash'
  };

  function formatTokens(n) {
    if (!n || n <= 0) return '0';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  }

  // 挂件外层：采用 Antigravity 原生底栏工具按钮规范 (h-7 w-7 / 28x28px, rounded-lg, hover:bg-secondary)
  const widget = document.createElement('div');
  widget.id = 'agy-model-context-widget';
  widget.className = 'flex items-center justify-center h-7 w-7 rounded-lg cursor-pointer hover:bg-secondary transition-colors relative';
  widget.style.cssText = 'display: inline-flex; align-items: center; justify-content: center; height: 28px; width: 28px; border-radius: 8px; cursor: pointer; user-select: none; vertical-align: middle; flex-shrink: 0; position: relative; margin-left: 2px; transition: background-color 0.15s ease;';

  widget.innerHTML = [
    '<div id="agy-ring-badge" class="relative rounded-full flex items-center justify-center flex-shrink-0 w-4 h-4 shrink-0" title="上下文使用率 (悬停查看详情)">',
    '  <svg aria-hidden="true" viewBox="0 0 32 32" shape-rendering="geometricPrecision" style="width: 16px; height: 16px; transform: rotate(-90deg); display: block;">',
    '    <circle cx="16" cy="16" r="13" fill="transparent" stroke="color-mix(in srgb, var(--foreground, #101010) 12%, transparent)" stroke-width="3.2" />',
    '    <circle id="agy-ring-progress" cx="16" cy="16" r="13" fill="transparent" stroke="var(--primary, #007acc)" stroke-width="3.8" stroke-linecap="round" stroke-dasharray="81.6814" stroke-dashoffset="81.6814" style="transition: stroke-dashoffset 0.35s ease, stroke 0.3s ease, opacity 0.2s ease; opacity: 0;" />',
    '  </svg>',
    '</div>',
    '<div id="agy-ring-popover" style="display: none; position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%); width: 172px; background: var(--card, #ffffff); border: 1px solid var(--border, rgba(0, 0, 0, 0.075)); border-radius: 8px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05), 0 1px 3px rgba(0, 0, 0, 0.04); padding: 8px 11px; z-index: 999999; font-family: var(--font-sans, system-ui, -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif); pointer-events: auto; box-sizing: border-box; white-space: nowrap;">',
    '  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">',
    '    <span style="font-size: 11.5px; font-weight: 500; color: var(--foreground, #101010); letter-spacing: -0.01em;">上下文容量</span>',
    '    <span id="agy-popover-pct" style="color: var(--primary, #007acc); font-weight: 600; font-size: 11.5px; font-variant-numeric: tabular-nums;">0%</span>',
    '  </div>',
    '  <div style="height: 3px; width: 100%; background: color-mix(in srgb, var(--foreground, #101010) 8%, transparent); border-radius: 9999px; overflow: hidden; margin-bottom: 6px;">',
    '    <div id="agy-popover-bar" style="width: 0%; height: 100%; background: var(--primary, #007acc); border-radius: 9999px; transition: width 0.3s ease;"></div>',
    '  </div>',
    '  <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px;">',
    '    <span style="color: var(--muted-foreground, rgba(16, 16, 16, 0.5)); font-weight: 400;">容量占用</span>',
    '    <span id="agy-popover-used" style="font-weight: 500; color: var(--foreground, #101010); font-variant-numeric: tabular-nums;">0 / 1.0M</span>',
    '  </div>',
    '  <div style="position: absolute; bottom: -4px; left: 50%; transform: translateX(-50%) rotate(45deg); width: 7px; height: 7px; background: var(--card, #ffffff); border-right: 1px solid var(--border, rgba(0, 0, 0, 0.075)); border-bottom: 1px solid var(--border, rgba(0, 0, 0, 0.075));"></div>',
    '</div>'
  ].join('');

  // 悬停交互事件：完全遵循原生底栏 hover:bg-secondary 动画
  const popover = widget.querySelector('#agy-ring-popover');
  let hideTimer = null;

  const showPop = () => {
    clearTimeout(hideTimer);
    widget.style.backgroundColor = 'var(--secondary, rgba(0, 0, 0, 0.06))';
    popover.style.display = 'block';
  };

  const hidePop = () => {
    hideTimer = setTimeout(() => {
      widget.style.backgroundColor = 'transparent';
      popover.style.display = 'none';
    }, 120);
  };

  widget.addEventListener('mouseenter', showPop);
  widget.addEventListener('mouseleave', hidePop);
  popover.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  popover.addEventListener('mouseleave', hidePop);

  // 定位模型按钮并挂载
  function findModelBtn() {
    const trigger = document.querySelector('button[data-testid="model-selector-trigger"]');
    if (trigger) return trigger;
    const btns = Array.from(document.querySelectorAll('button'));
    const found = btns.find(b => {
      const t = (b.innerText || '').trim();
      return (t.includes('Flash') || t.includes('Gemini') || t.includes('Claude') || t.includes('GPT')) && b.querySelector('svg') && !b.closest('.chat-scrollable, [data-testid="virtuoso-item-list"], .overflow-y-auto');
    });
    if (found) return found;
    return document.querySelector('.no-focus-agent-input')?.querySelector('button') || null;
  }

  function ensureMounted() {
    // 强制保持全页面仅有 1 个实例
    const allWidgets = document.querySelectorAll('#agy-model-context-widget');
    allWidgets.forEach(w => {
      if (w !== widget) w.remove();
    });

    const modelBtn = findModelBtn();
    if (!modelBtn) return false;
    const anchor = modelBtn.closest('.no-focus-agent-input') || modelBtn.parentElement;
    if (!anchor || !anchor.parentElement) return false;

    if (document.contains(widget) && widget.parentElement === anchor.parentElement && widget.previousElementSibling === anchor) {
      return true;
    }

    if (document.contains(widget)) {
      widget.remove();
    }
    anchor.after(widget);
    return true;
  }

  // 状态与数据更新
  async function updateData() {
    ensureMounted();

    try {
      const path = location.pathname;
      const match = path.match(/\/c\/([a-zA-Z0-9_-]+)/);
      if (!match) {
        const ring = document.getElementById('agy-ring-progress');
        if (ring) {
          ring.style.opacity = '0';
          ring.style.strokeDashoffset = CIRCLE_C;
        }
        const pctEl = document.getElementById('agy-popover-pct');
        const barEl = document.getElementById('agy-popover-bar');
        const usedEl = document.getElementById('agy-popover-used');
        if (pctEl) { pctEl.innerText = '0%'; pctEl.style.color = 'var(--primary, #007acc)'; }
        if (barEl) barEl.style.width = '0%';
        if (usedEl) usedEl.innerText = '0 / 1.0M';
        return;
      }

      const cascadeId = match[1];
      const token = window.__APP_CONFIG__ && window.__APP_CONFIG__.csrfToken;

      const res = await fetch('/exa.language_server_pb.LanguageServerService/GetCascadeTrajectorySteps', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-codeium-csrf-token': token
        },
        body: JSON.stringify({
          cascadeId: cascadeId,
          startIndex: 0,
          endIndex: 500,
          metadata: { ideName: 'antigravity', extensionName: 'antigravity' }
        })
      });

      if (!res.ok) return;
      const data = await res.json();
      const steps = data.steps || [];

      let lastUsage = null;
      for (let i = steps.length - 1; i >= 0; i--) {
        if (steps[i] && steps[i].metadata && steps[i].metadata.modelUsage) {
          lastUsage = steps[i].metadata.modelUsage;
          break;
        }
      }

      const modelId = (lastUsage && lastUsage.model) || 'default';
      let modelName = MODEL_NAMES[modelId] || MODEL_NAMES['default'];
      const curBtn = findModelBtn();
      if (curBtn && curBtn.innerText && curBtn.innerText.trim().length < 30) {
        modelName = curBtn.innerText.replace(/\s+/g, ' ').trim();
      }

      let used = 0;
      if (lastUsage) {
        used = Number(lastUsage.cacheReadTokens || 0) + Number(lastUsage.inputTokens || 0) + Number(lastUsage.outputTokens || 0);
      }

      const limit = CONTEXT_LIMIT; // 恒定 1,000,000 (100万)
      const pct = Math.min(100, Math.round((used / limit) * 1000) / 10);
      const remain = Math.max(0, limit - used);

      let color = 'var(--primary, #007acc)'; // Antigravity 官方白蓝系品牌主色（<50%）
      if (pct >= 80) {
        color = 'var(--error, #f05151)';     // 红色警示 (>=80%)
      } else if (pct >= 50) {
        color = 'var(--warning, #ac830b)';   // 琥珀黄预警 (50%~80%)
      }

      const ring = document.getElementById('agy-ring-progress');
      const offset = Math.max(0, CIRCLE_C - (pct / 100) * CIRCLE_C);

      if (ring) {
        ring.style.stroke = color;
        ring.style.strokeDashoffset = pct <= 0 ? CIRCLE_C : offset;
        ring.style.opacity = pct <= 0 ? '0' : '1';
      }

      const pctEl = document.getElementById('agy-popover-pct');
      const barEl = document.getElementById('agy-popover-bar');
      const usedEl = document.getElementById('agy-popover-used');

      if (pctEl) {
        pctEl.innerText = pct + '%';
        pctEl.style.color = color;
      }
      if (barEl) {
        barEl.style.width = pct + '%';
        barEl.style.background = color;
      }
      if (usedEl) usedEl.innerText = formatTokens(used) + ' / 1.0M';

    } catch (e) {
      console.warn('[ContextRing] Error:', e);
    }
  }

  // 清理可能存在的历史 Observer，杜绝卡顿
  if (window.__agyContextObserver) {
    try { window.__agyContextObserver.disconnect(); } catch(e) {}
    window.__agyContextObserver = null;
  }

  // 挂载与定时轮询 (极轻量 1500ms 刷新，绝不阻塞 UI 主线程)
  ensureMounted();
  updateData();

  // 路由切换感知
  const origPush = history.pushState;
  history.pushState = function() {
    const res = origPush.apply(this, arguments);
    setTimeout(updateData, 60);
    return res;
  };
  window.addEventListener('popstate', () => setTimeout(updateData, 60));

  window.__agyContextCircleTimer = setInterval(updateData, 1500);
})();