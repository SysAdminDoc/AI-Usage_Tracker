import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { providerForLocation } from '../src/lib/provider-surface.js';

assert.equal(providerForLocation({ hostname: 'claude.ai' }), 'claude');
assert.equal(providerForLocation({ hostname: 'team.claude.ai' }), 'claude');
assert.equal(providerForLocation({ hostname: 'chatgpt.com' }), 'codex');
assert.equal(providerForLocation({ hostname: 'workspace.chatgpt.com' }), 'codex');
assert.equal(providerForLocation({ hostname: 'openai.com' }), null);
assert.equal(providerForLocation({ hostname: 'notclaude.ai' }), null);

const entry = await fs.readFile(new URL('../userscript/entry.js', import.meta.url), 'utf8');
const header = await fs.readFile(new URL('../userscript/header.txt', import.meta.url), 'utf8');
const connections = [...header.matchAll(/^\/\/ @connect\s+(.+)$/gmi)].map((match) => match[1].trim());
assert.deepEqual(connections, ['claude.ai', 'chatgpt.com']);
assert.match(entry, /const provider = providerForLocation\(location\);/);
assert.match(entry, /provider === 'claude' \? fetchClaude\(\{ now \}\) : fetchCodex\(\{ now \}\)/);
assert.doesNotMatch(entry, /Promise\.all\(\[[\s\S]*fetchClaude[\s\S]*fetchCodex/);
assert.match(entry, /userscript\.fetch-failed/);
assert.match(entry, /if \(!provider\) return state/);

console.log('userscript provider scope smoke: OK');
