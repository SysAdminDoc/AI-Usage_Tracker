// Analytics-page content script.
// Runs ONLY on claude.ai/settings/usage and chatgpt.com/codex/cloud/settings/*.
// Watches the rendered DOM, scrapes whenever a valid snapshot becomes
// available, sends it to the background. The background merges it into
// state, evaluates notification rules, and persists.
//
// Why a separate script: claude.ai and chatgpt.com both serve a hydration
// shell on first fetch, so the background's direct fetch() can't see the
// numbers — they materialize only after React hydrates. This script lives
// inside the rendered DOM and reads the real values.

import { fetchClaude, parseClaudeDoc } from './scrapers/claude.js';
import { parseCodexDoc } from './scrapers/codex.js';
import { send } from './lib/browser.js';

const POLL_MS = 1000;
const STABLE_REQUIRED = 2;    // consecutive identical scrapes before we ship
const CLAUDE_API_MIN_MS = 5000;

const provider = detectProvider();
if (provider) bootstrap();

function detectProvider() {
  const h = location.hostname;
  if (/(^|\.)claude\.ai$/.test(h) && /\/settings\/usage/.test(location.pathname)) return 'claude';
  if (/(^|\.)chatgpt\.com$/.test(h) && /\/codex\/cloud\/settings\/analytics/.test(location.pathname)) return 'codex';
  return null;
}

function bootstrap() {
  let stableCount = 0;
  let lastHash = '';
  let inFlight = false;
  let lastClaudeApiAt = 0;

  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    let parsed;
    try {
      parsed = await scrapeProvider({
        lastClaudeApiAt,
        setLastClaudeApiAt: (ts) => { lastClaudeApiAt = ts; },
      });
    } catch (e) {
      parsed = { ok: false, provider, error: String(e) };
    } finally {
      inFlight = false;
    }

    if (!parsed.ok) {
      stableCount = 0;
      lastHash = '';
      return;
    }
    const hash = JSON.stringify(parsed.buckets.map((b) => [b.id, b.percentUsed, b.resetISO]));
    if (hash === lastHash) {
      stableCount++;
    } else {
      stableCount = 1;
      lastHash = hash;
    }
    if (stableCount >= STABLE_REQUIRED) {
      shipSnapshot(parsed);
      stableCount = 0;   // throttle re-sends; will fire again only if values change
    }
  };

  // Poll for ~30s, then back off — once we get a stable snapshot the
  // MutationObserver re-fires when values change.
  let polls = 0;
  const interval = setInterval(() => {
    tick();
    if (++polls > 30) clearInterval(interval);
  }, POLL_MS);

  // Watch for re-renders (user toggles 7D/1M, changes group-by, etc.).
  const mo = new MutationObserver(() => {
    tick();
  });
  mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
}

async function scrapeProvider({ lastClaudeApiAt, setLastClaudeApiAt }) {
  const now = new Date();
  if (provider === 'codex') return parseCodexDoc(document, { now });

  const ts = Date.now();
  if (ts - lastClaudeApiAt >= CLAUDE_API_MIN_MS) {
    setLastClaudeApiAt(ts);
    const apiParsed = await fetchClaude({ now });
    if (apiParsed.ok) return apiParsed;
    const domParsed = parseClaudeDoc(document, { now });
    return domParsed.ok ? domParsed : apiParsed;
  }
  return parseClaudeDoc(document, { now });
}

async function shipSnapshot(parsed) {
  try {
    await send({ type: 'aut/scraped', provider: parsed.provider, parsed });
  } catch (e) {
    console.warn('[AUT] scraper failed to ship snapshot', e);
  }
}
