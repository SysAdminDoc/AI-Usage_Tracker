import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const manifest = JSON.parse(await fs.readFile(new URL('../manifests/chrome.json', import.meta.url), 'utf8'));
const html = await fs.readFile(new URL('../src/ui/sidepanel.html', import.meta.url), 'utf8');
const source = await fs.readFile(new URL('../src/ui/sidepanel.js', import.meta.url), 'utf8');
assert.equal(manifest.side_panel?.default_path, 'ui/sidepanel.html');
assert.ok(manifest.permissions.includes('sidePanel'));
assert.match(html, /id="dashboard"/);
assert.match(html, /id="sidepanelDiagnostics"/);
assert.match(html, /href="options\.html"/);
assert.match(source, /render as renderDashboard/);
assert.match(source, /lastErrorCode/);
console.log('Chrome side-panel contract smoke: OK');
