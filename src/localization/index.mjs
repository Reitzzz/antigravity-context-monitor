import fs from 'node:fs';
import { createHash } from 'node:crypto';

const directory = new URL('./dicts/', import.meta.url);
const dictionary = Object.create(null);
for (const filename of fs.readdirSync(directory).filter(name => name.endsWith('.json') && name !== 'phrases.json').sort()) {
  const entries = JSON.parse(fs.readFileSync(new URL(filename, directory), 'utf8'));
  for (const [key, value] of Object.entries(entries)) {
    if (typeof value !== 'string') throw new Error(`Invalid translation in ${filename}: ${key}`);
    const normalized = key.replace(/\s+/g, ' ').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').trim();
    if (normalized) dictionary[normalized] = value;
  }
}
const source = fs.readFileSync(new URL('./localization_client.js', import.meta.url), 'utf8')
  .replace('DICT_PLACEHOLDER', () => JSON.stringify(dictionary))
  // Keep in-page title handling; do not read the user's conversation database.
  .replace('CONV_TITLES_PLACEHOLDER', '{}')
  .replace('PHRASES_PLACEHOLDER', () => fs.readFileSync(new URL('./dicts/phrases.json', import.meta.url), 'utf8'))
  .replace('TITLE_WORDS_PLACEHOLDER', () => fs.readFileSync(new URL('./data/title_words.json', import.meta.url), 'utf8'))
  .replace('STEM_SUFFIXES_PLACEHOLDER', () => fs.readFileSync(new URL('./data/stem_suffixes.json', import.meta.url), 'utf8'));
export const version = createHash('sha256').update(source).digest('hex').slice(0, 16);
export function localizationScript() {
  return `${source}\nwindow.__ag_hanhua_engine__.version = ${JSON.stringify(version)};`;
}
export const injection = {
  key: 'localization', required: false, version,
  probe: `({installed: window.__ag_hanhua_engine__?.version === '${version}'})`,
  install: localizationScript(),
  dispose: 'window.__ag_hanhua_engine__?.disconnect(); delete window.__ag_hanhua_engine__;',
};
