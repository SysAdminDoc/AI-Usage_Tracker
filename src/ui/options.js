import {
  exportSettings,
  getStorageUsage,
  getSyncSettingsStatus,
  importSettings,
  loadState,
  saveState,
  defaultSettings,
  createProfile,
  deleteProfile,
  getActiveProfile,
  isIncognitoContext,
  listProfiles,
  renameProfile,
  loadProfileRegistry,
  switchProfile,
  getApiCredentialStatus,
  removeApiCredential,
  saveApiCredential,
  clearSyncedSettings,
  loadSyncedSettings,
  mergeSyncedSettings,
} from '../lib/storage.js';
import {
  compactHistory,
  historyStats,
  historyToCSV,
} from '../lib/history.js';
import {
  defaultRowEnabled,
  listRowOptions,
  normalizeSettings,
  normalizeThemeValue,
} from '../lib/settings.js';
import { normalizeThresholds } from '../lib/countdown.js';
import { clearChildren } from '../lib/dom.js';
import {
  getNotificationPermission,
  getApiProviderHostPermission,
  notify,
  requestNotificationPermission,
  requestApiProviderHostPermission,
  removeApiProviderHostPermission,
  requestWebhookHostPermission,
} from '../lib/browser.js';
import { normalizeBudgetCap, resetSessionBudget } from '../lib/budget.js';
import { forecastMonthEnd } from '../lib/forecast.js';
import { buildPlanRecommendations } from '../lib/optimization.js';
import { buildSupportBundle } from '../lib/diagnostics.js';
import { exportMcpState } from '../lib/mcp-state.js';
import {
  buildCollaborationContribution,
  buildCollaborationDashboard,
  buildCollaborationLedger,
  buildCollaborationInvoiceRows,
  collaborationToCSV,
  mergeCollaborationImport,
  normalizeCollaborationState,
} from '../lib/collaboration.js';
import { apiBreakdownToCSV, buildApiBreakdown } from '../lib/api-breakdown.js';
import { API_PROVIDER_IDS, API_PROVIDER_META } from '../providers/api-contract.js';
import { buildWebhookPayload, deliverWebhook, normalizeWebhookURL } from '../lib/notify.js';
import { applyDocumentLocale, createI18n } from '../lib/i18n.js';

const VERSION = '0.2.3';

const saveStatus = document.getElementById('saveStatus');
let activeI18n = createI18n('en');

function t(key, variables = {}) {
  return activeI18n.t(key, variables);
}

function setActiveLocale(locale) {
  activeI18n = createI18n(locale);
  applyDocumentLocale(activeI18n);
  return activeI18n;
}

export const ready = init();

export async function init() {
  const initialState = await loadState();
  setActiveLocale(initialState.settings?.locale);
  document.querySelector('.opt-head__sub').textContent = t('options.header', {
    version: t('app.version', { version: VERSION.slice(1) }),
  });
  if (isIncognitoContext()) document.querySelector('.opt-head__sub').textContent = `${t('app.incognito')} · ${document.querySelector('.opt-head__sub').textContent}`;
  saveStatus.textContent = t('app.ready');

  // Populate daily-briefing hour select
  const hourSelect = document.getElementById('dailyBriefingHour');
  for (let h = 0; h < 24; h++) {
    const opt = document.createElement('option');
    opt.value = h;
    opt.textContent = `${h.toString().padStart(2, '0')}:00`;
    hourSelect.appendChild(opt);
  }

  await renderProfiles();
  await renderProviders();
  await renderApiCredentials();
  await renderRows();
  await loadCurrent();
  await renderSyncSettings();
  await renderNotificationPermission();
  await renderHistoryStatus();
  await renderDiagnostics();
  bindHandlers();
}

export async function renderProfiles() {
  const list = document.getElementById('profileList');
  const status = document.getElementById('profileStatus');
  if (!list) return;
  const registry = await loadProfileRegistry();
  const active = await getActiveProfile();
  clearChildren(list);
  for (const profile of registry.profiles) {
    const item = document.createElement('article');
    item.className = 'profile-item';
    item.dataset.profileId = profile.id;

    const identity = document.createElement('div');
    identity.className = 'profile-item__identity';
    const name = document.createElement('strong');
    name.className = 'profile-item__name';
    name.textContent = profile.name;
    const meta = document.createElement('span');
    meta.className = 'profile-item__meta';
    meta.textContent = profile.id === active.id ? t('inline.active') : t('inline.local');
    identity.append(name, meta);

    const actions = document.createElement('div');
    actions.className = 'profile-item__actions';
    const rename = document.createElement('input');
    rename.className = 'profile-item__rename';
    rename.type = 'text';
    rename.maxLength = 48;
    rename.value = profile.name;
    rename.setAttribute('aria-label', t('options.renameProfile', { name: profile.name }));
    rename.dataset.profileRename = profile.id;
    const switchButton = profileButton('switch', profile.id, profile.id === active.id ? t('app.active') : t('app.switch'));
    switchButton.disabled = profile.id === active.id;
    const renameButton = profileButton('rename', profile.id, t('app.rename'));
    const deleteButton = profileButton('delete', profile.id, t('app.delete'), 'opt-btn--quiet');
    deleteButton.disabled = registry.profiles.length <= 1;
    actions.append(rename, switchButton, renameButton, deleteButton);
    item.append(identity, actions);
    list.appendChild(item);
  }
  if (status) {
    const scope = isIncognitoContext() ? `${t('app.incognito')} · ` : '';
    status.textContent = `${scope}${t('options.activeProfileStatus', {
      name: active.name,
      count: registry.profiles.length,
      profiles: t('plural.member.other'),
    })}`;
    status.className = 'opt-callout opt-callout--good';
  }
}

function profileButton(action, profileId, text, extraClass = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `opt-btn ${extraClass}`.trim();
  button.dataset.profileAction = action;
  button.dataset.profileId = profileId;
  button.textContent = text;
  return button;
}

async function refreshAfterProfileChange(message) {
  await renderProfiles();
  await renderApiCredentials();
  await renderRows();
  await loadCurrent();
  await renderSyncSettings();
  await renderHistoryStatus();
  await renderDiagnostics();
  flash(message);
  sendRuntimeMessage({ type: 'aut/profile-updated' }).catch(() => {});
}

async function renderProviders() {
  const wrap = document.getElementById('provider-toggles');
  clearChildren(wrap);
  for (const id of ['claude', 'codex', ...API_PROVIDER_IDS]) {
    const label = document.createElement('label');
    label.className = 'opt-toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.provider = id;
    const labelText = providerLabel(id);
    label.append(input, document.createTextNode(labelText));
    wrap.appendChild(label);
  }
}

