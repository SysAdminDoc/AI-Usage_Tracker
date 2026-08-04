// Single host-matrix validator used by tests and the release build. It keeps
// content matches, apex-only permissions, userscript metadata, README copy,
// and runtime predicates from drifting independently.

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOST_MATRIX, isClaudeHost, isCodexHost, isSupportedHost } from '../src/lib/hosts.js';
import { MANIFESTS, ROOT } from './common.mjs';

export async function validateHostMatrix() {
  const [chrome, firefox, header, readme, content, userscript, analytics] = await Promise.all([
    readJSON(path.join(MANIFESTS, 'chrome.json')),
    readJSON(path.join(MANIFESTS, 'firefox.json')),
    fs.readFile(path.join(ROOT, 'userscript', 'header.txt'), 'utf8'),
    fs.readFile(path.join(ROOT, 'README.md'), 'utf8'),
    fs.readFile(path.join(ROOT, 'src', 'content.js'), 'utf8'),
    fs.readFile(path.join(ROOT, 'userscript', 'entry.js'), 'utf8'),
    fs.readFile(path.join(ROOT, 'src', 'analytics-scraper.js'), 'utf8'),
  ]);

  const claude = HOST_MATRIX.claude;
  const codex = HOST_MATRIX.codex;
  const generalMatches = [...claude.matches, ...codex.matches];
  const analyticsMatches = [...claude.analyticsMatches, ...codex.analyticsMatches];
  const apexPermissions = [
    `https://${claude.apex}/*`,
    `https://${codex.apex}/*`,
  ];
  const apiPermissions = [
    'https://api.anthropic.com/*',
    'https://api.openai.com/*',
    'https://api.github.com/*',
    'https://api.cursor.com/*',
  ];

  for (const [target, manifest] of [['chrome', chrome], ['firefox', firefox]]) {
    assert.deepEqual(manifest.host_permissions, [...apexPermissions, ...apiPermissions], `${target} host permissions drifted`);
    assert.deepEqual(
      manifest.web_accessible_resources?.[0]?.matches,
      apexPermissions,
      `${target} web-accessible matches drifted`,
    );
    const scripts = manifest.content_scripts || [];
    assert.deepEqual(findMatches(scripts, 'page-interceptor.js'), claude.matches, `${target} Claude interceptor matches drifted`);
    assert.deepEqual(findMatches(scripts, 'page-bridge.js'), claude.matches, `${target} Claude page bridge matches drifted`);
    assert.deepEqual(findMatches(scripts, 'content.js'), generalMatches, `${target} content matches drifted`);
    assert.deepEqual(findMatches(scripts, 'analytics-scraper.js'), analyticsMatches, `${target} analytics matches drifted`);
  }

  assert.deepEqual(metadataValues(header, 'match'), generalMatches, 'userscript @match entries drifted');
  assert.deepEqual(metadataValues(header, 'connect'), [
    claude.connect,
    codex.connect,
    'api.anthropic.com',
    'api.openai.com',
  ], 'userscript @connect entries drifted');
  for (const host of [claude.apex, codex.apex]) {
    assert.match(readme, new RegExp(host.replace('.', '\\.'), 'i'), `README must name ${host}`);
  }
  assert.doesNotMatch(readme, /https?:\/\/(?:www\.)?openai\.com/i, 'README must not advertise an unsupported openai.com host');

  assert.match(content, /isSupportedHost\(location\.hostname\)/, 'content runtime must use the canonical supported-host predicate');
  assert.match(userscript, /isSupportedHost\(location\.hostname\)/, 'userscript runtime must use the canonical supported-host predicate');
  assert.doesNotMatch(content, /openai\.com/i, 'content runtime must not retain an unsupported openai.com predicate');
  assert.doesNotMatch(userscript, /openai\.com/i, 'userscript runtime must not retain an unsupported openai.com predicate');
  assert.match(analytics, /isClaudeHost\(h\).*isCodexHost\(h\)/s, 'analytics runtime must use canonical provider predicates');

  assert.equal(isSupportedHost('claude.ai'), true);
  assert.equal(isSupportedHost('subdomain.claude.ai'), true);
  assert.equal(isSupportedHost('CHATGPT.COM.'), true);
  assert.equal(isClaudeHost('notclaude.ai'), false);
  assert.equal(isCodexHost('openai.com'), false);
  assert.equal(isSupportedHost('openai.com'), false);
}

function findMatches(scripts, filename) {
  return scripts.find((script) => script.js?.includes(filename))?.matches || [];
}

function metadataValues(text, key) {
  return [...text.matchAll(new RegExp(`^// @${key}\\s+(.+)$`, 'gmi'))]
    .map((match) => match[1].trim());
}

async function readJSON(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await validateHostMatrix();
  console.log('host matrix validation: OK');
}
