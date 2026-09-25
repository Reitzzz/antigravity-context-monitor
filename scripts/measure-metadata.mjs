// Read-only size and model summary. Prints aggregates only — never ids, prompts, or response bodies.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { connect, discoverPort, loopbackUrl, resolveProfile } from '../src/watch_context_widget.mjs';
import { readContext } from '../src/context/context_core.mjs';

export const LIMITS = { bytes: 2_000_000, parsePlusReadMs: 100, idleIntervalMs: 15_000 };
const round = value => Math.round((Number(value) || 0) * 10) / 10;

export function buildMeasureReport(measured) {
  const sampleIds = new Set([...measured].sort((a, b) => b.stepCount - a.stepCount).slice(0, 3).map(row => row.id));
  const current = measured.find(row => row.current);
  if (current?.id) sampleIds.add(current.id);
  const models = new Map();
  let emptySessions = 0, unavailableSessions = 0, errors = 0, maxBytes = 0, maxParsePlusReadMs = 0, overLimitSessions = 0, checkpointAdvancedSessions = 0;
  const samples = [];
  for (const row of measured) {
    const parsePlusReadMs = (row.parseMs || 0) + (row.readMs || 0);
    const over = row.bytes >= LIMITS.bytes || parsePlusReadMs >= LIMITS.parsePlusReadMs;
    const advanced = Number.isFinite(row.checkpoint) && Number.isFinite(row.previousCheckpoint) && row.checkpoint > row.previousCheckpoint;
    if (advanced) checkpointAdvancedSessions++;
    if (row.bytes > maxBytes) maxBytes = row.bytes;
    if (parsePlusReadMs > maxParsePlusReadMs) maxParsePlusReadMs = parsePlusReadMs;
    if (over) overLimitSessions++;
    if (row.state === 'empty') emptySessions++;
    else if (row.state === 'error') errors++;
    else if (row.state === 'unavailable') unavailableSessions++;
    else {
      const bucket = models.get(row.model || '') || { model: row.model || '', sessions: 0, withNativeWindow: 0, limits: new Set() };
      bucket.sessions++;
      if (row.state === 'ready' && Number.isFinite(row.limit)) { bucket.withNativeWindow++; bucket.limits.add(row.limit); }
      models.set(bucket.model, bucket);
    }
    if (!sampleIds.has(row.id) && !advanced) continue;
    samples.push({
      current: Boolean(row.current), stepCount: row.stepCount, entries: row.entries, bytes: row.bytes,
      parseMs: round(row.parseMs), readMs: round(row.readMs), state: row.state, model: row.model || '',
      used: Number.isFinite(row.used) ? row.used : null, limit: Number.isFinite(row.limit) ? row.limit : null,
      checkpoint: Number.isFinite(row.checkpoint) ? row.checkpoint : null,
      previousCheckpoint: Number.isFinite(row.previousCheckpoint) ? row.previousCheckpoint : null,
      checkpointAdvanced: advanced,
      idleBytesPerMinute: Math.round(row.bytes * (60_000 / LIMITS.idleIntervalMs)), overLimit: over,
    });
  }
  samples.sort((a, b) => b.stepCount - a.stepCount || Number(b.current) - Number(a.current));
  return {
    sessions: measured.length, emptySessions, unavailableSessions, errors, checkpointAdvancedSessions, maxBytes,
    maxParsePlusReadMs: round(maxParsePlusReadMs), overLimitSessions, samples,
    models: [...models.values()].map(bucket => ({
      model: bucket.model, sessions: bucket.sessions, withNativeWindow: bucket.withNativeWindow,
      limits: [...bucket.limits].sort((a, b) => a - b),
    })).sort((a, b) => b.sessions - a.sessions || a.model.localeCompare(b.model)),
    threshold: { bytes: LIMITS.bytes, parsePlusReadMs: LIMITS.parsePlusReadMs },
    item7: overLimitSessions > 0 ? 'triggered' : 'not-triggered',
  };
}

const listExpression = `(async () => {
  const token = window.__APP_CONFIG__?.csrfToken;
  if (typeof token !== 'string' || !token) throw new Error('客户端认证配置不可用');
  const response = await fetch('/exa.language_server_pb.LanguageServerService/GetAllCascadeTrajectories', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-codeium-csrf-token': token },
    body: '{}', signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error('本地接口 HTTP ' + response.status);
  const data = await response.json();
  const current = (location.pathname.match(/^\\/c\\/([A-Za-z0-9_-]+)/) || [])[1] || '';
  return Object.entries(data.trajectorySummaries || {}).map(([id, summary]) => {
    const stepCount = Number(summary?.stepCount ?? 0);
    return { id, stepCount: Number.isSafeInteger(stepCount) && stepCount > 0 ? stepCount : 0, current: id === current };
  });
})()`;

