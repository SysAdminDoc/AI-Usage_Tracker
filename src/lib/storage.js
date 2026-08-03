// Unified storage seam. Routes to chrome.storage.local in extensions or
// GM.* in userscripts. Falls back to localStorage when nothing else exists
// (e.g. in unit tests).

import { SUPPORTED_HOSTS } from './hosts.js';
import { invokeWebExtension } from './browser.js';

const STORE_KEY = 'aut.state.v1';
export const SETTINGS_EXPORT_SCHEMA = 'ai-usage-tracker.settings';
export const SETTINGS_EXPORT_VERSION = 1;

const adapter = pickAdapter();

function pickAdapter() {
  // 1) WebExtensions (Chrome + Firefox MV3 expose browser/chrome.storage).
  const ext = getWebExtensionStorage();
  if (ext && ext.local) {
    return {
      type: 'webext',
      async get(key) {
        const r = await invokeWebExtension(ext.local, 'get', [key]);
        return r?.[key];
      },
      async set(key, value) {
        await invokeWebExtension(ext.local, 'set', [{ [key]: value }]);
      },
    };
  }

  // 2) Userscript managers.
  if (typeof GM !== 'undefined' && GM.setValue) {
    return {
      type: 'gm',
      async get(key) {
        const raw = await GM.getValue(key, null);
        return raw ? JSON.parse(raw) : null;
      },
      async set(key, value) {
        await GM.setValue(key, JSON.stringify(value));
      },
    };
  }
  if (typeof GM_setValue === 'function') {
    return {
      type: 'gm-legacy',
      async get(key) {
        const raw = GM_getValue(key, null);
        return raw ? JSON.parse(raw) : null;
      },
      async set(key, value) {
        GM_setValue(key, JSON.stringify(value));
      },
    };
  }

  // 3) DOM localStorage fallback — test/dev only.
  //    In production (extension or userscript), writing tracker state to the
  //    provider page's localStorage would expose usage metadata to the host
  //    origin.  We allow it only when an explicit flag is set (unit tests) or
  //    when the page origin is NOT a provider site.
  function isProviderOrigin() {
    try {
      const host = typeof location !== 'undefined' ? location.hostname : '';
      return SUPPORTED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
    } catch { return false; }
  }

  const localStorageAllowed = typeof globalThis.__AUT_ALLOW_LOCALSTORAGE__ !== 'undefined'
    ? !!globalThis.__AUT_ALLOW_LOCALSTORAGE__
    : !isProviderOrigin();

  if (localStorageAllowed) {
    return {
      type: 'localstorage',
      async get(key) {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
        return raw ? JSON.parse(raw) : null;
      },
      async set(key, value) {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(key, JSON.stringify(value));
        }
      },
    };
  }

  // 4) No suitable adapter — fail closed with a degraded in-memory stub that
  //    keeps the current session working but does not persist or leak state.
  console.warn('[AUT] No safe storage adapter available — running in degraded memory-only mode.');
  const memStore = new Map();
  return {
    type: 'memory',
    async get(key) { return memStore.get(key) ?? null; },
    async set(key, value) { memStore.set(key, value); },
  };
}

export const storageType = adapter.type;

export async function getStorageUsage(state = null) {
  const ext = getWebExtensionStorage();
  if (ext?.local?.getBytesInUse) {
    try {
      const bytes = await invokeStorageMethod(ext.local, 'getBytesInUse', 'aut.state.v1');
      return {
        bytes: Number(bytes) || 0,
        quotaBytes: Number(ext.local.QUOTA_BYTES) || null,
        source: 'webext',
      };
    } catch (error) {
      console.warn('[AUT] Storage byte query failed:', error);
    }
  }

  try {
    const value = state || await loadState();
    const encoded = new TextEncoder().encode(JSON.stringify(value));
    return {
      bytes: encoded.byteLength,
      quotaBytes: null,
      source: `${adapter.type}-estimate`,
    };
  } catch {
    return { bytes: null, quotaBytes: null, source: 'unavailable' };
  }
}

function getWebExtensionStorage() {
  return (typeof browser !== 'undefined' && browser.storage)
    || (typeof chrome !== 'undefined' && chrome.storage)
    || null;
}

function invokeStorageMethod(target, method, argument) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    const callback = (value) => finish(resolve, value);
    try {
      const result = target[method](argument, callback);
      if (result && typeof result.then === 'function') result.then(
        (value) => finish(resolve, value),
        (error) => finish(reject, error),
      );
      else if (result !== undefined) finish(resolve, result);
    } catch (error) {
      finish(reject, error);
    }
  });
}

// --- Schema versioning and migration ---

const CURRENT_STATE_VERSION = 2;

/**
 * Migration table. Each entry upgrades from version N to version N+1.
 * Migrations receive the raw state object and return the upgraded version.
 */
