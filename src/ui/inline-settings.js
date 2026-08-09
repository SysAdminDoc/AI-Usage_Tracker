import {
  exportSettings,
  getStorageUsage,
  importSettings,
  loadState,
  saveState,
  createProfile,
  deleteProfile,
  getActiveProfile,
  listProfiles,
  renameProfile,
  switchProfile,
} from '../lib/storage.js';
import {
  compactHistory,
  historyStats,
  historyToCSV,
  HISTORY_RETENTION_OPTIONS,
} from '../lib/history.js';
import {
  defaultRowEnabled,
  listRowOptions,
  normalizeSettings,
  normalizeThemeValue,
} from '../lib/settings.js';
import { getNotificationPermission, notify, requestNotificationPermission } from '../lib/browser.js';
import { applyElementLocale, createI18n, SUPPORTED_LOCALES, localeLabel } from '../lib/i18n.js';

const REFRESH_OPTIONS = [1, 5, 15, 30];
const ANOMALY_THRESHOLD_OPTIONS = [10, 15, 20, 25, 30, 40, 50];
const NOTIFICATION_OPTIONS = [
  ['R1-60', 'options.renewal60'],
  ['R1-15', 'options.renewal15'],
  ['R1-0', 'options.renewal0'],
  ['R2', 'options.resetPositive'],
  ['U1-75', 'options.threshold75'],
  ['U1-90', 'options.threshold90'],
  ['U1-95', 'options.threshold95'],
  ['U2', 'options.burnRate'],
  ['U3', 'options.spike'],
  ['D1', 'options.dailyBriefing'],
];

