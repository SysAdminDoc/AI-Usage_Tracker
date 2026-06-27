import { loadState, saveState, defaultSettings } from '../lib/storage.js';
import { normalizeThresholds } from '../lib/countdown.js';

const VERSION = '0.2.2';

const KNOWN_ROWS = [
  { id: 'claude-session',        label: 'Claude - Current session' },
  { id: 'claude-weekly-all',     label: 'Claude - Weekly (All models)' },
  { id: 'claude-weekly-sonnet',  label: 'Claude - Weekly (Sonnet only)' },
  { id: 'claude-weekly-design',  label: 'Claude - Weekly (Claude Design)' },
  { id: 'codex-5h-all',          label: 'Codex - 5-hour limit' },
  { id: 'codex-weekly-all',      label: 'Codex - Weekly limit' },
];

const saveStatus = document.getElementById('saveStatus');

init();

async function init() {
  document.querySelector('.opt-head__sub').textContent = `Settings - v${VERSION}`;
  saveStatus.textContent = 'Ready';

  // Populate daily-briefing hour select
  const hourSelect = document.getElementById('dailyBriefingHour');
  for (let h = 0; h < 24; h++) {
    const opt = document.createElement('option');
    opt.value = h;
    opt.textContent = `${h.toString().padStart(2, '0')}:00`;
    hourSelect.appendChild(opt);
  }

  await renderProviders();
  await renderRows();
  await loadCurrent();
  await renderDiagnostics();
  bindHandlers();
}

async function renderProviders() {
  const wrap = document.getElementById('provider-toggles');
  wrap.innerHTML = '';
  for (const id of ['claude', 'codex']) {
    const label = document.createElement('label');
    label.className = 'opt-toggle';
    label.innerHTML = `<input type="checkbox" data-provider="${id}"> ${id === 'claude' ? 'Claude' : 'Codex'}`;
    wrap.appendChild(label);
  }
}

async function renderRows() {
  const state = await loadState();
  const wrap = document.getElementById('row-toggles');
  wrap.innerHTML = '';

  // Surface any row IDs the scraper has seen but aren't in our base list.
  const seen = new Set(KNOWN_ROWS.map((r) => r.id));
  const dyn = [];
  const providers = state.snapshot?.providers || {};
  for (const p of Object.keys(providers)) {
    const ps = providers[p];
    if (!ps || !ps.ok) continue;
    for (const b of ps.buckets) {
      if (!seen.has(b.id)) {
        dyn.push({ id: b.id, label: `${p === 'claude' ? 'Claude' : 'Codex'} - ${b.label}` });
        seen.add(b.id);
      }
    }
  }
  const all = [...KNOWN_ROWS, ...dyn];

  for (const row of all) {
    const label = document.createElement('label');
    label.className = 'opt-toggle';
    label.innerHTML = `<input type="checkbox" data-row="${row.id}"> ${row.label}`;
    wrap.appendChild(label);
  }
}

