import { render as renderDashboard } from './popup.js';
import { loadState } from '../lib/storage.js';
import { clearChildren, createElement } from '../lib/dom.js';
import { API_PROVIDER_IDS, API_PROVIDER_META } from '../providers/api-contract.js';
import { createI18n } from '../lib/i18n.js';

const diagnostics = document.getElementById('sidepanelDiagnostics');

renderDashboard().then(() => renderSidepanelDiagnostics()).catch(() => {});
setInterval(() => renderSidepanelDiagnostics().catch(() => {}), 5_000);

async function renderSidepanelDiagnostics() {
  const state = await loadState();
  if (!diagnostics) return;
  clearChildren(diagnostics);
  const i18n = createI18n(state.settings?.locale);
  const snapshot = state.snapshot || {};
  addDiagnostic(i18n.t('sidepanel.snapshot'), snapshot.fetchedAtISO ? formatAge(snapshot.fetchedAtISO, i18n) : i18n.t('sidepanel.noSnapshot'));
  for (const provider of ['claude', 'codex', ...API_PROVIDER_IDS]) {
    const ps = snapshot.providers?.[provider];
    const source = sourceLabel(ps?.lastSuccessSource || ps?.source, i18n);
    const freshness = ps?.lastSuccessISO ? formatAge(ps.lastSuccessISO, i18n) : i18n.t('sidepanel.neverSuccessful');
    const stale = ps?.stale ? i18n.t('sidepanel.staleSuffix') : '';
    const code = ps?.lastErrorCode ? i18n.t('sidepanel.errorCode', { code: ps.lastErrorCode }) : '';
    const label = i18n.t(`provider.${provider}`) !== `provider.${provider}`
      ? i18n.t(`provider.${provider}`)
      : API_PROVIDER_META[provider]?.label || provider;
    addDiagnostic(label, i18n.t('sidepanel.providerStatus', { source, freshness, stale, code }));
  }
  addDiagnostic(i18n.t('sidepanel.history'), i18n.t('sidepanel.localSamples', { count: state.history?.length || 0 }));
  addDiagnostic(i18n.t('sidepanel.storage'), i18n.t('app.localOnly'));
}

function addDiagnostic(label, value) {
  const row = createElement('div', { className: 'sidepanel-diagnostic' });
  row.append(
    createElement('span', { text: label }),
    createElement('strong', { text: value }),
  );
  diagnostics.appendChild(row);
}

function formatAge(iso, i18n) {
  return i18n.formatRelative(iso);
}

function sourceLabel(source, i18n) {
  if (!source) return i18n.t('sidepanel.noSource');
  return i18n.t(`source.${source}`) === `source.${source}`
    ? i18n.t('common.source', { source })
    : i18n.t(`source.${source}`);
}