const MODAL_CSS = `
.aut-inline-settings-root {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  color: var(--aut-text);
}
.aut-inline-settings-backdrop {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 12px;
  background: rgba(8, 8, 15, 0.68);
}
.aut-root[data-aut-theme="latte"] .aut-inline-settings-backdrop {
  background: rgba(48, 48, 64, 0.34);
}
.aut-inline-settings-dialog {
  width: min(680px, calc(100vw - 24px));
  max-height: min(780px, calc(100vh - 24px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--aut-card-bg);
  border: 1px solid var(--aut-border);
  border-radius: var(--aut-r-lg);
  box-shadow: 0 28px 70px -28px rgba(0, 0, 0, 0.9);
}
.aut-inline-settings__head,
.aut-inline-settings__foot {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  flex: 0 0 auto;
}
.aut-inline-settings__head {
  border-bottom: 1px solid var(--aut-border-subtle);
}
.aut-inline-settings__head h2 {
  margin: 0;
  font-size: 15px;
  color: var(--aut-text);
}
.aut-inline-settings__head p {
  margin: 2px 0 0;
  color: var(--aut-subtext0);
  font-size: 11px;
}
.aut-inline-settings__head-copy { min-width: 0; }
.aut-inline-settings__close {
  margin-inline-start: auto;
  width: 44px;
  height: 44px;
  border: 1px solid transparent;
  border-radius: var(--aut-r-sm);
  color: var(--aut-subtext0);
  background: transparent;
  font: inherit;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}
.aut-inline-settings__close:hover,
.aut-inline-settings__close:focus-visible {
  color: var(--aut-text);
  background: var(--aut-row-bg-hover);
  border-color: var(--aut-border);
  outline: none;
}
.aut-inline-settings__body {
  overflow: auto;
  padding: 14px 16px 18px;
}
.aut-inline-settings__section + .aut-inline-settings__section { margin-top: 16px; }
.aut-inline-settings__section h3 {
  margin: 0 0 4px;
  color: var(--aut-subtext1);
  font-size: 12px;
}
.aut-inline-settings__hint {
  margin: 0 0 10px;
  color: var(--aut-subtext0);
  font-size: 11px;
  line-height: 1.45;
}
.aut-inline-settings__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 7px;
}
.aut-inline-settings__toggle {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 44px;
  padding: 8px 10px;
  color: var(--aut-text);
  background: var(--aut-row-bg);
  border: 1px solid var(--aut-border-subtle);
  border-radius: var(--aut-r-md);
  cursor: pointer;
  font-size: 11px;
}
.aut-inline-settings__toggle:hover { background: var(--aut-row-bg-hover); }
.aut-inline-settings__toggle:focus-within {
  outline: 2px solid var(--aut-focus);
  outline-offset: 2px;
}
.aut-inline-settings__toggle input { accent-color: var(--aut-lavender); }
.aut-inline-settings__row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 9px;
  color: var(--aut-subtext1);
  font-size: 11px;
}
.aut-inline-settings__row > label:first-child { min-width: 118px; }
.aut-inline-settings__select {
  min-height: 44px;
  padding: 6px 10px;
  color: var(--aut-text);
  background: var(--aut-row-bg);
  border: 1px solid var(--aut-border);
  border-radius: var(--aut-r-sm);
  font: inherit;
}
.aut-inline-settings__select:focus-visible,
.aut-inline-settings__range:focus-visible,
.aut-inline-settings__button:focus-visible {
  outline: 2px solid var(--aut-focus);
  outline-offset: 2px;
}
.aut-inline-settings__thresholds { display: grid; gap: 9px; margin-top: 10px; }
.aut-inline-settings__range-label { display: grid; gap: 6px; color: var(--aut-subtext1); font-size: 11px; }
.aut-inline-settings__range-label span { display: flex; justify-content: space-between; gap: 8px; }
.aut-inline-settings__range-label strong { color: var(--aut-text); font-variant-numeric: tabular-nums; }
.aut-inline-settings__range { width: 100%; accent-color: var(--aut-lavender); }
.aut-inline-settings__foot {
  justify-content: flex-end;
  border-top: 1px solid var(--aut-border-subtle);
}
.aut-inline-settings__status { margin-inline-end: auto; color: var(--aut-subtext0); font-size: 11px; }
.aut-inline-settings__button {
  min-height: 44px;
  padding: 8px 13px;
  color: var(--aut-text);
  background: var(--aut-row-bg);
  border: 1px solid var(--aut-border);
  border-radius: var(--aut-r-md);
  font: inherit;
  font-size: 11px;
  font-weight: 650;
  cursor: pointer;
}
.aut-inline-settings__button--primary {
  color: var(--aut-crust);
  background: linear-gradient(135deg, var(--aut-sapphire), var(--aut-lavender));
}
.aut-inline-settings__button:hover { background: var(--aut-row-bg-hover); }
.aut-inline-settings__button--primary:hover { background: linear-gradient(135deg, var(--aut-blue), var(--aut-lavender)); }
.aut-inline-settings__history-actions { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 8px; }
.aut-inline-settings__notification { display: grid; gap: 7px; margin-top: 10px; }
.aut-inline-settings__profiles { display: grid; gap: 7px; }
.aut-inline-settings__profile { display: grid; gap: 7px; padding: 9px 10px; background: var(--aut-row-bg); border: 1px solid var(--aut-border-subtle); border-radius: var(--aut-r-md); }
.aut-inline-settings__profile-head { display: flex; align-items: baseline; gap: 8px; }
.aut-inline-settings__profile-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--aut-text); font-weight: 700; }
.aut-inline-settings__profile-meta { color: var(--aut-subtext0); font-size: 10px; }
.aut-inline-settings__profile-actions { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; }
.aut-inline-settings__profile-rename { flex: 1 1 160px; min-height: 40px; min-width: 0; box-sizing: border-box; padding: 7px 9px; color: var(--aut-text); background: var(--aut-surface0); border: 1px solid var(--aut-border); border-radius: var(--aut-r-sm); font: inherit; font-size: 11px; }
.aut-inline-settings__profile-rename:focus-visible { outline: 2px solid var(--aut-focus); outline-offset: 2px; }
@media (max-width: 520px) {
  .aut-inline-settings__row { align-items: stretch; flex-direction: column; }
  .aut-inline-settings__row > label:first-child { min-width: 0; }
  .aut-inline-settings__grid { grid-template-columns: 1fr; }
}
`;

let modalHost = null;
let activeI18n = createI18n('en');

function t(key, variables = {}) {
  return activeI18n.t(key, variables);
}

