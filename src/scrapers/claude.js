// Claude usage scraper. Targets claude.ai/settings/usage.
// Uses regex-based extraction so the same code works in a service worker
// (no DOMParser) and in a content/page script. The patterns are anchored on
// stable text and aria values, not Tailwind class hashes.

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

export function parseClaude(html, { now = new Date() } = {}) {
  if (!/Plan usage limits|Weekly limits/.test(html)) {
    return { ok: false, provider: 'claude', error: 'shell-response' };
  }

  const plan = extractPlan(html);

  // The page renders rows that each contain:
  //   - a label like "Current session" / "All models" / "Sonnet only" / "Claude Design"
  //   - a "Resets …" string
  //   - a progressbar with aria-valuenow="<integer>"
  // Section headings split session vs weekly.
  const sessionStart = html.indexOf('Plan usage limits');
  const weeklyStart  = html.indexOf('Weekly limits');
  const sessionHtml = sessionStart >= 0
    ? html.slice(sessionStart, weeklyStart >= 0 ? weeklyStart : html.length)
    : '';
  const weeklyHtml  = weeklyStart >= 0
    ? html.slice(weeklyStart)
    : '';

  const buckets = [];
  for (const r of extractRowsInBlock(sessionHtml, { now })) {
    buckets.push({ ...r, kind: 'session', model: 'all', id: 'claude-session' });
  }
  for (const r of extractRowsInBlock(weeklyHtml, { now })) {
    const model = modelSlug(r.label);
    buckets.push({ ...r, kind: 'weekly', model, id: `claude-weekly-${model}` });
  }

  return { ok: true, provider: 'claude', plan, buckets };
}

function extractPlan(html) {
  // Header shape: "Plan usage limits<…>Max (20x)<…>"
  const m = /Plan usage limits[\s\S]{0,200}?<span[^>]*>([^<]{1,40})<\/span>/.exec(html);
  if (!m) return null;
  const candidate = m[1].trim();
  if (!candidate || /Plan usage limits/.test(candidate)) return null;
  return candidate;
}

function extractRowsInBlock(block, { now }) {
  if (!block) return [];
  const rows = [];

  // Pull each label/reset/progress trio. Labels in this page sit inside
  // <span class="text-body text-primary">…</span>. The reset string is
  // any <span>Resets …</span>. The percentage lives in aria-valuenow.
  // We walk all label occurrences in order, then look forward (up to ~600
  // chars) for the matching reset and progressbar.
  const labelRe = /<span[^>]*text-body[^>]*text-primary[^>]*>([^<]+)<\/span>/g;
  let match;
  while ((match = labelRe.exec(block))) {
    const label = (match[1] || '').trim();
    if (!label) continue;
    const tail = block.slice(match.index, match.index + 2000);

    const resetMatch  = /<span[^>]*>(Resets[^<]*)<\/span>/.exec(tail);
    const valueMatch  = /aria-valuenow=\\?"(\d+(?:\.\d+)?)\\?"/.exec(tail);
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
