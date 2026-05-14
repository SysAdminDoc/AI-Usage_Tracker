// Claude usage scraper. Two modes:
//   1) parseClaudeDoc(document)   — runs on the live rendered DOM in a
//      content script (PRIMARY PATH — both providers serve hydration shells).
//   2) parseClaude(html) / fetchClaude() — regex over raw HTML for the
//      background fast path; works only if the response is server-rendered.
// Both return the same normalized snapshot:
//   { ok, provider:'claude', plan, buckets[] }

import { parseResetString } from '../lib/countdown.js';

export const CLAUDE_URL = 'https://claude.ai/settings/usage';

export async function fetchClaude({ now = new Date() } = {}) {
  try {
    const res = await fetch(CLAUDE_URL, { credentials: 'include' });
    if (!res.ok) return { ok: false, provider: 'claude', error: `HTTP ${res.status}` };
    const html = await res.text();
    return parseClaude(html, { now });
  } catch (err) {
    return { ok: false, provider: 'claude', error: String(err) };
  }
}

// ───── PRIMARY: live DOM ───────────────────────────────────────────────────

export function parseClaudeDoc(doc, { now = new Date() } = {}) {
  if (!doc) return { ok: false, provider: 'claude', error: 'no-document' };

  // Wait-state check — the React tree may not be done hydrating yet.
  const sessionH3 = findHeadingContaining(doc, 'Plan usage limits');
  const weeklyH3  = findHeadingContaining(doc, 'Weekly limits');
  if (!sessionH3 && !weeklyH3) {
    return { ok: false, provider: 'claude', error: 'unhydrated' };
  }

  const plan = extractPlanFromHeading(sessionH3);
  const buckets = [];

  if (sessionH3) {
    const section = closestSection(sessionH3);
    for (const r of extractRowsFromSection(section, { now })) {
      buckets.push({ ...r, kind: 'session', model: 'all', id: 'claude-session' });
    }
  }
  if (weeklyH3) {
    const section = closestSection(weeklyH3);
    for (const r of extractRowsFromSection(section, { now })) {
      const model = modelSlug(r.label);
      buckets.push({ ...r, kind: 'weekly', model, id: `claude-weekly-${model}` });
    }
  }

  if (buckets.length === 0) {
    return { ok: false, provider: 'claude', error: 'no-rows-rendered' };
  }
  return { ok: true, provider: 'claude', plan, buckets };
}

function findHeadingContaining(doc, text) {
  for (const h of doc.querySelectorAll('h1, h2, h3, h4')) {
    if (h.textContent && h.textContent.includes(text)) return h;
  }
  return null;
}

function closestSection(el) {
  return el.closest('section') || el.parentElement?.parentElement || el.parentElement;
}

function extractPlanFromHeading(h3) {
  if (!h3) return null;
  // Look for a sibling/inner span that holds the plan label (e.g. "Max (20x)").
  const spans = h3.querySelectorAll('span');
  for (const span of spans) {
    const txt = (span.textContent || '').trim();
    if (!txt) continue;
    if (/Plan usage limits/.test(txt)) continue;
    if (txt.length < 40 && /\(/.test(txt)) return txt;
    if (txt.length < 40 && /\d/.test(txt) && /max|pro|free|team|enterprise/i.test(txt)) return txt;
  }
  return null;
}

function extractRowsFromSection(section, { now }) {
  if (!section) return [];
  const rows = [];
  const bars = section.querySelectorAll('[role="progressbar"]');
  for (const bar of bars) {
    const rowEl = bar.closest('div.flex.w-full')
      || bar.closest('[class*="flex-row"]')
      || bar.parentElement?.parentElement?.parentElement;
    if (!rowEl) continue;

    const labelEl = rowEl.querySelector('span.text-body.text-primary')
      || rowEl.querySelector('span.text-body')
      || rowEl.querySelector('span');
    const label = labelEl ? (labelEl.textContent || '').trim() : '';
    if (!label) continue;

    let rawResetText = null;
    for (const s of rowEl.querySelectorAll('span')) {
      const t = (s.textContent || '').trim();
      if (/^Resets\b/.test(t)) { rawResetText = t; break; }
    }
    const resetISO = rawResetText ? parseResetString(rawResetText, { now }) : null;
    const percentUsed = parseFloat(bar.getAttribute('aria-valuenow') || '0') || 0;

    rows.push({ label, percentUsed, resetISO, rawResetText });
  }
  return rows;
}

// ───── FAST PATH: raw HTML over fetch() ────────────────────────────────────

export function parseClaude(html, { now = new Date() } = {}) {
  if (!/Plan usage limits|Weekly limits/.test(html)) {
    return { ok: false, provider: 'claude', error: 'shell-response' };
  }

  // The page may be a hydration shell — the strings can appear in the JS
  // bundle without the data being rendered. We only succeed if we find at
  // least one progressbar value AND a matching label.
  const plan = extractPlanFromHtml(html);
  const sessionStart = html.indexOf('Plan usage limits');
  const weeklyStart  = html.indexOf('Weekly limits');
  const sessionHtml = sessionStart >= 0
    ? html.slice(sessionStart, weeklyStart >= 0 ? weeklyStart : html.length)
    : '';
  const weeklyHtml  = weeklyStart >= 0 ? html.slice(weeklyStart) : '';

  const buckets = [];
  for (const r of extractRowsInBlock(sessionHtml, { now })) {
    buckets.push({ ...r, kind: 'session', model: 'all', id: 'claude-session' });
  }
  for (const r of extractRowsInBlock(weeklyHtml, { now })) {
    const model = modelSlug(r.label);
    buckets.push({ ...r, kind: 'weekly', model, id: `claude-weekly-${model}` });
  }

  if (buckets.length === 0) {
    return { ok: false, provider: 'claude', error: 'shell-response' };
  }
  return { ok: true, provider: 'claude', plan, buckets };
}

function extractPlanFromHtml(html) {
  const m = /Plan usage limits[\s\S]{0,200}?<span[^>]*>([^<]{1,40})<\/span>/.exec(html);
  if (!m) return null;
  const candidate = m[1].trim();
  if (!candidate || /Plan usage limits/.test(candidate)) return null;
  return candidate;
}

function extractRowsInBlock(block, { now }) {
  if (!block) return [];
  const rows = [];
  const labelRe = /<span[^>]*text-body[^>]*text-primary[^>]*>([^<]+)<\/span>/g;
  let match;
  while ((match = labelRe.exec(block))) {
    const label = (match[1] || '').trim();
    if (!label) continue;
    const tail = block.slice(match.index, match.index + 2000);
    const resetMatch = /<span[^>]*>(Resets[^<]*)<\/span>/.exec(tail);
    const valueMatch = /aria-valuenow=\\?"(\d+(?:\.\d+)?)\\?"/.exec(tail);
    if (!valueMatch) continue;
    const rawResetText = resetMatch ? resetMatch[1].trim() : null;
    const resetISO = rawResetText ? parseResetString(rawResetText, { now }) : null;
    const percentUsed = parseFloat(valueMatch[1]);
    rows.push({ label, percentUsed, resetISO, rawResetText });
  }
  return rows;
}

function modelSlug(label) {
  if (/all models/i.test(label)) return 'all';
  if (/sonnet/i.test(label))     return 'sonnet';
  if (/opus/i.test(label))       return 'opus';
  if (/haiku/i.test(label))      return 'haiku';
  if (/design/i.test(label))     return 'design';
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