export async function openInlineSettings({ onSaved } = {}) {
  if (modalHost) {
    modalHost.shadowRoot?.querySelector('.aut-inline-settings__close')?.focus();
    return;
  }

  let state = await loadState();
  let draft = normalizeSettings(state.settings);
  const returnFocus = document.activeElement;
  activeI18n = createI18n(draft.locale);
  const host = document.createElement('div');
  host.id = 'aut-inline-settings-host';
  host.style.cssText = 'all: initial;';
  document.documentElement.appendChild(host);
  modalHost = host;
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `${globalThis.__AUT_THEME_CSS__ || ''}\n${globalThis.__AUT_OPTIONS_CSS__ || ''}\n${MODAL_CSS}`;
  shadow.appendChild(style);

  const root = document.createElement('div');
  root.className = 'aut-root aut-inline-settings-root';
  shadow.appendChild(root);
  const backdrop = document.createElement('div');
  backdrop.className = 'aut-inline-settings-backdrop';
  root.appendChild(backdrop);
  const dialog = document.createElement('section');
  dialog.className = 'aut-inline-settings-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'aut-inline-settings-title');
  applyElementLocale(activeI18n, dialog);
  backdrop.appendChild(dialog);

  dialog.appendChild(buildHeader());
  const body = document.createElement('div');
  body.className = 'aut-inline-settings__body';
  dialog.appendChild(body);
  const controls = buildControls(body, state);
  await renderProfileControls(controls.profiles);
  const foot = buildFooter();
  dialog.appendChild(foot);
  applyDraft(controls, draft);
  applyTheme(root, draft);
  await updateHistorySummary(controls.history, state);
  bindHistoryActions(controls.history, foot, () => state, (next) => { state = next; });
  bindProfileControls(controls.profiles, async (message) => {
    host.remove();
    modalHost = null;
    if (onSaved) await onSaved();
    await openInlineSettings({ onSaved });
    return message;
  });
  await renderNotificationPermission(controls.notificationPermission);

  const focusables = () => [...dialog.querySelectorAll('button, input, select')]
    .filter((element) => !element.disabled && element.getAttribute('tabindex') !== '-1');
  const close = () => {
    host.remove();
    modalHost = null;
    if (returnFocus && returnFocus.isConnected && typeof returnFocus.focus === 'function') focusElement(returnFocus);
    if (globalThis.__AUT_TEST_INLINE_DIALOG__?.dialog === dialog) delete globalThis.__AUT_TEST_INLINE_DIALOG__;
  };
  const save = async () => {
    draft = readDraft(controls, draft);
    state.settings = normalizeSettings(draft);
    await saveState(state);
    foot.status.textContent = t('inline.saved');
    if (onSaved) await onSaved(state.settings);
    setTimeout(() => { if (modalHost === host) close(); }, 260);
  };

  dialog.addEventListener('change', () => {
    draft = readDraft(controls, draft);
    applyTheme(root, draft);
    foot.status.textContent = t('inline.unsaved');
  });
  controls.warnAt.addEventListener('input', () => updateThresholdLabels(controls));
  controls.dangerAt.addEventListener('input', () => updateThresholdLabels(controls));
  foot.save.addEventListener('click', () => save().catch(() => { foot.status.textContent = t('inline.saveFailed'); }));
  foot.close.addEventListener('click', close);
  controls.notificationPermission.button.addEventListener('click', async () => {
    controls.notificationPermission.button.disabled = true;
    try {
      const permission = await requestNotificationPermission();
      const ok = permission.state === 'granted'
        && await notify({
          id: 'aut-test-notification',
          title: t('inline.testAlertTitle'),
          body: t('inline.testAlertBody'),
          tone: 'info',
        });
      controls.notificationPermission.status.textContent = ok
        ? t('inline.testSent')
        : t('inline.permissionNotGranted');
      await renderNotificationPermission(controls.notificationPermission);
    } catch {
      controls.notificationPermission.status.textContent = t('inline.testFailed');
    } finally {
      controls.notificationPermission.button.disabled = false;
    }
  });
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close(); });
  shadow.addEventListener('keydown', (event) => handleDialogKeydown(event, { focusables, close, root: shadow }));
  if (globalThis.__AUT_BROWSER_TEST__ === true) {
    globalThis.__AUT_TEST_FOCUS_LOG__ = [];
    globalThis.__AUT_TEST_INLINE_DIALOG__ = {
      dialog,
      getFocusables: focusables,
      close,
      handleKeydown: (event) => handleDialogKeydown(event, { focusables, close, root: shadow }),
    };
  }
  setTimeout(() => focusElement(foot.close), 0);
}

function focusElement(element) {
  if (!element || typeof element.focus !== 'function') return;
  element.focus({ preventScroll: true });
  if (globalThis.__AUT_BROWSER_TEST__ === true) {
    const name = element.id || element.className || element.tagName || 'unknown';
    globalThis.__AUT_TEST_FOCUS_LOG__ = [...(globalThis.__AUT_TEST_FOCUS_LOG__ || []), String(name)].slice(-24);
  }
}

