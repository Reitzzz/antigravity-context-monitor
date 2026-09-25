// Native pre-request context estimate, never billing/cumulative usage.
// Pure function: the same parser runs in Node tests and the injected widget.
// Stringified into the page — the function body must not close over module scope.
export function readContext(generatorMetadata, stepCount) {
  const integer = value => {
    if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) return null;
    const n = Number(value);
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
  };
  const signed = value => {
    if (typeof value !== 'number' && !(typeof value === 'string' && /^-?\d+$/.test(value))) return null;
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : null;
  };
  if (!Array.isArray(generatorMetadata) || integer(stepCount) === null) throw new Error('上下文接口结构不兼容');
  if (Number(stepCount) === 0) return { state: 'empty' };
  const entries = [];
  for (const entry of generatorMetadata) {
    if (!entry || !Array.isArray(entry.stepIndices) || !entry.stepIndices.length) continue;
    const indices = entry.stepIndices.map(integer);
    if (indices.some(i => i === null || i >= Number(stepCount))) continue;
    const start = entry.chatModel?.chatStartMetadata;
    const context = start?.contextWindowMetadata;
    entries.push({
      used: integer(context?.estimatedTokensUsed), limit: integer(context?.maxContextTokens), step: Math.max(...indices),
      checkpoint: signed(start?.checkpointIndex),
      model: entry.plannerConfig?.requestedModel?.model || entry.plannerConfig?.planModel || '',
      breakdown: (Array.isArray(context?.tokenBreakdown?.groups) ? context.tokenBreakdown.groups : [])
        .filter(g => typeof g?.name === 'string' && integer(g.numTokens) !== null)
        .map(g => ({ name: g.name, tokens: integer(g.numTokens) })),
    });
  }
  entries.sort((a, b) => a.step - b.step);
  const lastStep = entries.at(-1)?.step;
  const tied = entries.filter(e => e.step === lastStep);
  const complete = tied.filter(e => e.used !== null && e.limit !== null && e.limit !== 0);
  const last = complete[0];
  const disagree = complete.some(e => e.used !== last.used || e.limit !== last.limit || e.model !== last.model);
  if (!last || disagree) return { state: 'unavailable', tiedRequests: tied.length };
  const previous = entries.filter(e => e.step < lastStep).reverse().find(e => e.checkpoint !== null);
  return {
    ...last, state: 'ready', percent: last.used / last.limit * 100,
    remaining: Math.max(0, last.limit - last.used),
    checkpointChanged: Boolean(previous && last.checkpoint !== null && last.checkpoint > previous.checkpoint),
    previousCheckpoint: previous ? previous.checkpoint : null,
    stepsAfterSnapshot: Number(stepCount) - 1 - last.step,
    tiedRequests: tied.length,
  };
}