async function renderApiCredentials() {
  const wrap = document.getElementById('api-credentials');
  const statusWrap = document.getElementById('apiCredentialsStatus');
  if (!wrap) return;
  const state = await loadState();
  const settings = normalizeSettings(state.settings);
  const statuses = await getApiCredentialStatus();
  const hostPermissions = Object.fromEntries(await Promise.all(API_PROVIDER_IDS.map(async (id) => [
    id,
    await getApiProviderHostPermission(id),
  ])));
  clearChildren(wrap);
  const configured = API_PROVIDER_IDS.filter((id) => statuses[id]?.configured).length;
  if (statusWrap) {
    const missingPermission = API_PROVIDER_IDS.filter((id) => statuses[id]?.configured && !hostPermissions[id]?.ok).length;
    statusWrap.textContent = configured
      ? t('options.credentialsConfigured', { count: configured, missing: missingPermission ? t('options.missingPermissions', { count: missingPermission }) : '' })
      : t('options.noCredentials');
    statusWrap.className = `opt-callout ${missingPermission ? 'opt-callout--warn' : configured ? 'opt-callout--good' : ''}`;
  }

  for (const id of API_PROVIDER_IDS) {
    const meta = API_PROVIDER_META[id];
    const card = document.createElement('article');
    card.className = 'api-credential';
    const head = document.createElement('div');
    head.className = 'api-credential__head';
    const title = document.createElement('strong');
    title.textContent = providerLabel(id);
    const docs = document.createElement('a');
    docs.href = meta.docsUrl;
    docs.target = '_blank';
    docs.rel = 'noreferrer';
    docs.textContent = t('app.officialDocs');
    head.append(title, docs);
    const hint = document.createElement('p');
    hint.className = 'api-credential__hint';
    hint.textContent = providerMetaText(id, 'hint');
    const costHint = document.createElement('p');
    costHint.className = 'api-credential__cost-hint';
    costHint.textContent = providerMetaText(id, 'costHint');
    const input = document.createElement('input');
    input.type = 'password';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = providerMetaText(id, 'placeholder');
    input.dataset.apiProvider = id;
    input.setAttribute('aria-label', t('options.credentialValue', { label: providerMetaText(id, 'credentialLabel') }));
    let providerConfig = null;
    if (id === 'github-copilot') {
      const config = document.createElement('div');
      config.className = 'opt-grid';
      const organizationLabel = document.createElement('label');
      organizationLabel.textContent = t('options.githubOrganization');
      const organization = document.createElement('input');
      organization.type = 'text';
      organization.autocomplete = 'off';
      organization.spellcheck = false;
      organization.placeholder = t('options.orgPlaceholder');
      organization.value = settings.githubCopilotOrganization || '';
      organization.dataset.apiConfig = 'githubCopilotOrganization';
      organization.setAttribute('aria-label', t('options.githubCopilotOrganization'));
      organizationLabel.appendChild(organization);
      const usernameLabel = document.createElement('label');
      usernameLabel.textContent = t('options.githubUsername');
      const username = document.createElement('input');
      username.type = 'text';
      username.autocomplete = 'off';
      username.spellcheck = false;
      username.placeholder = t('options.usernamePlaceholder');
      username.value = settings.githubCopilotUsername || '';
      username.dataset.apiConfig = 'githubCopilotUsername';
      username.setAttribute('aria-label', t('options.githubCopilotUsername'));
      usernameLabel.appendChild(username);
      config.append(organizationLabel, usernameLabel);
      providerConfig = config;
    } else if (id === 'gemini') {
      const config = document.createElement('div');
      config.className = 'opt-grid';
      const projectLabel = document.createElement('label');
      projectLabel.textContent = t('options.googleProject');
      const project = document.createElement('input');
      project.type = 'text';
      project.autocomplete = 'off';
      project.spellcheck = false;
      project.placeholder = t('options.geminiProjectPlaceholder');
      project.value = settings.geminiProjectId || '';
      project.dataset.apiConfig = 'geminiProjectId';
      project.setAttribute('aria-label', t('options.geminiProject'));
      projectLabel.appendChild(project);
      config.appendChild(projectLabel);
      providerConfig = config;
    }
    const actions = document.createElement('div');
    actions.className = 'api-credential__actions';
    actions.append(
      apiButton('save', id, t('app.saveKey')),
      apiButton('refresh', id, t('app.saveAndRefresh')),
      apiButton('revoke', id, t('app.revoke'), 'opt-btn--quiet'),
    );
    const credentialStatus = document.createElement('p');
    credentialStatus.className = 'api-credential__status';
    credentialStatus.textContent = statuses[id]?.configured
      ? hostPermissions[id]?.ok
        ? t('options.credentialConfigured')
        : t('options.credentialPermissionMissing')
      : t('options.credentialNotConfigured');
    credentialStatus.dataset.apiStatus = id;
    card.append(head, hint, costHint, input);
    if (providerConfig) card.appendChild(providerConfig);
    card.append(actions, credentialStatus);
    wrap.appendChild(card);
  }
}

function apiButton(action, provider, text, extraClass = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `opt-btn ${extraClass}`.trim();
  button.dataset.apiAction = action;
  button.dataset.apiProvider = provider;
  button.textContent = text;
  return button;
}

async function renderRows() {
  const state = await loadState();
  const wrap = document.getElementById('row-toggles');
  clearChildren(wrap);
  for (const row of listRowOptions(state)) {
    const label = document.createElement('label');
    label.className = 'opt-toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.row = row.id;
    label.append(input, document.createTextNode(row.label));
    wrap.appendChild(label);
  }
}

async function loadCurrent() {
  const state = await loadState();
  const s = normalizeSettings(state.settings);
  const notifications = s.notifications || {};
  applyTheme(s);

  for (const cb of document.querySelectorAll('[data-provider]')) {
    cb.checked = !!s.showProviders[cb.dataset.provider];
  }
  for (const cb of document.querySelectorAll('[data-row]')) {
    cb.checked = s.showRows[cb.dataset.row] ?? defaultRowEnabled(cb.dataset.row);
  }
  for (const cb of document.querySelectorAll('[data-notif]')) {
    cb.checked = !!notifications[cb.dataset.notif];
  }
  document.getElementById('refreshMinutes').value = String(s.refreshMinutes ?? 5);
  document.getElementById('silentTabRefresh').checked = s.silentTabRefresh === true;
  document.getElementById('nativeSchedulerEnabled').checked = s.nativeSchedulerEnabled === true;
  document.getElementById('highContrast').checked = s.highContrast === true;
  document.getElementById('dailyBriefingHour').value = String(notifications.dailyBriefingHour ?? 8);
  document.getElementById('theme').value = normalizeThemeValue(s.theme);
  document.getElementById('locale').value = s.locale || 'en';
  const thresholds = normalizeThresholds(s.thresholds);
  document.getElementById('warnAt').value = String(thresholds.warnAt);
  document.getElementById('dangerAt').value = String(thresholds.dangerAt);
  document.getElementById('anomalyThresholdPercent').value = String(s.anomalyThresholdPercent ?? 20);
  document.getElementById('historyRetentionDays').value = String(s.historyRetentionDays);
  document.getElementById('webhookEnabled').checked = s.notifications.webhookEnabled === true;
  document.getElementById('webhookURL').value = s.notifications.webhookURL || '';
  document.getElementById('webhookIncludeDetails').checked = s.notifications.webhookIncludeDetails === true;
  document.getElementById('sessionBudgetCap').value = s.apiBudget.sessionCapUSD ? String(s.apiBudget.sessionCapUSD) : '';
  document.getElementById('dailyBudgetCap').value = s.apiBudget.dailyCapUSD ? String(s.apiBudget.dailyCapUSD) : '';
  const syncCheckbox = document.getElementById('syncSettings');
  if (syncCheckbox) syncCheckbox.checked = s.syncSettings === true;
  setThresholdLabels(thresholds);
  renderSnoozeStatus(s);
  renderNativeSchedulerStatus(s);
  renderWebhookStatus(s);
  renderBudgetStatus(s, state.budget);
  await renderForecastStatus();
  await renderApiBreakdown();
  await renderCollaboration();
}

export async function renderSyncSettings(state = null) {
  const checkbox = document.getElementById('syncSettings');
  const status = document.getElementById('syncStatus');
  const clearButton = document.getElementById('clearSyncedSettings');
  if (!checkbox || !status) return;
  const current = state || await loadState();
  const result = await getSyncSettingsStatus(current.profileId);
  checkbox.disabled = !result.supported;
  if (!result.supported) {
    status.textContent = t('options.syncUnavailable');
    status.className = 'opt-callout';
  } else if (current.settings?.syncSettings === true) {
    status.textContent = result.hasRemote
      ? t('options.syncEnabled')
      : t('options.syncPublishing');
    status.className = 'opt-callout opt-callout--good';
  } else {
    status.textContent = result.hasRemote
      ? t('options.syncAvailable')
      : t('options.syncOff');
    status.className = 'opt-callout';
  }
  if (clearButton) clearButton.disabled = !result.supported || !result.hasRemote;
}

function readThresholdControls(changedId) {
  let warnAt = parseInt(document.getElementById('warnAt').value, 10) || 50;
  let dangerAt = parseInt(document.getElementById('dangerAt').value, 10) || 80;
  if (warnAt >= dangerAt) {
    if (changedId === 'warnAt') {
      dangerAt = Math.min(95, warnAt + 5);
    } else {
      warnAt = Math.max(25, dangerAt - 5);
    }
  }
  const next = normalizeThresholds({ warnAt, dangerAt });
  document.getElementById('warnAt').value = String(next.warnAt);
  document.getElementById('dangerAt').value = String(next.dangerAt);
  setThresholdLabels(next);
  return next;
}

function setThresholdLabels(thresholds) {
  document.getElementById('warnAtValue').textContent = `${thresholds.warnAt}%`;
  document.getElementById('dangerAtValue').textContent = `${thresholds.dangerAt}%`;
}

export function renderSnoozeStatus(settings = {}) {
  const wrap = document.getElementById('snoozeStatus');
  const clearBtn = document.getElementById('clearSnooze');
  if (!wrap) return;
  const until = settings.notifications?.snoozedUntilISO || '';
  const ts = until ? new Date(until).getTime() : 0;
  const active = Number.isFinite(ts) && ts > Date.now();
  wrap.textContent = active
    ? t('options.snoozedUntil', { time: activeI18n.formatTime(new Date(ts).toISOString()) })
    : t('options.notificationsActive');
  wrap.className = `opt-callout ${active ? 'opt-callout--warn' : 'opt-callout--good'}`;
  if (clearBtn) clearBtn.disabled = !active;
}