export function handleDialogKeydown(event, { focusables, close, root = null }) {
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
    return true;
  }
  if (event.key !== 'Tab') return false;
  const items = focusables();
  if (!items.length) return false;
  const first = items[0];
  const last = items[items.length - 1];
  const active = event.activeElement || root?.activeElement || document.activeElement;
  if (event.shiftKey && active === first) {
    event.preventDefault();
    focusElement(last);
    return true;
  }
  if (!event.shiftKey && active === last) {
    event.preventDefault();
    focusElement(first);
    return true;
  }
  return false;
}

function buildHeader() {
  const header = document.createElement('header');
  header.className = 'aut-inline-settings__head';
  const dot = document.createElement('span');
  dot.className = 'aut-widget__brand-dot';
  header.appendChild(dot);
  const copy = document.createElement('div');
  copy.className = 'aut-inline-settings__head-copy';
  const title = document.createElement('h2');
  title.id = 'aut-inline-settings-title';
  title.textContent = t('inline.title');
  const hint = document.createElement('p');
  hint.textContent = t('inline.savedLocally');
  copy.append(title, hint);
  header.appendChild(copy);
  const close = document.createElement('button');
  close.className = 'aut-inline-settings__close';
  close.type = 'button';
  close.setAttribute('aria-label', t('app.close'));
  close.textContent = '×';
  header.appendChild(close);
  return header;
}

function buildControls(body, state) {
  const controls = {};
  body.appendChild(buildSection(t('inline.profiles'), t('inline.profilesHint'), (section) => {
    controls.profiles = buildProfileControls(section);
  }));
  body.appendChild(buildSection(t('inline.providers'), t('inline.providersHint'), (section) => {
    controls.providers = addToggleGrid(section, [
      ['claude', t('provider.claude')],
      ['codex', t('provider.codex')],
    ], 'provider');
  }));
  body.appendChild(buildSection(t('options.quotaRows'), t('inline.rowsHint'), (section) => {
    controls.rows = addToggleGrid(section, listRowOptions(state).map((row) => [row.id, row.label]), 'row');
  }));
  body.appendChild(buildSection(t('inline.refresh'), t('inline.refreshHint'), (section) => {
    controls.refreshMinutes = addSelectRow(section, t('inline.refreshInterval'), REFRESH_OPTIONS.map((n) => [n, activeI18n.tp('inline.everyMinute', n)]), 'refreshMinutes');
    controls.silentTabRefresh = addCheckboxRow(section, t('inline.hiddenFallback'), 'silentTabRefresh');
  }));
  body.appendChild(buildSection(t('inline.appearance'), t('inline.appearanceHint'), (section) => {
    controls.theme = addSelectRow(section, t('options.theme'), [['mocha', t('options.mocha')], ['latte', t('options.latte')], ['system', t('options.system')]], 'theme');
    controls.locale = addSelectRow(section, t('options.language'), SUPPORTED_LOCALES.map((locale) => [locale, localeLabel(locale)]), 'locale');
    controls.highContrast = addCheckboxRow(section, t('options.highContrast'), 'highContrast');
    const thresholdWrap = document.createElement('div');
    thresholdWrap.className = 'aut-inline-settings__thresholds';
    controls.warnAt = addRange(thresholdWrap, t('options.warnAt'), 'warnAt', 25, 85, 5);
    controls.dangerAt = addRange(thresholdWrap, t('options.dangerAt'), 'dangerAt', 55, 95, 5);
    section.appendChild(thresholdWrap);
  }));
  body.appendChild(buildSection(t('inline.notifications'), t('inline.notificationsHint'), (section) => {
    controls.notifications = addToggleGrid(section, NOTIFICATION_OPTIONS, 'notification');
    controls.notificationPermission = buildNotificationPermissionControls(section);
    controls.anomalyThresholdPercent = addSelectRow(section, t('options.spikeThreshold'), ANOMALY_THRESHOLD_OPTIONS.map((n) => [n, activeI18n.tp('options.percentagePoints', n)]), 'anomalyThresholdPercent');
    controls.dailyBriefingHour = addSelectRow(section, t('options.dailyBriefingTime'), Array.from({ length: 24 }, (_, h) => [h, `${String(h).padStart(2, '0')}:00`]), 'dailyBriefingHour');
  }));
  body.appendChild(buildSection(t('options.history'), t('inline.historyHint'), (section) => {
    controls.history = buildHistoryControls(section);
  }));
  return controls;
}

