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
import { fetchCodexApi, parseCodexDoc } from './scrapers/codex.js';
import { send } from './lib/browser.js';
import { isClaudeHost, isCodexHost } from './lib/hosts.js';

const POLL_MS = 1000;
const STABLE_REQUIRED = 2;    // consecutive identical scrapes before we ship
const CLAUDE_API_MIN_MS = 5000;
const CODEX_API_MIN_MS = 5000;

// Backpressure: debounce MutationObserver callbacks so high-churn pages
// don't trigger unlimited scrapes. After a stable success, the observer
// backs off further to avoid unnecessary work.
const MO_DEBOUNCE_MS = 500;
const MO_BACKOFF_MS = 5000;   // after stable success, wait longer between MO ticks
const MO_MAX_TICKS = 200;     // disconnect observer after this many callbacks

const provider = detectProvider();
if (provider) bootstrap();

function detectProvider() {
  const h = location.hostname;
  if (isClaudeHost(h) && /\/settings\/usage/.test(location.pathname)) return 'claude';
  if (isCodexHost(h) && /\/codex\/cloud\/settings\/analytics/.test(location.pathname)) return 'codex';
  return null;
}

function bootstrap() {
  let stableCount = 0;
  let lastHash = '';
  let inFlight = false;
  let lastClaudeApiAt = 0;
  let lastCodexApiAt = 0;
  let successCount = 0;
  let moTickCount = 0;
  let moDebounceHandle = null;

  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    let parsed;
    try {
      parsed = await scrapeProvider({
        lastClaudeApiAt,
        setLastClaudeApiAt: (ts) => { lastClaudeApiAt = ts; },
        lastCodexApiAt,
        setLastCodexApiAt: (ts) => { lastCodexApiAt = ts; },
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
      successCount++;
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
  // Debounced: batch rapid mutations into a single tick.
  const mo = new MutationObserver(() => {
    moTickCount++;

    // Safety valve: disconnect after too many callbacks to prevent runaway
    // CPU usage on high-churn pages.
    if (moTickCount >= MO_MAX_TICKS) {
      mo.disconnect();
      return;
    }

    // Pause while document is hidden (tab in background / screen off).
    if (typeof document !== 'undefined' && document.hidden) return;

    // Debounce: wait for mutations to settle before scraping.
    if (moDebounceHandle) clearTimeout(moDebounceHandle);
    const delay = successCount > 0 ? MO_BACKOFF_MS : MO_DEBOUNCE_MS;
    moDebounceHandle = setTimeout(() => {
      moDebounceHandle = null;
      tick();
    }, delay);
  });
  mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  // Pause/resume observer when page visibility changes.
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        // Clear any pending debounced tick.
        if (moDebounceHandle) {
          clearTimeout(moDebounceHandle);
          moDebounceHandle = null;
        }
      }
    });
  }
}

async function scrapeProvider({ lastClaudeApiAt, setLastClaudeApiAt, lastCodexApiAt, setLastCodexApiAt }) {
  const now = new Date();
  if (provider === 'codex') {
    const ts = Date.now();
    if (ts - lastCodexApiAt >= CODEX_API_MIN_MS) {
      setLastCodexApiAt(ts);
      const apiParsed = await fetchCodexApi({ now });
      if (apiParsed.ok) return apiParsed;
      const domParsed = parseCodexDoc(document, { now });
      return domParsed.ok ? domParsed : apiParsed;
    }
    return parseCodexDoc(document, { now });
  }

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
