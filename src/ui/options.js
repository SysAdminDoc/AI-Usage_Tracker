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
  notify,
  requestNotificationPermission,
  requestWebhookHostPermission,
} from '../lib/browser.js';
import { normalizeBudgetCap, resetSessionBudget } from '../lib/budget.js';
import { forecastMonthEnd } from '../lib/forecast.js';
import { buildPlanRecommendations } from '../lib/optimization.js';
import { buildSupportBundle } from '../lib/diagnostics.js';
import { API_PROVIDER_IDS, API_PROVIDER_META } from '../providers/api-contract.js';
import { buildWebhookPayload, deliverWebhook, normalizeWebhookURL } from '../lib/notify.js';

const VERSION = '0.2.2';

const saveStatus = document.getElementById('saveStatus');

export const ready = init();

export async function init() {
  document.querySelector('.opt-head__sub').textContent = `${isIncognitoContext() ? 'Incognito · ' : ''}Settings - v${VERSION}`;
  saveStatus.textContent = 'Ready';

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
    meta.textContent = profile.id === active.id ? 'Active profile' : 'Local profile';
    identity.append(name, meta);

    const actions = document.createElement('div');
    actions.className = 'profile-item__actions';
    const rename = document.createElement('input');
    rename.className = 'profile-item__rename';
    rename.type = 'text';
    rename.maxLength = 48;
    rename.value = profile.name;
    rename.setAttribute('aria-label', `Rename ${profile.name}`);
    rename.dataset.profileRename = profile.id;
    const switchButton = profileButton('switch', profile.id, profile.id === active.id ? 'Active' : 'Switch');
    switchButton.disabled = profile.id === active.id;
    const renameButton = profileButton('rename', profile.id, 'Rename');
    const deleteButton = profileButton('delete', profile.id, 'Delete', 'opt-btn--quiet');
    deleteButton.disabled = registry.profiles.length <= 1;
    actions.append(rename, switchButton, renameButton, deleteButton);
    item.append(identity, actions);
    list.appendChild(item);
  }
  if (status) {
    const scope = isIncognitoContext() ? 'Incognito context. ' : '';
    status.textContent = `${scope}${active.name} is active. ${registry.profiles.length} local profile${registry.profiles.length === 1 ? '' : 's'} available.`;
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
    const labelText = id === 'claude' ? 'Claude'
      : id === 'codex' ? 'Codex'
        : API_PROVIDER_META[id]?.label || id;
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
  clearChildren(wrap);
  const configured = API_PROVIDER_IDS.filter((id) => statuses[id]?.configured).length;
  if (statusWrap) {
    statusWrap.textContent = configured
      ? `${configured} official provider credential${configured === 1 ? '' : 's'} configured locally.`
      : 'No official provider credentials configured. Web usage tracking remains available without them.';
    statusWrap.className = `opt-callout ${configured ? 'opt-callout--good' : ''}`;
  }

  for (const id of API_PROVIDER_IDS) {
    const meta = API_PROVIDER_META[id];
    const card = document.createElement('article');
    card.className = 'api-credential';
    const head = document.createElement('div');
    head.className = 'api-credential__head';
    const title = document.createElement('strong');
    title.textContent = meta.label;
    const docs = document.createElement('a');
    docs.href = meta.docsUrl;
    docs.target = '_blank';
    docs.rel = 'noreferrer';
    docs.textContent = 'Official docs';
    head.append(title, docs);
    const hint = document.createElement('p');
    hint.className = 'api-credential__hint';
    hint.textContent = meta.hint;
    const costHint = document.createElement('p');
    costHint.className = 'api-credential__cost-hint';
    costHint.textContent = meta.costHint || '';
    const input = document.createElement('input');
    input.type = 'password';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = meta.placeholder;
    input.dataset.apiProvider = id;
    input.setAttribute('aria-label', `${meta.credentialLabel} value`);
    let providerConfig = null;
    if (id === 'github-copilot') {
      const config = document.createElement('div');
      config.className = 'opt-grid';
      const organizationLabel = document.createElement('label');
      organizationLabel.textContent = 'GitHub organization';
      const organization = document.createElement('input');
      organization.type = 'text';
      organization.autocomplete = 'off';
      organization.spellcheck = false;
      organization.placeholder = 'your-org';
      organization.value = settings.githubCopilotOrganization || '';
      organization.dataset.apiConfig = 'githubCopilotOrganization';
      organization.setAttribute('aria-label', 'GitHub Copilot organization');
      organizationLabel.appendChild(organization);
      const usernameLabel = document.createElement('label');
      usernameLabel.textContent = 'GitHub username';
      const username = document.createElement('input');
      username.type = 'text';
      username.autocomplete = 'off';
      username.spellcheck = false;
      username.placeholder = 'your-username';
      username.value = settings.githubCopilotUsername || '';
      username.dataset.apiConfig = 'githubCopilotUsername';
      username.setAttribute('aria-label', 'GitHub Copilot username');
      usernameLabel.appendChild(username);
      config.append(organizationLabel, usernameLabel);
      providerConfig = config;
    } else if (id === 'gemini') {
      const config = document.createElement('div');
      config.className = 'opt-grid';
      const projectLabel = document.createElement('label');
      projectLabel.textContent = 'Google Cloud project ID';
      const project = document.createElement('input');
      project.type = 'text';
      project.autocomplete = 'off';
      project.spellcheck = false;
      project.placeholder = 'my-gemini-project';
      project.value = settings.geminiProjectId || '';
      project.dataset.apiConfig = 'geminiProjectId';
      project.setAttribute('aria-label', 'Gemini Google Cloud project ID');
      projectLabel.appendChild(project);
      config.appendChild(projectLabel);
      providerConfig = config;
    }
    const actions = document.createElement('div');
    actions.className = 'api-credential__actions';
    actions.append(
      apiButton('save', id, 'Save key'),
      apiButton('refresh', id, 'Save and refresh'),
      apiButton('revoke', id, 'Revoke locally', 'opt-btn--quiet'),
    );
    const credentialStatus = document.createElement('p');
    credentialStatus.className = 'api-credential__status';
    credentialStatus.textContent = statuses[id]?.configured
      ? 'Configured locally. The key value is never shown again.'
      : 'Not configured.';
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
  renderWebhookStatus(s);
  renderBudgetStatus(s, state.budget);
  await renderForecastStatus();
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
    status.textContent = 'Unavailable in this browser context. Settings remain local.';
    status.className = 'opt-callout';
  } else if (current.settings?.syncSettings === true) {
    status.textContent = result.hasRemote
      ? 'Enabled. Only non-sensitive display and alert settings are synced; history, provider data, API keys, and bridge data remain local.'
      : 'Enabled. This profile will publish non-sensitive settings to browser sync.';
    status.className = 'opt-callout opt-callout--good';
  } else {
    status.textContent = result.hasRemote
      ? 'Available. A synced settings copy exists for this profile; enable sync to use it on this browser.'
      : 'Off. Nothing is synced until you enable this option.';
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
    ? `Notifications are snoozed until ${new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.`
    : 'Notifications are active. Use snooze for a quiet hour without changing alert rules.';
  wrap.className = `opt-callout ${active ? 'opt-callout--warn' : 'opt-callout--good'}`;
  if (clearBtn) clearBtn.disabled = !active;
}

export async function renderNotificationPermission(capability = getNotificationPermission()) {
  const wrap = document.getElementById('notificationPermissionStatus');
  if (!wrap) return capability;
  const labels = {
    extension: 'Ready: extension notifications are enabled by the installed package.',
    'userscript-manager': 'Ready: the userscript manager can deliver notifications while this tab is open.',
    web: capability.state === 'granted'
      ? 'Ready: this browser has granted page notifications for the current tab.'
      : capability.state === 'denied'
        ? 'Blocked: allow notifications for this provider site in the browser site settings.'
        : 'Not requested: send a test notification to ask the browser for permission.',
    unavailable: 'Unavailable: this browser context does not expose notifications.',
  };
  wrap.textContent = labels[capability.source] || capability.detail || 'Notification status unavailable.';
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
    wrap.textContent = 'Webhook delivery is off.';
    wrap.className = 'opt-callout';
  } else if (!hasURL) {
    wrap.textContent = 'Webhook is enabled, but no valid HTTP(S) URL is configured.';
    wrap.className = 'opt-callout opt-callout--warn';
  } else if (notifications.webhookLastErrorCode) {
    wrap.textContent = `Last webhook delivery failed after ${attempts || 1} attempt${attempts === 1 ? '' : 's'} (${notifications.webhookLastErrorCode}). Check the endpoint and try again.`;
    wrap.className = 'opt-callout opt-callout--warn';
  } else if (notifications.webhookLastSuccessISO) {
    wrap.textContent = `Webhook delivery is active with redacted payloads by default. Last delivered ${formatAgo(notifications.webhookLastSuccessISO)}.`;
    wrap.className = 'opt-callout opt-callout--good';
  } else {
    wrap.textContent = 'Webhook delivery is enabled. The next matching rule will send a redacted event.';
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
    wrap.textContent = 'No API spend caps configured.';
    wrap.className = 'opt-callout';
    return;
  }
  const parts = [];
  if (sessionCap) parts.push(`Session ${formatUSD(budget.sessionSpentUSD)} / ${formatUSD(sessionCap)}`);
  if (dailyCap) parts.push(`Today ${formatUSD(budget.dailySpentUSD)} / ${formatUSD(dailyCap)}`);
  wrap.textContent = `${parts.join(' · ')}. Alerts fire at 80% and 100% of each cap.`;
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
    status.textContent = 'No cost-bearing API-provider snapshot yet. Anthropic, OpenAI, Cursor, or OpenRouter cost data will appear after a successful refresh.';
    status.className = 'opt-callout';
    return forecast;
  }

  const total = forecast.total;
  const projected = total.projectedUSD == null
    ? 'Forecast is waiting for more than one full day of cost coverage.'
    : `Projected ${formatUSD(total.projectedUSD)} by ${formatForecastDate(forecast.monthEndISO)} (${total.confidenceLabel} confidence).`;
  status.textContent = `${projected} ${formatUSD(total.observedUSD)} observed across ${total.providerCount} cost-bearing API provider${total.providerCount === 1 ? '' : 's'}. ${forecast.assumptions.join(' ')}`;
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
    confidence.textContent = `${entry.confidenceLabel} confidence`;
    head.append(label, confidence);
    const observed = document.createElement('p');
    observed.textContent = `Observed ${formatUSD(entry.observedUSD)} across ${entry.observedDays.toFixed(2)} days · ${entry.sourceLabel}.`;
    const projection = document.createElement('p');
    projection.textContent = entry.projectedUSD == null
      ? 'Projection unavailable until coverage improves.'
      : `Projected month end: ${formatUSD(entry.projectedUSD)}.`;
    const assumptions = document.createElement('p');
    assumptions.className = 'forecast-provider__assumptions';
    assumptions.textContent = `Assumptions: ${entry.assumptions.join(' ')}`;
    card.append(head, observed, projection, assumptions);
    breakdown.appendChild(card);
  }
  return forecast;
}

