import { normalizeThresholds } from './countdown.js';
import { defaultSettings } from './storage.js';
import { resolveLocale } from './i18n.js';
import { normalizeWebhookURL } from './notify.js';
import { normalizeBudgetCap } from './budget.js';

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
  next.nativeSchedulerEnabled = next.nativeSchedulerEnabled === true;
  next.highContrast = next.highContrast === true;
  next.syncSettings = next.syncSettings === true;
  next.githubCopilotOrganization = sanitizeIdentifier(next.githubCopilotOrganization);
  next.githubCopilotUsername = sanitizeIdentifier(next.githubCopilotUsername);
  next.geminiProjectId = sanitizeProjectIdentifier(next.geminiProjectId);
  next.locale = resolveLocale(next.locale);
  next.showProviders = {
    claude: next.showProviders?.claude !== false,
    codex: next.showProviders?.codex !== false,
    'anthropic-api': next.showProviders?.['anthropic-api'] !== false,
    'openai-api': next.showProviders?.['openai-api'] !== false,
    'github-copilot': next.showProviders?.['github-copilot'] !== false,
    cursor: next.showProviders?.cursor !== false,
    gemini: next.showProviders?.gemini !== false,
    openrouter: next.showProviders?.openrouter !== false,
  };
  next.showRows = { ...next.showRows };
  next.notifications = { ...next.notifications };
  next.notifications.dailyBriefingHour = clampInteger(next.notifications.dailyBriefingHour, 0, 23, 8);
  next.notifications.webhookEnabled = next.notifications.webhookEnabled === true;
  next.notifications.webhookURL = normalizeWebhookURL(next.notifications.webhookURL);
  next.notifications.webhookIncludeDetails = next.notifications.webhookIncludeDetails === true;
  next.notifications.webhookLastAttemptISO = normalizeISO(next.notifications.webhookLastAttemptISO);
  next.notifications.webhookLastSuccessISO = normalizeISO(next.notifications.webhookLastSuccessISO);
  next.notifications.webhookLastErrorCode = typeof next.notifications.webhookLastErrorCode === 'string'
    ? next.notifications.webhookLastErrorCode.trim().slice(0, 96) : null;
  next.notifications.webhookLastAttempts = clampInteger(next.notifications.webhookLastAttempts, 0, 3, 0);
  next.apiBudget = { ...defaultSettings().apiBudget, ...(next.apiBudget || {}) };
  next.apiBudget.sessionCapUSD = normalizeBudgetCap(next.apiBudget.sessionCapUSD);
  next.apiBudget.dailyCapUSD = normalizeBudgetCap(next.apiBudget.dailyCapUSD);
  next.anomalyThresholdPercent = clampInteger(next.anomalyThresholdPercent, 10, 50, 20);
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
  if (provider === 'claude') return 'Claude';
  if (provider === 'codex') return 'Codex';
  if (provider === 'anthropic-api') return 'Anthropic API';
  if (provider === 'openai-api') return 'OpenAI API';
  if (provider === 'github-copilot') return 'GitHub Copilot';
  if (provider === 'cursor') return 'Cursor';
  if (provider === 'gemini') return 'Gemini';
  if (provider === 'openrouter') return 'OpenRouter';
  return String(provider);
}

function clampInteger(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function sanitizeIdentifier(value) {
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