export async function renderNotificationPermission(capability = getNotificationPermission()) {
  const wrap = document.getElementById('notificationPermissionStatus');
  if (!wrap) return capability;
  const labels = {
    extension: t('options.permissionExtension'),
    'userscript-manager': t('options.permissionUserscript'),
    web: capability.state === 'granted'
      ? t('options.permissionWebGranted')
      : capability.state === 'denied'
        ? t('options.permissionWebDenied')
        : t('options.permissionWebPending'),
    unavailable: t('options.permissionUnavailable'),
  };
  wrap.textContent = labels[capability.source] || capability.detail || t('options.permissionUnknown');
  wrap.className = `opt-callout ${capability.state === 'granted' ? 'opt-callout--good' : capability.state === 'denied' ? 'opt-callout--warn' : ''}`;
  return capability;
}

export function renderWebhookStatus(settings = {}) {
  const wrap = document.getElementById('webhookStatus');
  if (!wrap) return;
  const notifications = settings.notifications || {};
  const enabled = notifications.webhookEnabled === true;
  const hasURL = !!normalizeWebhookURL(notifications.webhookURL);
  const attempts = Number(notifications.webhookLastAttempts) || 0;
  if (!enabled) {
    wrap.textContent = t('options.webhookOff');
    wrap.className = 'opt-callout';
  } else if (!hasURL) {
    wrap.textContent = t('options.webhookNoURL');
    wrap.className = 'opt-callout opt-callout--warn';
  } else if (notifications.webhookLastErrorCode) {
    wrap.textContent = t('options.webhookFailed', { attempts: attempts || 1, code: notifications.webhookLastErrorCode });
    wrap.className = 'opt-callout opt-callout--warn';
  } else if (notifications.webhookLastSuccessISO) {
    wrap.textContent = t('options.webhookDelivered', { relative: formatAgo(notifications.webhookLastSuccessISO) });
    wrap.className = 'opt-callout opt-callout--good';
  } else {
    wrap.textContent = t('options.webhookNext');
    wrap.className = 'opt-callout opt-callout--good';
  }
}

export function renderNativeSchedulerStatus(settings = {}) {
  const wrap = document.getElementById('nativeSchedulerStatus');
  if (!wrap) return;
  const enabled = settings.nativeSchedulerEnabled === true;
  const runtime = getRuntime();
  const nativeMessagingAvailable = typeof runtime?.connectNative === 'function';
  if (!enabled) {
    wrap.textContent = t('options.schedulerOff');
    wrap.className = 'opt-callout';
  } else if (!nativeMessagingAvailable) {
    wrap.textContent = t('options.schedulerUnavailable');
    wrap.className = 'opt-callout opt-callout--warn';
  } else {
    wrap.textContent = t('options.schedulerEnabled');
    wrap.className = 'opt-callout opt-callout--good';
  }
}

export function renderBudgetStatus(settings = {}, budget = {}) {
  const wrap = document.getElementById('budgetStatus');
  if (!wrap) return;
  const caps = settings.apiBudget || {};
  const sessionCap = normalizeBudgetCap(caps.sessionCapUSD);
  const dailyCap = normalizeBudgetCap(caps.dailyCapUSD);
  if (!sessionCap && !dailyCap) {
    wrap.textContent = t('options.noBudget');
    wrap.className = 'opt-callout';
    return;
  }
  const parts = [];
  if (sessionCap) parts.push(t('options.sessionBudget', { spent: formatUSD(budget.sessionSpentUSD), cap: formatUSD(sessionCap) }));
  if (dailyCap) parts.push(t('options.dailyBudget', { spent: formatUSD(budget.dailySpentUSD), cap: formatUSD(dailyCap) }));
  wrap.textContent = t('options.budgetStatus', { parts: parts.join(' · ') });
  const over = (sessionCap && Number(budget.sessionSpentUSD) >= sessionCap)
    || (dailyCap && Number(budget.dailySpentUSD) >= dailyCap);
  const warn = (sessionCap && Number(budget.sessionSpentUSD) >= sessionCap * 0.8)
    || (dailyCap && Number(budget.dailySpentUSD) >= dailyCap * 0.8);
  wrap.className = `opt-callout ${over ? 'opt-callout--warn' : warn ? 'opt-callout--warn' : 'opt-callout--good'}`;
}

export async function renderForecastStatus() {
  const status = document.getElementById('forecastStatus');
  const breakdown = document.getElementById('forecastBreakdown');
  if (!status || !breakdown) return;
  const state = await loadState();
  const forecast = forecastMonthEnd(state.snapshot);
  renderOptimizationStatus(buildPlanRecommendations(state.snapshot, forecast));
  clearChildren(breakdown);

  if (!forecast.providers.length) {
    status.textContent = t('options.noForecast');
    status.className = 'opt-callout';
    return forecast;
  }

  const total = forecast.total;
  const projected = total.projectedUSD == null
    ? t('forecast.waiting')
    : `${t('forecast.projected', { amount: formatUSD(total.projectedUSD), date: formatForecastDate(forecast.monthEndISO) })} (${t('forecast.confidence', { label: total.confidenceLabel })}).`;
  status.textContent = t('options.forecastStatus', {
    projected,
    observed: formatUSD(total.observedUSD),
    count: total.providerCount,
    assumptions: forecast.assumptions.join(' '),
  });
  status.className = `opt-callout ${!total.confidence || total.confidence === 'low' ? 'opt-callout--warn' : 'opt-callout--good'}`;

  for (const entry of forecast.providers) {
    const card = document.createElement('article');
    card.className = 'forecast-provider';
    const head = document.createElement('div');
    head.className = 'forecast-provider__head';
    const label = document.createElement('strong');
    label.textContent = entry.label;
    const confidence = document.createElement('span');
    confidence.className = `forecast-provider__confidence forecast-provider__confidence--${entry.confidence}`;
    confidence.textContent = t('options.confidence', { label: entry.confidenceLabel });
    head.append(label, confidence);
    const observed = document.createElement('p');
    observed.textContent = t('options.observedDays', { amount: formatUSD(entry.observedUSD), days: activeI18n.formatNumber(entry.observedDays, { maximumFractionDigits: 2 }), source: entry.sourceLabel });
    const projection = document.createElement('p');
    projection.textContent = entry.projectedUSD == null
      ? t('forecast.projectionUnavailable')
      : t('forecast.projectedMonthEnd', { amount: formatUSD(entry.projectedUSD) });
    const assumptions = document.createElement('p');
    assumptions.className = 'forecast-provider__assumptions';
    assumptions.textContent = t('forecast.assumptions', { text: entry.assumptions.join(' ') });
    card.append(head, observed, projection, assumptions);
    breakdown.appendChild(card);
  }
  return forecast;
}

export async function renderApiBreakdown() {
  const status = document.getElementById('apiBreakdownStatus');
  const wrap = document.getElementById('apiBreakdown');
  const exportButton = document.getElementById('exportApiBreakdown');
  if (!status || !wrap) return null;
  const state = await loadState();
  const breakdown = buildApiBreakdown(state.snapshot);
  clearChildren(wrap);
  if (exportButton) exportButton.disabled = breakdown.rows.length === 0;
  if (!breakdown.rows.length) {
    status.textContent = t('options.breakdownNone');
    status.className = 'opt-callout';
    return breakdown;
  }
  status.textContent = t('options.breakdownStatus', { count: breakdown.rows.length });
  status.className = 'opt-callout opt-callout--good';
  for (const row of breakdown.rows) {
    const item = document.createElement('article');
    item.className = 'api-breakdown__row';
    const head = document.createElement('div');
    head.className = 'api-breakdown__head';
    const provider = document.createElement('strong');
    provider.textContent = row.providerLabel;
    const value = document.createElement('span');
    value.className = 'api-breakdown__value';
    value.textContent = apiMetricSummary(row);
    head.append(provider, value);
    const group = document.createElement('span');
    group.className = 'api-breakdown__meta';
    group.textContent = row.group;
    const source = document.createElement('span');
    source.className = 'api-breakdown__source';
    source.textContent = [
      row.model ? t('options.model', { model: row.model }) : '',
      row.costSource ? (row.costSource === 'pricing-table' ? t('options.pricingEstimate') : t('options.officialCost')) : t('options.usageMetric'),
    ].filter(Boolean).join(' · ');
    item.append(head, group, source);
    wrap.appendChild(item);
  }
  return breakdown;
}

