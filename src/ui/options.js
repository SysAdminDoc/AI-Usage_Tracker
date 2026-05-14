import { loadState, saveState, defaultSettings } from '../lib/storage.js';

const KNOWN_ROWS = [
  { id: 'claude-session',        label: 'Claude — Current session' },
  { id: 'claude-weekly-all',     label: 'Claude — Weekly (All models)' },
  { id: 'claude-weekly-sonnet',  label: 'Claude — Weekly (Sonnet only)' },
  { id: 'claude-weekly-design',  label: 'Claude — Weekly (Claude Design)' },
  { id: 'codex-5h-all',          label: 'Codex — 5-hour limit' },
  { id: 'codex-weekly-all',      label: 'Codex — Weekly limit' },
];

const saveStatus = document.getElementById('saveStatus');

init();

async function init() {
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
        dyn.push({ id: b.id, label: `${p === 'claude' ? 'Claude' : 'Codex'} — ${b.label}` });
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

  for (const cb of document.querySelectorAll('[data-provider]')) {
    cb.checked = !!s.showProviders[cb.dataset.provider];
  }
  for (const cb of document.querySelectorAll('[data-row]')) {
    const fallback = ['claude-session', 'claude-weekly-all', 'codex-5h-all', 'codex-weekly-all'].includes(cb.dataset.row);
    cb.checked = s.showRows[cb.dataset.row] ?? fallback;
  }
  for (const cb of document.querySelectorAll('[data-notif]')) {
    cb.checked = !!s.notifications[cb.dataset.notif];
  }
  document.getElementById('refreshMinutes').value = String(s.refreshMinutes ?? 5);
  document.getElementById('dailyBriefingHour').value = String(s.notifications.dailyBriefingHour ?? 8);
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
    } else if (t.id === 'dailyBriefingHour') {
      s.notifications.dailyBriefingHour = parseInt(t.value, 10) || 8;
    } else {
      return;
    }
    state.settings = s;
    await saveState(state);
    flash('Saved.');
    // Tell the background to reschedule alarms if interval changed.
    if (t.id === 'refreshMinutes' && (chrome.runtime || (typeof browser !== 'undefined' && browser.runtime))) {
      const ns = chrome.runtime ? chrome.runtime : browser.runtime;
      ns.sendMessage({ type: 'aut/reschedule' });
    }
  });

  document.getElementById('resetWidgetPosition').addEventListener('click', async () => {
    const state = await loadState();
    state.widget = { x: null, y: null, minimized: false };
    await saveState(state);
    flash('Widget reset.');
  });
}

function flash(text) {
  saveStatus.textContent = text;
  saveStatus.style.color = 'var(--aut-green)';
  setTimeout(() => { saveStatus.style.color = ''; }, 1200);
}
