// Analytics-page content script.
// Runs ONLY on claude.ai/settings/usage and chatgpt.com/codex/cloud/settings/*.
// Watches the rendered DOM, scrapes whenever a valid snapshot becomes
// available, sends it to the background. The lifecycle controller below keeps
// that work recoverable across hidden tabs, SPA navigation, and high-churn DOM
// updates.

import { fetchClaudeApi, parseClaudeDoc } from './scrapers/claude.js';
import { fetchCodexApi, parseCodexDoc } from './scrapers/codex.js';
import { send } from './lib/browser.js';
import { isClaudeHost, isCodexHost } from './lib/hosts.js';

const POLL_MS = 1000;
const POLL_WARMUP_TICKS = 30;
const POLL_BACKOFF_MS = 10_000;
const STABLE_REQUIRED = 2;
const CLAUDE_API_MIN_MS = 5000;
const CODEX_API_MIN_MS = 5000;
const MO_DEBOUNCE_MS = 500;
const MO_BACKOFF_MS = 5000;
const MO_BACKPRESSURE_WINDOW_MS = 10_000;
const MO_BACKPRESSURE_MAX_TICKS = 60;
const MO_BACKPRESSURE_COOLDOWN_MS = 10_000;

const providerAtLoad = detectProvider();
if (providerAtLoad) bootstrap(providerAtLoad);

export function detectProvider(locationLike = globalThis.location) {
  const h = String(locationLike?.hostname || '').toLowerCase();
  const pathname = String(locationLike?.pathname || '');
  if (isClaudeHost(h) && /\/settings\/usage/.test(pathname)) return 'claude';
  if (isCodexHost(h) && /\/codex\/cloud\/settings\/analytics/.test(pathname)) return 'codex';
  return null;
}

function routeSignature(locationLike) {
  if (!locationLike) return '';
  return [locationLike.hostname, locationLike.pathname, locationLike.search, locationLike.hash].join('|');
}

function bootstrap(initialProvider) {
  const controller = createAnalyticsScraperController({
    provider: initialProvider,
    providerResolver: () => detectProvider(),
  });
  controller.start();
  return controller;
}

