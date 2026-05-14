// Smoke-test parsers against the MHTML snapshots in the repo root.
// Decodes quoted-printable, extracts the HTML body, runs parseClaude / parseCodex,
// prints the normalized snapshot. Used as a once-per-PR sanity check.

import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './common.mjs';
import { parseClaude } from '../src/scrapers/claude.js';
import { parseCodex } from '../src/scrapers/codex.js';

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

run().catch((e) => { console.error(e); process.exit(1); });
