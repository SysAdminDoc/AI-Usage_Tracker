import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { exportMcpState } from '../src/lib/mcp-state.js';
import { VERSION } from './common.mjs';

const fixedNow = new Date('2026-08-15T00:00:00.000Z');
const state = {
  snapshot: {
    fetchedAtISO: fixedNow.toISOString(),
    providers: {
      claude: {
        ok: true,
        provider: 'claude',
        source: 'api',
        buckets: [{ id: 'claude-session', kind: 'session', model: 'all', percentUsed: 62,
          resetISO: '2026-08-15T05:00:00.000Z', metric: null }],
      },
      openrouter: {
        ok: true,
        provider: 'openrouter',
        source: 'api-key',
        range: { startISO: '2026-08-01T00:00:00.000Z', endISO: fixedNow.toISOString() },
        totals: { usageUSD: 80, totalCreditsUSD: 200 },
        buckets: [{ id: 'openrouter-key-usage', kind: 'api', model: null, percentUsed: 80,
          resetISO: '2026-09-01T00:00:00.000Z', metric: {
            kind: 'currency', costUSD: 80, costSource: 'official', limitUSD: 100, remainingUSD: 20,
          }, dimensions: { apiKeyId: 'key-secret-9012' } }],
      },
    },
  },
  settings: { apiKey: 'never-export-this' },
  history: [{ bucketId: 'secret-history', percentUsed: 99 }],
};
const exported = exportMcpState(state, { now: fixedNow });
const serialized = JSON.stringify(exported);
assert.doesNotMatch(serialized, /never-export-this|secret-history|key-secret-9012/);
assert.match(serialized, /ke…12/);

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-usage-tracker-mcp-'));
const statePath = path.join(tempDir, 'state.json');
await fs.writeFile(statePath, JSON.stringify(exported), 'utf8');
const child = spawn(process.execPath, [path.join(process.cwd(), 'mcp', 'server.mjs'), '--state', statePath], {
  cwd: process.cwd(),
  stdio: ['pipe', 'pipe', 'pipe'],
});
const lines = [];
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  lines.push(...chunk.split(/\r?\n/).filter(Boolean));
});
const nextResponse = async () => {
  while (!lines.length) await new Promise((resolve) => setTimeout(resolve, 5));
  return JSON.parse(lines.shift());
};
const request = async (id, method, params = {}) => {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return nextResponse();
};

const initialize = await request(1, 'initialize');
assert.equal(initialize.result.serverInfo.name, 'ai-usage-tracker-local');
assert.equal(initialize.result.serverInfo.version, VERSION, 'MCP server version must match the package version');
const tools = await request(2, 'tools/list');
assert.deepEqual(tools.result.tools.map((tool) => tool.name), ['get_usage', 'forecast', 'time_to_reset']);

const usage = await request(3, 'tools/call', { name: 'get_usage', arguments: { provider: 'openrouter' } });
assert.equal(usage.result.structuredContent.providers.openrouter.buckets[0].metric.costUSD, 80);
assert.doesNotMatch(usage.result.content[0].text, /key-secret-9012|never-export-this/);

const forecast = await request(4, 'tools/call', { name: 'forecast', arguments: { asOfISO: fixedNow.toISOString() } });
assert.equal(forecast.result.structuredContent.forecast.total.projectedUSD, 177.14);

const resets = await request(5, 'tools/call', { name: 'time_to_reset', arguments: { provider: 'claude', asOfISO: fixedNow.toISOString() } });
assert.equal(resets.result.structuredContent.rows[0].remainingSeconds, 18_000);

const unknown = await request(6, 'tools/call', { name: 'unknown', arguments: {} });
assert.equal(unknown.result.isError, true);
assert.match(unknown.result.content[0].text, /Unknown tool/);

child.stdin.end();
await once(child, 'close');
await fs.rm(tempDir, { recursive: true, force: true });

console.log('MCP export/server smoke: OK');