export function createAnalyticsScraperController({
  provider = null,
  providerResolver = null,
  document: documentLike = globalThis.document,
  window: windowLike = documentLike?.defaultView || globalThis.window || globalThis,
  sendImpl = send,
  scrapeImpl = scrapeProvider,
  observerFactory = null,
  abortControllerFactory = null,
  nowImpl = () => Date.now(),
  setTimeoutImpl = globalThis.setTimeout?.bind(globalThis),
  clearTimeoutImpl = globalThis.clearTimeout?.bind(globalThis),
  setIntervalImpl = globalThis.setInterval?.bind(globalThis),
  clearIntervalImpl = globalThis.clearInterval?.bind(globalThis),
  pollMs = POLL_MS,
  pollWarmupTicks = POLL_WARMUP_TICKS,
  pollBackoffMs = POLL_BACKOFF_MS,
  mutationWindowMs = MO_BACKPRESSURE_WINDOW_MS,
  mutationMaxTicks = MO_BACKPRESSURE_MAX_TICKS,
  backpressureCooldownMs = MO_BACKPRESSURE_COOLDOWN_MS,
  mutationDebounceMs = MO_DEBOUNCE_MS,
  mutationBackoffMs = MO_BACKOFF_MS,
} = {}) {
  const doc = documentLike;
  const win = windowLike;
  const getLocation = () => (typeof globalThis.location === 'object' && globalThis.location
    && !providerResolver && !documentLike?.location ? globalThis.location : documentLike?.location || globalThis.location);
  const resolveProvider = providerResolver || (() => detectProvider(getLocation()));
  const makeObserver = observerFactory || ((callback) => (
    typeof MutationObserver === 'function' ? new MutationObserver(callback) : null
  ));
  const makeAbortController = abortControllerFactory || (() => (
    typeof AbortController === 'function' ? new AbortController() : null
  ));
  const setTimeoutSafe = typeof setTimeoutImpl === 'function' ? setTimeoutImpl : (fn) => fn();
  const clearTimeoutSafe = typeof clearTimeoutImpl === 'function' ? clearTimeoutImpl : () => {};
  const setIntervalSafe = typeof setIntervalImpl === 'function' ? setIntervalImpl : () => null;
  const clearIntervalSafe = typeof clearIntervalImpl === 'function' ? clearIntervalImpl : () => {};

  let running = false;
  let activeProvider = provider || resolveProvider();
  let lastRoute = routeSignature(getLocation());
  let currentRun = null;
  let historyPatches = [];
  const listeners = [];

  function addListener(target, type, handler) {
    if (!target?.addEventListener) return;
    target.addEventListener(type, handler);
    listeners.push(() => target.removeEventListener?.(type, handler));
  }

  function stopWork() {
    const run = currentRun;
    currentRun = null;
    if (!run) return;
    run.active = false;
    run.controller?.abort?.();
    if (run.observer) run.observer.disconnect?.();
    clearTimeoutSafe(run.debounceTimer);
    clearTimeoutSafe(run.recoveryTimer);
    clearTimeoutSafe(run.initialTimer);
    clearIntervalSafe(run.pollTimer);
    clearIntervalSafe(run.backoffPollTimer);
    run.debounceTimer = null;
    run.recoveryTimer = null;
    run.initialTimer = null;
    run.pollTimer = null;
    run.backoffPollTimer = null;
  }

  function isCurrentRun(run) {
    return running && currentRun === run && run.active && !doc?.hidden;
  }

  function resetMutationWindow(run, now) {
    if (now - run.mutationWindowStart >= mutationWindowMs) {
      run.mutationWindowStart = now;
      run.mutationTicks = 0;
    }
  }

  function scheduleMutation(run) {
    if (!isCurrentRun(run) || run.backpressure) return;
    clearTimeoutSafe(run.debounceTimer);
    const delay = run.successCount > 0 ? mutationBackoffMs : mutationDebounceMs;
    run.debounceTimer = setTimeoutSafe(() => {
      run.debounceTimer = null;
      void tick(run);
    }, delay);
  }

  function attachObserver(run) {
    if (!isCurrentRun(run) || run.observer || !doc?.documentElement) return;
    const observer = makeObserver(() => {
      if (!isCurrentRun(run) || run.backpressure) return;
      const now = nowImpl();
      resetMutationWindow(run, now);
      run.mutationTicks++;
      if (run.mutationTicks > mutationMaxTicks) {
        run.backpressure = true;
        run.backpressureUntil = now + backpressureCooldownMs;
        observer.disconnect?.();
        run.observer = null;
        clearTimeoutSafe(run.debounceTimer);
        run.debounceTimer = null;
        run.recoveryTimer = setTimeoutSafe(() => {
          run.recoveryTimer = null;
          if (!isCurrentRun(run)) return;
          run.backpressure = false;
          run.mutationWindowStart = nowImpl();
          run.mutationTicks = 0;
          attachObserver(run);
          void tick(run);
        }, backpressureCooldownMs);
        return;
      }
      scheduleMutation(run);
    });
    if (!observer?.observe) return;
    run.observer = observer;
    observer.observe(doc.documentElement, { childList: true, subtree: true, characterData: true });
  }

  async function tick(run) {
    if (!isCurrentRun(run) || run.inFlight) return;
    run.inFlight = true;
    const signal = run.controller?.signal || null;
    let parsed;
    try {
      parsed = await scrapeImpl({
        provider: run.provider,
        signal,
        lastClaudeApiAt: run.lastClaudeApiAt,
        setLastClaudeApiAt: (ts) => { run.lastClaudeApiAt = ts; },
        lastCodexApiAt: run.lastCodexApiAt,
        setLastCodexApiAt: (ts) => { run.lastCodexApiAt = ts; },
      });
    } catch (error) {
      parsed = { ok: false, provider: run.provider, error: String(error), errorCode: 'scraper.tick-failed' };
    } finally {
      run.inFlight = false;
    }

    if (!isCurrentRun(run) || signal?.aborted) return;
    if (!parsed?.ok) {
      run.stableCount = 0;
      run.lastHash = '';
      return;
    }
    const hash = JSON.stringify((parsed.buckets || []).map((bucket) => [bucket.id, bucket.percentUsed, bucket.resetISO]));
    if (hash === run.lastHash) run.stableCount++;
    else {
      run.stableCount = 1;
      run.lastHash = hash;
    }
    if (run.stableCount >= STABLE_REQUIRED) {
      run.stableCount = 0;
      run.successCount++;
      void shipSnapshot(parsed, { sendImpl, signal, isCurrent: () => isCurrentRun(run) });
    }
  }

  function startWork({ immediate = true } = {}) {
    if (!running || !activeProvider || doc?.hidden) return;
    stopWork();
    const run = {
      provider: activeProvider,
      active: true,
      inFlight: false,
      controller: makeAbortController(),
      observer: null,
      debounceTimer: null,
      recoveryTimer: null,
      initialTimer: null,
      pollTimer: null,
      backoffPollTimer: null,
      pollCount: 0,
      stableCount: 0,
      lastHash: '',
      successCount: 0,
      lastClaudeApiAt: 0,
      lastCodexApiAt: 0,
      mutationWindowStart: nowImpl(),
      mutationTicks: 0,
      backpressure: false,
      backpressureUntil: 0,
    };
    currentRun = run;
    attachObserver(run);
    run.pollTimer = setIntervalSafe(() => {
      if (!isCurrentRun(run)) return;
      run.pollCount++;
      void tick(run);
      if (run.pollCount >= pollWarmupTicks) {
        clearIntervalSafe(run.pollTimer);
        run.pollTimer = null;
        run.backoffPollTimer = setIntervalSafe(() => void tick(run), pollBackoffMs);
      }
    }, pollMs);
    if (immediate) {
      run.initialTimer = setTimeoutSafe(() => {
        run.initialTimer = null;
        void tick(run);
      }, 0);
    }
  }

  function refreshRoute({ force = false } = {}) {
    if (!running) return;
    const locationLike = getLocation();
    const nextProvider = resolveProvider(locationLike);
    const nextRoute = routeSignature(locationLike);
    const changed = force || nextProvider !== activeProvider || nextRoute !== lastRoute;
    if (!changed) {
      if (!currentRun && nextProvider && !doc?.hidden) startWork();
      return;
    }
    lastRoute = nextRoute;
    activeProvider = nextProvider;
    stopWork();
    if (activeProvider && !doc?.hidden) startWork();
  }

  function handleVisibility() {
    if (!running) return;
    if (doc?.hidden) stopWork();
    else refreshRoute({ force: true });
  }

  function installLifecycleListeners() {
    addListener(doc, 'visibilitychange', handleVisibility);
    const routeChange = () => refreshRoute({ force: true });
    addListener(win, 'popstate', routeChange);
    addListener(win, 'hashchange', routeChange);

    const history = win?.history;
    for (const method of ['pushState', 'replaceState']) {
      const original = history?.[method];
      if (typeof original !== 'function') continue;
      const wrapped = function wrappedHistoryMethod(...args) {
        const result = original.apply(this, args);
        refreshRoute({ force: true });
        return result;
      };
      try {
        history[method] = wrapped;
        historyPatches.push(() => {
          if (history[method] === wrapped) history[method] = original;
        });
      } catch { /* history may be immutable in an embedded document */ }
    }
  }

  function uninstallLifecycleListeners() {
    while (listeners.length) listeners.pop()();
    while (historyPatches.length) historyPatches.pop()();
  }

  function start() {
    if (running) return controller;
    running = true;
    installLifecycleListeners();
    refreshRoute({ force: true });
    return controller;
  }

  function stop() {
    if (!running) return;
    running = false;
    stopWork();
    activeProvider = null;
    uninstallLifecycleListeners();
  }

  function pause() {
    if (running) stopWork();
  }

  function resume() {
    if (running) refreshRoute({ force: true });
  }

  const controller = {
    start,
    stop,
    pause,
    resume,
    refreshRoute,
    getState() {
      return {
        running,
        activeProvider,
        workActive: !!currentRun,
        inFlight: currentRun?.inFlight === true,
        backpressure: currentRun?.backpressure === true,
        observerAttached: !!currentRun?.observer,
        pollCount: currentRun?.pollCount || 0,
      };
    },
  };
  return controller;
}

