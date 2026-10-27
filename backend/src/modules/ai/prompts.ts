import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type PromptEntry = { file: string; version: string };
export type LoadedPrompt = { text: string; version: string };
const here = dirname(fileURLToPath(import.meta.url));
const promptDir = join(here, 'prompts');
const manifest = JSON.parse(readFileSync(join(promptDir, 'index.json'), 'utf8')) as Record<string, PromptEntry>;
const cache = new Map<string, LoadedPrompt>();

export function prompt(name: string, values: Record<string, string> = {}): LoadedPrompt {
  const entry = manifest[name];
  if (!entry) throw new Error(`UNKNOWN_PROMPT:${name}`);
  let base = cache.get(name);
  if (!base) {
    base = { text: readFileSync(join(promptDir, entry.file), 'utf8').trim(), version: entry.version };
    cache.set(name, base);
  }
  return { version: base.version, text: base.text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? '') };
}

export function promptVersion(name: string) {
  return prompt(name).version;
}
export const promptVersions = Object.fromEntries(Object.keys(manifest).map((name) => [name, manifest[name].version]));