function buildProfileControls(parent) {
  const status = document.createElement('p');
  status.className = 'aut-inline-settings__hint';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const list = document.createElement('div');
  list.className = 'aut-inline-settings__profiles';
  const row = document.createElement('div');
  row.className = 'aut-inline-settings__profile-actions';
  const input = document.createElement('input');
  input.className = 'aut-inline-settings__profile-rename';
  input.type = 'text';
  input.maxLength = 48;
  input.autocomplete = 'off';
  input.placeholder = t('inline.newProfile');
  input.setAttribute('aria-label', t('inline.newProfile'));
  const create = historyActionButton(t('options.createProfile'));
  row.append(input, create);
  parent.append(status, list, row);
  return { status, list, input, create };
}

async function renderProfileControls(controls) {
  if (!controls) return;
  const [profiles, active] = await Promise.all([listProfiles(), getActiveProfile()]);
  controls.list.replaceChildren();
  for (const profile of profiles) {
    const item = document.createElement('div');
    item.className = 'aut-inline-settings__profile';
    item.dataset.profileId = profile.id;
    const head = document.createElement('div');
    head.className = 'aut-inline-settings__profile-head';
    const name = document.createElement('strong');
    name.className = 'aut-inline-settings__profile-name';
    name.textContent = profile.name;
    const meta = document.createElement('span');
    meta.className = 'aut-inline-settings__profile-meta';
    meta.textContent = profile.id === active.id ? t('inline.active') : t('inline.local');
    head.append(name, meta);
    const actions = document.createElement('div');
    actions.className = 'aut-inline-settings__profile-actions';
    const renameInput = document.createElement('input');
    renameInput.className = 'aut-inline-settings__profile-rename';
    renameInput.type = 'text';
    renameInput.maxLength = 48;
    renameInput.value = profile.name;
    renameInput.setAttribute('aria-label', t('options.renameProfile', { name: profile.name }));
    renameInput.dataset.profileRename = profile.id;
    const switchButton = historyActionButton(profile.id === active.id ? t('inline.active') : t('app.switch'));
    switchButton.dataset.profileAction = 'switch';
    switchButton.dataset.profileId = profile.id;
    switchButton.disabled = profile.id === active.id;
    const renameButton = historyActionButton(t('app.rename'));
    renameButton.dataset.profileAction = 'rename';
    renameButton.dataset.profileId = profile.id;
    const deleteButton = historyActionButton(t('app.delete'));
    deleteButton.dataset.profileAction = 'delete';
    deleteButton.dataset.profileId = profile.id;
    deleteButton.disabled = profiles.length <= 1;
    actions.append(renameInput, switchButton, renameButton, deleteButton);
    item.append(head, actions);
    controls.list.appendChild(item);
  }
  controls.status.textContent = t('inline.activeSummary', {
    name: active.name,
    count: profiles.length,
  });
}

function bindProfileControls(controls, reload) {
  if (!controls) return;
  controls.create.addEventListener('click', async () => {
    try {
      const profile = await createProfile(controls.input.value);
      await switchProfile(profile.id);
      await reload(t('options.switchedProfile', { name: profile.name }));
    } catch (error) {
      controls.status.textContent = t('inline.profileCreationFailed', { error: error?.message || t('app.unknownError') });
    }
  });
  controls.list.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-profile-action]');
    if (!button) return;
    const profileId = button.dataset.profileId;
    try {
      if (button.dataset.profileAction === 'switch') {
        const profile = await switchProfile(profileId);
        await reload(t('options.switchedProfile', { name: profile.name }));
      } else if (button.dataset.profileAction === 'rename') {
        const input = [...controls.list.querySelectorAll('input[data-profile-rename]')]
          .find((candidate) => candidate.dataset.profileRename === profileId);
        const profile = await renameProfile(profileId, input?.value || '');
        await reload(t('options.renamedProfile', { name: profile.name }));
      } else if (button.dataset.profileAction === 'delete') {
        const profile = (await listProfiles()).find((candidate) => candidate.id === profileId);
        if (!profile || !confirmAction(t('inline.profileDeleteConfirm', { name: profile.name }))) return;
        const registry = await deleteProfile(profileId);
        const active = registry.profiles.find((candidate) => candidate.id === registry.activeId);
        await reload(t('options.activeProfile', { name: active?.name || t('app.defaultProfile') }));
      }
    } catch (error) {
      controls.status.textContent = t('inline.profileUpdateFailed', { error: error?.message || t('app.unknownError') });
    }
  });
}