export async function scrapeProvider({
  provider,
  signal = null,
  lastClaudeApiAt,
  setLastClaudeApiAt,
  lastCodexApiAt,
  setLastCodexApiAt,
  now = new Date(),
} = {}) {
  if (signal?.aborted) return { ok: false, provider, errorCode: 'scraper.aborted', error: 'aborted' };
  const doc = globalThis.document;
  if (provider === 'codex') {
    const ts = Date.now();
    if (ts - lastCodexApiAt >= CODEX_API_MIN_MS) {
      setLastCodexApiAt?.(ts);
      const apiParsed = await fetchCodexApi({ now, signal });
      if (signal?.aborted) return { ok: false, provider, errorCode: 'scraper.aborted', error: 'aborted' };
      const domParsed = parseCodexDoc(doc, { now });
      return domParsed.ok ? domParsed : apiParsed;
    }
    return parseCodexDoc(doc, { now });
  }

  const ts = Date.now();
  if (ts - lastClaudeApiAt >= CLAUDE_API_MIN_MS) {
    setLastClaudeApiAt?.(ts);
    const apiParsed = await fetchClaudeApi({ now, signal });
    if (signal?.aborted) return { ok: false, provider, errorCode: 'scraper.aborted', error: 'aborted' };
    const domParsed = parseClaudeDoc(doc, { now });
    return domParsed.ok ? domParsed : apiParsed;
  }
  return parseClaudeDoc(doc, { now });
}

async function shipSnapshot(parsed, { sendImpl, signal, isCurrent }) {
  if (signal?.aborted || !isCurrent()) return;
  try {
    await sendImpl({
      type: 'aut/scraped',
      provider: parsed.provider,
      parsed,
      observedAtISO: new Date().toISOString(),
    });
  } catch (error) {
    if (!signal?.aborted) console.warn('[AUT] scraper failed to ship snapshot', error);
  }
}
