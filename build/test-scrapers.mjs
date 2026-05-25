// Smoke-test parsers against the MHTML snapshots in the repo root.
// Decodes quoted-printable, extracts the HTML body, runs parseClaude / parseCodex,
// prints the normalized snapshot. Used as a once-per-PR sanity check.

import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './common.mjs';
import { parseClaude, parseClaudeUsageApi } from '../src/scrapers/claude.js';
import { fetchCodexApi, parseCodex, parseCodexUsageApi } from '../src/scrapers/codex.js';
import { collectClaudeMessageLimitsFromSseText, extractClaudeRateLimitHeaders } from '../src/lib/claude-stream.js';

async function run() {
  const claudeRaw = await fs.readFile(path.join(ROOT, 'Claude.mhtml'), 'utf8').catch(() => null);
  const codexRaw  = await fs.readFile(path.join(ROOT, 'Codex.mhtml'),  'utf8').catch(() => null);

  if (claudeRaw) {
    const html = decodeMhtmlBody(claudeRaw);
    const parsed = parseClaude(html, { now: new Date('2026-05-14T12:00:00') });
    print('Claude', parsed);
  } else {
    console.log('Claude.mhtml not found — skipping.');
  }

  if (codexRaw) {
    const html = decodeMhtmlBody(codexRaw);
    const parsed = parseCodex(html, { now: new Date('2026-05-14T12:00:00') });
    print('Codex', parsed);
  } else {
    console.log('Codex.mhtml not found — skipping.');
  }

  smokeClaudeStream();
  smokeClaudeRateLimitHeaders();
  await smokeCodexApi();
}

