// Tiny cross-runtime polyfill. Re-exports the WebExtensions API surface
// we actually use (storage, notifications, alarms, runtime, tabs), with
// fallbacks to userscript primitives where needed.

import { API_PROVIDER_HOSTS } from '../providers/api-contract.js';
import { normalizeNotificationTone } from './notify.js';

export const isExtension = typeof chrome !== 'undefined' && !!(chrome.runtime && chrome.runtime.id);
export const isUserscript = !isExtension && (typeof GM !== 'undefined' || typeof GM_setValue !== 'undefined');

const ns = (typeof browser !== 'undefined' && browser.runtime) ? browser : (typeof chrome !== 'undefined' ? chrome : null);

// Firefox exposes promise-returning WebExtension methods through `browser`,
// while Chrome's callback surface remains the lowest common denominator.
// Keep this decision at module load so every adapter uses the same namespace
// and calling convention.
export const isPromiseStyle = typeof browser !== 'undefined' && !!browser.runtime;

export const runtime = ns ? ns.runtime : null;
export const tabs = ns ? ns.tabs : null;
export const alarms = ns ? ns.alarms : null;

const alarmHandlers = new Map();
const fallbackTimers = new Map();
let alarmListenerBound = false;

/**
 * Invoke a WebExtension method in either its callback or promise form.
 *
 * `promiseStyle` is injectable for contract tests and embedded runtimes that
 * expose a non-standard namespace. Production callers use the module-level
 * browser-vs-chrome decision by default.
 */
export function invokeWebExtension(target, method, args = [], { promiseStyle = isPromiseStyle } = {}) {
  const fn = target?.[method];
  if (typeof fn !== 'function') return Promise.reject(new Error(`WebExtension method unavailable: ${method}`));

  if (promiseStyle) {
    try {
      return Promise.resolve(fn.apply(target, args));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    const callback = (...values) => {
      // Chrome requires runtime.lastError to be read inside the callback.
      const error = target?.runtime?.lastError
        || (typeof chrome !== 'undefined' ? chrome.runtime?.lastError : null);
      if (error) finish(reject, error);
      else finish(resolve, values.length > 1 ? values : values[0]);
    };

    try {
      const result = fn.apply(target, [...args, callback]);
      // A few Chromium implementations return a promise even when a
      // callback is supplied. Supporting both makes the seam future-proof.
      if (result && typeof result.then === 'function') {
        result.then(
          (value) => finish(resolve, value),
          (error) => finish(reject, error),
        );
      } else if (result !== undefined) {
        finish(resolve, result);
      }
    } catch (error) {
      finish(reject, error);
    }
  });
}

export function getNotificationPermission() {
  if (ns?.notifications?.create) {
    return {
      state: 'granted',
      source: 'extension',
      detail: 'Extension notifications are available from the declared browser permission.',
    };
  }
  if ((typeof GM !== 'undefined' && typeof GM.notification === 'function')
      || typeof GM_notification === 'function') {
    return {
      state: 'granted',
      source: 'userscript-manager',
      detail: 'The userscript manager notification API is available while this provider tab is open.',
    };
  }
  if (typeof Notification !== 'undefined') {
    return {
      state: Notification.permission || 'default',
      source: 'web',
      detail: 'The browser page Notification permission controls delivery for this userscript tab.',
    };
  }
  return {
    state: 'unsupported',
    source: 'unavailable',
    detail: 'This browser context does not expose a notification API.',
  };
}

/**
 * Request only the configured webhook origin. Optional host permissions are
 * declared in the manifests but never requested for the default-disabled
 * feature; userscript contexts simply use their page/fetch capability.
 */
export async function requestWebhookHostPermission(url) {
  let parsed;
  try { parsed = new URL(String(url || '').trim()); } catch {
    return { ok: false, supported: true, errorCode: 'webhook.url-invalid' };
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    return { ok: false, supported: true, errorCode: 'webhook.url-invalid' };
  }
  const permissions = (typeof browser !== 'undefined' && browser.permissions)
    || (typeof chrome !== 'undefined' && chrome.permissions)
    || null;
  if (!permissions?.request) return { ok: true, supported: false, granted: true };

  const originPattern = `${parsed.origin}/*`;
  try {
    if (permissions.contains) {
      const alreadyGranted = await invokeWebExtension(permissions, 'contains', [{ origins: [originPattern] }]);
      if (alreadyGranted === true) return { ok: true, supported: true, granted: true, alreadyGranted: true };
    }
    const granted = await invokeWebExtension(permissions, 'request', [{ origins: [originPattern] }]);
    return granted === true
      ? { ok: true, supported: true, granted: true }
      : { ok: false, supported: true, granted: false, errorCode: 'webhook.permission-denied' };
  } catch {
    return { ok: false, supported: true, granted: false, errorCode: 'webhook.permission-failed' };
  }
}

