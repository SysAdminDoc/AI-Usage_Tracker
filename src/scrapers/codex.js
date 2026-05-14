// Codex usage scraper. Targets chatgpt.com/codex/cloud/settings/analytics#usage.
// Regex-based so it runs in service workers, content scripts, and userscripts.

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

export function parseCodex(html, { now = new Date() } = {}) {
  if (!/Codex Analytics|usage limit/i.test(html)) {
    return { ok: false, provider: 'codex', error: 'shell-response' };
  }

  const buckets = [];
  // Split on <article tags so we can scope each bucket card.
  // Keep the delimiter via lookahead-friendly split.
  const articles = html.split(/<article\b/).slice(1);
  for (const art of articles) {
    // Stop at the matching </article> for our slice (approximate).
    const end = art.indexOf('</article>');
    const body = end >= 0 ? art.slice(0, end) : art;

    // Label: first <p ...>… usage limit</p>.
    const labelMatch = /<p[^>]*>([^<]+?)<\/p>/.exec(body);
    if (!labelMatch) continue;
    const label = labelMatch[1].trim();
    if (!/usage limit/i.test(label)) continue;        // skips "Credits remaining"

    // Percent remaining: first standalone "<N>%" span — text-2xl font-semibold.
    const pctMatch = /<span[^>]*>(\d+(?:\.\d+)?)%<\/span>/.exec(body);
    if (!pctMatch) continue;
    const percentRemaining = parseFloat(pctMatch[1]);
    const percentUsed = Math.max(0, Math.min(100, 100 - percentRemaining));

    // Reset string (may be absent for sub-buckets).
    const resetMatch = /<span[^>]*>(Resets[^<]*)<\/span>/.exec(body);
    const rawResetText = resetMatch ? resetMatch[1].trim() : null;
    const resetISO = rawResetText ? parseResetString(rawResetText, { now }) : null;

    const kind = classifyKind(label);
    const model = extractModel(label);
    buckets.push({
      label,
      percentUsed,
      resetISO,
      rawResetText,
      kind,
      model,
      id: `codex-${kind}-${model}`,
    });
  }

  return { ok: true, provider: 'codex', plan: null, buckets };
}

function classifyKind(label) {
  if (/5\s*hour/i.test(label)) return '5h';
  if (/weekly/i.test(label))   return 'weekly';
  return 'unknown';
}

function extractModel(label) {
  // "5 hour usage limit"               → all
  // "Weekly usage limit"               → all
  // "GPT-5.3-Codex-Spark 5 hour limit" → gpt-5-3-codex-spark
  const stripped = label.replace(/\s*(5\s*hour|weekly)\s*usage\s*limit/i, '').trim();
  if (!stripped) return 'all';
  return stripped.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
