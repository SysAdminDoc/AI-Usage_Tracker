// Unified storage seam. Routes to chrome.storage.local in extensions or
// GM.* in userscripts. Falls back to localStorage when nothing else exists
// (e.g. in unit tests).

import { SUPPORTED_HOSTS } from './hosts.js';
import { invokeWebExtension } from './browser.js';
import { isTrackerState } from './type-guards.js';
import { normalizeWebhookURL } from './notify.js';
import { defaultBudgetLedger, normalizeBudgetCap } from './budget.js';
import { defaultCollaborationState, normalizeCollaborationState } from './collaboration.js';
import { API_PROVIDER_IDS } from '../providers/api-contract.js';
import {
  compactHistoryToBudget,
  historyBudgetStatus,
  HISTORY_MAX_BYTES,
  HISTORY_MAX_SAMPLES,
} from './history.js';

const LEGACY_STORE_KEY = 'aut.state.v1';
export const PROFILE_REGISTRY_KEY = 'aut.profiles.v1';
export const PROFILE_STATE_PREFIX = 'aut.state.v1.profile.';
const API_CREDENTIALS_KEY = 'aut.api-credentials.v1';
const PROFILE_CREDENTIALS_PREFIX = 'aut.api-credentials.v1.profile.';
export const INCOGNITO_STORAGE_PREFIX = 'aut.incognito.';
export const STORAGE_SCOPE_REGULAR = 'regular';
export const STORAGE_SCOPE_INCOGNITO = 'incognito';
export const SYNC_SETTINGS_KEY = 'aut.sync.settings.v1';
export const SYNC_SETTINGS_SCHEMA = 'ai-usage-tracker.sync-settings';
export const SYNC_SETTINGS_VERSION = 1;
const DEFAULT_PROFILE_ID = 'default';
const PROFILE_NAME_MAX = 48;
export const API_CREDENTIAL_PROVIDERS = API_PROVIDER_IDS;
export const API_CREDENTIAL_STORAGE_MODE_SESSION = 'session';
export const API_CREDENTIAL_STORAGE_MODE_PERSISTENT = 'persistent';
export const API_CREDENTIAL_STORAGE_MODES = Object.freeze([
  API_CREDENTIAL_STORAGE_MODE_SESSION,
  API_CREDENTIAL_STORAGE_MODE_PERSISTENT,
]);
export const SETTINGS_EXPORT_SCHEMA = 'ai-usage-tracker.settings';
export const SETTINGS_EXPORT_VERSION = 1;