export async function renderCollaboration() {
  const status = document.getElementById('collaborationStatus');
  const breakdown = document.getElementById('collaborationBreakdown');
  if (!status || !breakdown) return null;
  const state = await loadState();
  const collaboration = normalizeCollaborationState(state.collaboration);
  const dashboard = buildCollaborationDashboard(collaboration);
  const enabled = document.getElementById('collaborationEnabled');
  const teamName = document.getElementById('collaborationTeamName');
  const memberName = document.getElementById('collaborationMemberName');
  const attributionEnabled = document.getElementById('collaborationAttributionEnabled');
  const clientName = document.getElementById('collaborationClientName');
  const projectName = document.getElementById('collaborationProjectName');
  const branchName = document.getElementById('collaborationBranchName');
  if (enabled) enabled.checked = collaboration.enabled;
  if (teamName && document.activeElement !== teamName) teamName.value = collaboration.teamName;
  if (memberName && document.activeElement !== memberName) memberName.value = collaboration.memberName;
  if (attributionEnabled) {
    attributionEnabled.checked = collaboration.attribution.enabled;
    attributionEnabled.disabled = !collaboration.enabled;
  }
  for (const [input, value] of [[clientName, collaboration.attribution.clientName], [projectName, collaboration.attribution.projectName], [branchName, collaboration.attribution.branchName]]) {
    if (input && document.activeElement !== input) input.value = value;
    if (input) input.disabled = !collaboration.enabled || !collaboration.attribution.enabled;
  }
  const importButton = document.getElementById('importCollaboration');
  const exportContributionButton = document.getElementById('exportCollaborationContribution');
  const exportLedgerButton = document.getElementById('exportCollaborationLedger');
  const exportInvoiceButton = document.getElementById('exportCollaborationInvoice');
  const clearButton = document.getElementById('clearCollaboration');
  const invoiceRows = buildCollaborationInvoiceRows(collaboration);
  if (importButton) importButton.disabled = !collaboration.enabled;
  if (exportContributionButton) exportContributionButton.disabled = !collaboration.enabled;
  if (exportLedgerButton) exportLedgerButton.disabled = !collaboration.enabled || dashboard.contributionCount === 0;
  if (exportInvoiceButton) exportInvoiceButton.disabled = !collaboration.enabled || invoiceRows.length === 0;
  if (clearButton) clearButton.disabled = dashboard.contributionCount === 0;
  clearChildren(breakdown);

  if (dashboard.status === 'disabled') {
    status.textContent = t('options.teamOff');
    status.className = 'opt-callout';
    return dashboard;
  }
  if (dashboard.status === 'empty') {
    status.textContent = t('options.teamEmpty');
    status.className = 'opt-callout opt-callout--warn';
    return dashboard;
  }

  status.textContent = t('options.teamStatus', {
    team: dashboard.teamName,
    members: activeI18n.tp('plural.member', dashboard.memberCount),
    contributions: activeI18n.tp('plural.contribution', dashboard.contributionCount),
    cost: formatUSD(dashboard.total.costUSD),
  });
  status.className = 'opt-callout opt-callout--good';
  const heading = document.createElement('article');
  heading.className = 'collaboration-summary';
  const headingTitle = document.createElement('strong');
  headingTitle.textContent = t('options.teamTotal');
  const headingValue = document.createElement('span');
  headingValue.textContent = formatCollaborationAggregate(dashboard.total);
  heading.append(headingTitle, headingValue);
  breakdown.appendChild(heading);

  for (const member of dashboard.members) {
    appendCollaborationAggregate(breakdown, 'Member', member);
  }
  for (const provider of dashboard.providers) {
    appendCollaborationAggregate(breakdown, 'Provider', provider);
  }
  for (const row of dashboard.attributionRows) {
    appendCollaborationAttribution(breakdown, row);
  }
  return dashboard;
}

function appendCollaborationAggregate(wrap, kind, aggregate) {
  const row = document.createElement('article');
  row.className = 'collaboration-row';
  const head = document.createElement('div');
  head.className = 'collaboration-row__head';
  const label = document.createElement('strong');
  label.textContent = `${t(kind === 'Member' ? 'options.member' : 'options.provider')} · ${aggregate.label}`;
  const value = document.createElement('span');
  value.textContent = formatUSD(aggregate.costUSD);
  head.append(label, value);
  const meta = document.createElement('span');
  meta.className = 'collaboration-row__meta';
  meta.textContent = [
    aggregate.totalTokens ? t('metric.tokens', { value: formatCount(aggregate.totalTokens) }) : '',
    aggregate.requests ? t('metric.requests', { value: formatCount(aggregate.requests) }) : '',
    aggregate.source ? (aggregate.source === 'mixed' ? t('options.mixedCostSources') : t('options.sourceCost', { source: aggregate.source })) : '',
  ].filter(Boolean).join(' · ') || t('options.noCostRows');
  row.append(head, meta);
  wrap.appendChild(row);
}

function formatCollaborationAggregate(aggregate) {
  const parts = [formatUSD(aggregate.costUSD)];
  if (aggregate.totalTokens) parts.push(t('metric.tokens', { value: formatCount(aggregate.totalTokens) }));
  if (aggregate.requests) parts.push(t('metric.requests', { value: formatCount(aggregate.requests) }));
  return parts.join(' · ');
}

function appendCollaborationAttribution(wrap, row) {
  const item = document.createElement('article');
  item.className = 'collaboration-row collaboration-row--attribution';
  const head = document.createElement('div');
  head.className = 'collaboration-row__head';
  const label = document.createElement('strong');
  label.textContent = [row.clientName, row.projectName, row.branchName].filter(Boolean).join(' · ') || t('options.unlabelledAttribution');
  const value = document.createElement('span');
  value.textContent = formatUSD(row.costUSD);
  head.append(label, value);
  const meta = document.createElement('span');
  meta.className = 'collaboration-row__meta';
  meta.textContent = t('options.invoiceAttribution', {
    members: activeI18n.tp('plural.member', row.memberCount),
    aggregate: formatCollaborationAggregate(row),
  });
  item.append(head, meta);
  wrap.appendChild(item);
}

function apiMetricSummary(row) {
  const parts = [];
  if (row.costUSD != null) parts.push(formatUSD(row.costUSD));
  if (row.totalTokens != null) parts.push(t('metric.tokens', { value: formatCount(row.totalTokens) }));
  if (row.requests != null) parts.push(t('metric.requests', { value: formatCount(row.requests) }));
  return parts.join(' · ') || t('options.usageRow');
}

export function renderOptimizationStatus(optimization = {}) {
  const status = document.getElementById('optimizationStatus');
  const breakdown = document.getElementById('optimizationBreakdown');
  if (!status || !breakdown) return;
  clearChildren(breakdown);

  if (optimization.status === 'no-data') {
    status.textContent = t('options.noPlanGuidance');
    status.className = 'opt-callout';
    return;
  }
  if (optimization.status === 'insufficient-coverage') {
    status.textContent = t('options.noPlanRecommendation', { days: optimization.requiredDays });
    status.className = 'opt-callout opt-callout--warn';
    return;
  }
  if (!optimization.recommendations?.length) {
    status.textContent = t('options.noPlanSignal');
    status.className = 'opt-callout opt-callout--good';
    return;
  }

  status.textContent = t('options.planStatus', {
    count: optimization.recommendations.length,
    assumptions: optimization.assumptions?.join(' ') || '',
  });
  status.className = 'opt-callout opt-callout--warn';
  for (const recommendation of optimization.recommendations) {
    const card = document.createElement('article');
    card.className = `forecast-provider optimization-recommendation optimization-recommendation--${recommendation.type}`;
    const head = document.createElement('div');
    head.className = 'forecast-provider__head';
    const title = document.createElement('strong');
    title.textContent = recommendation.title;
    const confidence = document.createElement('span');
    confidence.className = `forecast-provider__confidence forecast-provider__confidence--${recommendation.confidence}`;
    confidence.textContent = t('options.confidence', { label: recommendation.confidenceLabel });
    head.append(title, confidence);
    const detail = document.createElement('p');
    detail.textContent = recommendation.detail;
    const reason = document.createElement('p');
    reason.textContent = recommendation.reason;
    const uncertainty = document.createElement('p');
    uncertainty.className = 'forecast-provider__assumptions';
    uncertainty.textContent = recommendation.uncertainty;
    card.append(head, detail, reason, uncertainty);
    breakdown.appendChild(card);
  }
}

function formatForecastDate(iso) {
  const date = new Date(iso);
  return Number.isFinite(date.getTime())
    ? activeI18n.formatDate(iso, { month: 'short', day: 'numeric' })
    : t('forecast.monthEnd');
}

function applyTheme(settings = {}) {
  const requested = normalizeThemeValue(settings.theme);
  const systemLight = typeof matchMedia === 'function'
    && matchMedia('(prefers-color-scheme: light)').matches;
  document.body.dataset.autTheme = requested === 'system'
    ? (systemLight ? 'latte' : 'mocha')
    : requested;
  document.body.dataset.autContrast = settings.highContrast === true ? 'high' : 'normal';
}