function buildHistoryControls(parent) {
  const retentionDays = addSelectRow(
    parent,
    t('options.keepSamples'),
    HISTORY_RETENTION_OPTIONS.map((days) => [days, activeI18n.tp('options.days', days)]),
    'historyRetentionDays',
  );
  const summary = document.createElement('p');
  summary.className = 'aut-inline-settings__hint';
  summary.setAttribute('role', 'status');
  summary.textContent = t('inline.loadingHistory');
  parent.appendChild(summary);
  const actions = document.createElement('div');
  actions.className = 'aut-inline-settings__history-actions';
  const exportButton = historyActionButton(t('options.exportCSV'));
  const compactButton = historyActionButton(t('options.compactHistory'));
  const clearButton = historyActionButton(t('options.clearHistory'));
  actions.append(exportButton, compactButton, clearButton);
  parent.appendChild(actions);
  const backupToggle = document.createElement('label');
  backupToggle.className = 'aut-inline-settings__toggle';
  const includeHistory = document.createElement('input');
  includeHistory.type = 'checkbox';
  const backupLabel = document.createElement('span');
  backupLabel.textContent = t('inline.includeHistory');
  backupToggle.append(includeHistory, backupLabel);
  parent.appendChild(backupToggle);
  const backupActions = document.createElement('div');
  backupActions.className = 'aut-inline-settings__history-actions';
  const exportSettingsButton = historyActionButton(t('inline.exportSettings'));
  const importSettingsButton = historyActionButton(t('inline.importSettings'));
  const importFile = document.createElement('input');
  importFile.type = 'file';
  importFile.accept = 'application/json,.json';
  importFile.setAttribute('aria-label', t('inline.selectSettings'));
  importFile.hidden = true;
  backupActions.append(exportSettingsButton, importSettingsButton, importFile);
  parent.appendChild(backupActions);
  const backupStatus = document.createElement('p');
  backupStatus.className = 'aut-inline-settings__hint';
  backupStatus.setAttribute('role', 'status');
  backupStatus.setAttribute('aria-live', 'polite');
  backupStatus.textContent = t('inline.backupHint');
  parent.appendChild(backupStatus);
  return {
    retentionDays,
    summary,
    exportButton,
    compactButton,
    clearButton,
    includeHistory,
    exportSettingsButton,
    importSettingsButton,
    importFile,
    backupStatus,
  };
}

function buildNotificationPermissionControls(parent) {
  const wrap = document.createElement('div');
  wrap.className = 'aut-inline-settings__notification';
  const status = document.createElement('p');
  status.className = 'aut-inline-settings__hint';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const button = historyActionButton(t('inline.notificationPermission'));
  wrap.append(status, button);
  parent.appendChild(wrap);
  return { wrap, status, button };
}

async function renderNotificationPermission(controls) {
  if (!controls) return;
  const capability = getNotificationPermission();
  controls.status.textContent = capability.state === 'granted'
    ? capability.detail
    : capability.state === 'denied'
      ? t('inline.permissionDenied')
      : capability.state === 'default'
        ? t('inline.permissionPending')
        : capability.detail;
  controls.button.disabled = capability.state === 'unsupported';
}

function historyActionButton(label) {
  const button = document.createElement('button');
  button.className = 'aut-inline-settings__button';
  button.type = 'button';
  button.textContent = label;
  return button;
}

async function updateHistorySummary(controls, state) {
  if (!controls) return;
  const stats = historyStats(state.history || []);
  const usage = await getStorageUsage(state);
  controls.retentionDays.value = String(normalizeSettings(state.settings).historyRetentionDays);
  controls.summary.textContent = t('inline.historySummary', {
    samples: activeI18n.tp('plural.sample', stats.sampleCount),
    buckets: activeI18n.tp('plural.bucket', stats.bucketCount),
    bytes: formatBytes(usage.bytes),
    source: storageSourceLabel(usage.source),
  });
}

