// Native-messaging bridge to QuotaGlass (https://github.com/SysAdminDoc/QuotaGlass).
//
// Forwards every successful state ingest to the QuotaGlass desktop widget
// via Chrome's chrome.runtime.connectNative API.
//
// Design constraints:
//  - Chrome MV3 service workers die after 30s idle. connectNative() is
//    supposed to provide a "strong keep-alive" but per chromium issue
//    #2688 and the 2026-01 claude-code#16350 incident, that guarantee
//    can fail in practice. We send a periodic ping (25s) to defeat the
//    timer regardless.
//  - The port can disconnect because the native host crashes, the user
//    uninstalled QuotaGlass, anti-virus killed the host EXE, or the
//    user just doesn't have QuotaGlass installed. We must reconnect
//    lazily on next push, and silently no-op if the host is absent.
//  - Disconnect handlers must NEVER let chrome.runtime.lastError throw
//    asynchronously — that would crash the background service worker.

const HOST_NAME = 'com.sysadmindoc.quotaglass';
const PING_INTERVAL_MS = 25_000;
const SCHEMA_VERSION = 2;

let port = null;
let pingHandle = null;
let connectFailedOnce = false;

function ensurePort() {
  if (port) return port;
  try {
    port = chrome.runtime.connectNative(HOST_NAME);
  } catch (e) {
    // First failure is logged informationally; subsequent failures are
    // silent so users without QuotaGlass don't see console spam.
    if (!connectFailedOnce) {
      console.info('[AUT-bridge] QuotaGlass NMH not available; bridge inactive:', e?.message || e);
      connectFailedOnce = true;
    }
    port = null;
    return null;
  }

  port.onDisconnect.addListener(() => {
    // Reading lastError suppresses the unchecked-error warning.
    const err = chrome.runtime.lastError;
    if (err) {
      // "Specified native messaging host not found" → not installed; quiet.
      if (!/not found/i.test(err.message || '')) {
        console.info('[AUT-bridge] NMH disconnected:', err.message);
      } else if (!connectFailedOnce) {
        console.info('[AUT-bridge] QuotaGlass NMH not installed; bridge inactive.');
        connectFailedOnce = true;
      }
    }
    port = null;
    stopPing();
  });

  port.onMessage.addListener((msg) => {
    if (msg && msg.ok === false) {
      console.warn('[AUT-bridge] NMH rejected:', msg.detail || '(no detail)');
    }
  });

  startPing();
  return port;
}

function startPing() {
  stopPing();
  pingHandle = setInterval(() => {
    try {
      ensurePort()?.postMessage({ kind: 'ping', ts: new Date().toISOString() });
    } catch {
      port = null;
    }
  }, PING_INTERVAL_MS);
}

function stopPing() {
  if (pingHandle) {
    clearInterval(pingHandle);
    pingHandle = null;
  }
}

/**
 * Build a minimal, redacted envelope containing only the fields
 * QuotaGlass needs to display usage status. Excludes history, raw
 * errors, org/account IDs, secrets, and full settings.
 */
function buildBridgeEnvelope(state) {
  const providers = {};
  const snapshot = state?.snapshot;
  if (snapshot?.providers) {
    for (const [key, ps] of Object.entries(snapshot.providers)) {
      if (!ps) continue;
      providers[key] = {
        ok: !!ps.ok,
        stale: !!ps.stale,
        source: ps.lastSuccessSource || ps.source || null,
        lastSuccessISO: ps.lastSuccessISO || null,
        plan: ps.plan || null,
        buckets: (ps.buckets || []).map((b) => ({
          id: b.id,
          label: b.label,
          kind: b.kind,
          model: b.model,
          percentUsed: b.percentUsed,
          resetISO: b.resetISO || null,
        })),
      };
    }
  }
  return {
    fetchedAtISO: snapshot?.fetchedAtISO || null,
    providers,
    display: {
      theme: state?.settings?.theme || 'mocha',
      thresholds: state?.settings?.thresholds || { warnAt: 50, dangerAt: 80 },
    },
  };
}

/**
 * Push a minimal, redacted state envelope to QuotaGlass. No-op when the
 * native host isn't installed. Called from background.js after a successful
 * mergeSnapshot or notification fire.
 *
 * Only provider, bucket, percent, reset, source, freshness, and display
 * settings are forwarded. History, raw errors, org/account IDs, and secrets
 * are excluded by default.
 */
export function pushSnapshot(state, extensionVersion) {
  try {
    const p = ensurePort();
    if (!p) return;
    p.postMessage({
      kind: 'snapshot',
      schemaVersion: SCHEMA_VERSION,
      ts: new Date().toISOString(),
      extensionVersion,
      state: buildBridgeEnvelope(state),
    });
  } catch (e) {
    console.info('[AUT-bridge] push failed; will retry next tick', e?.message || e);
    port = null;
  }
}

/** Tear down on extension reload / disable. */
export function disconnect() {
  stopPing();
  try { port?.disconnect(); } catch { /* swallow */ }
  port = null;
}