const MIGRATIONS = [
  // v0 / v1 (unversioned) -> v2: add stateVersion, ensure settings shape.
  function migrateV1toV2(state) {
    const next = { ...state };
    next.stateVersion = 2;
    // Ensure all expected top-level keys exist.
    if (!next.snapshot) next.snapshot = { fetchedAtISO: null, providers: { claude: null, codex: null } };
    if (!next.snapshot.providers) next.snapshot.providers = { claude: null, codex: null };
    if (!Array.isArray(next.history)) next.history = [];
    if (!next.firedRules || typeof next.firedRules !== 'object') next.firedRules = {};
    if (!next.widget || typeof next.widget !== 'object') next.widget = { x: null, y: null, minimized: false };
    // Merge in any missing settings with defaults.
    next.settings = mergeDefaults(next.settings, defaultSettings());
    return next;
  },
];

/**
 * Deep-merge defaults into an existing settings object without overwriting
 * user-set values.
 */
function mergeDefaults(current, defaults) {
  if (!current || typeof current !== 'object') return { ...defaults };
  const out = { ...defaults };
  for (const key of Object.keys(current)) {
    if (current[key] != null && typeof current[key] === 'object' && !Array.isArray(current[key])
        && defaults[key] && typeof defaults[key] === 'object' && !Array.isArray(defaults[key])) {
      out[key] = mergeDefaults(current[key], defaults[key]);
    } else if (current[key] !== undefined) {
      out[key] = current[key];
    }
  }
  return out;
}

/**
 * Apply migrations to bring state up to CURRENT_STATE_VERSION.
 * Returns { state, migrated } where migrated is true if any migration ran.
 */
export function migrateState(raw) {
  let state = raw;
  let migrated = false;
  let version = typeof state?.stateVersion === 'number' ? state.stateVersion : 1;

  while (version < CURRENT_STATE_VERSION) {
    const migrationIndex = version - 1;
    if (migrationIndex < 0 || migrationIndex >= MIGRATIONS.length) break;
    try {
      state = MIGRATIONS[migrationIndex](state);
      migrated = true;
    } catch (e) {
      console.error(`[AUT] Migration v${version}->v${version + 1} failed:`, e);
      // Return a default state rather than losing everything.
      return { state: defaultState(), migrated: true, error: `migration-v${version}-failed` };
    }
    version = typeof state?.stateVersion === 'number' ? state.stateVersion : version + 1;
  }
  return { state, migrated };
}

/**
 * Validate that a raw state object has the minimum expected shape.
 * Returns true if the state appears safe to use.
 */
function isStateValid(raw) {
  if (!raw || typeof raw !== 'object') return false;
  if (Array.isArray(raw)) return false;
  // Must have at least a snapshot key.
  if (!raw.snapshot || typeof raw.snapshot !== 'object') return false;
  return true;
}

export async function loadState() {
  let raw;
  try {
    raw = await adapter.get(STORE_KEY);
  } catch (e) {
    console.error('[AUT] Storage read failed:', e);
    return defaultState();
  }

  if (!raw) return defaultState();

  // Corruption guard: if the raw data isn't a valid object, reset.
  if (!isStateValid(raw)) {
    console.warn('[AUT] Stored state is corrupt — resetting to defaults. Previous value type:', typeof raw);
    const fresh = defaultState();
    try { await adapter.set(STORE_KEY, fresh); } catch { /* best effort */ }
    return fresh;
  }

  // Run migrations if needed.
  const { state, migrated, error } = migrateState(raw);
  if (error) {
    console.warn('[AUT] Migration error:', error);
  }
  if (migrated) {
    try { await adapter.set(STORE_KEY, state); } catch { /* best effort */ }
  }
  return state;
}

export async function saveState(state) {
  // Stamp current version on every write.
  state.stateVersion = CURRENT_STATE_VERSION;
  await adapter.set(STORE_KEY, state);
}

export async function patchState(patch) {
  const state = await loadState();
  const next = { ...state, ...patch };
  await saveState(next);
  return next;
}

/**
 * Build a portable settings payload. History is deliberately opt-in because
 * it is the largest and most identifying part of local tracker state.
 */
export function exportSettings(state = defaultState(), { includeHistory = false } = {}) {
  const payload = {
    schema: SETTINGS_EXPORT_SCHEMA,
    schemaVersion: SETTINGS_EXPORT_VERSION,
    exportedAtISO: new Date().toISOString(),
    stateVersion: CURRENT_STATE_VERSION,
    settings: sanitizeImportedSettings(state.settings),
    widget: normalizeWidget(state.widget),
  };
  if (includeHistory) payload.history = cloneJSON(Array.isArray(state.history) ? state.history : []);
  return payload;
}

/**
 * Validate and normalize an exported payload without mutating storage.
 * Throws a descriptive error so callers can leave the current state intact.
 */
