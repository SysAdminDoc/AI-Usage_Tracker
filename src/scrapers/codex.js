// Codex usage scraper. Same two-mode shape as claude.js:
//   1) parseCodexDoc(document) — primary path, runs on the live DOM in a
//      content script.
//   2) parseCodex(html) / fetchCodex() — fast-path regex; falls through if
//      the page is a hydration shell.

import { parseResetString } from '../lib/countdown.js';

export const CODEX_URL = 'https://chatgpt.com/codex/cloud/settings/analytics#usage';

export async function fetchCodex({ now = new Date() } = {}) {
  try {
    const res = await fetch(CODEX_URL, { credentials: 'include' });
    if (!res.ok) return { ok: false, provider: 'codex', error: `HTTP ${res.status}` };
    const html = await res.text();
    return parseCodex(html, { now });
  } catch (err) {
    return { ok: false, provider: 'codex', error: String(err) };
  }
}

// ───── PRIMARY: live DOM ───────────────────────────────────────────────────

export function parseCodexDoc(doc, { now = new Date() } = {}) {
  if (!doc) return { ok: false, provider: 'codex', error: 'no-document' };

  const articles = doc.querySelectorAll('article');
  if (articles.length === 0) {
    return { ok: false, provider: 'codex', error: 'unhydrated' };
  }

  const buckets = [];
  for (const art of articles) {
    const labelEl = art.querySelector('header p, p');
    if (!labelEl) continue;
    const label = (labelEl.textContent || '').trim();
    if (!/usage limit/i.test(label)) continue;        // skips "Credits remaining"

    // First "<digits>%" span is the percent-remaining big number.
    let percentRemaining = null;
    for (const s of art.querySelectorAll('span')) {
      const t = (s.textContent || '').trim();
      const m = /^(\d+(?:\.\d+)?)%$/.exec(t);
      if (m) { percentRemaining = parseFloat(m[1]); break; }
    }
    if (percentRemaining == null) continue;
    const percentUsed = Math.max(0, Math.min(100, 100 - percentRemaining));

    let rawResetText = null;
    for (const s of art.querySelectorAll('span')) {
      const t = (s.textContent || '').trim();
      if (/^Resets\b/.test(t)) { rawResetText = t; break; }
    }
    const resetISO = rawResetText ? parseResetString(rawResetText, { now }) : null;

    const kind = classifyKind(label);
    const model = extractModel(label);
    buckets.push({
      label, percentUsed, resetISO, rawResetText,
      kind, model, id: `codex-${kind}-${model}`,
    });
  }

  if (buckets.length === 0) {
    return { ok: false, provider: 'codex', error: 'no-rows-rendered' };
  }
  return { ok: true, provider: 'codex', plan: null, buckets };
}

// ───── FAST PATH: raw HTML over fetch() ────────────────────────────────────

export function parseCodex(html, { now = new Date() } = {}) {
  if (!/Codex Analytics|usage limit/i.test(html)) {
    return { ok: false, provider: 'codex', error: 'shell-response' };
  }

  const buckets = [];
  const parts = html.split(/<article\b/).slice(1);
  for (const art of parts) {
    const end = art.indexOf('</article>');
    const body = end >= 0 ? art.slice(0, end) : art;

    const labelMatch = /<p[^>]*>([^<]+?)<\/p>/.exec(body);
    if (!labelMatch) continue;
    const label = labelMatch[1].trim();
    if (!/usage limit/i.test(label)) continue;

    const pctMatch = /<span[^>]*>(\d+(?:\.\d+)?)%<\/span>/.exec(body);
    if (!pctMatch) continue;
    const percentRemaining = parseFloat(pctMatch[1]);
    const percentUsed = Math.max(0, Math.min(100, 100 - percentRemaining));

    const resetMatch = /<span[^>]*>(Resets[^<]*)<\/span>/.exec(body);
    const rawResetText = resetMatch ? resetMatch[1].trim() : null;
    const resetISO = rawResetText ? parseResetString(rawResetText, { now }) : null;

    const kind = classifyKind(label);
    const model = extractModel(label);
    buckets.push({
      label, percentUsed, resetISO, rawResetText,
      kind, model, id: `codex-${kind}-${model}`,
    });
  }

  if (buckets.length === 0) {
    return { ok: false, provider: 'codex', error: 'shell-response' };
  }
  return { ok: true, provider: 'codex', plan: null, buckets };
}

function classifyKind(label) {
  if (/5\s*hour/i.test(label)) return '5h';
  if (/weekly/i.test(label))   return 'weekly';
  return 'unknown';
}

function extractModel(label) {
  const stripped = label.replace(/\s*(5\s*hour|weekly)\s*usage\s*limit/i, '').trim();
  if (!stripped) return 'all';
  return stripped.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
