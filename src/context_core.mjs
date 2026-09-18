// Native pre-request context estimate, never billing/cumulative usage.
// Pure function: the same parser runs in Node tests and the injected widget.
export function readContext(generatorMetadata, stepCount) {
  const integer = value => {
    if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) return null;
    const n = Number(value);
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
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
      checkpoint: Number.isSafeInteger(start?.checkpointIndex) ? start.checkpointIndex : null,
      model: entry.plannerConfig?.requestedModel?.model || entry.plannerConfig?.planModel || entry.chatModel?.model || '',
      breakdown: (Array.isArray(context?.tokenBreakdown?.groups) ? context.tokenBreakdown.groups : [])
        .filter(g => typeof g?.name === 'string' && integer(g.numTokens) !== null)
        .map(g => ({ name: g.name, tokens: integer(g.numTokens) })),
    });
  }
  entries.sort((a, b) => a.step - b.step);
  const last = entries.at(-1);
  // Do not fall back to old telemetry when the newest request lacks it.
  if (!last || last.used === null || last.limit === null || last.limit === 0) return { state: 'unavailable' };
  const previous = entries.slice(0, -1).reverse().find(e => e.checkpoint !== null);
  return {
    ...last, state: 'ready', percent: last.used / last.limit * 100,
    remaining: Math.max(0, last.limit - last.used),
    checkpointChanged: Boolean(previous && last.checkpoint !== null && last.checkpoint > previous.checkpoint),
    stepsAfterSnapshot: Number(stepCount) - 1 - last.step,
  };
}