function bindHandlers() {
  document.getElementById('createProfile')?.addEventListener('click', async () => {
    const input = document.getElementById('newProfileName');
    const name = input?.value?.trim() || '';
    try {
      const profile = await createProfile(name);
      await switchProfile(profile.id);
      if (input) input.value = '';
      await refreshAfterProfileChange(t('options.switchedProfile', { name: profile.name }));
    } catch (error) {
      flash(t('options.profileCreationFailed', { error: error?.message || t('app.unknownError') }), 'bad');
    }
  });

  document.getElementById('profileList')?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-profile-action]');
    if (!button) return;
    const profileId = button.dataset.profileId;
    const action = button.dataset.profileAction;
    try {
      if (action === 'switch') {
        const profile = await switchProfile(profileId);
        await refreshAfterProfileChange(t('options.switchedProfile', { name: profile.name }));
      } else if (action === 'rename') {
        const input = [...document.querySelectorAll('input[data-profile-rename]')]
          .find((candidate) => candidate.getAttribute('data-profile-rename') === profileId);
        const profile = await renameProfile(profileId, input?.value || '');
        await refreshAfterProfileChange(t('options.renamedProfile', { name: profile.name }));
      } else if (action === 'delete') {
        const profile = (await listProfiles()).find((candidate) => candidate.id === profileId);
        if (!profile || !confirmAction(t('options.profileDeleteConfirm', { name: profile.name }))) return;
        const registry = await deleteProfile(profileId);
        const active = registry.profiles.find((candidate) => candidate.id === registry.activeId);
        await refreshAfterProfileChange(t('options.activeProfile', { name: active?.name || t('app.defaultProfile') }));
      }
    } catch (error) {
      flash(t('options.profileUpdateFailed', { error: error?.message || t('app.unknownError') }), 'bad');
    }
  });

  document.getElementById('clearSyncedSettings')?.addEventListener('click', async () => {
    if (!confirmAction(t('options.clearSyncedConfirm'))) return;
    try {
      await clearSyncedSettings();
      await renderSyncSettings();
      flash(t('options.syncedCleared'));
    } catch (error) {
      flash(t('options.syncClearFailed', { error: error?.message || t('app.unknownError') }), 'bad');
    }
  });

  document.body.addEventListener('change', async (e) => {
    const target = e.target;
    const state = await loadState();
    let s = normalizeSettings(state.settings || defaultSettings());
    let collaboration = normalizeCollaborationState(state.collaboration);
    let collaborationChanged = false;
    if (target.dataset.provider) {
      s.showProviders = { ...s.showProviders, [target.dataset.provider]: target.checked };
      if (target.checked && API_PROVIDER_IDS.includes(target.dataset.provider)) {
        const credentialStatus = await getApiCredentialStatus();
        if (credentialStatus[target.dataset.provider]?.configured) {
          const permission = await requestApiProviderHostPermission(target.dataset.provider);
          if (!permission.ok) {
            s.showProviders[target.dataset.provider] = false;
            flash(t('options.permissionNotGranted', { provider: providerLabel(target.dataset.provider) }), 'bad');
          }
        }
      }
    } else if (target.dataset.row) {
      s.showRows = { ...s.showRows, [target.dataset.row]: target.checked };
    } else if (target.dataset.notif) {
      s.notifications = { ...s.notifications, [target.dataset.notif]: target.checked };
    } else if (target.id === 'refreshMinutes') {
      s.refreshMinutes = parseInt(target.value, 10) || 5;
    } else if (target.id === 'silentTabRefresh') {
      s.silentTabRefresh = target.checked;
    } else if (target.id === 'nativeSchedulerEnabled') {
      s.nativeSchedulerEnabled = target.checked;
    } else if (target.id === 'highContrast') {
      s.highContrast = target.checked;
    } else if (target.id === 'dailyBriefingHour') {
      s.notifications = s.notifications || {};
      s.notifications.dailyBriefingHour = parseInt(target.value, 10) || 8;
    } else if (target.id === 'historyRetentionDays') {
      s.historyRetentionDays = parseInt(target.value, 10) || 30;
    } else if (target.id === 'theme') {
      s.theme = target.value;
      applyTheme(s);
    } else if (target.id === 'locale') {
      s.locale = target.value;
      setActiveLocale(s.locale);
    } else if (target.id === 'syncSettings') {
      if (target.checked) {
        const remote = await loadSyncedSettings(state.profileId);
        if (remote) s = mergeSyncedSettings(s, remote);
      }
      s.syncSettings = target.checked;
    } else if (target.id === 'warnAt' || target.id === 'dangerAt') {
      s.thresholds = readThresholdControls(target.id);
    } else if (target.id === 'anomalyThresholdPercent') {
      s.anomalyThresholdPercent = parseInt(target.value, 10) || 20;
    } else if (target.id === 'webhookEnabled') {
      let enabled = target.checked;
      if (enabled) {
        const permission = await requestWebhookHostPermission(s.notifications.webhookURL);
        if (!permission.ok) {
          enabled = false;
          flash(t('options.webhookPermissionNeeded'), 'bad');
        }
      }
      s.notifications = { ...s.notifications, webhookEnabled: enabled };
    } else if (target.id === 'webhookURL') {
      const webhookURL = normalizeWebhookURL(target.value);
      let enabled = s.notifications.webhookEnabled === true;
      if (s.notifications.webhookEnabled === true && webhookURL) {
        const permission = await requestWebhookHostPermission(webhookURL);
        if (!permission.ok) {
          enabled = false;
          flash(t('options.webhookPermissionNotGranted'), 'bad');
        }
      }
      s.notifications = { ...s.notifications, webhookURL, webhookEnabled: enabled };
    } else if (target.id === 'webhookIncludeDetails') {
      s.notifications = { ...s.notifications, webhookIncludeDetails: target.checked };
    } else if (target.id === 'sessionBudgetCap') {
      s.apiBudget = { ...s.apiBudget, sessionCapUSD: normalizeBudgetCap(target.value) };
    } else if (target.id === 'dailyBudgetCap') {
      s.apiBudget = { ...s.apiBudget, dailyCapUSD: normalizeBudgetCap(target.value) };
    } else if (target.id === 'collaborationEnabled') {
      collaboration.enabled = target.checked;
      collaborationChanged = true;
    } else if (target.id === 'collaborationTeamName') {
      collaboration.teamName = target.value;
      collaborationChanged = true;
    } else if (target.id === 'collaborationMemberName') {
      collaboration.memberName = target.value;
      collaborationChanged = true;
    } else if (target.id === 'collaborationAttributionEnabled') {
      collaboration.attribution = { ...collaboration.attribution, enabled: target.checked };
      collaborationChanged = true;
    } else if (target.id === 'collaborationClientName' || target.id === 'collaborationProjectName' || target.id === 'collaborationBranchName') {
      const key = target.id === 'collaborationClientName' ? 'clientName'
        : target.id === 'collaborationProjectName' ? 'projectName' : 'branchName';
      collaboration.attribution = { ...collaboration.attribution, [key]: target.value };
      collaborationChanged = true;
    } else {
      return;
    }
    state.settings = s;
    state.collaboration = collaboration;
    await saveState(state);
    await renderSyncSettings(state);
    await renderHistoryStatus();
    await renderDiagnostics();
    renderSnoozeStatus(s);
    renderNativeSchedulerStatus(s);
    renderWebhookStatus(s);
    renderBudgetStatus(s, state.budget);
    if (collaborationChanged) await renderCollaboration();
    flash(t('options.savedNow'));
    // Tell the background to reschedule alarms if interval changed.
    const runtime = getRuntime();
    if ((target.id === 'refreshMinutes' || target.id === 'nativeSchedulerEnabled') && runtime?.sendMessage) {
      sendRuntimeMessage({ type: 'aut/reschedule' }).catch(() => {});
    }
    if (runtime?.sendMessage) {
      sendRuntimeMessage({ type: 'aut/settings-updated' }).catch(() => {});
    }
  });

  document.getElementById('api-credentials').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-api-action]');
    if (!button) return;
    const provider = button.dataset.apiProvider;
    const action = button.dataset.apiAction;
    const input = document.querySelector(`[data-api-provider="${provider}"][type="password"]`);
    button.disabled = true;
    try {
      const state = await loadState();
      if (action === 'save' || action === 'refresh') {
        const value = input?.value?.trim() || '';
        if (!value) {
          flash(t('options.apiKeyRequired'), 'bad');
          return;
        }
        if (provider === 'github-copilot') {
          const organization = document.querySelector('[data-api-config="githubCopilotOrganization"]')?.value?.trim() || '';
          const username = document.querySelector('[data-api-config="githubCopilotUsername"]')?.value?.trim() || '';
          if (!organization || !username) {
            flash(t('options.copilotFieldsRequired'), 'bad');
            return;
          }
          state.settings = normalizeSettings(state.settings);
          state.settings.githubCopilotOrganization = organization;
          state.settings.githubCopilotUsername = username;
        }
        if (provider === 'gemini') {
          const projectId = document.querySelector('[data-api-config="geminiProjectId"]')?.value?.trim() || '';
          if (!projectId) {
            flash(t('options.geminiProjectRequired'), 'bad');
            return;
          }
          state.settings = normalizeSettings(state.settings);
          state.settings.geminiProjectId = projectId;
        }
        const permission = await requestApiProviderHostPermission(provider);
        if (!permission.ok) {
          flash(t('options.permissionNotGranted', { provider: providerLabel(provider) }), 'bad');
          return;
        }
        await saveApiCredential(provider, value);
        if (provider === 'github-copilot' || provider === 'gemini') await saveState(state);
        if (input) input.value = '';
        await renderApiCredentials();
        if (action === 'refresh') await refreshApiProviderData();
        else flash(t('options.keySaved', { provider: providerLabel(provider) }));
      } else if (action === 'revoke') {
        await removeApiCredential(provider);
        const permission = await removeApiProviderHostPermission(provider);
        if (!permission.ok) flash(t('options.keyRemoveFailed', { provider: providerLabel(provider) }), 'bad');
        state.snapshot.providers[provider] = null;
        if (provider === 'github-copilot') {
          state.settings = normalizeSettings(state.settings);
          state.settings.githubCopilotOrganization = '';
          state.settings.githubCopilotUsername = '';
        }
        if (provider === 'gemini') {
          state.settings = normalizeSettings(state.settings);
          state.settings.geminiProjectId = '';
        }
        await saveState(state);
        await renderApiCredentials();
        await renderRows();
        await renderDiagnostics();
        await renderApiBreakdown();
        flash(t('options.keyRevoked', { provider: providerLabel(provider) }));
      }
    } catch (error) {
      flash(t('options.apiCredentialFailed', { error: error?.message || t('app.unknownError') }), 'bad');
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById('resetWidgetPosition').addEventListener('click', async () => {
    const state = await loadState();
    state.widget = { x: null, y: null, minimized: false };
    await saveState(state);
    await renderDiagnostics();
    flash(t('options.widgetReset'));
  });

  document.getElementById('snoozeNotifications').addEventListener('click', async () => {
    const state = await loadState();
    const s = state.settings || defaultSettings();
    s.notifications = s.notifications || {};
    s.notifications.snoozedUntilISO = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    state.settings = s;
    await saveState(state);
    renderSnoozeStatus(s);
    await renderDiagnostics();
    sendRuntimeMessage({ type: 'aut/settings-updated' }).catch(() => {});
    flash(t('options.notificationsSnoozed'));
  });

  document.getElementById('clearSnooze').addEventListener('click', async () => {
    const state = await loadState();
    const s = state.settings || defaultSettings();
    s.notifications = s.notifications || {};
    delete s.notifications.snoozedUntilISO;
    state.settings = s;
    await saveState(state);
    renderSnoozeStatus(s);
    await renderDiagnostics();
    sendRuntimeMessage({ type: 'aut/settings-updated' }).catch(() => {});
    flash(t('options.notificationsResumed'));
  });

  document.getElementById('testNotification').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const permission = await requestNotificationPermission();
      const ok = permission.state === 'granted'
        && await notify({
          id: 'aut-test-notification',
          title: t('options.testNotificationTitle'),
          body: t('options.testNotificationBody'),
          tone: 'info',
        });
      flash(ok ? t('options.testNotificationSent') : t('options.notificationPermissionNotGranted'), ok ? 'good' : 'bad');
      await renderNotificationPermission();
    } catch {
      flash(t('options.testNotificationFailed'), 'bad');
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById('testWebhook')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const state = await loadState();
      const settings = normalizeSettings(state.settings);
      const url = normalizeWebhookURL(document.getElementById('webhookURL')?.value);
      if (!url) {
        flash(t('options.webhookURLRequired'), 'bad');
        return;
      }
      const now = new Date();
      const permission = await requestWebhookHostPermission(url);
      if (!permission.ok) {
        flash(t('options.webhookPermissionNotGranted'), 'bad');
        return;
      }
      const result = await deliverWebhook({
        url,
        payload: buildWebhookPayload({
          ruleId: 'test',
          tone: 'info',
          title: t('options.webhookTestTitle'),
          body: t('options.webhookTestBody'),
        }, {
          includeDetails: settings.notifications.webhookIncludeDetails === true,
          now,
        }),
      });
      const notifications = {
        ...settings.notifications,
        webhookURL: url,
        webhookLastAttemptISO: now.toISOString(),
        webhookLastAttempts: Number(result.attempts) || 0,
        webhookLastSuccessISO: result.ok ? now.toISOString() : settings.notifications.webhookLastSuccessISO || null,
        webhookLastErrorCode: result.ok ? null : result.errorCode || 'webhook.delivery-failed',
      };
      state.settings = { ...settings, notifications };
      await saveState(state);
      renderWebhookStatus(state.settings);
      await renderDiagnostics();
      flash(result.ok ? t('options.webhookTestDelivered') : t('options.webhookTestFailed', { error: result.errorCode || t('app.deliveryFailed') }), result.ok ? 'good' : 'bad');
    } catch {
      flash(t('options.webhookTestUnavailable'), 'bad');
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById('resetBudgetSession')?.addEventListener('click', async () => {
    const state = await loadState();
    state.budget = resetSessionBudget(state.budget, state.snapshot, { now: new Date() });
    await saveState(state);
    renderBudgetStatus(state.settings, state.budget);
    await renderDiagnostics();
    flash(t('options.budgetReset'));
  });

  document.getElementById('exportHistory').addEventListener('click', async () => {
    const state = await loadState();
    downloadHistory(state.history || []);
    flash(t('options.historyDownload'));
  });

  document.getElementById('exportApiBreakdown')?.addEventListener('click', async () => {
    const state = await loadState();
    const breakdown = buildApiBreakdown(state.snapshot);
    if (!breakdown.rows.length) {
      flash(t('options.noBreakdown'), 'bad');
      return;
    }
    downloadApiBreakdown(breakdown);
    flash(t('options.breakdownDownload'));
  });

  document.getElementById('compactHistory').addEventListener('click', async () => {
    if (!confirmAction(t('options.compactConfirm'))) return;
    const state = await loadState();
    const retentionDays = normalizeSettings(state.settings).historyRetentionDays;
    state.history = compactHistory(state.history || [], { retentionDays });
    await saveState(state);
    await renderHistoryStatus();
    await renderDiagnostics();
    flash(t('options.historyCompacted'));
  });

  document.getElementById('clearHistory').addEventListener('click', async () => {
    if (!confirmAction(t('options.clearHistoryConfirm'))) return;
    const state = await loadState();
    state.history = [];
    await saveState(state);
    await renderHistoryStatus();
    await renderDiagnostics();
    flash(t('options.historyCleared'));
  });

  const settingsImportFile = document.getElementById('settingsImportFile');
  document.getElementById('exportSettings').addEventListener('click', async () => {
    const state = await loadState();
    const includeHistory = document.getElementById('includeHistoryInSettings').checked;
    downloadSettings(exportSettings(state, { includeHistory }));
    document.getElementById('settingsTransferStatus').textContent = includeHistory
      ? t('options.settingsDownloadWithHistory')
      : t('options.settingsDownload');
  });
  document.getElementById('importSettings').addEventListener('click', () => settingsImportFile.click());
  settingsImportFile.addEventListener('change', async () => {
    const file = settingsImportFile.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const includeHistory = document.getElementById('includeHistoryInSettings').checked;
      await importSettings(text, { includeHistory });
      await renderRows();
      await loadCurrent();
      await renderHistoryStatus();
      await renderDiagnostics();
      document.getElementById('settingsTransferStatus').textContent = includeHistory
        ? t('options.settingsImportWithHistory')
        : t('options.settingsImport');
      flash(t('options.settingsImported'));
    } catch (error) {
      document.getElementById('settingsTransferStatus').textContent = t('options.settingsImportRejected', { error: error?.message || t('app.invalidFile') });
      flash(t('options.settingsRejected'), 'bad');
    } finally {
      settingsImportFile.value = '';
    }
  });

  document.getElementById('resetClaudeOrg').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await sendRuntimeMessage({ type: 'aut/reset-claude-org' });
      setTimeout(async () => {
        await renderRows();
        await renderDiagnostics();
        await loadCurrent();
        flash(t('options.orgCleared'));
        btn.disabled = false;
      }, 1000);
    } catch (err) {
      flash(t('options.resetFailed', { error: String(err?.message || err) }), 'bad');
      btn.disabled = false;
    }
  });

  document.getElementById('refreshDiagnostics').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await sendRuntimeMessage({ type: 'aut/refresh' });
      setTimeout(async () => {
        await renderRows();
        await renderDiagnostics();
        await loadCurrent();
        flash(t('options.snapshotRefreshed'));
        btn.disabled = false;
      }, 800);
    } catch (err) {
      flash(t('options.refreshFailed', { error: String(err?.message || err) }), 'bad');
      btn.disabled = false;
    }
  });

  document.getElementById('copyDiagnostics').addEventListener('click', async () => {
    const state = await loadState();
    const usage = await getStorageUsage(state);
    const text = JSON.stringify(buildDiagnosticsBundle(state, usage), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      flash(t('options.diagnosticsCopied'));
    } catch {
      flash(t('options.clipboardUnavailable'), 'bad');
    }
  });

  document.getElementById('exportDiagnostics').addEventListener('click', async () => {
    const state = await loadState();
    const usage = await getStorageUsage(state);
    downloadDiagnostics(buildDiagnosticsBundle(state, usage));
    flash(t('options.diagnosticsDownload'));
  });

  document.getElementById('exportMcpState')?.addEventListener('click', async () => {
    const state = await loadState();
    downloadMcpState(exportMcpState(state));
    flash(t('options.mcpDownload'));
  });

  document.getElementById('exportCollaborationContribution')?.addEventListener('click', async () => {
    const state = await loadState();
    const collaboration = normalizeCollaborationState(state.collaboration);
    if (!collaboration.enabled) {
      flash(t('options.enableTeamFirst'), 'bad');
      return;
    }
    const payload = buildCollaborationContribution(state.snapshot, {
      teamName: document.getElementById('collaborationTeamName')?.value || collaboration.teamName,
      memberName: document.getElementById('collaborationMemberName')?.value || collaboration.memberName,
      attribution: {
        enabled: document.getElementById('collaborationAttributionEnabled')?.checked === true,
        clientName: document.getElementById('collaborationClientName')?.value || collaboration.attribution.clientName,
        projectName: document.getElementById('collaborationProjectName')?.value || collaboration.attribution.projectName,
        branchName: document.getElementById('collaborationBranchName')?.value || collaboration.attribution.branchName,
      },
      now: new Date(),
    });
    if (!payload.contribution.providers.length) {
      flash(t('options.noContributionUsage'), 'bad');
      return;
    }
    downloadCollaboration(payload, 'contribution');
    flash(t('options.contributionDownload'));
  });

  document.getElementById('exportCollaborationLedger')?.addEventListener('click', async () => {
    const state = await loadState();
    const collaboration = normalizeCollaborationState(state.collaboration);
    if (!collaboration.ledger.contributions.length) {
      flash(t('options.noTeamContributions'), 'bad');
      return;
    }
    downloadCollaboration(buildCollaborationLedger(collaboration), 'ledger');
    flash(t('options.ledgerDownload'));
  });

  document.getElementById('exportCollaborationInvoice')?.addEventListener('click', async () => {
    const state = await loadState();
    const collaboration = normalizeCollaborationState(state.collaboration);
    if (!buildCollaborationInvoiceRows(collaboration).length) {
      flash(t('options.noAttributionRows'), 'bad');
      return;
    }
    downloadCollaborationCSV(collaboration);
    flash(t('options.invoiceDownload'));
  });

  document.getElementById('clearCollaboration')?.addEventListener('click', async () => {
    if (!confirmAction(t('options.clearTeamConfirm'))) return;
    const state = await loadState();
    const collaboration = normalizeCollaborationState(state.collaboration);
    state.collaboration = normalizeCollaborationState({
      enabled: collaboration.enabled,
      teamName: collaboration.teamName,
      memberName: collaboration.memberName,
      attribution: collaboration.attribution,
    });
    await saveState(state);
    await renderCollaboration();
    flash(t('options.teamCleared'));
  });

  const collaborationImportFile = document.getElementById('collaborationImportFile');
  document.getElementById('importCollaboration')?.addEventListener('click', () => collaborationImportFile?.click());
  collaborationImportFile?.addEventListener('change', async () => {
    const file = collaborationImportFile.files?.[0];
    if (!file) return;
    try {
      const state = await loadState();
      state.collaboration = mergeCollaborationImport(state.collaboration, await file.text());
      await saveState(state);
      await renderCollaboration();
      flash(t('options.teamImported'));
    } catch (error) {
      flash(t('options.teamImportRejected', { error: error?.message || t('app.invalidFile') }), 'bad');
    } finally {
      collaborationImportFile.value = '';
    }
  });
}

