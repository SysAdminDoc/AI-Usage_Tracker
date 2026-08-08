// Smoke-test parsers against the MHTML snapshots in the repo root.
// Decodes quoted-printable, extracts the HTML body, runs parseClaude / parseCodex,
// prints the normalized snapshot. Used as a once-per-PR sanity check.

import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './common.mjs';
import {
  clearClaudeOrgCache,
  fetchClaudeApi,
  getClaudeOrgId,
  parseClaude,
  parseClaudeDoc,
  parseClaudeUsageApi,
} from '../src/scrapers/claude.js';
import {
  fetchCodexApi,
  getChatGptAuthContext,
  parseCodex,
  parseCodexDoc,
  parseCodexUsageApi,
} from '../src/scrapers/codex.js';
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
  await smokeProviderContractMatrix();
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

async function smokeProviderContractMatrix() {
  const now = new Date('2026-05-14T12:00:00Z');

  // Renamed fields and alternate nesting are kept as named fixtures so a
  // provider schema change points to the affected contract row.
  const claudeFixture = {
    organization: { tier: 'team' },
    usage: {
      windows: {
        fiveHour: { utilization: 0.125, resetAt: '2026-05-14T17:00:00Z' },
        sevenDay: { remaining: 60, maximum: 100, reset_time: '2026-05-19T17:00:00Z' },
      },
    },
  };
  const claudeApi = parseClaudeUsageApi(claudeFixture, { now, orgId: 'org_fixture' });
  assert(claudeApi.ok, 'Claude renamed-field fixture should parse');
  assert(nearly(findBucket(claudeApi, 'claude-session')?.percentUsed, 12.5), 'Claude utilization alias should remain fractional');
  assert(nearly(findBucket(claudeApi, 'claude-weekly-all')?.percentUsed, 40), 'Claude remaining/max aliases should normalize');

  clearClaudeOrgCache();
  const claudeRequests = [];
  const fetchedClaude = await fetchClaudeApi({
    now,
    fetchImpl: async (url) => {
      claudeRequests.push(String(url));
      if (String(url) === 'https://claude.ai/api/organizations') {
        return jsonResponse({ organizations: [{ id: 'org_fixture', is_default: true }] });
      }
      return jsonResponse(claudeFixture);
    },
  });
  assert(fetchedClaude.ok, 'Claude API fixture should pass through org and usage fetches');
  assertEqual(fetchedClaude.orgId, 'org_fixture', 'Claude account fixture should preserve org id');
  assertEqual(claudeRequests.length, 2, 'Claude API fixture should make org and usage requests');

  clearClaudeOrgCache();
  const missingClaude = await getClaudeOrgId({ fetchImpl: async () => jsonResponse([]) });
  assertError(missingClaude, 'claude.account.missing', 'Claude missing-account fixture should classify the failure');
  assertError(parseClaudeUsageApi({}, { now }), 'claude.api.schema-unsupported', 'Claude empty API fixture should classify the failure');

  const codexFixture = {
    usage: {
      rateLimit: {
        primaryWindow: { percentUsed: 12, resetAfter: 3600 },
        secondaryWindow: { remainingPercent: 75, resetAt: '2026-05-19T06:05:00Z' },
      },
    },
  };
  const codexApi = parseCodexUsageApi(codexFixture, { now });
  assert(codexApi.ok, 'Codex renamed-field fixture should parse');
  assertEqual(findBucket(codexApi, 'codex-5h-all')?.percentUsed, 12, 'Codex percentUsed alias should parse');
  assertEqual(findBucket(codexApi, 'codex-weekly-all')?.percentUsed, 25, 'Codex remainingPercent alias should normalize');
  assertError(parseCodexUsageApi({}, { now }), 'codex.api.schema-unsupported', 'Codex empty API fixture should classify the failure');

  const missingCodex = await getChatGptAuthContext({ fetchImpl: async () => jsonResponse({ accountId: 'acc_fixture' }) });
  assertError(missingCodex, 'codex.auth.missing-token', 'Codex missing-auth fixture should classify the failure');

  const claudeHtml = [
    '<h2>Plan usage limits <span>Max (20x)</span></h2>',
    '<span class="text-body text-primary">Current session</span><div role="progressbar" aria-valuenow="42"></div><span>Resets in 1 hr</span>',
    '<h2>Weekly limits</h2>',
    '<span class="text-body text-primary">Sonnet only</span><div role="progressbar" aria-valuenow="18"></div><span>Resets Tue 1:00 PM</span>',
  ].join('');
  const parsedClaudeHtml = parseClaude(claudeHtml, { now });
  assert(parsedClaudeHtml.ok && parsedClaudeHtml.buckets.length === 2, 'Claude raw HTML fixture should render both rows');
  assertEqual(findBucket(parsedClaudeHtml, 'claude-session')?.percentUsed, 42, 'Claude raw HTML session should parse');
  assertError(parseClaude('<main>hydration shell</main>', { now }), 'claude.html.shell', 'Claude shell fixture should classify the failure');

  const codexHtml = [
    '<div>Codex Analytics</div>',
    '<article><header><p>5 hour usage limit</p></header><span>25%</span><span>Resets in 1 hr</span></article>',
    '<article><header><p>Weekly usage limit</p></header><span>60%</span><span>Resets Tue 1:00 PM</span></article>',
  ].join('');
  const parsedCodexHtml = parseCodex(codexHtml, { now });
  assert(parsedCodexHtml.ok && parsedCodexHtml.buckets.length === 2, 'Codex raw HTML fixture should render both rows');
  assertEqual(findBucket(parsedCodexHtml, 'codex-5h-all')?.percentUsed, 75, 'Codex raw HTML remaining percent should normalize');
  assertError(parseCodex('<main>hydration shell</main>', { now }), 'codex.html.shell', 'Codex shell fixture should classify the failure');

  const claudeDom = makeClaudeDocument();
  const parsedClaudeDom = parseClaudeDoc(claudeDom, { now });
  assert(parsedClaudeDom.ok && parsedClaudeDom.buckets.length === 2, 'Claude DOM fixture should render both rows');
  assertEqual(findBucket(parsedClaudeDom, 'claude-weekly-sonnet')?.percentUsed, 18, 'Claude DOM weekly row should parse');
  assertError(parseClaudeDoc(null, { now }), 'claude.dom.no-document', 'Claude missing DOM fixture should classify the failure');
  assertError(parseClaudeDoc({ querySelectorAll: () => [] }, { now }), 'claude.dom.unhydrated', 'Claude unhydrated DOM fixture should classify the failure');

  const codexDom = makeCodexDocument();
  const parsedCodexDom = parseCodexDoc(codexDom, { now });
  assert(parsedCodexDom.ok && parsedCodexDom.buckets.length === 1, 'Codex DOM fixture should render the usage row');
  assertEqual(findBucket(parsedCodexDom, 'codex-5h-all')?.percentUsed, 55, 'Codex DOM remaining percent should normalize');
  assertError(parseCodexDoc(null, { now }), 'codex.dom.no-document', 'Codex missing DOM fixture should classify the failure');
  assertError(parseCodexDoc({ querySelectorAll: () => [] }, { now }), 'codex.dom.unhydrated', 'Codex unhydrated DOM fixture should classify the failure');

  console.log('\n=== Provider Contract Matrix ===');
  console.log('  API aliases, auth/account failures, DOM, raw HTML, and diagnostics: OK');
}