export function parseSettingsImport(input, { includeHistory = false } = {}) {
  let payload = input;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { throw new Error('Settings file is not valid JSON'); }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Settings import must be a JSON object');
  }
  if (payload.schema !== SETTINGS_EXPORT_SCHEMA || payload.schemaVersion !== SETTINGS_EXPORT_VERSION) {
    throw new Error(`Unsupported settings export schema: ${String(payload.schema || 'missing')}`);
  }
  if (!payload.settings || typeof payload.settings !== 'object' || Array.isArray(payload.settings)) {
    throw new Error('Settings export is missing its settings object');
  }

  const parsed = {
    settings: sanitizeImportedSettings(payload.settings),
    widget: normalizeWidget(payload.widget),
  };
  if (includeHistory && Object.prototype.hasOwnProperty.call(payload, 'history')) {
    parsed.history = validateImportedHistory(payload.history);
  }
  return parsed;
}

/**
 * Apply a validated settings payload atomically. Invalid input throws before
 * loadState/saveState can write anything, which provides rollback-by-default.
 */
export async function importSettings(input, options = {}) {
  const parsed = parseSettingsImport(input, options);
  const state = await loadState();
  const next = {
    ...state,
    settings: parsed.settings,
    widget: parsed.widget,
  };
  if (Object.prototype.hasOwnProperty.call(parsed, 'history')) next.history = parsed.history;
  await saveState(next);
  return next;
}

function sanitizeImportedSettings(input) {
  const settings = mergeDefaults(input, defaultSettings());
  const refreshValues = [1, 5, 15, 30];
  const retentionValues = [7, 14, 30, 60, 90];
  settings.refreshMinutes = refreshValues.includes(Number(settings.refreshMinutes)) ? Number(settings.refreshMinutes) : 5;
  settings.historyRetentionDays = retentionValues.includes(Number(settings.historyRetentionDays))
    ? Number(settings.historyRetentionDays) : 30;
  settings.silentTabRefresh = settings.silentTabRefresh === true;
  settings.highContrast = settings.highContrast === true;
  settings.theme = ['mocha', 'latte', 'system'].includes(settings.theme) ? settings.theme : 'mocha';
  settings.showProviders = {
    claude: settings.showProviders?.claude !== false,
    codex: settings.showProviders?.codex !== false,
  };
  settings.notifications = mergeDefaults(settings.notifications, defaultSettings().notifications);
  settings.notifications.dailyBriefingHour = clampNumber(settings.notifications.dailyBriefingHour, 0, 23, 8);
  const warnAt = clampNumber(settings.thresholds?.warnAt, 25, 85, 50);
  let dangerAt = clampNumber(settings.thresholds?.dangerAt, 55, 95, 80);
  if (warnAt >= dangerAt) dangerAt = Math.min(95, warnAt + 5);
  settings.thresholds = { warnAt, dangerAt };
  return settings;
}

function normalizeWidget(widget) {
  const source = widget && typeof widget === 'object' && !Array.isArray(widget) ? widget : {};
  return {
    x: source.x == null ? null : Number.isFinite(Number(source.x)) ? Number(source.x) : null,
    y: source.y == null ? null : Number.isFinite(Number(source.y)) ? Number(source.y) : null,
    minimized: source.minimized === true,
  };
}

function validateImportedHistory(history) {
  if (!Array.isArray(history)) throw new Error('History import must be an array');
  return history.map((sample, index) => {
    if (!sample || typeof sample !== 'object' || Array.isArray(sample)
        || !Number.isFinite(Number(sample.ts))
        || typeof sample.bucketId !== 'string'
        || !Number.isFinite(Number(sample.percentUsed))) {
      throw new Error(`History sample ${index + 1} is invalid`);
    }
    return {
      ...sample,
      ts: Number(sample.ts),
      percentUsed: Math.max(0, Math.min(100, Number(sample.percentUsed))),
    };
  });
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function cloneJSON(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function defaultState() {
  return {
    stateVersion: CURRENT_STATE_VERSION,
    snapshot: { fetchedAtISO: null, providers: { claude: null, codex: null } },
    history: [],          // [{ ts, bucketId, percentUsed }]
    firedRules: {},       // { '<provider>-<bucket>-<rule>-<resetISO>': true }
    settings: defaultSettings(),
    widget: { x: null, y: null, minimized: false },
  };
}

export function defaultSettings() {
  return {
    refreshMinutes: 5,
    silentTabRefresh: false,
    highContrast: false,
    showProviders: { claude: true, codex: true },
    showRows: {     // headline buckets default ON; per-model rows default OFF
      'claude-session': true,
      'claude-weekly-all': true,
      'claude-weekly-sonnet': false,
      'claude-weekly-design': false,
      'codex-5h-all': true,
      'codex-weekly-all': true,
    },
    notifications: {
      'R1-60': true,
      'R1-15': true,
      'R1-0': true,
      'R2':    true,
      'U1-75': false,
      'U1-90': true,
      'U1-95': true,
      'U2':    true,
      'D1':    true,
      dailyBriefingHour: 8,    // 24h local
    },
    theme: 'mocha',            // 'mocha' (default) | 'latte' | 'system'
    thresholds: {
      warnAt: 50,
      dangerAt: 80,
    },
    historyRetentionDays: 30,
  };
}
