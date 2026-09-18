import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { widgetScript, version, discoverPort, resolveProfile } from '../src/watch_context_widget.mjs';

test('widget version is sourced from the client script', () => {
  assert.equal(widgetScript().includes(`const VERSION = '${version}'`), true);
});

test('discoverPort reads the first line, rejects junk, prefers explicit', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-port-'));
  try {
    fs.writeFileSync(path.join(dir, 'DevToolsActivePort'), '9333\n/devtools');
    assert.equal(discoverPort(dir), 9333);
    fs.writeFileSync(path.join(dir, 'DevToolsActivePort'), 'nope');
    assert.throws(() => discoverPort(dir));
    fs.writeFileSync(path.join(dir, 'DevToolsActivePort'), '99999');
    assert.throws(() => discoverPort(dir));
    assert.equal(discoverPort(dir, '9222'), 9222);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('resolveProfile rejects relative paths', () => {
  assert.throws(() => resolveProfile('relative/path'));
  assert.equal(resolveProfile(path.resolve('/abs-profile')), path.resolve('/abs-profile'));
});
