import { loadState } from '../lib/storage.js';
import { formatCountdown, formatResetAbsolute, ringColor, normalizeThresholds } from '../lib/countdown.js';
import { sparklineSamplesFor } from '../lib/history.js';

const RING_R = 22;
const RING_C = 2 * Math.PI * RING_R;
const VERSION = '0.2.1';

const dashboard = document.getElementById('dashboard');
const updatedEl = document.getElementById('updated');
const refreshBtn = document.getElementById('refresh');
const versionEl = document.querySelector('.version');
if (versionEl) versionEl.textContent = `v${VERSION}`;

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
  applyTheme(settings);
  const thresholds = normalizeThresholds(settings.thresholds);

  dashboard.innerHTML = '';
  const overview = buildOverview(snapshot, settings, thresholds);
  if (overview) dashboard.appendChild(renderOverview(overview));

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
    dashboard.appendChild(renderProvider(provider, ps, visibleBuckets, history, thresholds));
    drew = true;
  }

  if (!drew) {
    const empty = document.createElement('div');
    empty.className = 'popup-empty';
    empty.innerHTML = `
      <div class="popup-empty__title">No local usage snapshot yet</div>
      <div>Open a signed-in usage page once. The tracker stores the reading locally, then this popup stays useful all day.</div>
      <div class="popup-empty__actions">
        <button class="aut-link-btn aut-link-btn--primary" data-provider="claude">Open Claude</button>
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

function renderOverview(overview) {
  const wrap = document.createElement('section');
  wrap.className = `popup-overview popup-overview--${overview.tone}`;
  wrap.setAttribute('aria-label', 'Usage overview');
  wrap.innerHTML = `
    <div class="popup-overview__copy">
      <span class="popup-overview__label">Most constrained</span>
      <strong>${escapeHtml(overview.title)}</strong>
      <span>${escapeHtml(overview.detail)}</span>
    </div>
    <div class="popup-overview__meta">
      <span class="aut-status-label aut-status-label--${overview.tone}">${overview.percent}% used</span>
      <span class="aut-status-label aut-status-label--info">Local only</span>
    </div>
  `;
  return wrap;
}

function renderProvider(providerKey, ps, buckets, history, thresholds) {
  const wrap = document.createElement('section');
  wrap.className = 'popup-provider';

  const head = document.createElement('div');
  head.className = 'popup-provider__head';
  head.innerHTML = `<span class="aut-widget__brand-dot"></span>${providerKey === 'claude' ? 'Claude' : 'Codex'}`;
  const meta = document.createElement('span');
  meta.className = 'popup-provider__meta';
  if (ps.plan) {
    const plan = document.createElement('span');
    plan.className = 'popup-provider__plan aut-status-label';
    plan.textContent = ps.plan;
    meta.appendChild(plan);
  }
  if (ps.source) {
    const source = document.createElement('span');
    source.className = 'popup-provider__source aut-status-label aut-status-label--good';
    source.textContent = sourceLabel(ps.source);
    meta.appendChild(source);
  }
  if (meta.childNodes.length) head.appendChild(meta);
  wrap.appendChild(head);

  for (const b of buckets) {
    wrap.appendChild(renderBucket(b, history, thresholds));
  }
  return wrap;
}

function renderBucket(b, history, thresholds) {
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
      <circle cx="26" cy="26" r="${RING_R}" fill="none" stroke="${ringColor(percent, thresholds)}" stroke-width="4"
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
  buildSparkline(spark, history, b.id);
  row.appendChild(spark);
  row.setAttribute('aria-label', `${humanBucketLabel(b)}: ${Math.round(percent)} percent used`);

  return row;
}

function buildOverview(snapshot, settings, thresholds) {
  const buckets = [];
  const providers = snapshot?.providers || {};
  for (const provider of ['claude', 'codex']) {
    if (settings?.showProviders?.[provider] === false) continue;
    const ps = providers[provider];
    if (!ps?.ok) continue;
    for (const bucket of ps.buckets || []) {
      if (settings?.showRows?.[bucket.id] === false) continue;
      const percent = Math.max(0, Math.min(100, Number(bucket.percentUsed) || 0));
      buckets.push({ provider, bucket, percent });
    }
  }
  if (!buckets.length) return null;
  buckets.sort((a, b) => b.percent - a.percent);
  const best = buckets[0];
  const reset = best.bucket.resetISO
    ? `${formatCountdown(best.bucket.resetISO)} until reset`
    : 'Reset time not published';
  return {
    title: `${best.provider === 'claude' ? 'Claude' : 'Codex'} ${humanBucketLabel(best.bucket)}`,
    detail: `${Math.round(100 - best.percent)}% remaining - ${reset}`,
    percent: Math.round(best.percent),
    tone: statusTone(best.percent, thresholds),
  };
}

function statusTone(percent, thresholds) {
  const t = normalizeThresholds(thresholds);
  if (percent >= t.dangerAt) return 'bad';
  if (percent >= t.warnAt) return 'warn';
  return 'good';
}

function buildSparkline(host, history, bucketId) {
  const samples = sparklineSamplesFor(history, bucketId, { n: 24 });
  const pts = samples.map((sample) => sample.percentUsed);
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
    host.appendChild(svg);
    return;
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
  host.appendChild(svg);
  attachSparklineTooltip(host, samples);
}

function attachSparklineTooltip(host, samples) {
  if (!samples.length) return;
  host.tabIndex = 0;
  host.setAttribute('role', 'img');
  host.setAttribute('aria-label', sparklineAriaLabel(samples));

  const tip = document.createElement('div');
  tip.className = 'popup-spark-tooltip';
  tip.setAttribute('role', 'tooltip');
  host.appendChild(tip);

  const show = (sample, x = host.clientWidth / 2) => {
    tip.textContent = `${formatHistoryPercent(sample.percentUsed)} used - ${formatHistoryTime(sample.ts)}`;
    const safeX = Math.max(34, Math.min(host.clientWidth - 34, x));
    tip.style.left = `${safeX}px`;
    tip.classList.add('is-visible');
  };
  const hide = () => tip.classList.remove('is-visible');

  host.addEventListener('pointermove', (event) => {
    const rect = host.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const idx = Math.max(0, Math.min(samples.length - 1, Math.round((x / rect.width) * (samples.length - 1))));
    show(samples[idx], x);
  });
  host.addEventListener('pointerleave', hide);
  host.addEventListener('focus', () => show(samples[samples.length - 1]));
  host.addEventListener('blur', hide);
}

function sparklineAriaLabel(samples) {
  const latest = samples[samples.length - 1];
  return `Usage history sparkline, latest ${formatHistoryPercent(latest.percentUsed)} at ${formatHistoryTime(latest.ts)}`;
}

function formatHistoryPercent(percentUsed) {
  const n = Number(percentUsed) || 0;
  return `${n.toFixed(Math.abs(n - Math.round(n)) < 0.05 ? 0 : 1)}%`;
}

function formatHistoryTime(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return 'unknown time';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
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
  if (source === 'stream') return 'Stream';
  if (source === 'headers') return 'Headers';
  return String(source).slice(0, 12);
}

function applyTheme(settings = {}) {
  const requested = settings.theme || 'mocha';
  const systemLight = typeof matchMedia === 'function'
    && matchMedia('(prefers-color-scheme: light)').matches;
  document.body.dataset.autTheme = requested === 'system'
    ? (systemLight ? 'latte' : 'mocha')
    : (requested === 'latte' || requested === 'mocha-light' ? 'latte' : 'mocha');
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
