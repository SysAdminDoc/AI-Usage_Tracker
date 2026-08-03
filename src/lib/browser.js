// Tiny cross-runtime polyfill. Re-exports the WebExtensions API surface
// we actually use (storage, notifications, alarms, runtime, tabs), with
// fallbacks to userscript primitives where needed.

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

// chrome.notifications uses callbacks on Chrome, promises on Firefox.
export async function notify({ title, body, tone = 'info', id }) {
  // Extension path.
  if (ns && ns.notifications && ns.notifications.create) {
    const iconUrl = ns.runtime?.getURL ? ns.runtime.getURL('icons/icon-128.png') : 'icons/icon-128.png';
    try {
      await invokeWebExtension(ns.notifications, 'create', [id || undefined, {
        type: 'basic',
        iconUrl,
        title,
        message: body,
        priority: tone === 'bad' ? 2 : tone === 'warn' ? 1 : 0,
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
