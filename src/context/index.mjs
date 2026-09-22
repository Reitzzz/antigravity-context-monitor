import fs from 'node:fs';
import { readContext } from './context_core.mjs';

const clientSource = fs.readFileSync(new URL('./widget_client.js', import.meta.url), 'utf8');
export const version = clientSource.match(/const VERSION = '([^']+)'/)?.[1];
if (!version) throw new Error('widget_client.js is missing VERSION');
export function widgetScript() {
  return `window.__agyReadContext = (${readContext.toString()});\n${clientSource}`;
}
export const injection = {
  key: 'widget', required: true, version,
  probe: `(() => {const s=window.__agyContextMonitor;return {installed:s?.version === '${version}',status:s?.status,snapshot:s?.snapshot,mounted:!!document.getElementById('agy-model-context-widget'),detail:s?.detail};})()`,
  install: widgetScript(),
  dispose: 'window.__agyContextMonitor?.dispose(); delete window.__agyReadContext;',
};
