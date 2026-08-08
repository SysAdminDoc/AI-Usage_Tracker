import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const {
  validateClaudeBridgeMessage,
  validateScrapedMessage,
} = await import('../src/lib/message-contract.js?message-contract');

const runtimeId = 'extension-test-id';
const now = new Date('2026-08-08T12:00:00.000Z');
const observedAtISO = now.toISOString();
const sender = (url, id = runtimeId) => ({ id, tab: { id: 42, url } });
const bucket = {
  id: 'claude-session',
  label: 'Current session',
  kind: 'session',
  model: 'all',
  percentUsed: 42,
  resetISO: '2026-08-08T17:00:00.000Z',
  rawResetText: 'Resets in 5 hours',
};

const validScraped = {
  type: 'aut/scraped',
  provider: 'claude',
  observedAtISO,
  parsed: { ok: true, provider: 'claude', plan: 'Pro', buckets: [bucket] },
};
assert.equal(validateScrapedMessage(
  validScraped,
  sender('https://claude.ai/settings/usage?tab=limits'),
  { runtimeId, now },
).ok, true);

assert.equal(validateScrapedMessage(
  validScraped,
  sender('https://claude.ai/settings/usage', 'other-extension'),
  { runtimeId, now },
).errorCode, 'message.sender.extension-id');
assert.equal(validateScrapedMessage(
  validScraped,
  sender('https://chatgpt.com/codex/cloud/settings/analytics'),
  { runtimeId, now },
).errorCode, 'message.payload.provider-mismatch');
assert.equal(validateScrapedMessage(
  { ...validScraped, provider: 'codex', parsed: { ...validScraped.parsed, provider: 'codex' } },
  sender('https://claude.ai/settings/usage'),
  { runtimeId, now },
).errorCode, 'message.payload.provider-mismatch');
assert.equal(validateScrapedMessage(
  validScraped,
  sender('https://claude.ai/settings/profile'),
  { runtimeId, now },
).errorCode, 'message.sender.analytics-url');
assert.equal(validateScrapedMessage(
  { ...validScraped, observedAtISO: '2026-08-08T11:00:00.000Z' },
  sender('https://claude.ai/settings/usage'),
  { runtimeId, now },
).errorCode, 'message.payload.observed-at-stale');
assert.equal(validateScrapedMessage(
  { ...validScraped, parsed: { ...validScraped.parsed, buckets: [{ ...bucket, percentUsed: 101 }] } },
  sender('https://claude.ai/settings/usage'),
  { runtimeId, now },
).errorCode, 'message.payload.bucket-percent');

const validStream = {
  type: 'aut/claude-message-limit',
  observedAtISO,
  messageLimit: {
    windows: {
      '5h': { utilization: 0.42, reset_at: '2026-08-08T17:00:00.000Z', status: 'allowed' },
    },
    cache_ttl_seconds: 300,
  },
};
assert.equal(validateClaudeBridgeMessage(
  validStream,
  sender('https://claude.ai/chat/abc'),
  {
    runtimeId,
    now,
    field: { messageType: 'aut/claude-message-limit', payloadKey: 'messageLimit' },
  },
).ok, true);
assert.equal(validateClaudeBridgeMessage(
  { ...validStream, messageLimit: { windows: { '5h': { utilization: 101 } } } },
  sender('https://claude.ai/chat/abc'),
  {
    runtimeId,
    now,
    field: { messageType: 'aut/claude-message-limit', payloadKey: 'messageLimit' },
  },
).errorCode, 'message.payload.window-utilization');
assert.equal(validateClaudeBridgeMessage(
  { ...validStream, type: 'aut/claude-rate-limit-headers', rateLimit: validStream.messageLimit },
  sender('https://chatgpt.com/codex/cloud/settings/analytics'),
  {
    runtimeId,
    now,
    field: { messageType: 'aut/claude-rate-limit-headers', payloadKey: 'rateLimit' },
  },
).errorCode, 'message.sender.provider-host');

const background = await fs.readFile(new URL('../src/background.js', import.meta.url), 'utf8');
const scraper = await fs.readFile(new URL('../src/analytics-scraper.js', import.meta.url), 'utf8');
const bridge = await fs.readFile(new URL('../src/page-bridge.js', import.meta.url), 'utf8');
assert.match(background, /onMessage\(async \(msg, sender\)/);
assert.match(background, /validateScrapedMessage\(msg, sender/);
assert.match(background, /validateClaudeBridgeMessage\(msg, sender/);
assert.match(background, /rejected background message/);
assert.match(scraper, /observedAtISO: new Date\(\)\.toISOString\(\)/);
assert.match(bridge, /observedAtISO,\n    \}\);/);

console.log('background message provenance smoke: OK');