export function renderOptimizationStatus(optimization = {}) {
  const status = document.getElementById('optimizationStatus');
  const breakdown = document.getElementById('optimizationBreakdown');
  if (!status || !breakdown) return;
  clearChildren(breakdown);

  if (optimization.status === 'no-data') {
    status.textContent = 'No plan guidance yet. Connect a cost-bearing API provider first.';
    status.className = 'opt-callout';
    return;
  }
  if (optimization.status === 'insufficient-coverage') {
    status.textContent = `No plan recommendation yet. Keep at least ${optimization.requiredDays} days of fresh cost coverage before changing a plan or routing policy.`;
    status.className = 'opt-callout opt-callout--warn';
    return;
  }
  if (!optimization.recommendations?.length) {
    status.textContent = 'No provider limit or seat-mix signal supports a plan review from the current data.';
    status.className = 'opt-callout opt-callout--good';
    return;
  }

  status.textContent = `${optimization.recommendations.length} evidence-based plan review${optimization.recommendations.length === 1 ? '' : 's'} available. Verify current provider pricing and entitlements before acting. ${optimization.assumptions?.join(' ') || ''}`;
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
    confidence.textContent = `${recommendation.confidenceLabel} confidence`;
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
    ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : 'month end';
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
      await refreshAfterProfileChange(`Switched to ${profile.name}`);
    } catch (error) {
      flash(`Profile creation failed: ${error?.message || 'unknown error'}`, 'bad');
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
        await refreshAfterProfileChange(`Switched to ${profile.name}`);
      } else if (action === 'rename') {
        const input = [...document.querySelectorAll('input[data-profile-rename]')]
          .find((candidate) => candidate.getAttribute('data-profile-rename') === profileId);
        const profile = await renameProfile(profileId, input?.value || '');
        await refreshAfterProfileChange(`Renamed profile to ${profile.name}`);
      } else if (action === 'delete') {
        const profile = (await listProfiles()).find((candidate) => candidate.id === profileId);
        if (!profile || !confirmAction(`Delete the local profile “${profile.name}” and its settings, history, snapshot, and API keys?`)) return;
        const registry = await deleteProfile(profileId);
        const active = registry.profiles.find((candidate) => candidate.id === registry.activeId);
        await refreshAfterProfileChange(`Active profile: ${active?.name || 'Default'}`);
      }
    } catch (error) {
      flash(`Profile update failed: ${error?.message || 'unknown error'}`, 'bad');
    }
  });

  document.getElementById('clearSyncedSettings')?.addEventListener('click', async () => {
    if (!confirmAction('Clear the synced settings copy for this profile? Other browsers will keep their current local settings.')) return;
    try {
      await clearSyncedSettings();
      await renderSyncSettings();
      flash('Synced settings cleared');
    } catch (error) {
      flash(`Synced settings could not be cleared: ${error?.message || 'unknown error'}`, 'bad');
    }
  });

  document.body.addEventListener('change', async (e) => {
    const t = e.target;
    const state = await loadState();
    let s = normalizeSettings(state.settings || defaultSettings());
    if (t.dataset.provider) {
      s.showProviders = { ...s.showProviders, [t.dataset.provider]: t.checked };
    } else if (t.dataset.row) {
      s.showRows = { ...s.showRows, [t.dataset.row]: t.checked };
    } else if (t.dataset.notif) {
      s.notifications = { ...s.notifications, [t.dataset.notif]: t.checked };
    } else if (t.id === 'refreshMinutes') {
      s.refreshMinutes = parseInt(t.value, 10) || 5;
    } else if (t.id === 'silentTabRefresh') {
      s.silentTabRefresh = t.checked;
    } else if (t.id === 'highContrast') {
      s.highContrast = t.checked;
    } else if (t.id === 'dailyBriefingHour') {
      s.notifications = s.notifications || {};
      s.notifications.dailyBriefingHour = parseInt(t.value, 10) || 8;
    } else if (t.id === 'historyRetentionDays') {
      s.historyRetentionDays = parseInt(t.value, 10) || 30;
    } else if (t.id === 'theme') {
      s.theme = t.value;
      applyTheme(s);
    } else if (t.id === 'locale') {
      s.locale = t.value;
    } else if (t.id === 'syncSettings') {
      if (t.checked) {
        const remote = await loadSyncedSettings(state.profileId);
        if (remote) s = mergeSyncedSettings(s, remote);
      }
      s.syncSettings = t.checked;
    } else if (t.id === 'warnAt' || t.id === 'dangerAt') {
      s.thresholds = readThresholdControls(t.id);
    } else if (t.id === 'anomalyThresholdPercent') {
      s.anomalyThresholdPercent = parseInt(t.value, 10) || 20;
    } else if (t.id === 'webhookEnabled') {
      let enabled = t.checked;
      if (enabled) {
        const permission = await requestWebhookHostPermission(s.notifications.webhookURL);
        if (!permission.ok) {
          enabled = false;
          flash('Webhook needs a valid endpoint origin and permission', 'bad');
        }
      }
      s.notifications = { ...s.notifications, webhookEnabled: enabled };
    } else if (t.id === 'webhookURL') {
      const webhookURL = normalizeWebhookURL(t.value);
      let enabled = s.notifications.webhookEnabled === true;
      if (s.notifications.webhookEnabled === true && webhookURL) {
        const permission = await requestWebhookHostPermission(webhookURL);
        if (!permission.ok) {
          enabled = false;
          flash('Webhook endpoint permission was not granted', 'bad');
        }
      }
      s.notifications = { ...s.notifications, webhookURL, webhookEnabled: enabled };
    } else if (t.id === 'webhookIncludeDetails') {
      s.notifications = { ...s.notifications, webhookIncludeDetails: t.checked };
    } else if (t.id === 'sessionBudgetCap') {
      s.apiBudget = { ...s.apiBudget, sessionCapUSD: normalizeBudgetCap(t.value) };
    } else if (t.id === 'dailyBudgetCap') {
      s.apiBudget = { ...s.apiBudget, dailyCapUSD: normalizeBudgetCap(t.value) };
    } else {
      return;
    }
    state.settings = s;
    await saveState(state);
    await renderSyncSettings(state);
    await renderHistoryStatus();
    await renderDiagnostics();
    renderSnoozeStatus(s);
    renderWebhookStatus(s);
    renderBudgetStatus(s, state.budget);
    flash('Saved just now');
    // Tell the background to reschedule alarms if interval changed.
    const runtime = getRuntime();
    if (t.id === 'refreshMinutes' && runtime?.sendMessage) {
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
          flash('Enter an API key first', 'bad');
          return;
        }
        if (provider === 'github-copilot') {
          const organization = document.querySelector('[data-api-config="githubCopilotOrganization"]')?.value?.trim() || '';
          const username = document.querySelector('[data-api-config="githubCopilotUsername"]')?.value?.trim() || '';
          if (!organization || !username) {
            flash('Enter the GitHub organization and username first', 'bad');
            return;
          }
          state.settings = normalizeSettings(state.settings);
          state.settings.githubCopilotOrganization = organization;
          state.settings.githubCopilotUsername = username;
        }
        if (provider === 'gemini') {
          const projectId = document.querySelector('[data-api-config="geminiProjectId"]')?.value?.trim() || '';
          if (!projectId) {
            flash('Enter the Google Cloud project ID first', 'bad');
            return;
          }
          state.settings = normalizeSettings(state.settings);
          state.settings.geminiProjectId = projectId;
        }
        await saveApiCredential(provider, value);
        if (provider === 'github-copilot' || provider === 'gemini') await saveState(state);
        if (input) input.value = '';
        await renderApiCredentials();
        if (action === 'refresh') await refreshApiProviderData();
        else flash(`${API_PROVIDER_META[provider]?.label || provider} key saved`);
      } else if (action === 'revoke') {
        await removeApiCredential(provider);
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
        flash(`${API_PROVIDER_META[provider]?.label || provider} key revoked`);
      }
    } catch (error) {
      flash(`API credential update failed: ${error?.message || 'unknown error'}`, 'bad');
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById('resetWidgetPosition').addEventListener('click', async () => {
    const state = await loadState();
    state.widget = { x: null, y: null, minimized: false };
    await saveState(state);
    await renderDiagnostics();
    flash('Widget reset');
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
    flash('Notifications snoozed for 1 hour');
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
    flash('Notifications resumed');
  });

  document.getElementById('testNotification').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const permission = await requestNotificationPermission();
      const ok = permission.state === 'granted'
        && await notify({
          id: 'aut-test-notification',
          title: 'AI Usage Tracker test alert',
          body: 'Notification delivery is ready for the current browser context.',
          tone: 'info',
        });
      flash(ok ? 'Test notification sent' : 'Notification permission was not granted', ok ? 'good' : 'bad');
      await renderNotificationPermission();
    } catch {
      flash('Test notification failed', 'bad');
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
        flash('Enter a valid HTTP(S) webhook URL first', 'bad');
        return;
      }
      const now = new Date();
      const permission = await requestWebhookHostPermission(url);
      if (!permission.ok) {
        flash('Webhook endpoint permission was not granted', 'bad');
        return;
      }
      const result = await deliverWebhook({
        url,
        payload: buildWebhookPayload({
          ruleId: 'test',
          tone: 'info',
          title: 'AI Usage Tracker webhook test',
          body: 'Webhook delivery is configured.',
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
      flash(result.ok ? 'Redacted webhook test delivered' : `Webhook test failed: ${result.errorCode || 'delivery failed'}`, result.ok ? 'good' : 'bad');
    } catch {
      flash('Webhook test failed: delivery unavailable', 'bad');
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
    flash('Session spend baseline reset');
  });

  document.getElementById('exportHistory').addEventListener('click', async () => {
    const state = await loadState();
    downloadHistory(state.history || []);
    flash('History CSV download started');
  });

  document.getElementById('compactHistory').addEventListener('click', async () => {
    if (!confirmAction('Export a CSV before compacting? Compaction keeps representative samples and cannot be undone.')) return;
    const state = await loadState();
    const retentionDays = normalizeSettings(state.settings).historyRetentionDays;
    state.history = compactHistory(state.history || [], { retentionDays });
    await saveState(state);
    await renderHistoryStatus();
    await renderDiagnostics();
    flash('History compacted');
  });

  document.getElementById('clearHistory').addEventListener('click', async () => {
    if (!confirmAction('Clear all local history? Export a CSV first if you may need these samples later.')) return;
    const state = await loadState();
    state.history = [];
    await saveState(state);
    await renderHistoryStatus();
    await renderDiagnostics();
    flash('History cleared');
  });

  const settingsImportFile = document.getElementById('settingsImportFile');
  document.getElementById('exportSettings').addEventListener('click', async () => {
    const state = await loadState();
    const includeHistory = document.getElementById('includeHistoryInSettings').checked;
    downloadSettings(exportSettings(state, { includeHistory }));
    document.getElementById('settingsTransferStatus').textContent = includeHistory
      ? 'Settings and history JSON download started.'
      : 'Settings JSON download started; history was omitted.';
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
        ? 'Settings import applied, including history when present.'
        : 'Settings import applied; existing history was preserved.';
      flash('Settings imported');
    } catch (error) {
      document.getElementById('settingsTransferStatus').textContent = `Import rejected: ${error?.message || 'invalid file'}`;
      flash('Settings import rejected', 'bad');
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
        flash('Claude org cache cleared and usage refreshed');
        btn.disabled = false;
      }, 1000);
    } catch (err) {
      flash(`Reset failed: ${String(err?.message || err)}`, 'bad');
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
        flash('Snapshot refreshed');
        btn.disabled = false;
      }, 800);
    } catch (err) {
      flash(`Refresh failed: ${String(err?.message || err)}`, 'bad');
      btn.disabled = false;
    }
  });

  document.getElementById('copyDiagnostics').addEventListener('click', async () => {
    const state = await loadState();
    const usage = await getStorageUsage(state);
    const text = JSON.stringify(buildDiagnosticsBundle(state, usage), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      flash('Redacted diagnostics copied');
    } catch {
      flash('Clipboard unavailable', 'bad');
    }
  });

  document.getElementById('exportDiagnostics').addEventListener('click', async () => {
    const state = await loadState();
    const usage = await getStorageUsage(state);
    downloadDiagnostics(buildDiagnosticsBundle(state, usage));
    flash('Redacted diagnostics download started');
  });
}