function metadataExpression(cascadeId, stepCount) {
  return `(async () => {
    const readContext = (${readContext.toString()});
    const token = window.__APP_CONFIG__?.csrfToken;
    if (typeof token !== 'string' || !token) throw new Error('客户端认证配置不可用');
    const response = await fetch('/exa.language_server_pb.LanguageServerService/GetCascadeTrajectoryGeneratorMetadata', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-codeium-csrf-token': token },
      body: JSON.stringify({ cascadeId: ${JSON.stringify(cascadeId)} }), signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error('本地接口 HTTP ' + response.status);
    const text = await response.text();
    const bytes = new TextEncoder().encode(text).length;
    const parsedAt = performance.now();
    const data = JSON.parse(text);
    const parseMs = performance.now() - parsedAt;
    const readAt = performance.now();
    const result = readContext(data.generatorMetadata ?? [], ${stepCount});
    const readMs = performance.now() - readAt;
    const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
    return {
      bytes, parseMs, readMs, entries: Array.isArray(data.generatorMetadata) ? data.generatorMetadata.length : 0,
      state: result.state, model: typeof result.model === 'string' ? result.model : '',
      used: finite(result.used), limit: finite(result.limit), checkpoint: finite(result.checkpoint), previousCheckpoint: finite(result.previousCheckpoint),
    };
  })()`;
}

function blank(row, state) {
  return {
    id: typeof row?.id === 'string' ? row.id : '', current: Boolean(row?.current),
    stepCount: Number.isSafeInteger(row?.stepCount) ? row.stepCount : 0,
    entries: 0, bytes: 0, parseMs: 0, readMs: 0, state, model: '', used: null, limit: null, checkpoint: null, previousCheckpoint: null,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : null;
  const port = discoverPort(resolveProfile(option('--profile')), option('--port'));
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) })).json();
  const pages = targets.filter(target => target.type === 'page' && loopbackUrl(target.url, ['https:', 'http:']) && new URL(target.url).pathname.startsWith('/c/'));
  if (!pages[0]) throw new Error('Open an existing Antigravity conversation');
  const client = await connect(pages[0].webSocketDebuggerUrl, { callTimeout: 120000 });
  try {
    const evaluate = async expression => (await client.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value;
    const identity = await evaluate(`(() => { const c = window.__APP_CONFIG__; return { version: c?.appVersion || '', ok: /antigravity/i.test(c?.productName || '') && /^2\\./.test(c?.appVersion || '') && typeof c?.csrfToken === 'string' }; })()`);
    if (!identity?.ok) throw new Error('当前页面不是 Antigravity 2.x');
    const rows = await evaluate(listExpression);
    if (!Array.isArray(rows)) throw new Error('会话列表结构不兼容');
    const measured = [];
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      console.error(`measuring ${index + 1}/${rows.length}`);
      if (!row || typeof row.id !== 'string') { measured.push(blank(row, 'error')); continue; }
      if (row.stepCount === 0) { measured.push(blank(row, 'empty')); continue; }
      try {
        measured.push({ id: row.id, current: Boolean(row.current), stepCount: row.stepCount, ...await evaluate(metadataExpression(row.id, row.stepCount)) });
      } catch (error) {
        console.error(String(error.message || error).split(row.id).join('#'));
        measured.push(blank(row, 'error'));
      }
    }
    const report = { appVersion: identity.version, conversationPages: pages.length, ...buildMeasureReport(measured) };
    const configs = await evaluate(`(async () => {
      const token = window.__APP_CONFIG__?.csrfToken;
      if (typeof token !== 'string' || !token) return [];
      const response = await fetch('/exa.language_server_pb.LanguageServerService/GetUserStatus', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-codeium-csrf-token': token },
        body: '{}', signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) return [];
      const data = await response.json();
      const list = data.userStatus?.cascadeModelConfigData?.clientModelConfigs || [];
      return list.filter(item => typeof item?.label === 'string' && typeof item?.modelOrAlias?.model === 'string')
        .map(item => ({ model: item.modelOrAlias.model, label: item.label }));
    })()`);
    const labels = new Map(Array.isArray(configs) ? configs.map(item => [item.model, item.label]) : []);
    for (const model of report.models) if (labels.has(model.model)) model.label = labels.get(model.model);
    for (const sample of report.samples) if (labels.has(sample.model)) sample.label = labels.get(sample.model);
    if (report.samples.some(sample => sample.current && sample.checkpointAdvanced)) {
      report.currentCheckpointWidget = await evaluate(`(() => ({
        installed: Boolean(window.__agyContextMonitor),
        detailHasCheckpointSentence: (window.__agyContextMonitor?.detail || '').includes('原生 checkpoint 已推进，可能发生上下文整理'),
        snapshot: window.__agyContextMonitor?.snapshot || null,
      }))()`);
    }
const encoded = JSON.stringify(report);
if (measured.some(row => typeof row.id === 'string' && row.id.length >= 8 && encoded.includes(row.id))) throw new Error('测量结果包含会话标识，已中止输出');
console.log(JSON.stringify(report, null, 2));
if (report.errors) process.exitCode = 1;
  } finally { client.socket.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
