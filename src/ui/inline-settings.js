import { getStorageUsage, loadState, saveState } from '../lib/storage.js';
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

const REFRESH_OPTIONS = [1, 5, 15, 30];
const NOTIFICATION_OPTIONS = [
  ['R1-60', 'Renewal - 60 min before reset'],
  ['R1-15', 'Renewal - 15 min before reset'],
  ['R1-0', 'Renewal - at reset moment'],
  ['R2', 'On-reset positive - fresh quota'],
  ['U1-75', 'Threshold - 75% used'],
  ['U1-90', 'Threshold - 90% used'],
  ['U1-95', 'Threshold - 95% used'],
  ['U2', 'Burn-rate forecast - weekly'],
  ['D1', 'Daily briefing'],
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
  margin-left: auto;
  width: 34px;
  height: 34px;
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
  min-height: 38px;
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
  min-height: 34px;
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
.aut-inline-settings__status { margin-right: auto; color: var(--aut-subtext0); font-size: 11px; }
.aut-inline-settings__button {
  min-height: 36px;
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
@media (max-width: 520px) {
  .aut-inline-settings__row { align-items: stretch; flex-direction: column; }
  .aut-inline-settings__row > label:first-child { min-width: 0; }
  .aut-inline-settings__grid { grid-template-columns: 1fr; }
}
`;

let modalHost = null;

export async function openInlineSettings({ onSaved } = {}) {
  if (modalHost) {
    modalHost.shadowRoot?.querySelector('.aut-inline-settings__close')?.focus();
    return;
  }

  let state = await loadState();
  let draft = normalizeSettings(state.settings);
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
  backdrop.appendChild(dialog);

  dialog.appendChild(buildHeader());
  const body = document.createElement('div');
  body.className = 'aut-inline-settings__body';
  dialog.appendChild(body);
  const controls = buildControls(body, state);
  const foot = buildFooter();
  dialog.appendChild(foot);
  applyDraft(controls, draft);
  applyTheme(root, draft);
  await updateHistorySummary(controls.history, state);
  bindHistoryActions(controls.history, foot, () => state, (next) => { state = next; });

  const focusables = () => [...dialog.querySelectorAll('button, input, select')]
    .filter((element) => !element.disabled && element.getAttribute('tabindex') !== '-1');
  const close = () => {
    host.remove();
    modalHost = null;
  };
  const save = async () => {
    draft = readDraft(controls, draft);
    state.settings = normalizeSettings(draft);
    await saveState(state);
    foot.status.textContent = 'Saved locally';
    if (onSaved) await onSaved(state.settings);
    setTimeout(() => { if (modalHost === host) close(); }, 260);
  };

  dialog.addEventListener('change', () => {
    draft = readDraft(controls, draft);
    applyTheme(root, draft);
    foot.status.textContent = 'Unsaved changes';
  });
  controls.warnAt.addEventListener('input', () => updateThresholdLabels(controls));
  controls.dangerAt.addEventListener('input', () => updateThresholdLabels(controls));
  foot.save.addEventListener('click', () => save().catch(() => { foot.status.textContent = 'Save failed'; }));
  foot.close.addEventListener('click', close);
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close(); });
  shadow.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'Tab') return;
    const items = focusables();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = shadow.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault(); first.focus();
    }
  });
  setTimeout(() => foot.close.focus(), 0);
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
  title.textContent = 'AI Usage Tracker settings';
  const hint = document.createElement('p');
  hint.textContent = 'Saved locally in your userscript manager';
  copy.append(title, hint);
  header.appendChild(copy);
  const close = document.createElement('button');
  close.className = 'aut-inline-settings__close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Close settings');
  close.textContent = '×';
  header.appendChild(close);
  return header;
}

function buildControls(body, state) {
  const controls = {};
  body.appendChild(buildSection('Providers', 'Choose which providers appear in the widget.', (section) => {
    controls.providers = addToggleGrid(section, [
      ['claude', 'Claude'],
      ['codex', 'Codex'],
    ], 'provider');
  }));
  body.appendChild(buildSection('Quota rows', 'Keep the dashboard compact or add model-specific rows.', (section) => {
    controls.rows = addToggleGrid(section, listRowOptions(state).map((row) => [row.id, row.label]), 'row');
  }));
  body.appendChild(buildSection('Refresh', 'Refresh cadence and the optional page fallback.', (section) => {
    controls.refreshMinutes = addSelectRow(section, 'Refresh interval', REFRESH_OPTIONS.map((n) => [n, `Every ${n} minute${n === 1 ? '' : 's'}`]), 'refreshMinutes');
    controls.silentTabRefresh = addCheckboxRow(section, 'Use hidden fallback tabs when API refresh fails', 'silentTabRefresh');
  }));
  body.appendChild(buildSection('Appearance', 'Choose the surface theme and visual warning thresholds.', (section) => {
    controls.theme = addSelectRow(section, 'Theme', [['mocha', 'Mocha dark'], ['latte', 'Latte light'], ['system', 'Follow system']], 'theme');
    const thresholdWrap = document.createElement('div');
    thresholdWrap.className = 'aut-inline-settings__thresholds';
    controls.warnAt = addRange(thresholdWrap, 'Warn at', 'warnAt', 25, 85, 5);
    controls.dangerAt = addRange(thresholdWrap, 'Danger at', 'dangerAt', 55, 95, 5);
    section.appendChild(thresholdWrap);
  }));
  body.appendChild(buildSection('Notifications', 'Choose which alerts can fire while this tab is open.', (section) => {
    controls.notifications = addToggleGrid(section, NOTIFICATION_OPTIONS, 'notification');
    controls.dailyBriefingHour = addSelectRow(section, 'Daily briefing time', Array.from({ length: 24 }, (_, h) => [h, `${String(h).padStart(2, '0')}:00`]), 'dailyBriefingHour');
  }));
  body.appendChild(buildSection('History', 'Export a CSV before compacting or clearing local samples. History never leaves your browser unless you download it.', (section) => {
    controls.history = buildHistoryControls(section);
  }));
  return controls;
}

function buildHistoryControls(parent) {
  const retentionDays = addSelectRow(
    parent,
    'Keep samples for',
    HISTORY_RETENTION_OPTIONS.map((days) => [days, `${days} days`]),
    'historyRetentionDays',
  );
  const summary = document.createElement('p');
  summary.className = 'aut-inline-settings__hint';
  summary.setAttribute('role', 'status');
  summary.textContent = 'Loading local history details…';
  parent.appendChild(summary);
  const actions = document.createElement('div');
  actions.className = 'aut-inline-settings__history-actions';
  const exportButton = historyActionButton('Export CSV');
  const compactButton = historyActionButton('Compact history');
  const clearButton = historyActionButton('Clear history');
  actions.append(exportButton, compactButton, clearButton);
  parent.appendChild(actions);
  return { retentionDays, summary, exportButton, compactButton, clearButton };
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
  controls.summary.textContent = `${stats.sampleCount} samples across ${stats.bucketCount} buckets; ${formatBytes(usage.bytes)} stored (${usage.source}).`;
}

function bindHistoryActions(controls, foot, getState, setState) {
  controls.exportButton.addEventListener('click', () => {
    downloadHistory(getState().history || []);
    foot.status.textContent = 'CSV download started';
  });
  controls.compactButton.addEventListener('click', async () => {
    if (!confirmAction('Export a CSV before compacting? Compaction keeps representative samples and cannot be undone.')) return;
    const state = await loadState();
    const retentionDays = Number(controls.retentionDays.value);
    state.history = compactHistory(state.history || [], { retentionDays });
    await saveState(state);
    setState(state);
    await updateHistorySummary(controls, state);
    foot.status.textContent = 'History compacted';
  });
  controls.clearButton.addEventListener('click', async () => {
    if (!confirmAction('Clear all local history? Export a CSV first if you may need these samples later.')) return;
    const state = await loadState();
    state.history = [];
    await saveState(state);
    setState(state);
    await updateHistorySummary(controls, state);
    foot.status.textContent = 'History cleared';
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

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return 'unknown size';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
    text.textContent = labelText;
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
  foot.status.textContent = 'Changes are not saved yet';
  foot.close = document.createElement('button');
  foot.close.className = 'aut-inline-settings__button';
  foot.close.type = 'button';
  foot.close.textContent = 'Cancel';
  foot.save = document.createElement('button');
  foot.save.className = 'aut-inline-settings__button aut-inline-settings__button--primary';
  foot.save.type = 'button';
  foot.save.textContent = 'Save settings';
  foot.append(foot.status, foot.close, foot.save);
  return foot;
}

function applyDraft(controls, settings) {
  for (const [id, input] of Object.entries(controls.providers)) input.checked = settings.showProviders[id] !== false;
  for (const [id, input] of Object.entries(controls.rows)) input.checked = settings.showRows[id] ?? defaultRowEnabled(id);
  for (const [id, input] of Object.entries(controls.notifications)) input.checked = settings.notifications[id] === true;
  controls.refreshMinutes.value = String(settings.refreshMinutes);
  controls.silentTabRefresh.checked = settings.silentTabRefresh === true;
  controls.theme.value = normalizeThemeValue(settings.theme);
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
  next.theme = controls.theme.value;
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
}