export async function renderDiagnostics() {
  const state = await loadState();
  const wrap = document.getElementById('diagnostics');
  if (!wrap) return;

  const usage = await getStorageUsage(state);
  const diag = buildDiagnostics(state, usage);
  clearChildren(wrap);
  addDiagnostic(wrap, 'Snapshot', diag.snapshot);
  for (const [provider, providerDiag] of Object.entries(diag.providers)) {
    addDiagnostic(wrap, providerLabel(provider), providerDiag.summary, providerDiag.ok ? 'good' : 'bad');
  }
  addDiagnostic(wrap, 'Rows', diag.rows);
  addDiagnostic(wrap, 'Appearance', `${diag.settings.theme}; warn ${diag.settings.thresholds.warnAt}% / danger ${diag.settings.thresholds.dangerAt}%`);
  addDiagnostic(wrap, 'History', diag.history);
  addDiagnostic(wrap, 'Storage', diag.storage);
  addDiagnostic(wrap, 'Alerts', diag.notifications.summary, diag.notifications.snoozed ? 'warn' : 'good');
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
  wrap.textContent = `${stats.sampleCount} samples across ${stats.bucketCount} buckets. Retaining ${settings.historyRetentionDays} days. ${formatStorageUsage(usage)}.`;
  wrap.className = 'opt-callout opt-callout--good';
}

