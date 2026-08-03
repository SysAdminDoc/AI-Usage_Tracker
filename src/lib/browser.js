// Tiny cross-runtime polyfill. Re-exports the WebExtensions API surface
// we actually use (storage, notifications, alarms, runtime, tabs), with
// fallbacks to userscript primitives where needed.

export const isExtension = typeof chrome !== 'undefined' && !!(chrome.runtime && chrome.runtime.id);
export const isUserscript = !isExtension && (typeof GM !== 'undefined' || typeof GM_setValue !== 'undefined');

const ns = (typeof browser !== 'undefined' && browser.runtime) ? browser : (typeof chrome !== 'undefined' ? chrome : null);

export const runtime = ns ? ns.runtime : null;
export const tabs = ns ? ns.tabs : null;
export const alarms = ns ? ns.alarms : null;

const alarmHandlers = new Map();
const fallbackTimers = new Map();
let alarmListenerBound = false;

// chrome.notifications uses callbacks on Chrome, promises on Firefox.
export async function notify({ title, body, tone = 'info', id }) {
  // Extension path.
  if (ns && ns.notifications && ns.notifications.create) {
    const iconUrl = ns.runtime.getURL ? ns.runtime.getURL('icons/icon-128.png') : 'icons/icon-128.png';
    try {
      await new Promise((resolve) => {
        const args = [id || undefined, {
          type: 'basic',
          iconUrl,
          title,
          message: body,
          priority: tone === 'bad' ? 2 : tone === 'warn' ? 1 : 0,
        }, resolve];
        // chrome.notifications.create signature handles undefined id gracefully.
        ns.notifications.create(...args);
      });
      return true;
    } catch { /* fall through to web API */ }
  }

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
    alarms.create(name, { periodInMinutes: minutes });
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

  cancelSchedule(name);
  if (alarms && alarms.create) {
    alarms.create(name, { when: Math.max(Date.now() + 1_000, timestamp) });
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
  try {
    const result = alarms?.clear?.(name);
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch { /* best effort */ }
}

// Send a message between background <-> content <-> popup.
export function send(message) {
  if (runtime && runtime.sendMessage) {
    return runtime.sendMessage(message);
  }
  return Promise.resolve(null);
}

export function onMessage(handler) {
  if (runtime && runtime.onMessage) {
    runtime.onMessage.addListener((msg, sender, sendResponse) => {
      Promise.resolve(handler(msg, sender)).then(sendResponse);
      return true; // keep channel open for async response
    });
  }
}