async function loadCurrent() {
  const state = await loadState();
  const s = state.settings;
  const notifications = s.notifications || {};
  applyTheme(s);

  for (const cb of document.querySelectorAll('[data-provider]')) {
    cb.checked = !!s.showProviders[cb.dataset.provider];
  }
  for (const cb of document.querySelectorAll('[data-row]')) {
    const fallback = ['claude-session', 'claude-weekly-all', 'codex-5h-all', 'codex-weekly-all'].includes(cb.dataset.row);
    cb.checked = s.showRows[cb.dataset.row] ?? fallback;
  }
  for (const cb of document.querySelectorAll('[data-notif]')) {
    cb.checked = !!notifications[cb.dataset.notif];
  }
  document.getElementById('refreshMinutes').value = String(s.refreshMinutes ?? 5);
  document.getElementById('silentTabRefresh').checked = s.silentTabRefresh === true;
  document.getElementById('dailyBriefingHour').value = String(notifications.dailyBriefingHour ?? 8);
  document.getElementById('theme').value = normalizeThemeValue(s.theme);
  const thresholds = normalizeThresholds(s.thresholds);
  document.getElementById('warnAt').value = String(thresholds.warnAt);
  document.getElementById('dangerAt').value = String(thresholds.dangerAt);
  setThresholdLabels(thresholds);
  renderSnoozeStatus(s);
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

function renderSnoozeStatus(settings = {}) {
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

function normalizeThemeValue(theme) {
  if (theme === 'latte' || theme === 'mocha-light') return 'latte';
  if (theme === 'system') return 'system';
  return 'mocha';
}

function applyTheme(settings = {}) {
  const requested = normalizeThemeValue(settings.theme);
  const systemLight = typeof matchMedia === 'function'
    && matchMedia('(prefers-color-scheme: light)').matches;
  document.body.dataset.autTheme = requested === 'system'
    ? (systemLight ? 'latte' : 'mocha')
    : requested;
}

function bindHandlers() {
  document.body.addEventListener('change', async (e) => {
    const t = e.target;
    const state = await loadState();
    const s = state.settings || defaultSettings();
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
    } else if (t.id === 'dailyBriefingHour') {
      s.notifications = s.notifications || {};
      s.notifications.dailyBriefingHour = parseInt(t.value, 10) || 8;
    } else if (t.id === 'theme') {
      s.theme = t.value;
      applyTheme(s);
    } else if (t.id === 'warnAt' || t.id === 'dangerAt') {
      s.thresholds = readThresholdControls(t.id);
    } else {
      return;
    }
    state.settings = s;
    await saveState(state);
    await renderDiagnostics();
    renderSnoozeStatus(s);
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
    const text = JSON.stringify(buildDiagnostics(state), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      flash('Diagnostics copied');
    } catch {
      flash('Clipboard unavailable', 'bad');
    }
  });
}

async function renderDiagnostics() {
  const state = await loadState();
  const wrap = document.getElementById('diagnostics');
  if (!wrap) return;

  const diag = buildDiagnostics(state);
  wrap.innerHTML = '';
  addDiagnostic(wrap, 'Snapshot', diag.snapshot);
  addDiagnostic(wrap, 'Claude', diag.providers.claude.summary, diag.providers.claude.ok ? 'good' : 'bad');
  addDiagnostic(wrap, 'Codex', diag.providers.codex.summary, diag.providers.codex.ok ? 'good' : 'bad');
  addDiagnostic(wrap, 'Rows', diag.rows);
  addDiagnostic(wrap, 'Appearance', `${diag.settings.theme}; warn ${diag.settings.thresholds.warnAt}% / danger ${diag.settings.thresholds.dangerAt}%`);
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

function buildDiagnostics(state) {
  const providers = state.snapshot?.providers || {};
  const thresholds = normalizeThresholds(state.settings?.thresholds);
  const rows = Object.values(providers)
    .filter((ps) => ps?.ok)
    .reduce((sum, ps) => sum + (ps.buckets?.length || 0), 0);
  return {
    version: VERSION,
    snapshot: state.snapshot?.fetchedAtISO ? `Updated ${formatAgo(state.snapshot.fetchedAtISO)}` : 'No successful snapshot yet',
    providers: {
      claude: providerDiagnostic('claude', providers.claude),
      codex: providerDiagnostic('codex', providers.codex),
    },
    rows: `${rows} discovered rows; ${visibleRowCount(state)} visible by current settings`,
    settings: {
      refreshMinutes: state.settings?.refreshMinutes,
      silentTabRefresh: state.settings?.silentTabRefresh === true,
      theme: normalizeThemeValue(state.settings?.theme),
      thresholds,
      providers: state.settings?.showProviders,
    },
    notifications: notificationDiagnostic(state.settings),
  };
}

function notificationDiagnostic(settings = {}) {
  const until = settings.notifications?.snoozedUntilISO || '';
  const ts = until ? new Date(until).getTime() : 0;
  const snoozed = Number.isFinite(ts) && ts > Date.now();
  return {
    snoozed,
    summary: snoozed
      ? `Snoozed until ${new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
      : 'Active',
  };
}

function providerDiagnostic(provider, ps) {
  if (!ps) return { ok: false, summary: 'No local snapshot yet' };
  if (!ps.ok && !ps.stale) return { ok: false, summary: ps.lastErrorDetail || ps.error || 'Last refresh failed' };
  const parts = [
    `${ps.buckets?.length || 0} rows`,
    sourceLabel(ps.lastSuccessSource || ps.source),
  ];
  if (provider === 'claude' && ps.orgId) parts.push(`org ${shortId(ps.orgId)}`);
  if (ps.plan) parts.push(ps.plan);
  if (ps.lastSuccessISO) parts.push(`fresh ${formatAgo(ps.lastSuccessISO)}`);
  if (ps.stale) parts.push('(stale - last fetch failed)');
  return { ok: !ps.stale && ps.ok !== false, summary: parts.filter(Boolean).join(' - ') };
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
  return `${source} source`;
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