function downloadHistory(history) {
  if (typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    flash('Download unavailable', 'bad');
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

function downloadSettings(payload) {
  if (typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    flash('Download unavailable', 'bad');
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
    flash('Download unavailable', 'bad');
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

function confirmAction(message) {
  return typeof window !== 'undefined' && typeof window.confirm === 'function'
    ? window.confirm(message)
    : true;
}

function formatStorageUsage(usage = {}) {
  const bytes = formatBytes(usage.bytes);
  if (usage.quotaBytes) return `${bytes} of ${formatBytes(usage.quotaBytes)} (${usage.source})`;
  return `${bytes} (${usage.source})`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return 'unknown size';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function buildDiagnostics(state, usage = {}) {
  const providers = state.snapshot?.providers || {};
  const settings = normalizeSettings(state.settings);
  const thresholds = normalizeThresholds(state.settings?.thresholds);
  const history = historyStats(state.history || []);
  const rows = Object.values(providers)
    .filter((ps) => ps?.ok)
    .reduce((sum, ps) => sum + (ps.buckets?.length || 0), 0);
  return {
    version: VERSION,
    snapshot: state.snapshot?.fetchedAtISO ? `Updated ${formatAgo(state.snapshot.fetchedAtISO)}` : 'No successful snapshot yet',
    providers: Object.fromEntries(Object.entries(providers).map(([provider, snapshot]) => [
      provider,
      providerDiagnostic(provider, snapshot),
    ])),
    rows: `${rows} discovered rows; ${visibleRowCount(state)} visible by current settings`,
    settings: {
      refreshMinutes: settings.refreshMinutes,
      silentTabRefresh: settings.silentTabRefresh === true,
      theme: normalizeThemeValue(settings.theme),
      highContrast: settings.highContrast === true,
      thresholds,
      providers: settings.showProviders,
    },
    history: `${history.sampleCount} samples across ${history.bucketCount} buckets; ${settings.historyRetentionDays} day retention`,
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
    ? `Snoozed until ${new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
    : 'Active';
  if (notifications.webhookEnabled === true) {
    if (notifications.webhookLastErrorCode) {
      summary += `; webhook failed (${notifications.webhookLastErrorCode})`;
    } else if (notifications.webhookLastSuccessISO) {
      summary += `; webhook delivered ${formatAgo(notifications.webhookLastSuccessISO)}`;
    } else {
      summary += '; webhook enabled with redacted payloads';
    }
  }
  return {
    snoozed,
    summary,
  };
}

function formatUSD(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function providerDiagnostic(provider, ps) {
  if (!ps) return { ok: false, summary: 'No local snapshot yet' };
  if (!ps.ok && !ps.stale) return {
    ok: false,
    summary: formatProviderError(ps.lastErrorDetail || ps.error || 'Last refresh failed', ps.lastErrorCode),
  };
  const parts = [
    `${ps.buckets?.length || 0} rows`,
    sourceLabel(ps.lastSuccessSource || ps.source),
  ];
  if (provider === 'claude' && ps.orgId) parts.push(`org ${shortId(ps.orgId)}`);
  if (ps.plan) parts.push(ps.plan);
  if (ps.lastSuccessISO) parts.push(`fresh ${formatAgo(ps.lastSuccessISO)}`);
  if (ps.stale) parts.push(`(stale - ${formatProviderError('last fetch failed', ps.lastErrorCode)})`);
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
  if (!source) return 'unknown source';
  if (source === 'api') return 'API source';
  if (source === 'dom') return 'rendered page source';
  if (source === 'html') return 'HTML fallback';
  if (source === 'live') return 'live content source';
  if (source === 'fetch') return 'fetch source';
  if (source === 'stream') return 'streamed message-limit source';
  if (source === 'headers') return 'rate-limit headers source';
  if (source === 'api-key') return 'official API key source';
  return `${source} source`;
}

function providerLabel(provider) {
  if (provider === 'claude') return 'Claude';
  if (provider === 'codex') return 'Codex';
  return API_PROVIDER_META[provider]?.label || provider;
}

async function refreshApiProviderData() {
  try {
    await sendRuntimeMessage({ type: 'aut/refresh' });
    await renderRows();
    await renderDiagnostics();
    await loadCurrent();
    flash('Official API data refreshed');
  } catch (error) {
    flash(`API refresh failed: ${error?.message || 'unknown error'}`, 'bad');
  }
}

function shortId(id) {
  const s = String(id);
  if (s.length <= 8) return s;
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

function formatAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return 'at unknown time';
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
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
    saveStatus.textContent = 'Ready';
    saveStatus.style.color = '';
  }, 1400);
}