function bindHistoryActions(controls, foot, getState, setState) {
  controls.exportButton.addEventListener('click', () => {
    downloadHistory(getState().history || []);
    foot.status.textContent = t('inline.csvStarted');
  });
  controls.exportSettingsButton.addEventListener('click', () => {
    downloadSettings(exportSettings(getState(), { includeHistory: controls.includeHistory.checked }));
    controls.backupStatus.textContent = controls.includeHistory.checked
      ? t('inline.settingsDownloadWithHistory')
      : t('inline.settingsDownload');
  });
  controls.importSettingsButton.addEventListener('click', () => controls.importFile.click());
  controls.importFile.addEventListener('change', async () => {
    const file = controls.importFile.files?.[0];
    if (!file) return;
    try {
      const next = await importSettings(await file.text(), { includeHistory: controls.includeHistory.checked });
      setState(next);
      await updateHistorySummary(controls, next);
      controls.backupStatus.textContent = controls.includeHistory.checked
        ? t('inline.settingsImportWithHistory')
        : t('inline.settingsImport');
      foot.status.textContent = t('inline.settingsImported');
    } catch (error) {
      controls.backupStatus.textContent = t('options.settingsImportRejected', { error: error?.message || t('app.invalidFile') });
      foot.status.textContent = t('inline.settingsRejected');
    } finally {
      controls.importFile.value = '';
    }
  });
  controls.compactButton.addEventListener('click', async () => {
    if (!confirmAction(t('inline.compactConfirm'))) return;
    const state = await loadState();
    const retentionDays = Number(controls.retentionDays.value);
    state.history = compactHistory(state.history || [], { retentionDays });
    await saveState(state);
    setState(state);
    await updateHistorySummary(controls, state);
    foot.status.textContent = t('inline.historyCompacted');
  });
  controls.clearButton.addEventListener('click', async () => {
    if (!confirmAction(t('inline.deleteHistoryConfirm'))) return;
    const state = await loadState();
    state.history = [];
    await saveState(state);
    setState(state);
    await updateHistorySummary(controls, state);
    foot.status.textContent = t('inline.historyCleared');
  });
}

function confirmAction(message) {
  return typeof window !== 'undefined' && typeof window.confirm === 'function'
    ? window.confirm(message)
    : true;
}

