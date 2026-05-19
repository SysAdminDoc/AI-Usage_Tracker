import { loadState } from '../lib/storage.js';
import { formatCountdown, formatResetAbsolute, ringColor } from '../lib/countdown.js';
import { sparklineFor } from '../lib/history.js';

const RING_R = 22;
const RING_C = 2 * Math.PI * RING_R;

const dashboard = document.getElementById('dashboard');
const updatedEl = document.getElementById('updated');
const refreshBtn = document.getElementById('refresh');

refreshBtn.addEventListener('click', async () => {
  refreshBtn.disabled = true;
  refreshBtn.classList.add('is-loading');
  refreshBtn.setAttribute('aria-busy', 'true');
  try {
    await sendRuntimeMessage({ type: 'aut/refresh' });
    setTimeout(render, 600);
  } finally {
    setTimeout(() => {
      refreshBtn.disabled = false;
      refreshBtn.classList.remove('is-loading');
      refreshBtn.removeAttribute('aria-busy');
    }, 450);
  }
});

document.getElementById('settings').addEventListener('click', () => {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
  else if (typeof browser !== 'undefined' && browser.runtime?.openOptionsPage) browser.runtime.openOptionsPage();
});

render();
setInterval(render, 1000);

async function render() {
  const state = await loadState();
  const { snapshot, settings, history } = state;

  dashboard.innerHTML = '';

  let drew = false;
  for (const provider of ['claude', 'codex']) {
    if (!settings.showProviders[provider]) continue;
    const ps = snapshot && snapshot.providers ? snapshot.providers[provider] : null;
    if (!ps) continue;
    if (!ps.ok) {
      dashboard.appendChild(renderError(provider, ps.error));
      drew = true;
      continue;
    }
    const visibleBuckets = ps.buckets.filter((b) => settings.showRows[b.id] !== false);
    if (!visibleBuckets.length) continue;
    dashboard.appendChild(renderProvider(provider, ps, visibleBuckets, history));
    drew = true;
  }

  if (!drew) {
    const empty = document.createElement('div');
    empty.className = 'popup-empty';
    empty.innerHTML = `
      <div class="popup-empty__title">No usage data yet</div>
      <div>Open a signed-in usage page once, then refresh this dashboard.</div>
      <div class="popup-empty__actions">
        <button class="aut-link-btn" data-provider="claude">Open Claude</button>
        <button class="aut-link-btn" data-provider="codex">Open Codex</button>
      </div>
    `;
    empty.querySelector('[data-provider="claude"]').addEventListener('click', () => openAnalytics('claude'));
    empty.querySelector('[data-provider="codex"]').addEventListener('click', () => openAnalytics('codex'));
    dashboard.appendChild(empty);
  }

  updatedEl.textContent = snapshot && snapshot.fetchedAtISO
    ? `Updated ${formatAgo(snapshot.fetchedAtISO)}`
    : 'Never updated';
}

function renderProvider(providerKey, ps, buckets, history) {
  const wrap = document.createElement('section');
  wrap.className = 'popup-provider';

  const head = document.createElement('div');
  head.className = 'popup-provider__head';
  head.innerHTML = `<span class="aut-widget__brand-dot"></span>${providerKey === 'claude' ? 'Claude' : 'Codex'}`;
  const meta = document.createElement('span');
  meta.className = 'popup-provider__meta';
  if (ps.plan) {
    const plan = document.createElement('span');
    plan.className = 'popup-provider__plan';
    plan.textContent = ps.plan;
    meta.appendChild(plan);
  }
  if (ps.source) {
    const source = document.createElement('span');
    source.className = 'popup-provider__source';
    source.textContent = sourceLabel(ps.source);
    meta.appendChild(source);
  }
  if (meta.childNodes.length) head.appendChild(meta);
  wrap.appendChild(head);

  for (const b of buckets) {
    wrap.appendChild(renderBucket(b, history));
  }
  return wrap;
}

