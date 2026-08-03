import { normalizeThresholds } from './countdown.js';
import { defaultSettings } from './storage.js';

export const KNOWN_ROWS = [
  { id: 'claude-session', label: 'Claude - Current session' },
  { id: 'claude-weekly-all', label: 'Claude - Weekly (All models)' },
  { id: 'claude-weekly-sonnet', label: 'Claude - Weekly (Sonnet only)' },
  { id: 'claude-weekly-design', label: 'Claude - Weekly (Claude Design)' },
  { id: 'codex-5h-all', label: 'Codex - 5-hour limit' },
  { id: 'codex-weekly-all', label: 'Codex - Weekly limit' },
];

const REFRESH_MINUTES = [1, 5, 15, 30];
const RETENTION_DAYS = [7, 14, 30, 60, 90];

export function normalizeThemeValue(theme) {
  if (theme === 'latte' || theme === 'mocha-light') return 'latte';
  if (theme === 'system') return 'system';
  return 'mocha';
}

export function normalizeSettings(input = {}) {
  const next = mergeDefaults(input, defaultSettings());
  next.refreshMinutes = REFRESH_MINUTES.includes(Number(next.refreshMinutes))
    ? Number(next.refreshMinutes)
    : 5;
  next.silentTabRefresh = next.silentTabRefresh === true;
  next.highContrast = next.highContrast === true;
  next.showProviders = {
    claude: next.showProviders?.claude !== false,
    codex: next.showProviders?.codex !== false,
  };
  next.showRows = { ...next.showRows };
  next.notifications = { ...next.notifications };
  next.notifications.dailyBriefingHour = clampInteger(next.notifications.dailyBriefingHour, 0, 23, 8);
  next.theme = normalizeThemeValue(next.theme);
  next.thresholds = normalizeThresholds(next.thresholds);
  next.historyRetentionDays = RETENTION_DAYS.includes(Number(next.historyRetentionDays))
    ? Number(next.historyRetentionDays)
    : 30;
  return next;
}

export function listRowOptions(state = {}) {
  const out = KNOWN_ROWS.map((row) => ({ ...row }));
  const known = new Set(out.map((row) => row.id));
  for (const [provider, providerState] of Object.entries(state.snapshot?.providers || {})) {
    if (!providerState?.ok) continue;
    for (const bucket of providerState.buckets || []) {
      if (!bucket?.id || known.has(bucket.id)) continue;
      out.push({
        id: bucket.id,
        label: `${providerLabel(provider)} - ${bucket.label || bucket.id}`,
      });
      known.add(bucket.id);
    }
  }
  return out;
}

export function defaultRowEnabled(rowId) {
  return ['claude-session', 'claude-weekly-all', 'codex-5h-all', 'codex-weekly-all'].includes(rowId);
}

function providerLabel(provider) {
  return provider === 'claude' ? 'Claude' : provider === 'codex' ? 'Codex' : String(provider);
}

function clampInteger(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function mergeDefaults(current, defaults) {
  if (!current || typeof current !== 'object' || Array.isArray(current)) return clone(defaults);
  const out = { ...defaults };
  for (const key of Object.keys(current)) {
    const value = current[key];
    if (value != null && typeof value === 'object' && !Array.isArray(value)
        && defaults[key] && typeof defaults[key] === 'object' && !Array.isArray(defaults[key])) {
      out[key] = mergeDefaults(value, defaults[key]);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