function downloadHistory(history) {
  if (typeof document === 'undefined' || typeof Blob === 'undefined'
      || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return;
  const blob = new Blob([historyToCSV(history)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `ai-usage-tracker-history-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.style.display = 'none';
  document.documentElement.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadSettings(payload) {
  if (typeof document === 'undefined' || typeof Blob === 'undefined'
      || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `ai-usage-tracker-settings-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.style.display = 'none';
  document.documentElement.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return t('app.unknownSize');
  if (bytes < 1024) return `${activeI18n.formatNumber(bytes)} B`;
  if (bytes < 1024 * 1024) return `${activeI18n.formatNumber(bytes / 1024, { maximumFractionDigits: 1 })} KB`;
  return `${activeI18n.formatNumber(bytes / (1024 * 1024), { maximumFractionDigits: 1 })} MB`;
}

function storageSourceLabel(source) {
  if (source === 'webext') return t('options.storageSource.webext');
  if (source === 'unavailable') return t('options.storageSource.unavailable');
  if (String(source || '').endsWith('-estimate')) return t('options.storageSource.estimate');
  return t('options.storageSource.unknown', { source: source || t('app.unknown') });
}

function buildSection(titleText, hintText, fill) {
  const section = document.createElement('section');
  section.className = 'aut-inline-settings__section';
  const title = document.createElement('h3');
  title.textContent = titleText;
  const hint = document.createElement('p');
  hint.className = 'aut-inline-settings__hint';
  hint.textContent = hintText;
  section.append(title, hint);
  fill(section);
  return section;
}

function addToggleGrid(parent, entries, kind) {
  const grid = document.createElement('div');
  grid.className = 'aut-inline-settings__grid';
  const controls = {};
  for (const [id, labelText] of entries) {
    const label = document.createElement('label');
    label.className = 'aut-inline-settings__toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset[kind] = id;
    const text = document.createElement('span');
    const localized = t(labelText);
    text.textContent = localized === labelText ? labelText : localized;
    label.append(input, text);
    grid.appendChild(label);
    controls[id] = input;
  }
  parent.appendChild(grid);
  return controls;
}

function addCheckboxRow(parent, labelText, id) {
  const label = document.createElement('label');
  label.className = 'aut-inline-settings__toggle';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = id;
  const text = document.createElement('span');
  text.textContent = labelText;
  label.append(input, text);
  parent.appendChild(label);
  return input;
}

function addSelectRow(parent, labelText, entries, explicitId = '') {
  const row = document.createElement('div');
  row.className = 'aut-inline-settings__row';
  const label = document.createElement('label');
  label.textContent = labelText;
  const select = document.createElement('select');
  select.className = 'aut-inline-settings__select';
  for (const [value, textValue] of entries) {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = textValue;
    select.appendChild(option);
  }
  const id = explicitId || (labelText === 'Refresh interval' ? 'refreshMinutes'
    : labelText === 'Theme' ? 'theme' : 'dailyBriefingHour');
  select.id = id;
  label.htmlFor = id;
  row.append(label, select);
  parent.appendChild(row);
  return select;
}

function addRange(parent, labelText, id, min, max, step) {
  const label = document.createElement('label');
  label.className = 'aut-inline-settings__range-label';
  const text = document.createElement('span');
  const name = document.createElement('span');
  name.textContent = labelText;
  const value = document.createElement('strong');
  value.dataset.valueFor = id;
  text.append(name, value);
  const input = document.createElement('input');
  input.className = 'aut-inline-settings__range';
  input.type = 'range';
  input.id = id;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  label.append(text, input);
  parent.appendChild(label);
  return input;
}

function buildFooter() {
  const foot = document.createElement('footer');
  foot.className = 'aut-inline-settings__foot';
  foot.status = document.createElement('span');
  foot.status.className = 'aut-inline-settings__status';
  foot.status.setAttribute('role', 'status');
  foot.status.setAttribute('aria-live', 'polite');
  foot.status.textContent = t('inline.changeUnsaved');
  foot.close = document.createElement('button');
  foot.close.className = 'aut-inline-settings__button';
  foot.close.type = 'button';
  foot.close.textContent = t('inline.cancel');
  foot.save = document.createElement('button');
  foot.save.className = 'aut-inline-settings__button aut-inline-settings__button--primary';
  foot.save.type = 'button';
  foot.save.textContent = t('inline.save');
  foot.append(foot.status, foot.close, foot.save);
  return foot;
}

function applyDraft(controls, settings) {
  for (const [id, input] of Object.entries(controls.providers)) input.checked = settings.showProviders[id] !== false;
  for (const [id, input] of Object.entries(controls.rows)) input.checked = settings.showRows[id] ?? defaultRowEnabled(id);
  for (const [id, input] of Object.entries(controls.notifications)) input.checked = settings.notifications[id] === true;
  controls.refreshMinutes.value = String(settings.refreshMinutes);
  controls.silentTabRefresh.checked = settings.silentTabRefresh === true;
  controls.highContrast.checked = settings.highContrast === true;
  controls.theme.value = normalizeThemeValue(settings.theme);
  controls.locale.value = settings.locale || 'en';
  controls.anomalyThresholdPercent.value = String(settings.anomalyThresholdPercent ?? 20);
  controls.dailyBriefingHour.value = String(settings.notifications.dailyBriefingHour);
  controls.history.retentionDays.value = String(settings.historyRetentionDays);
  controls.warnAt.value = String(settings.thresholds.warnAt);
  controls.dangerAt.value = String(settings.thresholds.dangerAt);
  updateThresholdLabels(controls);
}

function readDraft(controls, prior) {
  const next = normalizeSettings(prior);
  for (const [id, input] of Object.entries(controls.providers)) next.showProviders[id] = input.checked;
  for (const [id, input] of Object.entries(controls.rows)) next.showRows[id] = input.checked;
  for (const [id, input] of Object.entries(controls.notifications)) next.notifications[id] = input.checked;
  next.refreshMinutes = Number(controls.refreshMinutes.value);
  next.silentTabRefresh = controls.silentTabRefresh.checked;
  next.highContrast = controls.highContrast.checked;
  next.theme = controls.theme.value;
  next.locale = controls.locale.value;
  next.anomalyThresholdPercent = Number(controls.anomalyThresholdPercent.value);
  next.notifications.dailyBriefingHour = Number(controls.dailyBriefingHour.value);
  next.historyRetentionDays = Number(controls.history.retentionDays.value);
  next.thresholds = {
    warnAt: Number(controls.warnAt.value),
    dangerAt: Number(controls.dangerAt.value),
  };
  return normalizeSettings(next);
}

function updateThresholdLabels(controls) {
  const warn = documentElementFor(controls.warnAt, '[data-value-for="warnAt"]');
  const danger = documentElementFor(controls.dangerAt, '[data-value-for="dangerAt"]');
  if (warn) warn.textContent = `${controls.warnAt.value}%`;
  if (danger) danger.textContent = `${controls.dangerAt.value}%`;
}

function documentElementFor(input, selector) {
  return input?.parentElement?.querySelector(selector) || null;
}

function applyTheme(root, settings) {
  const theme = normalizeThemeValue(settings.theme);
  const systemLight = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches;
  root.dataset.autTheme = theme === 'system' ? (systemLight ? 'latte' : 'mocha') : theme;
  root.dataset.autContrast = settings.highContrast === true ? 'high' : 'normal';
}
