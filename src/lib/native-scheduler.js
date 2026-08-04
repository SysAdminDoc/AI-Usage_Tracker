// Optional native-messaging scheduler companion.
//
// This channel is deliberately separate from the QuotaGlass snapshot bridge.
// It sends only scheduling metadata (refresh cadence and the next notification
// deadline), never provider state, history, credentials, prompts, or account
// identifiers. The default extension packages do not request nativeMessaging;
// the bridge build adds that permission for users who explicitly install and
// enable the helper.

export const NATIVE_SCHEDULER_HOST = 'com.sysadmindoc.ai_usage_tracker.scheduler';
export const NATIVE_SCHEDULER_SCHEMA_VERSION = 1;

const MIN_REFRESH_MINUTES = 1;
const MAX_REFRESH_MINUTES = 1440;
const PING_INTERVAL_MS = 25_000;

let port = null;
let pingHandle = null;
let wakeHandler = null;
let connectionFailureLogged = false;
let currentConfig = {
  enabled: false,
  refreshMinutes: 5,
  notificationAtISO: null,
};

/**
 * Build the only payload sent to the scheduler host.
 *
 * Keeping this as a pure function makes the privacy boundary easy to test and
 * prevents future callers from accidentally passing a full TrackerState.
 */
export function buildNativeSchedulerMessage({ refreshMinutes = 5, notificationAtISO = null } = {}) {
  const minutes = normalizeRefreshMinutes(refreshMinutes);
  if (minutes == null) throw new TypeError('refreshMinutes must be an integer from 1 to 1440');
  return {
    kind: 'schedule',
    schemaVersion: NATIVE_SCHEDULER_SCHEMA_VERSION,
    refreshMinutes: minutes,
    notificationAtISO: normalizeDeadline(notificationAtISO),
  };
}

/**
 * Connect/update/disconnect the helper schedule. A missing host is an
 * expected state for the default package and is always a silent no-op after
 * the first informational log.
 */
export function configureNativeScheduler({
  enabled = false,
  refreshMinutes = 5,
  notificationAtISO = null,
  onWake = null,
} = {}) {
  currentConfig = {
    enabled: enabled === true,
    refreshMinutes: normalizeRefreshMinutes(refreshMinutes) || 5,
    notificationAtISO: normalizeDeadline(notificationAtISO),
  };
  wakeHandler = typeof onWake === 'function' ? onWake : null;

  if (!currentConfig.enabled) {
    disconnectNativeScheduler();
    return nativeSchedulerStatus();
  }

  const connected = postSchedule();
  return { ...nativeSchedulerStatus(), connected };
}

export function nativeSchedulerStatus() {
  return {
    enabled: currentConfig.enabled,
    connected: !!port,
    host: NATIVE_SCHEDULER_HOST,
  };
}

export function disconnectNativeScheduler() {
  stopPing();
  try { port?.disconnect(); } catch { /* host may already be gone */ }
  port = null;
}

function postSchedule() {
  const target = ensurePort();
  if (!target) return false;
  try {
    target.postMessage(buildNativeSchedulerMessage(currentConfig));
    return true;
  } catch (error) {
    console.info('[AUT-scheduler] schedule push failed; will retry on the next update:', error?.message || error);
    port = null;
    stopPing();
    return false;
  }
}

function ensurePort() {
  if (port) return port;
  const runtime = getRuntime();
  if (!runtime?.connectNative) return null;

  try {
    port = runtime.connectNative(NATIVE_SCHEDULER_HOST);
  } catch (error) {
    if (!connectionFailureLogged) {
      console.info('[AUT-scheduler] scheduler host not available; helper inactive:', error?.message || error);
      connectionFailureLogged = true;
    }
    port = null;
    return null;
  }

  port.onDisconnect?.addListener?.(() => {
    const error = getRuntime()?.lastError;
    if (error && !/not found/i.test(error.message || '') && !connectionFailureLogged) {
      console.info('[AUT-scheduler] scheduler host disconnected:', error.message);
      connectionFailureLogged = true;
    }
    port = null;
    stopPing();
  });
  port.onMessage?.addListener?.(handleNativeMessage);
  startPing();
  return port;
}

function handleNativeMessage(message) {
  if (!message || message.schemaVersion !== NATIVE_SCHEDULER_SCHEMA_VERSION) return;
  if (message.kind !== 'wake' || !['refresh', 'notification'].includes(message.reason)) return;
  try {
    const result = wakeHandler?.(message.reason);
    if (result && typeof result.catch === 'function') result.catch((error) => {
      console.warn('[AUT-scheduler] wake handling failed:', error?.message || error);
    });
  } catch (error) {
    console.warn('[AUT-scheduler] wake handling failed:', error?.message || error);
  }
}

function startPing() {
  stopPing();
  pingHandle = setInterval(() => {
    try {
      if (currentConfig.enabled) ensurePort()?.postMessage({
        kind: 'ping',
        schemaVersion: NATIVE_SCHEDULER_SCHEMA_VERSION,
        ts: new Date().toISOString(),
      });
    } catch {
      port = null;
      stopPing();
    }
  }, PING_INTERVAL_MS);
}

function stopPing() {
  if (pingHandle) {
    clearInterval(pingHandle);
    pingHandle = null;
  }
}

function getRuntime() {
  return (typeof chrome !== 'undefined' && chrome.runtime)
    || (typeof browser !== 'undefined' && browser.runtime)
    || null;
}

function normalizeRefreshMinutes(value) {
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < MIN_REFRESH_MINUTES || minutes > MAX_REFRESH_MINUTES) return null;
  return minutes;
}

function normalizeDeadline(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