function assertError(result, errorCode, message) {
  assert(!result.ok, message);
  assertEqual(result.errorCode, errorCode, message);
  assertEqual(result.provider, errorCode.split('.')[0], `${message} should retain provider identity`);
}

function makeClaudeDocument() {
  const sessionLabel = { textContent: 'Current session' };
  const sessionReset = { textContent: 'Resets in 1 hr' };
  const sessionRow = makeRow(sessionLabel, sessionReset);
  const sessionBar = makeBar('42', sessionRow);
  const sessionSection = makeSection([sessionBar]);
  const sessionHeading = makeHeading('Plan usage limits', 'Max (20x)', sessionSection);

  const weeklyLabel = { textContent: 'Sonnet only' };
  const weeklyReset = { textContent: 'Resets Tue 1:00 PM' };
  const weeklyRow = makeRow(weeklyLabel, weeklyReset);
  const weeklyBar = makeBar('18', weeklyRow);
  const weeklySection = makeSection([weeklyBar]);
  const weeklyHeading = makeHeading('Weekly limits', null, weeklySection);

  return {
    querySelectorAll(selector) {
      return selector === 'h1, h2, h3, h4' ? [sessionHeading, weeklyHeading] : [];
    },
  };
}

function makeHeading(text, plan, section) {
  return {
    textContent: text,
    querySelectorAll(selector) {
      return selector === 'span' && plan ? [{ textContent: plan }] : [];
    },
    closest() { return section; },
  };
}

function makeSection(bars) {
  return { querySelectorAll(selector) { return selector === '[role="progressbar"]' ? bars : []; } };
}

function makeRow(label, reset) {
  return {
    querySelector() { return label; },
    querySelectorAll(selector) { return selector === 'span' ? [label, reset] : []; },
  };
}

function makeBar(value, row) {
  return {
    closest() { return row; },
    getAttribute(name) { return name === 'aria-valuenow' ? value : null; },
  };
}

function makeCodexDocument() {
  const label = { textContent: '5 hour usage limit' };
  const percent = { textContent: '45%' };
  const reset = { textContent: 'Resets in 1 hr' };
  const article = {
    querySelector() { return label; },
    querySelectorAll(selector) { return selector === 'span' ? [percent, reset] : []; },
  };
  return { querySelectorAll(selector) { return selector === 'article' ? [article] : []; } };
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

function assertEqual(actual, expected, message) {
  assert(Object.is(actual, expected), `${message} (expected ${expected}, got ${actual})`);
}

run().catch((e) => { console.error(e); process.exit(1); });