export async function renderDiagnostics() {
  const state = await loadState();
  const wrap = document.getElementById('diagnostics');
  if (!wrap) return;

  const usage = await getStorageUsage(state);
  const diag = buildDiagnostics(state, usage);
  clearChildren(wrap);
  addDiagnostic(wrap, t('options.diagnosticsSnapshot'), diag.snapshot);
  for (const [provider, providerDiag] of Object.entries(diag.providers)) {
    addDiagnostic(wrap, providerLabel(provider), providerDiag.summary, providerDiag.ok ? 'good' : 'bad');
  }
  addDiagnostic(wrap, t('options.diagnosticsRows'), diag.rows);
  addDiagnostic(wrap, t('options.diagnosticsAppearance'), t('options.diagnosticsAppearanceValue', {
    theme: diag.settings.theme,
    warn: diag.settings.thresholds.warnAt,
    danger: diag.settings.thresholds.dangerAt,
  }));
  addDiagnostic(wrap, t('options.diagnosticsHistory'), diag.history);
  addDiagnostic(wrap, t('options.diagnosticsStorage'), diag.storage);
  addDiagnostic(wrap, t('options.diagnosticsAlerts'), diag.notifications.summary, diag.notifications.snoozed ? 'warn' : 'good');
}

function addDiagnostic(wrap, key, value, tone = '') {
  const row = document.createElement('div');
  row.className = 'opt-diagnostic';
  const k = document.createElement('div');
  k.className = 'opt-diagnostic__key';
  k.textContent = key;
  const v = document.createElement('div');
  v.className = `opt-diagnostic__value ${tone}`.trim();
  v.textContent = value;
  row.append(k, v);
  wrap.appendChild(row);
}