/** Request only the exact optional origin used by one configured API provider. */
export async function requestApiProviderHostPermission(provider) {
  return changeApiProviderHostPermission(provider, { request: true });
}

/** Inspect one provider origin without opening a permission prompt. */
export async function getApiProviderHostPermission(provider) {
  return changeApiProviderHostPermission(provider, { request: false });
}

/** Revoke one provider origin when its local credential is removed. */
export async function removeApiProviderHostPermission(provider) {
  const pattern = API_PROVIDER_HOSTS[provider];
  if (!pattern) return { ok: false, supported: true, granted: false, errorCode: 'api.host-unknown' };
  const permissions = (typeof browser !== 'undefined' && browser.permissions)
    || (typeof chrome !== 'undefined' && chrome.permissions)
    || null;
  if (!permissions?.remove) return { ok: true, supported: false, granted: false, skipped: true };
  try {
    const removed = await invokeWebExtension(permissions, 'remove', [{ origins: [pattern] }]);
    return removed === false
      ? { ok: false, supported: true, granted: true, errorCode: 'api.host-remove-denied' }
      : { ok: true, supported: true, granted: false };
  } catch {
    return { ok: false, supported: true, granted: true, errorCode: 'api.host-remove-failed' };
  }
}

async function changeApiProviderHostPermission(provider, { request }) {
  const pattern = API_PROVIDER_HOSTS[provider];
  if (!pattern) return { ok: false, supported: true, granted: false, errorCode: 'api.host-unknown' };
  const permissions = (typeof browser !== 'undefined' && browser.permissions)
    || (typeof chrome !== 'undefined' && chrome.permissions)
    || null;
  if (!permissions) {
    return (!!runtime?.id)
      ? { ok: false, supported: false, granted: false, errorCode: 'api.host-permission-unavailable' }
      : { ok: true, supported: false, granted: true, skipped: true };
  }

  try {
    if (permissions.contains) {
      const alreadyGranted = await invokeWebExtension(permissions, 'contains', [{ origins: [pattern] }]);
      if (alreadyGranted === true) return { ok: true, supported: true, granted: true, alreadyGranted: true };
    } else if (!request) {
      return { ok: false, supported: true, granted: false, errorCode: 'api.host-status-unavailable' };
    }
    if (!request || !permissions.request) {
      return { ok: false, supported: true, granted: false, errorCode: 'api.host-permission-denied' };
    }
    const granted = await invokeWebExtension(permissions, 'request', [{ origins: [pattern] }]);
    return granted === true
      ? { ok: true, supported: true, granted: true }
      : { ok: false, supported: true, granted: false, errorCode: 'api.host-permission-denied' };
  } catch {
    return { ok: false, supported: true, granted: false, errorCode: 'api.host-permission-failed' };
  }
}

export async function requestNotificationPermission() {
  const current = getNotificationPermission();
  if (current.source !== 'web' || current.state !== 'default') return current;
  if (typeof Notification.requestPermission !== 'function') return current;
  try {
    const state = await Notification.requestPermission();
    return { ...getNotificationPermission(), state: state || 'default' };
  } catch {
    return getNotificationPermission();
  }
}

async function notifyViaUserscriptManager({ title, body, id }) {
  const details = { title, text: body, tag: id || undefined };
  try {
    if (typeof GM !== 'undefined' && typeof GM.notification === 'function') {
      const result = GM.notification(details);
      if (result && typeof result.then === 'function') await result;
      return true;
    }
    if (typeof GM_notification === 'function') {
      GM_notification(details);
      return true;
    }
  } catch {
    // Fall through to the page Notification API when the manager rejects it.
  }
  return false;
}

/** Map every notification tone to the WebExtensions priority contract. */
export function notificationPriorityForTone(tone) {
  switch (normalizeNotificationTone(tone)) {
    case 'reset': return 1;
    case 'warning': return 1;
    case 'bad': return 2;
    case 'success': return 0;
    case 'snooze': return 0;
    case 'delivery-failure': return 2;
    case 'info': return 0;
    default: return 0;
  }
}