function renderBucket(b, history) {
  const row = document.createElement('div');
  row.className = 'popup-bucket';

  const percent = Math.max(0, Math.min(100, b.percentUsed || 0));
  const remaining = 100 - percent;
  const offset = RING_C * (1 - remaining / 100);
  const ring = document.createElement('div');
  ring.className = 'popup-bucket__ring';
  ring.innerHTML = `
    <svg viewBox="0 0 52 52" style="transform:rotate(-90deg);">
      <circle cx="26" cy="26" r="${RING_R}" fill="none" stroke="var(--aut-surface0)" stroke-width="4"></circle>
      <circle cx="26" cy="26" r="${RING_R}" fill="none" stroke="${ringColor(percent)}" stroke-width="4"
              stroke-dasharray="${RING_C}" stroke-dashoffset="${offset}" stroke-linecap="round"></circle>
    </svg>
    <div style="margin-top:-36px;text-align:center;font-size:11px;font-weight:700;">${Math.round(remaining)}%</div>
  `;
  row.appendChild(ring);

  const main = document.createElement('div');
  main.className = 'popup-bucket__main';
  const subClass = b.resetISO ? 'popup-bucket__sub' : 'popup-bucket__sub popup-bucket__sub--missing';
  const subText = b.resetISO
    ? `Resets ${formatResetAbsolute(b.resetISO)} - in ${formatCountdown(b.resetISO)}`
    : (b.rawResetText || 'Reset not published');
  main.innerHTML = `
    <div class="popup-bucket__label">${escapeHtml(humanBucketLabel(b))}</div>
    <div class="${subClass}">${escapeHtml(subText)}</div>
  `;
  row.appendChild(main);

  const spark = document.createElement('div');
  spark.className = 'popup-bucket__spark';
  spark.appendChild(buildSparkline(history, b.id));
  row.appendChild(spark);
  row.setAttribute('aria-label', `${humanBucketLabel(b)}: ${Math.round(percent)} percent used`);

  return row;
}

function buildSparkline(history, bucketId) {
  const pts = sparklineFor(history, bucketId, { n: 24 });
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 80 28');
  svg.setAttribute('preserveAspectRatio', 'none');
  if (pts.length < 2) {
    const text = document.createElementNS(svgNS, 'text');
    text.setAttribute('x', '40'); text.setAttribute('y', '20');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('fill', 'var(--aut-overlay1)');
    text.setAttribute('font-size', '9');
    text.textContent = '-';
    svg.appendChild(text);
    return svg;
  }
  const w = 80, h = 28;
  const step = w / (pts.length - 1);
  const max = 100;
  let d = '';
  pts.forEach((v, i) => {
    const x = i * step;
    const y = h - (v / max) * h;
    d += (i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`);
  });
  d += ` L ${w} ${h} L 0 ${h} Z`;
  const path = document.createElementNS(svgNS, 'path');
  path.setAttribute('d', d);
  svg.appendChild(path);
  return svg;
}

function renderError(provider, error) {
  const wrap = document.createElement('section');
  wrap.className = 'popup-provider';
  wrap.innerHTML = `
    <div class="popup-provider__head"><span class="aut-widget__brand-dot"></span>${provider === 'claude' ? 'Claude' : 'Codex'}</div>
    <div class="popup-error">
      <div class="popup-error__title">${error === 'shell-response' ? 'Waiting for a signed-in reading' : 'Refresh failed'}</div>
      <div>${error === 'shell-response'
        ? 'Open the usage page once while signed in, then refresh this popup.'
        : escapeHtml(error || 'Unknown error')}</div>
      <div class="popup-error__actions">
        <button class="aut-link-btn" data-provider="${provider}">Open usage page</button>
      </div>
    </div>
  `;
  wrap.querySelector('[data-provider]')?.addEventListener('click', () => openAnalytics(provider));
  return wrap;
}

function humanBucketLabel(b) {
  if (b.kind === 'session') return 'Current session (5 hr)';
  if (b.kind === '5h')      return b.model === 'all' ? '5-hour limit' : `${titleModel(b.model)} (5 hr)`;
  if (b.kind === 'weekly')  return b.model === 'all' ? 'Weekly limit' : `${titleModel(b.model)} (weekly)`;
  return b.label;
}

function titleModel(model) {
  return String(model || '')
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
  }[c]));
}

function formatAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function sourceLabel(source) {
  if (source === 'api') return 'API';
  if (source === 'dom') return 'Page';
  if (source === 'html') return 'HTML';
  if (source === 'live') return 'Live';
  if (source === 'fetch') return 'Fetch';
  return String(source).slice(0, 12);
}

function openAnalytics(provider) {
  sendRuntimeMessage({ type: 'aut/open-analytics', provider }).catch(() => {
    const url = provider === 'claude'
      ? 'https://claude.ai/settings/usage'
      : 'https://chatgpt.com/codex/cloud/settings/analytics#usage';
    window.open(url, '_blank');
  });
}

function sendRuntimeMessage(message) {
  if (typeof browser !== 'undefined' && browser.runtime?.sendMessage && typeof chrome === 'undefined') {
    return browser.runtime.sendMessage(message);
  }
  const runtime = (typeof chrome !== 'undefined' && chrome.runtime)
    || (typeof browser !== 'undefined' && browser.runtime);
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