async function renderHistoryStatus() {
  const wrap = document.getElementById('historyStatus');
  if (!wrap) return;
  const state = await loadState();
  const settings = normalizeSettings(state.settings);
  const stats = historyStats(state.history || []);
  const usage = await getStorageUsage(state);
  const warning = usage.degraded || usage.warningCode;
  const warningText = warning ? t('options.storageProtection') : '';
  wrap.textContent = t('options.historyStatus', {
    samples: activeI18n.tp('plural.sample', stats.sampleCount),
    buckets: activeI18n.tp('plural.bucket', stats.bucketCount),
    days: activeI18n.tp('plural.day', settings.historyRetentionDays),
    storage: formatStorageUsage(usage),
    warning: warningText,
  });
  wrap.className = `opt-callout ${warning ? 'opt-callout--warn' : 'opt-callout--good'}`;
}

function downloadHistory(history) {
  if (typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    flash(t('app.downloadUnavailable'), 'bad');
    return;
  }
  const blob = new Blob([historyToCSV(history)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `ai-usage-tracker-history-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadApiBreakdown(breakdown) {
  if (typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    flash(t('app.downloadUnavailable'), 'bad');
    return;
  }
  const blob = new Blob([apiBreakdownToCSV(breakdown)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `ai-usage-tracker-api-breakdown-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadSettings(payload) {
  if (typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    flash(t('app.downloadUnavailable'), 'bad');
    return;
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `ai-usage-tracker-settings-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadDiagnostics(bundle) {
  if (typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    flash(t('app.downloadUnavailable'), 'bad');
    return;
  }
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `ai-usage-tracker-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadMcpState(payload) {
  if (typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    flash(t('app.downloadUnavailable'), 'bad');
    return;
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `ai-usage-tracker-mcp-state-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadCollaboration(payload, kind) {
  if (typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    flash(t('app.downloadUnavailable'), 'bad');
    return;
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `ai-usage-tracker-team-${kind}-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadCollaborationCSV(collaboration) {
  if (typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    flash(t('app.downloadUnavailable'), 'bad');
    return;
  }
  const blob = new Blob([collaborationToCSV(collaboration)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `ai-usage-tracker-invoicing-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function confirmAction(message) {
  return typeof window !== 'undefined' && typeof window.confirm === 'function'
    ? window.confirm(message)
    : true;
}

function formatStorageUsage(usage = {}) {
  const bytes = formatBytes(usage.bytes);
  const base = usage.quotaBytes
    ? t('options.storageOf', { used: bytes, quota: formatBytes(usage.quotaBytes), source: storageSourceLabel(usage.source) })
    : t('options.storageSimple', { used: bytes, source: storageSourceLabel(usage.source) });
  return usage.warningCode ? `${base}${t('options.storageWarning', { warning: usage.warningCode })}` : base;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return t('app.unknownSize');
  if (bytes < 1024) return `${activeI18n.formatNumber(bytes)} B`;
  if (bytes < 1024 * 1024) return `${activeI18n.formatNumber(bytes / 1024, { maximumFractionDigits: 1 })} KB`;
  return `${activeI18n.formatNumber(bytes / (1024 * 1024), { maximumFractionDigits: 1 })} MB`;
}

export function buildDiagnostics(state, usage = {}) {
  const providers = state.snapshot?.providers || {};
  const settings = normalizeSettings(state.settings);
  const thresholds = normalizeThresholds(state.settings?.thresholds);
  const history = historyStats(state.history || []);
  const rows = Object.values(providers)
    .filter((ps) => ps?.ok)
    .reduce((sum, ps) => sum + (ps.buckets?.length || 0), 0);
  const historyWarning = usage.warningCode ? `; ${usage.warningCode}` : '';
  return {
    version: VERSION,
    snapshot: state.snapshot?.fetchedAtISO ? t('updated.prefix', { relative: formatAgo(state.snapshot.fetchedAtISO) }) : t('sidepanel.noSnapshot'),
    providers: Object.fromEntries(Object.entries(providers).map(([provider, snapshot]) => [
      provider,
      providerDiagnostic(provider, snapshot),
    ])),
    rows: t('options.discoveredRows', { discovered: rows, visible: visibleRowCount(state) }),
    settings: {
      refreshMinutes: settings.refreshMinutes,
      silentTabRefresh: settings.silentTabRefresh === true,
      theme: normalizeThemeValue(settings.theme),
      highContrast: settings.highContrast === true,
      thresholds,
      providers: settings.showProviders,
    },
    history: `${activeI18n.tp('plural.sample', history.sampleCount)} · ${activeI18n.tp('plural.bucket', history.bucketCount)} · ${t('options.retention', { days: activeI18n.tp('plural.day', settings.historyRetentionDays) })}${historyWarning}`,
    storage: formatStorageUsage(usage),
    notifications: notificationDiagnostic(settings),
  };
}

export function buildDiagnosticsBundle(state, usage = {}) {
  const runtime = getRuntime();
  const manifest = runtime?.getManifest?.() || null;
  return buildSupportBundle({
    state,
    usage,
    version: manifest?.version || VERSION,
    channel: manifest ? 'extension' : 'settings-page',
    manifest,
  });
}

function notificationDiagnostic(settings = {}) {
  const notifications = settings.notifications || {};
  const until = notifications.snoozedUntilISO || '';
  const ts = until ? new Date(until).getTime() : 0;
  const snoozed = Number.isFinite(ts) && ts > Date.now();
  let summary = snoozed
    ? t('options.notificationSnoozed', { time: activeI18n.formatTime(new Date(ts).toISOString()) })
    : t('options.notificationActive');
  if (notifications.webhookEnabled === true) {
    if (notifications.webhookLastErrorCode) {
      summary += t('options.webhookFailedDiagnostic', { code: notifications.webhookLastErrorCode });
    } else if (notifications.webhookLastSuccessISO) {
      summary += t('options.webhookDeliveredDiagnostic', { relative: formatAgo(notifications.webhookLastSuccessISO) });
    } else {
      summary += t('options.webhookEnabledDiagnostic');
    }
  }
  return {
    snoozed,
    summary,
  };
}

function formatUSD(value) {
  return activeI18n.formatCurrency(value, 'USD', 2);
}

function formatCount(value) {
  return activeI18n.formatNumber(value, { maximumFractionDigits: 0 });
}

function providerDiagnostic(provider, ps) {
  if (!ps) return { ok: false, summary: t('options.noSnapshot') };
  if (!ps.ok && !ps.stale) return {
    ok: false,
    summary: formatProviderError(ps.lastErrorDetail || ps.error || t('options.lastRefreshFailed'), ps.lastErrorCode),
  };
  const parts = [
    t('options.providerRows', { count: ps.buckets?.length || 0 }),
    sourceLabel(ps.lastSuccessSource || ps.source),
  ];
  if (provider === 'claude' && ps.orgId) parts.push(t('options.org', { id: shortId(ps.orgId) }));
  if (ps.plan) parts.push(ps.plan);
  if (ps.lastSuccessISO) parts.push(t('options.fresh', { relative: formatAgo(ps.lastSuccessISO) }));
  if (ps.stale) {
    const reason = ps.staleReason ? `; ${ps.staleReason}` : '';
    parts.push(t('options.staleDiagnostic', { detail: formatProviderError(`${t('options.lastRefreshFailed')}${reason}`, ps.lastErrorCode) }));
  }
  return { ok: !ps.stale && ps.ok !== false, summary: parts.filter(Boolean).join(' - ') };
}

function formatProviderError(detail, errorCode) {
  return errorCode ? `${detail} [${errorCode}]` : detail;
}

function visibleRowCount(state) {
  const providers = state.snapshot?.providers || {};
  let count = 0;
  for (const ps of Object.values(providers)) {
    if (!ps?.ok) continue;
    for (const bucket of ps.buckets || []) {
      if (state.settings?.showRows?.[bucket.id] !== false) count++;
    }
  }
  return count;
}

function sourceLabel(source) {
  if (!source) return t('options.unknownSource');
  const keys = {
    api: 'options.apiSource', dom: 'options.pageSource', html: 'options.htmlSource', live: 'options.liveSource',
    fetch: 'options.fetchSource', stream: 'options.streamSource', headers: 'options.headersSource', 'api-key': 'options.apiKeySource',
  };
  return keys[source] ? t(keys[source]) : t('options.sourceSuffix', { source });
}

function providerLabel(provider) {
  return t(`provider.${provider}`) === `provider.${provider}` ? API_PROVIDER_META[provider]?.label || provider : t(`provider.${provider}`);
}

function providerMetaText(provider, field) {
  const key = `providerMeta.${provider}.${field}`;
  const localized = t(key);
  return localized === key ? API_PROVIDER_META[provider]?.[field] || '' : localized;
}

function storageSourceLabel(source) {
  if (source === 'webext') return t('options.storageSource.webext');
  if (source === 'unavailable') return t('options.storageSource.unavailable');
  if (String(source || '').endsWith('-estimate')) return t('options.storageSource.estimate');
  return t('options.storageSource.unknown', { source: source || t('app.unknown') });
}

async function refreshApiProviderData() {
  try {
    await sendRuntimeMessage({ type: 'aut/refresh' });
    await renderRows();
    await renderDiagnostics();
    await loadCurrent();
    flash(t('options.apiRefreshed'));
  } catch (error) {
    flash(t('options.apiRefreshFailed', { error: error?.message || t('app.unknownError') }), 'bad');
  }
}

function shortId(id) {
  const s = String(id);
  if (s.length <= 8) return s;
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

function formatAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  return Number.isFinite(ms) ? activeI18n.formatRelative(iso) : t('app.timeUnavailable');
}

function sendRuntimeMessage(message) {
  if (typeof browser !== 'undefined' && browser.runtime?.sendMessage && typeof chrome === 'undefined') {
    return browser.runtime.sendMessage(message);
  }
  const runtime = getRuntime();
  if (!runtime?.sendMessage) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    try {
      const result = runtime.sendMessage(message, (response) => {
        const err = typeof chrome !== 'undefined' ? chrome.runtime?.lastError : null;
        if (err) reject(err);
        else resolve(response);
      });
      if (result && typeof result.then === 'function') result.then(resolve, reject);
    } catch (e) {
      reject(e);
    }
  });
}

function getRuntime() {
  return (typeof chrome !== 'undefined' && chrome.runtime)
    || (typeof browser !== 'undefined' && browser.runtime)
    || null;
}

function flash(text, tone = 'good') {
  saveStatus.textContent = text;
  saveStatus.style.color = tone === 'bad' ? 'var(--aut-red)' : 'var(--aut-green)';
  setTimeout(() => {
    saveStatus.textContent = t('app.ready');
    saveStatus.style.color = '';
  }, 1400);
}
