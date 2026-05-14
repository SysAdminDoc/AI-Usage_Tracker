// Service worker entry — runs in Chrome MV3 and Firefox MV3.
// Periodically fetches both analytics pages, normalizes them, stores a
// snapshot, evaluates notification rules, and fires OS notifications.

import { fetchClaude } from './scrapers/claude.js';
import { fetchCodex } from './scrapers/codex.js';
import { loadState, saveState, defaultState } from './lib/storage.js';
import { recordSnapshot } from './lib/history.js';
import { evaluateRules } from './lib/notify.js';
import { notify, schedule, onMessage } from './lib/browser.js';

const ALARM_NAME = 'aut-refresh';

init();

function init() {
  bindMessageHandlers();
  bindAlarm();
}

function bindMessageHandlers() {
  onMessage(async (msg) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'aut/refresh')      { await refreshNow(); return { ok: true }; }
    if (msg.type === 'aut/reschedule')   { await reschedule(); return { ok: true }; }
    if (msg.type === 'aut/get-snapshot') { return await loadState(); }
    return null;
  });
}

async function bindAlarm() {
  const state = await loadState();
  const minutes = state?.settings?.refreshMinutes ?? 5;
  schedule({
    name: ALARM_NAME,
    minutes,
    onFire: () => refreshNow().catch(console.error),
  });
}

async function reschedule() {
  if (typeof chrome !== 'undefined' && chrome.alarms) {
    await new Promise((r) => chrome.alarms.clear(ALARM_NAME, r));
  } else if (typeof browser !== 'undefined' && browser.alarms) {
    await browser.alarms.clear(ALARM_NAME);
  }
  await bindAlarm();
}

async function refreshNow() {
  const now = new Date();
  const state = (await loadState()) || defaultState();

  const [claude, codex] = await Promise.all([
    fetchClaude({ now }),
    fetchCodex({ now }),
  ]);

  const snapshot = {
    fetchedAtISO: now.toISOString(),
    providers: { claude, codex },
  };
  state.snapshot = snapshot;
  state.history  = recordSnapshot(state.history || [], snapshot, { now });

  const toFire = evaluateRules({
    snapshot,
    history: state.history,
    settings: state.settings,
    firedRules: state.firedRules || {},
    now,
  });

  for (const n of toFire) {
    const fired = await notify({
      id: n.fireKey,
      title: n.title,
      body:  n.body,
      tone:  n.tone,
    });
    if (fired) state.firedRules[n.fireKey] = Date.now();
  }
  state.firedRules = pruneFired(state.firedRules, now);

  await saveState(state);
  return state;
}

function pruneFired(firedRules, now) {
  // Drop fire-keys whose reset window is more than 14 days old.
  const cutoff = now.getTime() - 14 * 24 * 60 * 60 * 1000;
  const out = {};
  for (const [k, ts] of Object.entries(firedRules || {})) {
    if (typeof ts === 'number' && ts < cutoff) continue;
    out[k] = ts;
  }
  return out;
}
