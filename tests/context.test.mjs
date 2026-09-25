import test from 'node:test';
import assert from 'node:assert/strict';
import { readContext } from '../src/context/context_core.mjs';
import { loopbackUrl } from '../src/watch_context_widget.mjs';
const entry = (step, used = 145624, limit = 256000, checkpoint = -1) => ({
  stepIndices: [step], plannerConfig: { requestedModel: { model: 'MODEL_PLACEHOLDER_M318' } },
  chatModel: { model: 'shadow-model', usage: { inputTokens: '5778', cacheReadTokens: '138096', outputTokens: '347' },
    chatStartMetadata: { checkpointIndex: checkpoint, contextWindowMetadata: { estimatedTokensUsed: used, maxContextTokens: limit } } },
});
test('2.13 native sample: preserve native estimate, never sum billing tokens', () => {
  const result = readContext([entry(238)], 239);
  assert.equal(result.used, 145624); assert.equal(result.limit, 256000);
  assert.equal(result.percent, 56.884375); assert.equal(result.model, 'MODEL_PLACEHOLDER_M318');
});
test('long conversations and unordered metadata use latest step beyond 500', () => {
  assert.equal(readContext([entry(1250, 200000), entry(10, 10)], 1251).used, 200000);
});
test('rewind excludes a request containing steps outside the active trajectory', () => {
  const future = entry(900); future.stepIndices = [498, 900];
  assert.equal(readContext([entry(450, 120000), future], 500).used, 120000);
});
test('missing newest telemetry does not reuse older telemetry', () => {
  const latest = entry(9); delete latest.chatModel.chatStartMetadata;
  assert.equal(readContext([entry(2), latest], 10).state, 'unavailable');
});
test('zero is valid, missing or invalid counters are unknown', () => {
  assert.equal(readContext([entry(0, 0)], 1).used, 0);
  for (const value of [null, undefined, '', true, -1, Infinity, NaN, '23junk', Number.MAX_SAFE_INTEGER + 1]) {
    const row = entry(0); row.chatModel.chatStartMetadata.contextWindowMetadata.estimatedTokensUsed = value;
    assert.equal(readContext([row], 1).state, 'unavailable');
  }
  assert.equal(readContext([entry(0, 12, 0)], 1).state, 'unavailable');
});
test('numeric protobuf strings and percentages over 100 remain honest', () => {
  const result = readContext([entry(0, '300000', '256000')], '1');
  assert.equal(result.used, 300000); assert.ok(result.percent > 100); assert.equal(result.remaining, 0);
});
test('native checkpoint advancement is distinct from token drops and rewind', () => {
  assert.equal(readContext([entry(1, 100000), entry(3, 1000)], 4).checkpointChanged, false);
  const advanced = readContext([entry(1, 100000, 256000, -1), entry(3, 1000, 256000, 2)], 4);
  assert.equal(advanced.checkpointChanged, true);
  assert.equal(advanced.checkpoint, 2);
  assert.equal(advanced.previousCheckpoint, -1);
  assert.equal(readContext([entry(1), entry(3, 1000, 256000, 2)], 2).checkpointChanged, false);
});
test('empty, unavailable, malformed payloads', () => {
  assert.equal(readContext([], 0).state, 'empty');
  assert.equal(readContext([], 3).state, 'unavailable');
  assert.throws(() => readContext({}, 3)); assert.throws(() => readContext([], -1));
});
test('later steps are labelled; only top-level breakdown numeric groups survive', () => {
  const e = entry(5); e.chatModel.chatStartMetadata.contextWindowMetadata.tokenBreakdown = { groups: [{ name: 'System', numTokens: '12' }, { name: 'Bad', numTokens: -1 }] };
  const result = readContext([e], 9);
  assert.equal(result.stepsAfterSnapshot, 3); assert.deepEqual(result.breakdown, [{ name: 'System', tokens: 12 }]);
});
test('CDP URL boundary rejects remote endpoints and schemes', () => {
  assert.equal(loopbackUrl('ws://127.0.0.1:1234/devtools/page/x', ['ws:']), true);
  for (const url of ['ws://example.com', 'ws://127.0.0.1.evil.test', 'file:///tmp/x', 'https://127.0.0.1']) assert.equal(loopbackUrl(url, ['ws:']), false);
});
test('missing plannerConfig does not fall back to chatModel.model', () => {
  const row = entry(0); delete row.plannerConfig;
  assert.equal(readContext([row], 1).model, '');
});
test('string checkpointIndex values are parsed and can mark advancement', () => {
  const result = readContext([entry(1, 100000, 256000, '-1'), entry(3, 1000, 256000, '2')], 4);
  assert.equal(result.checkpoint, 2);
  assert.equal(result.checkpointChanged, true);
});
test('same-step ties: agree, disagree, one incomplete, both incomplete', () => {
  const agree = readContext([entry(1, 100, 256000), entry(1, 100, 256000)], 2);
  assert.equal(agree.state, 'ready'); assert.equal(agree.tiedRequests, 2); assert.equal(agree.used, 100);
  assert.equal(readContext([entry(1, 100), entry(1, 200)], 2).state, 'unavailable');
  const incomplete = entry(1); delete incomplete.chatModel.chatStartMetadata;
  assert.equal(readContext([incomplete, entry(1, 50)], 2).used, 50);
  const a = entry(1); delete a.chatModel.chatStartMetadata;
  const b = entry(1); delete b.chatModel.chatStartMetadata;
  assert.equal(readContext([a, b], 2).state, 'unavailable');
});
