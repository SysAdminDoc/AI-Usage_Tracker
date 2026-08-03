import { render as renderDashboard } from './popup.js';
import { loadState } from '../lib/storage.js';
import { clearChildren, createElement } from '../lib/dom.js';
import { API_PROVIDER_IDS, API_PROVIDER_META } from '../providers/api-contract.js';

const diagnostics = document.getElementById('sidepanelDiagnostics');

renderDashboard().then(() => renderSidepanelDiagnostics()).catch(() => {});
setInterval(() => renderSidepanelDiagnostics().catch(() => {}), 5_000);

async function renderSidepanelDiagnostics() {
  const state = await loadState();
  if (!diagnostics) return;
  clearChildren(diagnostics);
  const snapshot = state.snapshot || {};
  addDiagnostic('Snapshot', snapshot.fetchedAtISO ? formatAge(snapshot.fetchedAtISO) : 'No successful snapshot yet');
  for (const provider of ['claude', 'codex', ...API_PROVIDER_IDS]) {
    const ps = snapshot.providers?.[provider];
    const source = ps?.lastSuccessSource || ps?.source || 'no source';
    const freshness = ps?.lastSuccessISO ? formatAge(ps.lastSuccessISO) : 'never successful';
    const code = ps?.lastErrorCode ? ` · ${ps.lastErrorCode}` : '';
    const label = provider === 'claude' ? 'Claude'
      : provider === 'codex' ? 'Codex'
        : API_PROVIDER_META[provider]?.label || provider;
    addDiagnostic(label, `${source} · ${freshness}${ps?.stale ? ' · stale' : ''}${code}`);
  }
  addDiagnostic('History', `${state.history?.length || 0} local samples`);
  addDiagnostic('Storage', 'Local only');
}

function addDiagnostic(label, value) {
  const row = createElement('div', { className: 'sidepanel-diagnostic' });
  row.append(
    createElement('span', { text: label }),
    createElement('strong', { text: value }),
  );
  diagnostics.appendChild(row);
}

function formatAge(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return 'time unavailable';
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