const adapter = pickAdapter();
const credentialMemoryStore = new Map();

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
      async remove(key) {
        await invokeWebExtension(ext.local, 'remove', [key]);
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
      async remove(key) {
        if (typeof GM.deleteValue === 'function') await GM.deleteValue(key);
        else await GM.setValue(key, null);
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
      async remove(key) {
        if (typeof GM_deleteValue === 'function') GM_deleteValue(key);
        else GM_setValue(key, '');
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

  if (localStorageAllowed && typeof localStorage !== 'undefined') {
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
      async remove(key) {
        if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
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
    async remove(key) { memStore.delete(key); },
  };
}

export const storageType = adapter.type;

export function isIncognitoContext() {
  if (typeof globalThis.__AUT_INCOGNITO_CONTEXT__ !== 'undefined') {
    return globalThis.__AUT_INCOGNITO_CONTEXT__ === true;
  }
  const ext = (typeof browser !== 'undefined' && browser.extension)
    || (typeof chrome !== 'undefined' && chrome.extension);
  return ext?.inIncognitoContext === true;
}

export function getStorageScope() {
  return isIncognitoContext() ? STORAGE_SCOPE_INCOGNITO : STORAGE_SCOPE_REGULAR;
}

export const storageScope = getStorageScope();

function scopedStorageKey(key, scope = getStorageScope()) {
  return scope === STORAGE_SCOPE_INCOGNITO ? `${INCOGNITO_STORAGE_PREFIX}${key}` : key;
}

export function getProfileRegistryStorageKey(scope = getStorageScope()) {
  return scopedStorageKey(PROFILE_REGISTRY_KEY, scope);
}

export function getProfileStateStoragePrefix(scope = getStorageScope()) {
  return scopedStorageKey(PROFILE_STATE_PREFIX, scope);
}

export function getProfileCredentialsStoragePrefix(scope = getStorageScope()) {
  return scopedStorageKey(PROFILE_CREDENTIALS_PREFIX, scope);
}

export function getSyncSettingsStorageKey(scope = getStorageScope()) {
  return scopedStorageKey(SYNC_SETTINGS_KEY, scope);
}

const syncReadCache = new Map();
const storageWriteDiagnostics = {
  state: { attempts: 0, successes: 0, failures: 0, bytes: 0, lastBytes: 0 },
  sync: { attempts: 0, successes: 0, failures: 0, bytes: 0, lastBytes: 0 },
};
let syncWriteQueue = Promise.resolve();

export function resetStorageWriteDiagnostics() {
  for (const entry of Object.values(storageWriteDiagnostics)) {
    entry.attempts = 0;
    entry.successes = 0;
    entry.failures = 0;
    entry.bytes = 0;
    entry.lastBytes = 0;
  }
}

export function getStorageWriteDiagnostics() {
  return cloneJSON(storageWriteDiagnostics);
}

function recordStorageWriteAttempt(kind, bytes) {
  const entry = storageWriteDiagnostics[kind];
  if (!entry) return;
  const size = Number.isFinite(Number(bytes)) ? Math.max(0, Math.floor(Number(bytes))) : 0;
  entry.attempts += 1;
  entry.bytes += size;
  entry.lastBytes = size;
}

function recordStorageWriteResult(kind, ok) {
  const entry = storageWriteDiagnostics[kind];
  if (!entry) return;
  entry[ok ? 'successes' : 'failures'] += 1;
}

function cloneSyncedSettings(settings) {
  return settings ? JSON.parse(JSON.stringify(settings)) : null;
}

export function syncSettingsAvailable() {
  const sync = getWebExtensionSyncStorage();
  return !!(sync?.get && sync?.set);
}

export function pickSyncSettings(settings = {}) {
  const safe = sanitizeImportedSettings(settings);
  const notifications = Object.fromEntries([
    'R1-60', 'R1-15', 'R1-0', 'R2', 'U1-75', 'U1-90', 'U1-95', 'U2', 'U3', 'D1',
    'dailyBriefingHour',
  ].map((key) => [key, safe.notifications[key]]));
  const showRows = Object.fromEntries(Object.entries(safe.showRows || {})
    .filter(([key, value]) => typeof key === 'string' && typeof value === 'boolean')
    .slice(0, 128));
  return {
    refreshMinutes: safe.refreshMinutes,
    silentTabRefresh: safe.silentTabRefresh === true,
    highContrast: safe.highContrast === true,
    locale: typeof safe.locale === 'string' ? safe.locale.slice(0, 16) : 'en',
    showProviders: { ...safe.showProviders },
    showRows,
    notifications,
    theme: safe.theme,
    thresholds: { ...safe.thresholds },
    anomalyThresholdPercent: safe.anomalyThresholdPercent,
    historyRetentionDays: safe.historyRetentionDays,
    apiBudget: { ...safe.apiBudget },
  };
}

export function mergeSyncedSettings(current, remote) {
  const safe = pickSyncSettings(remote);
  return {
    ...current,
    ...safe,
    showProviders: { ...current?.showProviders, ...safe.showProviders },
    showRows: { ...current?.showRows, ...safe.showRows },
    notifications: { ...current?.notifications, ...safe.notifications },
    thresholds: { ...current?.thresholds, ...safe.thresholds },
    apiBudget: { ...current?.apiBudget, ...safe.apiBudget },
    syncSettings: current?.syncSettings === true,
  };
}

async function readSyncedSettings(profileId) {
  const sync = getWebExtensionSyncStorage();
  if (!sync?.get) return null;
  const key = `${getSyncSettingsStorageKey()}:${profileId}`;
  const cached = syncReadCache.get(key);
  if (cached && Date.now() - cached.readAt < 30_000) return cloneSyncedSettings(cached.settings);
  try {
    const value = await invokeWebExtension(sync, 'get', [getSyncSettingsStorageKey()]);
    const record = value?.[getSyncSettingsStorageKey()];
    if (!record || typeof record !== 'object' || Array.isArray(record)
        || record.schema !== SYNC_SETTINGS_SCHEMA
        || record.schemaVersion !== SYNC_SETTINGS_VERSION
        || record.profileId !== profileId
        || !record.settings || typeof record.settings !== 'object' || Array.isArray(record.settings)) {
      syncReadCache.set(key, { readAt: Date.now(), settings: null });
      return null;
    }
    const settings = pickSyncSettings(record.settings);
    syncReadCache.set(key, { readAt: Date.now(), settings });
    return cloneSyncedSettings(settings);
  } catch (error) {
    console.warn('[AUT] Synced settings read failed:', error);
    return null;
  }
}

export async function loadSyncedSettings(profileId = null) {
  const id = profileId || await getActiveProfileId();
  return readSyncedSettings(id);
}

let lastSyncFingerprint = '';

export async function saveSyncedSettings(settings, profileId = null) {
  const sync = getWebExtensionSyncStorage();
  if (!sync?.set) return { supported: false, synced: false };
  const id = profileId || await getActiveProfileId();
  const payload = pickSyncSettings(settings);
  const fingerprint = `${id}:${JSON.stringify(payload)}`;
  const key = getSyncSettingsStorageKey();
  return enqueueSyncWrite(async () => {
    if (fingerprint === lastSyncFingerprint) return { supported: true, synced: false, unchanged: true };
    const record = {
      schema: SYNC_SETTINGS_SCHEMA,
      schemaVersion: SYNC_SETTINGS_VERSION,
      profileId: id,
      settings: payload,
      updatedAtISO: new Date().toISOString(),
    };
    const values = { [key]: record };
    recordStorageWriteAttempt('sync', encodedByteLength(JSON.stringify(values)));
    try {
      await invokeWebExtension(sync, 'set', [values]);
      recordStorageWriteResult('sync', true);
    } catch (error) {
      recordStorageWriteResult('sync', false);
      throw error;
    }
    lastSyncFingerprint = fingerprint;
    syncReadCache.delete(`${getSyncSettingsStorageKey()}:${id}`);
    return { supported: true, synced: true };
  });
}

function enqueueSyncWrite(task) {
  const work = syncWriteQueue.catch(() => {}).then(task);
  syncWriteQueue = work.catch(() => {});
  return work;
}

export async function clearSyncedSettings() {
  const sync = getWebExtensionSyncStorage();
  if (!sync?.remove) return { supported: false, cleared: false };
  await invokeWebExtension(sync, 'remove', [getSyncSettingsStorageKey()]);
  lastSyncFingerprint = '';
  syncReadCache.clear();
  return { supported: true, cleared: true };
}

export async function getSyncSettingsStatus(profileId = null) {
  const supported = syncSettingsAvailable();
  if (!supported) return { supported: false, hasRemote: false };
  const remote = await loadSyncedSettings(profileId);
  return { supported: true, hasRemote: !!remote };
}

export async function getStorageUsage(state = null) {
  const value = state || await loadState();
  const history = historyBudgetStatus(value?.history || []);
  const ext = getWebExtensionStorage();
  if (ext?.local?.getBytesInUse) {
    try {
      const profileId = await getActiveProfileId();
      const bytes = await invokeStorageMethod(ext.local, 'getBytesInUse', profileStateStorageKey(profileId));
      return withStorageDiagnostics({
        bytes: Number(bytes) || 0,
        quotaBytes: Number(ext.local.QUOTA_BYTES) || null,
        source: 'webext',
      }, history, value);
    } catch (error) {
      console.warn('[AUT] Storage byte query failed:', error);
    }
  }

  try {
    const encoded = new TextEncoder().encode(JSON.stringify(value));
    return withStorageDiagnostics({
      bytes: encoded.byteLength,
      quotaBytes: null,
      source: `${adapter.type}-estimate`,
    }, history, value);
  } catch {
    return withStorageDiagnostics({ bytes: null, quotaBytes: null, source: 'unavailable' }, history, value);
  }
}

function withStorageDiagnostics(usage, history, state) {
  const nearQuota = Number.isFinite(usage.bytes)
    && Number.isFinite(usage.quotaBytes)
    && usage.quotaBytes > 0
    && usage.bytes / usage.quotaBytes >= 0.8;
  const warningCode = state?.historyDiagnostics?.warningCode
    || (history.degraded ? 'history-budget' : nearQuota ? 'storage-near-quota' : null);
  return {
    ...usage,
    history,
    writes: getStorageWriteDiagnostics(),
    degraded: history.degraded || nearQuota || !!state?.historyDiagnostics?.warningCode,
    warningCode,
  };
}

function getWebExtensionStorage() {
  return (typeof browser !== 'undefined' && browser.storage)
    || (typeof chrome !== 'undefined' && chrome.storage)
    || null;
}

function getWebExtensionSessionStorage() {
  return getWebExtensionStorage()?.session || null;
}

function getWebExtensionSyncStorage() {
  return getWebExtensionStorage()?.sync || null;
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
    if (!Object.prototype.hasOwnProperty.call(next.snapshot.providers, 'anthropic-api')) next.snapshot.providers['anthropic-api'] = null;
    if (!Object.prototype.hasOwnProperty.call(next.snapshot.providers, 'openai-api')) next.snapshot.providers['openai-api'] = null;
    if (!Object.prototype.hasOwnProperty.call(next.snapshot.providers, 'github-copilot')) next.snapshot.providers['github-copilot'] = null;
    if (!Object.prototype.hasOwnProperty.call(next.snapshot.providers, 'cursor')) next.snapshot.providers.cursor = null;
    if (!Object.prototype.hasOwnProperty.call(next.snapshot.providers, 'gemini')) next.snapshot.providers.gemini = null;
    if (!Object.prototype.hasOwnProperty.call(next.snapshot.providers, 'openrouter')) next.snapshot.providers.openrouter = null;
    if (!Array.isArray(next.history)) next.history = [];
    if (!next.firedRules || typeof next.firedRules !== 'object') next.firedRules = {};
    if (!next.notificationRetries || typeof next.notificationRetries !== 'object') next.notificationRetries = {};
    if (!next.widget || typeof next.widget !== 'object') next.widget = { x: null, y: null, minimized: false };
    if (!next.budget || typeof next.budget !== 'object' || Array.isArray(next.budget)) {
      next.budget = defaultBudgetLedger();
    }
    // Merge in any missing settings with defaults.
    next.settings = mergeDefaults(next.settings, defaultSettings());
    next.collaboration = normalizeCollaborationState(next.collaboration || defaultCollaborationState());
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
  return isTrackerState(raw);
}

const PROFILE_VERSION = 1;

export function profileStateStorageKey(profileId) {
  const id = normalizeProfileId(profileId);
  if (!id) throw new Error(`Invalid profile id: ${String(profileId)}`);
  return `${getProfileStateStoragePrefix()}${id}`;
}

function profileCredentialsStorageKey(profileId) {
  return `${getProfileCredentialsStoragePrefix()}${profileStateStorageKey(profileId).slice(getProfileStateStoragePrefix().length)}`;
}

export function defaultProfileRegistry(nowISO = new Date().toISOString()) {
  return {
    profileVersion: PROFILE_VERSION,
    activeId: DEFAULT_PROFILE_ID,
    profiles: [{ id: DEFAULT_PROFILE_ID, name: 'Default', createdAtISO: nowISO }],
  };
}

function normalizeProfileId(value) {
  const id = String(value ?? '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,47}$/.test(id) ? id : null;
}

function normalizeProfileName(value, fallback = '') {
  const name = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, PROFILE_NAME_MAX);
  return name || fallback;
}

function normalizeProfileRegistry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || raw.profileVersion !== PROFILE_VERSION || !Array.isArray(raw.profiles)) return null;

  const seen = new Set();
  const profiles = [];
  for (const candidate of raw.profiles) {
    const id = normalizeProfileId(candidate?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    profiles.push({
      id,
      name: normalizeProfileName(candidate?.name, id === DEFAULT_PROFILE_ID ? 'Default' : id),
      createdAtISO: typeof candidate?.createdAtISO === 'string' ? candidate.createdAtISO : null,
    });
  }
  if (!profiles.length) return null;
  const activeId = normalizeProfileId(raw.activeId);
  return {
    profileVersion: PROFILE_VERSION,
    activeId: profiles.some((profile) => profile.id === activeId) ? activeId : profiles[0].id,
    profiles,
  };
}

async function readLegacyCredentials() {
  try {
    const value = await adapter.get(API_CREDENTIALS_KEY);
    return normalizeCredentialMap(value);
  } catch {
    return {};
  }
}

function normalizeCredentialMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(API_CREDENTIAL_PROVIDERS
    .filter((provider) => typeof value[provider] === 'string' && value[provider].trim())
    .map((provider) => [provider, value[provider].trim()]));
}

async function ensureProfileRegistry() {
  const scope = getStorageScope();
  const registryKey = getProfileRegistryStorageKey(scope);
  let raw = null;
  try { raw = await adapter.get(registryKey); } catch { /* recover below */ }
  const normalized = normalizeProfileRegistry(raw);
  if (normalized) {
    if (JSON.stringify(raw) !== JSON.stringify(normalized)) {
      try { await adapter.set(registryKey, normalized); } catch { /* best effort */ }
    }
    return normalized;
  }

  let legacyState = null;
  if (scope === STORAGE_SCOPE_REGULAR) {
    try { legacyState = await adapter.get(LEGACY_STORE_KEY); } catch { /* default below */ }
  }
  const registry = defaultProfileRegistry();
  const state = isStateValid(legacyState) ? legacyState : defaultState();
  try {
    await adapter.set(registryKey, registry);
    await adapter.set(profileStateStorageKey(DEFAULT_PROFILE_ID), state);
    if (scope === STORAGE_SCOPE_REGULAR) {
      const legacyCredentials = await readLegacyCredentials();
      if (Object.keys(legacyCredentials).length) {
        await adapter.set(profileCredentialsStorageKey(DEFAULT_PROFILE_ID), legacyCredentials);
      }
      if (typeof adapter.remove === 'function') {
        try { await adapter.remove(API_CREDENTIALS_KEY); } catch { /* legacy cleanup is best effort */ }
      }
    }
  } catch (error) {
    console.warn('[AUT] Profile registry migration failed:', error);
  }
  return registry;
}

function profileFromRegistry(registry, profileId = registry.activeId) {
  return registry.profiles.find((profile) => profile.id === profileId) || registry.profiles[0];
}

export async function loadProfileRegistry() {
  return cloneJSON(await ensureProfileRegistry());
}

export async function listProfiles() {
  return (await loadProfileRegistry()).profiles;
}

export async function getActiveProfileId() {
  return (await ensureProfileRegistry()).activeId;
}

export async function getActiveProfile() {
  const registry = await ensureProfileRegistry();
  return cloneJSON(profileFromRegistry(registry));
}

export async function createProfile(name) {
  const normalizedName = normalizeProfileName(name);
  if (!normalizedName) throw new Error('Profile name is required');
  const registry = await ensureProfileRegistry();
  const base = (normalizeProfileId(normalizedName.replace(/[^a-z0-9]+/gi, '-')) || 'profile').slice(0, 40);
  let id = base;
  let suffix = 2;
  while (registry.profiles.some((profile) => profile.id === id)) id = `${base}-${suffix++}`.slice(0, 48);
  const profile = { id, name: normalizedName, createdAtISO: new Date().toISOString() };
  const next = { ...registry, profiles: [...registry.profiles, profile] };
  await adapter.set(getProfileRegistryStorageKey(), next);
  await adapter.set(profileStateStorageKey(id), defaultState());
  return cloneJSON(profile);
}

export async function switchProfile(profileId) {
  const id = normalizeProfileId(profileId);
  const registry = await ensureProfileRegistry();
  if (!id || !registry.profiles.some((profile) => profile.id === id)) {
    throw new Error(`Unknown profile: ${String(profileId)}`);
  }
  if (registry.activeId === id) return cloneJSON(profileFromRegistry(registry, id));
  const next = { ...registry, activeId: id };
  await adapter.set(getProfileRegistryStorageKey(), next);
  return cloneJSON(profileFromRegistry(next, id));
}

export async function renameProfile(profileId, name) {
  const id = normalizeProfileId(profileId);
  const normalizedName = normalizeProfileName(name);
  if (!id) throw new Error(`Unknown profile: ${String(profileId)}`);
  if (!normalizedName) throw new Error('Profile name is required');
  const registry = await ensureProfileRegistry();
  if (!registry.profiles.some((profile) => profile.id === id)) {
    throw new Error(`Unknown profile: ${String(profileId)}`);
  }
  const next = {
    ...registry,
    profiles: registry.profiles.map((profile) => profile.id === id
      ? { ...profile, name: normalizedName }
      : profile),
  };
  await adapter.set(getProfileRegistryStorageKey(), next);
  return cloneJSON(profileFromRegistry(next, id));
}

export async function deleteProfile(profileId) {
  const id = normalizeProfileId(profileId);
  const registry = await ensureProfileRegistry();
  if (!id || !registry.profiles.some((profile) => profile.id === id)) {
    throw new Error(`Unknown profile: ${String(profileId)}`);
  }
  if (registry.profiles.length <= 1) throw new Error('At least one profile must remain');
  const profiles = registry.profiles.filter((profile) => profile.id !== id);
  const next = {
    ...registry,
    activeId: registry.activeId === id ? profiles[0].id : registry.activeId,
    profiles,
  };
  await adapter.set(getProfileRegistryStorageKey(), next);
  if (typeof adapter.remove === 'function') await adapter.remove(profileStateStorageKey(id));
  await clearApiCredentialCopies(id);
  return cloneJSON(next);
}

async function applySyncedSettings(state, profileId) {
  if (state?.settings?.syncSettings !== true) return state;
  const remote = await readSyncedSettings(profileId);
  if (!remote) return state;
  const merged = mergeSyncedSettings(state.settings, remote);
  if (JSON.stringify(state.settings) === JSON.stringify(merged)) return state;
  state.settings = merged;
  try { await adapter.set(profileStateStorageKey(profileId), state); } catch { /* best effort */ }
  return state;
}

export async function loadState() {
  const profileId = await getActiveProfileId();
  const stateKey = profileStateStorageKey(profileId);
  let raw;
  try {
    raw = await adapter.get(stateKey);
  } catch (e) {
    console.error('[AUT] Storage read failed:', e);
    return { ...defaultState(), profileId };
  }

  if (!raw) {
    const fresh = { ...defaultState(), profileId };
    try { await adapter.set(stateKey, fresh); } catch { /* best effort */ }
    return fresh;
  }

  // Corruption guard: if the raw data isn't a valid object, reset.
  if (!isStateValid(raw)) {
    console.warn('[AUT] Stored state is corrupt — resetting to defaults. Previous value type:', typeof raw);
    const fresh = { ...defaultState(), profileId };
    try { await adapter.set(stateKey, fresh); } catch { /* best effort */ }
    return fresh;
  }

  // Run migrations if needed.
  const { state, migrated, error } = migrateState(raw);
  if (error) {
    console.warn('[AUT] Migration error:', error);
  }
  if (migrated) {
    try { await adapter.set(stateKey, state); } catch { /* best effort */ }
  }
  state.collaboration = normalizeCollaborationState(state.collaboration || defaultCollaborationState());
  state.notificationRetries = normalizeNotificationRetries(state.notificationRetries);
  state.profileId = profileId;
  const syncedState = await applySyncedSettings(state, profileId);
  const normalizedHistory = compactHistoryToBudget(syncedState.history, {
    retentionDays: null,
  });
  if (JSON.stringify(normalizedHistory) !== JSON.stringify(syncedState.history)) {
    syncedState.history = normalizedHistory;
    try { await adapter.set(stateKey, syncedState); } catch { /* best effort */ }
  }
  return syncedState;
}

export async function saveState(state) {
  const registry = await ensureProfileRegistry();
  const requestedId = normalizeProfileId(state?.profileId);
  const profileId = requestedId && registry.profiles.some((profile) => profile.id === requestedId)
    ? requestedId
    : registry.activeId;
  // Stamp current version on every write.
  state.stateVersion = CURRENT_STATE_VERSION;
  state.profileId = profileId;
  state.collaboration = normalizeCollaborationState(state.collaboration || defaultCollaborationState());
  state.notificationRetries = normalizeNotificationRetries(state.notificationRetries);
  const stateKey = profileStateStorageKey(profileId);
  const normalizedHistory = compactHistoryToBudget(state.history, {
    retentionDays: null,
  });
  state.history = normalizedHistory;
  const stateBytes = () => encodedByteLength(JSON.stringify(state));
  recordStorageWriteAttempt('state', stateBytes());
  try {
    await adapter.set(stateKey, state);
    recordStorageWriteResult('state', true);
  } catch (error) {
    recordStorageWriteResult('state', false);
    // A busy profile or a browser with a smaller quota gets one tighter,
    // recoverable retry before the write is surfaced to the caller.
    const tighterHistory = compactHistoryToBudget(state.history, {
      retentionDays: null,
      maxSamples: Math.max(100, Math.floor(HISTORY_MAX_SAMPLES / 2)),
      maxBytes: Math.max(64 * 1024, Math.floor(HISTORY_MAX_BYTES / 2)),
    });
    if (JSON.stringify(tighterHistory) === JSON.stringify(state.history)) throw error;
    state.history = tighterHistory;
    recordStorageWriteAttempt('state', stateBytes());
    try {
      await adapter.set(stateKey, state);
      recordStorageWriteResult('state', true);
    } catch (retryError) {
      recordStorageWriteResult('state', false);
      console.warn('[AUT] State write remains over storage quota after history compaction.');
      throw retryError;
    }
  }
  if (state.settings?.syncSettings === true) {
    try { await saveSyncedSettings(state.settings, profileId); } catch (error) {
      console.warn('[AUT] Synced settings write failed:', error);
    }
  } else {
    lastSyncFingerprint = '';
  }
}

export async function patchState(patch) {
  const state = await loadState();
  const next = { ...state, ...patch };
  await saveState(next);
  return next;
}

/**
 * API credentials live outside TrackerState. The privacy-first default keeps
 * them in WebExtension session storage, or an in-memory map when that API is
 * unavailable. Persistent local storage is retained only as an explicit
 * compatibility mode and is never part of sync/export/diagnostics payloads.
 */
export function normalizeApiCredentialStorageMode(value) {
  return value === API_CREDENTIAL_STORAGE_MODE_PERSISTENT
    ? API_CREDENTIAL_STORAGE_MODE_PERSISTENT
    : API_CREDENTIAL_STORAGE_MODE_SESSION;
}

function isPersistentCredentialAdapterAvailable() {
  return adapter.type !== 'memory';
}

function isSessionCredentialStorageAvailable() {
  const session = getWebExtensionSessionStorage();
  return !!(session?.get && session?.set && session?.remove);
}

function describeCredentialStorageMode(requestedMode) {
  const requested = normalizeApiCredentialStorageMode(requestedMode);
  const sessionAvailable = isSessionCredentialStorageAvailable();
  const persistentAvailable = isPersistentCredentialAdapterAvailable();
  let mode = 'memory';
  let recovery = 'Credentials stay in memory only and must be entered again when this context ends.';
  if (requested === API_CREDENTIAL_STORAGE_MODE_PERSISTENT && persistentAvailable) {
    mode = API_CREDENTIAL_STORAGE_MODE_PERSISTENT;
    recovery = 'Credentials survive browser restarts on this profile, but remain local and are never synced or exported.';
  } else if (requested === API_CREDENTIAL_STORAGE_MODE_SESSION && sessionAvailable) {
    mode = API_CREDENTIAL_STORAGE_MODE_SESSION;
    recovery = 'Credentials stay in browser memory and are cleared when the browser or extension session ends; enter them again afterward.';
  }
  return {
    requestedMode: requested,
    mode,
    sessionAvailable,
    persistentAvailable,
    storage: mode,
    export: 'omitted',
    sync: 'omitted',
    recovery,
  };
}

export async function getApiCredentialStorageStatus(profileId = null) {
  const id = profileId || await getActiveProfileId();
  return { profileId: id, ...describeCredentialStorageMode(await readProfileCredentialStorageMode(id)) };
}

async function readProfileCredentialStorageMode(profileId) {
  try {
    const state = await adapter.get(profileStateStorageKey(profileId));
    return normalizeApiCredentialStorageMode(state?.settings?.apiCredentialStorageMode);
  } catch {
    return API_CREDENTIAL_STORAGE_MODE_SESSION;
  }
}

function credentialStorageKey(profileId) {
  return profileCredentialsStorageKey(profileId);
}

async function readCredentialRecord(area, key) {
  if (!area?.get) return { map: {}, present: false };
  try {
    const result = await invokeWebExtension(area, 'get', [key]);
    const raw = result?.[key];
    return { map: normalizeCredentialMap(raw), present: raw != null };
  } catch (error) {
    console.warn('[AUT] API credential area read failed:', error);
    return { map: {}, present: false };
  }
}

async function readPersistentCredentialRecord(key) {
  try {
    const raw = await adapter.get(key);
    return { map: normalizeCredentialMap(raw), present: raw != null };
  } catch (error) {
    console.warn('[AUT] API credential map read failed:', error);
    return { map: {}, present: false };
  }
}

async function readCredentialSources(profileId) {
  const key = credentialStorageKey(profileId);
  const session = await readCredentialRecord(getWebExtensionSessionStorage(), key);
  const memoryValue = credentialMemoryStore.get(key);
  const sources = {
    persistent: await readPersistentCredentialRecord(key),
    session,
    memory: { map: normalizeCredentialMap(memoryValue), present: memoryValue != null },
    legacy: { map: {}, present: false },
  };
  if (getStorageScope() === STORAGE_SCOPE_REGULAR && profileId === DEFAULT_PROFILE_ID) {
    sources.legacy = await readPersistentCredentialRecord(API_CREDENTIALS_KEY);
  }
  return sources;
}

function credentialSourceOrder(storageStatus) {
  if (storageStatus.mode === API_CREDENTIAL_STORAGE_MODE_PERSISTENT) {
    return ['persistent', 'session', 'memory', 'legacy'];
  }
  if (storageStatus.mode === API_CREDENTIAL_STORAGE_MODE_SESSION) {
    return ['session', 'memory', 'persistent', 'legacy'];
  }
  return ['memory', 'session', 'persistent', 'legacy'];
}

function mergeCredentialSources(sources, order) {
  return Object.fromEntries(API_CREDENTIAL_PROVIDERS.flatMap((provider) => {
    for (const source of order) {
      const value = sources[source]?.map?.[provider];
      if (typeof value === 'string' && value.trim()) return [[provider, value.trim()]];
    }
    return [];
  }));
}

function credentialMapsEqual(left, right) {
  return JSON.stringify(left || {}) === JSON.stringify(right || {});
}

async function removeCredentialSource(profileId, source) {
  const key = credentialStorageKey(profileId);
  if (source === 'persistent') {
    if (typeof adapter.remove === 'function') await adapter.remove(key);
  } else if (source === 'session') {
    const session = getWebExtensionSessionStorage();
    if (session?.remove) await invokeWebExtension(session, 'remove', [key]);
  } else if (source === 'memory') {
    credentialMemoryStore.delete(key);
  } else if (source === 'legacy' && getStorageScope() === STORAGE_SCOPE_REGULAR && profileId === DEFAULT_PROFILE_ID) {
    if (typeof adapter.remove === 'function') await adapter.remove(API_CREDENTIALS_KEY);
  }
}

async function writeCredentialTarget(profileId, credentials, storageStatus) {
  const key = credentialStorageKey(profileId);
  const normalized = normalizeCredentialMap(credentials);
  if (storageStatus.mode === API_CREDENTIAL_STORAGE_MODE_PERSISTENT) {
    if (Object.keys(normalized).length) await adapter.set(key, normalized);
    else await removeCredentialSource(profileId, 'persistent');
  } else if (storageStatus.mode === API_CREDENTIAL_STORAGE_MODE_SESSION) {
    const session = getWebExtensionSessionStorage();
    if (Object.keys(normalized).length) await invokeWebExtension(session, 'set', [{ [key]: normalized }]);
    else await removeCredentialSource(profileId, 'session');
  } else {
    if (Object.keys(normalized).length) credentialMemoryStore.set(key, normalized);
    else credentialMemoryStore.delete(key);
  }
}

async function replaceCredentialCopies(profileId, credentials, storageStatus) {
  const target = storageStatus.mode;
  await writeCredentialTarget(profileId, credentials, storageStatus);
  for (const source of ['persistent', 'session', 'memory', 'legacy']) {
    if (source !== target) await removeCredentialSource(profileId, source);
  }
}

async function clearApiCredentialCopies(profileId) {
  for (const source of ['persistent', 'session', 'memory', 'legacy']) {
    await removeCredentialSource(profileId, source);
  }
}

/** Move credentials between the selected storage mode and the available fallback. */
export async function setApiCredentialStorageMode(mode) {
  const requestedMode = normalizeApiCredentialStorageMode(mode);
  const profileId = await getActiveProfileId();
  const targetStatus = describeCredentialStorageMode(requestedMode);
  const sources = await readCredentialSources(profileId);
  const credentials = mergeCredentialSources(sources, credentialSourceOrder(targetStatus));
  await replaceCredentialCopies(profileId, credentials, targetStatus);

  const state = await loadState();
  state.settings = { ...state.settings, apiCredentialStorageMode: requestedMode };
  await saveState(state);
  return getApiCredentialStorageStatus(profileId);
}

export async function loadApiCredential(provider) {
  if (!API_CREDENTIAL_PROVIDERS.includes(provider)) return null;
  try {
    const credentials = await readApiCredentials(await getActiveProfileId());
    const value = credentials?.[provider];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  } catch (error) {
    console.warn('[AUT] API credential read failed:', error);
    return null;
  }
}

export async function saveApiCredential(provider, credential) {
  assertApiCredentialProvider(provider);
  const value = String(credential ?? '').trim();
  if (!value) return removeApiCredential(provider);
  if (value.length > 4096) throw new Error('API credential is too long');

  const profileId = await getActiveProfileId();
  const storageStatus = await getApiCredentialStorageStatus(profileId);
  const credentials = await readApiCredentials(profileId);
  credentials[provider] = value;
  await replaceCredentialCopies(profileId, credentials, storageStatus);
  return { configured: true, storage: storageStatus.mode };
}

export async function removeApiCredential(provider) {
  assertApiCredentialProvider(provider);
  const profileId = await getActiveProfileId();
  const storageStatus = await getApiCredentialStorageStatus(profileId);
  const credentials = await readApiCredentials(profileId);
  delete credentials[provider];
  await replaceCredentialCopies(profileId, credentials, storageStatus);
  return { configured: false, storage: storageStatus.mode };
}

export async function getApiCredentialStatus() {
  const profileId = await getActiveProfileId();
  const storageStatus = await getApiCredentialStorageStatus(profileId);
  const credentials = await readApiCredentials(profileId);
  return Object.fromEntries(API_CREDENTIAL_PROVIDERS.map((provider) => [provider, {
    configured: typeof credentials[provider] === 'string' && credentials[provider].trim().length > 0,
    storage: storageStatus.mode,
    storageMode: storageStatus.requestedMode,
    recovery: storageStatus.recovery,
    export: 'omitted',
    sync: 'omitted',
  }]));
}

async function readApiCredentials(profileId = null) {
  try {
    const id = profileId || await getActiveProfileId();
    const storageStatus = await getApiCredentialStorageStatus(id);
    const sources = await readCredentialSources(id);
    const credentials = mergeCredentialSources(sources, credentialSourceOrder(storageStatus));
    const target = sources[storageStatus.mode] || { map: {}, present: false };
    const hasStaleCopy = Object.entries(sources)
      .some(([source, record]) => source !== storageStatus.mode && record.present);
    if (!credentialMapsEqual(target.map, credentials) || hasStaleCopy) {
      await replaceCredentialCopies(id, credentials, storageStatus);
    }
    return credentials;
  } catch (error) {
    console.warn('[AUT] API credential map read failed:', error);
    return {};
  }
}

function assertApiCredentialProvider(provider) {
  if (!API_CREDENTIAL_PROVIDERS.includes(provider)) {
    throw new Error(`Unsupported API credential provider: ${String(provider)}`);
  }
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
    if (encodedByteLength(payload) > 2 * 1024 * 1024) throw new Error('Settings import exceeds the 2 MB safety limit');
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
    const importedHistory = validateImportedHistory(payload.history);
    parsed.history = compactHistoryToBudget(importedHistory, { retentionDays: null });
    parsed.historyCompacted = JSON.stringify(parsed.history) !== JSON.stringify(importedHistory);
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
  if (Object.prototype.hasOwnProperty.call(parsed, 'history')) {
    next.history = parsed.history;
    if (parsed.historyCompacted) {
      next.historyDiagnostics = {
        warningCode: 'history-import-compacted',
        compactedAtISO: new Date().toISOString(),
      };
    }
  }
  await saveState(next);
  return next;
}

function sanitizeImportedSettings(input) {
  const settings = mergeDefaults(input, defaultSettings());
  for (const key of Object.keys(settings)) {
    if (key !== 'apiCredentialStorageMode' && /credential|secret|password|token|api.?key/i.test(key)) {
      delete settings[key];
    }
  }
  const refreshValues = [1, 5, 15, 30];
  const retentionValues = [7, 14, 30, 60, 90];
  settings.refreshMinutes = refreshValues.includes(Number(settings.refreshMinutes)) ? Number(settings.refreshMinutes) : 5;
  settings.historyRetentionDays = retentionValues.includes(Number(settings.historyRetentionDays))
    ? Number(settings.historyRetentionDays) : 30;
  settings.silentTabRefresh = settings.silentTabRefresh === true;
  settings.nativeSchedulerEnabled = settings.nativeSchedulerEnabled === true;
  settings.highContrast = settings.highContrast === true;
  settings.syncSettings = settings.syncSettings === true;
  settings.apiCredentialStorageMode = normalizeApiCredentialStorageMode(settings.apiCredentialStorageMode);
  settings.githubCopilotOrganization = sanitizeOptionalIdentifier(settings.githubCopilotOrganization);
  settings.githubCopilotUsername = sanitizeOptionalIdentifier(settings.githubCopilotUsername);
  settings.geminiProjectId = sanitizeProjectIdentifier(settings.geminiProjectId);
  settings.theme = ['mocha', 'latte', 'system'].includes(settings.theme) ? settings.theme : 'mocha';
  settings.showProviders = {
    ...settings.showProviders,
    claude: settings.showProviders?.claude !== false,
    codex: settings.showProviders?.codex !== false,
    'anthropic-api': settings.showProviders?.['anthropic-api'] !== false,
    'openai-api': settings.showProviders?.['openai-api'] !== false,
    'github-copilot': settings.showProviders?.['github-copilot'] !== false,
    cursor: settings.showProviders?.cursor !== false,
    gemini: settings.showProviders?.gemini !== false,
    openrouter: settings.showProviders?.openrouter !== false,
  };
  settings.notifications = mergeDefaults(settings.notifications, defaultSettings().notifications);
  settings.notifications.dailyBriefingHour = clampNumber(settings.notifications.dailyBriefingHour, 0, 23, 8);
  settings.notifications.webhookEnabled = settings.notifications.webhookEnabled === true;
  settings.notifications.webhookURL = normalizeWebhookURL(settings.notifications.webhookURL);
  settings.notifications.webhookIncludeDetails = settings.notifications.webhookIncludeDetails === true;
  settings.notifications.webhookLastAttemptISO = normalizeISO(settings.notifications.webhookLastAttemptISO);
  settings.notifications.webhookLastSuccessISO = normalizeISO(settings.notifications.webhookLastSuccessISO);
  settings.notifications.webhookLastErrorCode = sanitizeErrorCode(settings.notifications.webhookLastErrorCode);
  settings.notifications.webhookLastAttempts = clampNumber(settings.notifications.webhookLastAttempts, 0, 3, 0);
  settings.apiBudget = {
    ...defaultSettings().apiBudget,
    ...(settings.apiBudget || {}),
  };
  settings.apiBudget.sessionCapUSD = normalizeBudgetCap(settings.apiBudget.sessionCapUSD);
  settings.apiBudget.dailyCapUSD = normalizeBudgetCap(settings.apiBudget.dailyCapUSD);
  settings.anomalyThresholdPercent = clampNumber(settings.anomalyThresholdPercent, 10, 50, 20);
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
  if (history.length > 20_000) throw new Error('History import exceeds the sample safety limit');
  return history.map((sample, index) => {
    if (!sample || typeof sample !== 'object' || Array.isArray(sample)
        || !Number.isFinite(Number(sample.ts))
        || typeof sample.bucketId !== 'string'
        || sample.bucketId.length === 0
        || sample.bucketId.length > 128
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

function sanitizeOptionalIdentifier(value) {
  return String(value || '').trim().replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 100);
}

function sanitizeProjectIdentifier(value) {
  const project = String(value || '').trim().toLowerCase();
  return /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project) ? project : '';
}

function normalizeISO(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function sanitizeErrorCode(value) {
  return typeof value === 'string' ? value.trim().slice(0, 96) : null;
}

function normalizeNotificationRetries(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [key, raw] of Object.entries(value).slice(0, 256)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const attempts = clampNumber(raw.attempts, 0, 3, 0);
    const status = raw.status === 'exhausted' || attempts >= 3 ? 'exhausted' : 'retrying';
    out[String(key).slice(0, 256)] = {
      attempts,
      status,
      nextRetryISO: normalizeISO(raw.nextRetryISO),
      lastAttemptISO: normalizeISO(raw.lastAttemptISO),
      lastErrorCode: sanitizeErrorCode(raw.lastErrorCode),
      tone: 'delivery-failure',
      ruleId: typeof raw.ruleId === 'string' ? raw.ruleId.trim().slice(0, 64) : null,
      provider: typeof raw.provider === 'string' ? raw.provider.trim().slice(0, 64) : null,
      bucketId: typeof raw.bucketId === 'string' ? raw.bucketId.trim().slice(0, 160) : null,
    };
  }
  return out;
}

function cloneJSON(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function encodedByteLength(value) {
  const text = String(value ?? '');
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).byteLength;
  return text.length;
}

export function defaultState() {
  return {
    stateVersion: CURRENT_STATE_VERSION,
    snapshot: {
      fetchedAtISO: null,
      providers: {
        claude: null,
        codex: null,
        'anthropic-api': null,
        'openai-api': null,
        'github-copilot': null,
        cursor: null,
        gemini: null,
        openrouter: null,
      },
    },
    history: [],          // [{ ts, bucketId, percentUsed }]
    firedRules: {},       // { '<provider>-<bucket>-<rule>-<resetISO>': true }
    notificationRetries: {}, // { '<fireKey>': bounded delivery retry state }
    budget: defaultBudgetLedger(),
    collaboration: defaultCollaborationState(),
    cache: {},
    settings: defaultSettings(),
    widget: { x: null, y: null, minimized: false },
  };
}

export function defaultSettings() {
  return {
    refreshMinutes: 5,
    silentTabRefresh: false,
    nativeSchedulerEnabled: false,
    highContrast: false,
    syncSettings: false,
    apiCredentialStorageMode: API_CREDENTIAL_STORAGE_MODE_SESSION,
    githubCopilotOrganization: '',
    githubCopilotUsername: '',
    locale: 'en',
    showProviders: {
      claude: true,
      codex: true,
      'anthropic-api': true,
      'openai-api': true,
      'github-copilot': true,
      cursor: true,
      gemini: true,
      openrouter: true,
    },
    geminiProjectId: '',
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
      'U3':    false,
      'D1':    true,
      dailyBriefingHour: 8,    // 24h local
      webhookEnabled: false,
      webhookURL: '',
      webhookIncludeDetails: false,
      webhookLastAttemptISO: null,
      webhookLastSuccessISO: null,
      webhookLastErrorCode: null,
      webhookLastAttempts: 0,
    },
    theme: 'mocha',            // 'mocha' (default) | 'latte' | 'system'
    thresholds: {
      warnAt: 50,
      dangerAt: 80,
    },
    anomalyThresholdPercent: 20,
    historyRetentionDays: 30,
    apiBudget: {
      sessionCapUSD: 0,
      dailyCapUSD: 0,
    },
  };
}
