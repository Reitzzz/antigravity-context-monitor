import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMeasureReport, LIMITS } from '../scripts/measure-metadata.mjs';

const row = (id, stepCount, extra = {}) => ({
  id, current: false, stepCount, entries: 1, bytes: 1000, parseMs: 1, readMs: 1,
  state: 'ready', model: 'flash', used: 10, limit: 256000, checkpoint: -1, previousCheckpoint: null, ...extra,
});

test('samples are the three longest sessions plus the current one', () => {
  const report = buildMeasureReport([
    row('current-session-aaaa', 10, { current: true, model: 'flash' }),
    row('mid-session-bbbbbbbb', 20),
    row('length-30-cccccccccc', 30),
    row('length-40-dddddddddd', 40),
    row('length-50-eeeeeeeeee', 50, { checkpoint: 4, previousCheckpoint: -1, used: 80, limit: 128000, model: 'pro' }),
  ]);
  assert.deepEqual(report.samples.map(sample => sample.stepCount), [50, 40, 30, 10]);
  assert.equal(report.samples.at(-1).current, true);
  assert.equal(report.samples[0].checkpointAdvanced, true);
  assert.equal(report.samples[0].previousCheckpoint, -1);
  assert.equal(report.samples[0].idleBytesPerMinute, 4000);
  assert.equal(JSON.stringify(report).includes('current-session-aaaa'), false);
  assert.equal(JSON.stringify(report).includes('length-50-eeeeeeeeee'), false);
});

test('item 7 trips on decoded size or parse-plus-read time, including sessions outside the printed sample', () => {
  const sized = buildMeasureReport([row('huge-body-session-aa', 1, { bytes: LIMITS.bytes })]);
  assert.equal(sized.item7, 'triggered');
  assert.equal(sized.samples[0].overLimit, true);
  const timed = buildMeasureReport([row('slow-parse-session-a', 1, { parseMs: 60, readMs: 40 })]);
  assert.equal(timed.item7, 'triggered');
  assert.equal(timed.maxParsePlusReadMs, 100);
  const under = buildMeasureReport([row('under-limit-session-a', 1, { bytes: LIMITS.bytes - 1, parseMs: 20, readMs: 79 })]);
  assert.equal(under.item7, 'not-triggered');
  const hidden = buildMeasureReport([
    row('short-but-huge-body', 1, { bytes: LIMITS.bytes }),
    row('long-a-aaaaaaaaaaaa', 10), row('long-b-bbbbbbbbbbbb', 11), row('long-c-cccccccccccc', 12),
  ]);
  assert.equal(hidden.item7, 'triggered');
  assert.equal(hidden.overLimitSessions, 1);
  assert.equal(hidden.samples.some(sample => sample.stepCount === 1), false);
  assert.equal(hidden.maxBytes, LIMITS.bytes);
});

test('a checkpoint advance outside the longest sessions is still included in the samples', () => {
  const report = buildMeasureReport([
    row('advanced-short-aaaaaa', 2, { checkpoint: 3, previousCheckpoint: 1, used: 40, limit: 80000, model: 'gpt' }),
    row('long-a-aaaaaaaaaaaa', 10), row('long-b-bbbbbbbbbbbb', 11), row('long-c-cccccccccccc', 12),
  ]);
  assert.equal(report.checkpointAdvancedSessions, 1);
  assert.equal(report.samples.some(sample => sample.stepCount === 2 && sample.checkpointAdvanced && sample.used === 40), true);
});

test('model rollup counts native windows and limits, and keeps empty or unavailable sessions out of model rows', () => {
  const report = buildMeasureReport([
    row('flash-a-aaaaaaaaaa', 5, { model: 'flash', limit: 256000 }),
    row('flash-b-bbbbbbbbbb', 4, { model: 'flash', limit: 128000 }),
    row('opus-a-aaaaaaaaaaa', 3, { model: 'opus', limit: 160000 }),
    row('none-a-aaaaaaaaaaa', 2, { state: 'unavailable', model: '', limit: null, used: null }),
    row('empty-a-aaaaaaaaaa', 0, { state: 'empty', model: '', limit: null, used: null, bytes: 0 }),
  ]);
  assert.equal(report.emptySessions, 1);
  assert.equal(report.unavailableSessions, 1);
  assert.deepEqual(report.models, [
    { model: 'flash', sessions: 2, withNativeWindow: 2, limits: [128000, 256000] },
    { model: 'opus', sessions: 1, withNativeWindow: 1, limits: [160000] },
  ]);
});