// chrome.notifications uses callbacks on Chrome, promises on Firefox.
export async function notify({ title, body, tone = 'info', id }) {
  const normalizedTone = normalizeNotificationTone(tone);
  // Extension path.
  if (ns && ns.notifications && ns.notifications.create) {
    const iconUrl = ns.runtime?.getURL ? ns.runtime.getURL('icons/icon-128.png') : 'icons/icon-128.png';
    try {
      await invokeWebExtension(ns.notifications, 'create', [id || undefined, {
        type: 'basic',
        iconUrl,
        title,
        message: body,
        priority: notificationPriorityForTone(normalizedTone),
      }]);
      return true;
    } catch { /* fall through to web API */ }
  }

  if (await notifyViaUserscriptManager({ title, body, id })) return true;

  // Web Notification API (userscript path, or extension fallback).
  if (typeof Notification !== 'undefined') {
    if (Notification.permission === 'granted') {
      new Notification(title, { body });
      return true;
    }
    if (Notification.permission !== 'denied') {
      try {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          new Notification(title, { body });
          return true;
        }
      } catch { /* user dismissed */ }
    }
  }
  return false;
}

// Schedule a recurring callback. Uses chrome.alarms in extensions (survives
// service-worker death), setInterval in userscripts.
export function schedule({ name, minutes, onFire }) {
  if (alarms && alarms.create) {
    invokeWebExtension(alarms, 'create', [name, { periodInMinutes: minutes }])
      .catch((error) => console.warn('[AUT] alarm schedule failed', error));
    registerAlarmHandler(name, onFire);
    return { type: 'alarm', cancel: () => cancelSchedule(name) };
  }
  const handle = setInterval(onFire, minutes * 60 * 1000);
  // Fire once immediately so the user sees data fast.
  setTimeout(onFire, 1000);
  return { type: 'interval', cancel: () => clearInterval(handle) };
}

// Schedule one exact deadline. Extension alarms survive service-worker sleep;
// userscript timers provide the best available tab-open fallback.
export function scheduleAt({ name, when, onFire }) {
  const timestamp = when instanceof Date ? when.getTime() : Number(when);
  if (!Number.isFinite(timestamp)) return { type: 'none', cancel: () => {} };

  void cancelSchedule(name);
  if (alarms && alarms.create) {
    invokeWebExtension(alarms, 'create', [name, { when: Math.max(Date.now() + 1_000, timestamp) }])
      .catch((error) => console.warn('[AUT] one-shot alarm schedule failed', error));
    registerAlarmHandler(name, onFire);
    return { type: 'alarm', cancel: () => cancelSchedule(name) };
  }

  const handle = setTimeout(onFire, Math.max(1_000, timestamp - Date.now()));
  fallbackTimers.set(name, handle);
  return { type: 'timeout', cancel: () => cancelSchedule(name) };
}

function registerAlarmHandler(name, onFire) {
  alarmHandlers.set(name, onFire);
  if (alarmListenerBound || !alarms?.onAlarm?.addListener) return;
  alarms.onAlarm.addListener((alarm) => {
    const handler = alarmHandlers.get(alarm?.name);
    if (handler) Promise.resolve(handler()).catch((error) => console.error('[AUT] alarm callback failed', error));
  });
  alarmListenerBound = true;
}

export function cancelSchedule(name) {
  alarmHandlers.delete(name);
  const timer = fallbackTimers.get(name);
  if (timer != null) {
    clearTimeout(timer);
    fallbackTimers.delete(name);
  }
  if (!alarms?.clear) return Promise.resolve(false);
  return invokeWebExtension(alarms, 'clear', [name]).catch(() => false);
}

// Send a message between background <-> content <-> popup.
export function send(message) {
  if (!runtime?.sendMessage) return Promise.resolve(null);
  return invokeWebExtension(runtime, 'sendMessage', [message]);
}

export function onMessage(handler) {
  if (runtime && runtime.onMessage) {
    runtime.onMessage.addListener((msg, sender, sendResponse) => {
      const response = Promise.resolve().then(() => handler(msg, sender));
      if (isPromiseStyle || typeof sendResponse !== 'function') return response;
      response.then(sendResponse, (error) => {
        console.warn('[AUT] message handler failed', error);
        sendResponse(undefined);
      });
      return true; // keep the callback channel open in Chrome
    });
  }
}