function decodeMhtmlBody(mhtml) {
  // MHTML is multipart MIME. We want the first text/html part decoded from
  // quoted-printable. Find headers/body delimiter for that part.
  const partMatch = /\r?\nContent-Type:\s*text\/html[\s\S]*?\r?\n\r?\n([\s\S]*?)(?=\r?\n------|$)/i.exec(mhtml);
  let body = partMatch ? partMatch[1] : mhtml;
  // Soft line breaks "=\r\n" → ""
  body = body.replace(/=\r?\n/g, '');
  // Hex escapes "=XY" → byte
  body = body.replace(/=([A-Fa-f0-9]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  return body;
}

function print(label, parsed) {
  console.log(`\n=== ${label} ===`);
  if (!parsed.ok) {
    console.log('  NOT OK:', parsed.error);
    return;
  }
  console.log(`  plan: ${parsed.plan || '(none)'}`);
  for (const b of parsed.buckets) {
    console.log(`  [${b.id}]`);
    console.log(`     label:       ${b.label}`);
    console.log(`     kind/model:  ${b.kind} / ${b.model}`);
    console.log(`     percentUsed: ${b.percentUsed.toFixed(1)}%`);
    console.log(`     resetISO:    ${b.resetISO || '(none)'}`);
    console.log(`     rawReset:    ${b.rawResetText || '(none)'}`);
  }
}

function smokeClaudeStream() {
  const now = new Date('2026-05-14T12:00:00Z');
  const sse = [
    'event: message_limit',
    'data: {"type":"message_limit","message_limit":{"windows":{"5h":{"utilization":0.223,"reset_at":"2026-05-14T17:05:00.000Z"},"seven_day":{"utilization":0.314,"reset_at":"2026-05-19T17:00:00.000Z"}}}}',
    '',
  ].join('\n');
  const limits = collectClaudeMessageLimitsFromSseText(sse);
  assert(limits.length === 1, 'Claude stream should surface one message_limit payload');

  const parsed = parseClaudeUsageApi({ message_limit: limits[0] }, { now });
  assert(parsed.ok, 'Claude streamed message_limit should parse');
  assert(nearly(findBucket(parsed, 'claude-session')?.percentUsed, 22.3), 'Claude stream session utilization stays fractional');
  assert(nearly(findBucket(parsed, 'claude-weekly-all')?.percentUsed, 31.4), 'Claude stream weekly utilization stays fractional');

  console.log('\n=== Claude Stream ===');
  console.log('  SSE message_limit payload: OK');
  console.log('  fractional utilization: OK');
}

function smokeClaudeRateLimitHeaders() {
  const now = new Date('2026-05-14T12:00:00Z');
  const headers = new Headers({
    'anthropic-ratelimit-unified-5h-utilization': '44.5',
    'anthropic-ratelimit-unified-5h-reset': '2026-05-14T17:05:00.000Z',
    'anthropic-ratelimit-unified-5h-status': 'allowed_warning',
    'anthropic-ratelimit-unified-7d-utilization': '62.25',
    'anthropic-ratelimit-unified-7d-reset': '2026-05-19T17:00:00.000Z',
  });
  const snapshot = extractClaudeRateLimitHeaders(headers);
  assert(snapshot?.windows?.['5h']?.status === 'allowed_warning', 'Claude unified header status should parse');

  const parsed = parseClaudeUsageApi({ message_limit: snapshot }, { now });
  assert(parsed.ok, 'Claude unified rate-limit headers should parse');
  assert(nearly(findBucket(parsed, 'claude-session')?.percentUsed, 44.5), 'Claude 5h header utilization maps to session bucket');
  assert(nearly(findBucket(parsed, 'claude-weekly-all')?.percentUsed, 62.25), 'Claude 7d header utilization maps to weekly bucket');

  console.log('\n=== Claude Headers ===');
  console.log('  unified rate-limit headers: OK');
}

async function smokeCodexApi() {
  const now = new Date('2026-05-14T12:00:00Z');
  const reset5h = Math.floor(new Date('2026-05-14T19:34:00Z').getTime() / 1000);
  const resetWeekly = Math.floor(new Date('2026-05-19T06:05:00Z').getTime() / 1000);

  const payload = {
    plan_type: 'pro',
    rate_limit: {
      allowed: true,
      limit_reached: false,
      primary_window: {
        used_percent: 98,
        limit_window_seconds: 18_000,
        reset_after_seconds: 0,
        reset_at: reset5h,
      },
      secondary_window: {
        used_percent: 69,
        limit_window_seconds: 604_800,
        reset_after_seconds: 0,
        reset_at: resetWeekly,
      },
    },
    additional_rate_limits: [{
      limit_name: 'gpt-5.3-codex-spark',
      metered_feature: 'gpt-5.3-codex-spark',
      rate_limit: {
        primary_window: {
          used_percent: 7,
          limit_window_seconds: 18_000,
          reset_after_seconds: 0,
          reset_at: reset5h,
        },
      },
    }],
  };

  const parsed = parseCodexUsageApi(payload, { now, accountId: 'acc_123' });
  assert(parsed.ok, 'Codex API payload should parse');
  assert(findBucket(parsed, 'codex-5h-all')?.percentUsed === 98, 'primary window maps to 5h bucket');
  assert(findBucket(parsed, 'codex-weekly-all')?.percentUsed === 69, 'secondary window maps to weekly bucket');
  assert(findBucket(parsed, 'codex-5h-gpt-5-3-codex-spark')?.percentUsed === 7, 'additional model window maps to model bucket');

  const alt = parseCodexUsageApi({
    planType: 'plus',
    five_hour_limit: { remaining_percent: 75, reset_after_seconds: 3600 },
    weekly: { used: 3, limit: 10, resetAt: '2026-05-19T06:05:00Z' },
  }, { now });
  assert(alt.ok, 'Codex alternate field-name payload should parse');
  assert(findBucket(alt, 'codex-5h-all')?.percentUsed === 25, 'five_hour_limit remaining percent normalizes');
  assert(findBucket(alt, 'codex-weekly-all')?.percentUsed === 30, 'weekly used/limit normalizes');

  const requests = [];
  const token = makeJwt({
    'https://api.openai.com/auth': {
      chatgpt_account_id: 'acc_123',
      chatgpt_plan_type: 'plus',
    },
  });
  const fetched = await fetchCodexApi({
    now,
    fetchImpl: async (url, init = {}) => {
      requests.push({ url, init });
      if (String(url).includes('/api/auth/session')) {
        return jsonResponse({ accessToken: token });
      }
      assert(init.headers.Authorization === `Bearer ${token}`, 'Codex API request sends bearer token');
      assert(init.headers['ChatGPT-Account-Id'] === 'acc_123', 'Codex API request sends account id');
      return jsonResponse(payload);
    },
  });
  assert(fetched.ok, 'fetchCodexApi should parse mocked WHAM response');

  console.log('\n=== Codex API ===');
  console.log('  primary WHAM payload: OK');
  console.log('  alternate field names: OK');
  console.log(`  auth/session + wham/usage requests: ${requests.length}`);
}

function findBucket(parsed, id) {
  return parsed.buckets.find((b) => b.id === id);
}

function nearly(actual, expected) {
  return Math.abs((actual ?? NaN) - expected) < 0.001;
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

function makeJwt(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value), 'utf8')
    .toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

run().catch((e) => { console.error(e); process.exit(1); });
