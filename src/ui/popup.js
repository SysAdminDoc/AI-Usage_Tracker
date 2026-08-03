import { getActiveProfile, loadState } from '../lib/storage.js';
import { formatCountdown, formatResetAbsolute, ringColor, normalizeThresholds } from '../lib/countdown.js';
import { sparklineSamplesFor } from '../lib/history.js';
import {
  appendChildren,
  clearChildren,
  createElement,
  createSvgElement,
  setSafeAttribute,
} from '../lib/dom.js';
import { createI18n } from '../lib/i18n.js';
import { API_PROVIDER_IDS } from '../providers/api-contract.js';

const RING_R = 22;
const RING_C = 2 * Math.PI * RING_R;
const VERSION = '0.2.2';

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
setInterval(() => {
  updateCountdowns();
  if (!dashboard.contains(document.activeElement)) render();
}, 1000);

function updateCountdowns() {
  for (const element of dashboard.querySelectorAll('.popup-bucket__countdown[data-target]')) {
    element.textContent = formatCountdown(element.dataset.target);
  }
}

export async function render() {
  const state = await loadState();
  const activeProfile = await getActiveProfile();
  const profileName = document.getElementById('profileName');
  if (profileName) {
    profileName.textContent = activeProfile?.name || 'Default';
    profileName.title = `Active local profile: ${activeProfile?.name || 'Default'}`;
  }
  const { snapshot, settings, history } = state;
  const i18n = createI18n(settings.locale);
  applyTheme(settings);
  const thresholds = normalizeThresholds(settings.thresholds);

  clearChildren(dashboard);
  const overview = buildOverview(snapshot, settings, thresholds, i18n);
  if (overview) dashboard.appendChild(renderOverview(overview, i18n));

  let drew = false;
  for (const provider of providerKeys(snapshot)) {
    if (settings.showProviders?.[provider] === false) continue;
    const ps = snapshot && snapshot.providers ? snapshot.providers[provider] : null;
    if (!ps) continue;
    if (!ps.ok) {
      dashboard.appendChild(renderError(provider, ps.error, i18n));
      drew = true;
      continue;
    }
    const visibleBuckets = ps.buckets.filter((b) => settings.showRows[b.id] !== false);
    if (!visibleBuckets.length) continue;
    dashboard.appendChild(renderProvider(provider, ps, visibleBuckets, history, thresholds, i18n));
    drew = true;
  }

  if (!drew) {
    const empty = createElement('div', { className: 'popup-empty' });
    const actions = createElement('div', { className: 'popup-empty__actions' });
    const claudeButton = createElement('button', {
      className: 'aut-link-btn aut-link-btn--primary',
      text: i18n.t('empty.openClaude'),
      attrs: { type: 'button', 'data-provider': 'claude' },
    });
    const codexButton = createElement('button', {
      className: 'aut-link-btn',
      text: i18n.t('empty.openCodex'),
      attrs: { type: 'button', 'data-provider': 'codex' },
    });
    appendChildren(actions, [claudeButton, codexButton]);
    appendChildren(empty, [
      createElement('div', { className: 'popup-empty__title', text: i18n.t('empty.title') }),
      createElement('div', { text: i18n.t('empty.body') }),
      actions,
    ]);
    claudeButton.addEventListener('click', () => openAnalytics('claude'));
    codexButton.addEventListener('click', () => openAnalytics('codex'));
    dashboard.appendChild(empty);
  }

  updatedEl.textContent = snapshot && snapshot.fetchedAtISO
    ? i18n.t('updated.prefix', { relative: i18n.formatRelative(snapshot.fetchedAtISO) })
    : i18n.t('updated.never');
}

function renderOverview(overview, i18n) {
  const wrap = createElement('section', {
    className: `popup-overview popup-overview--${overview.tone}`,
    attrs: { 'aria-label': 'Usage overview' },
  });
  const copy = createElement('div', { className: 'popup-overview__copy' });
  appendChildren(copy, [
    createElement('span', { className: 'popup-overview__label', text: i18n.t('overview.mostConstrained') }),
    createElement('strong', { text: overview.title }),
    createElement('span', { text: overview.detail }),
  ]);
  const meta = createElement('div', { className: 'popup-overview__meta' });
  appendChildren(meta, [
    createElement('span', {
      className: `aut-status-label aut-status-label--${overview.tone}`,
      text: i18n.t('overview.used', { percent: i18n.formatPercent(overview.percent) }),
    }),
    createElement('span', { className: 'aut-status-label aut-status-label--info', text: i18n.t('overview.localOnly') }),
  ]);
  appendChildren(wrap, [copy, meta]);
  return wrap;
}

function renderProvider(providerKey, ps, buckets, history, thresholds, i18n) {
  const wrap = document.createElement('section');
  wrap.className = 'popup-provider';

  const head = document.createElement('div');
  head.className = 'popup-provider__head';
  appendChildren(head, [
    createElement('span', { className: 'aut-widget__brand-dot' }),
    i18n.t(`provider.${providerKey}`),
  ]);
  const meta = createElement('span', { className: 'popup-provider__meta' });
  if (ps.plan) {
    const plan = document.createElement('span');
    plan.className = 'popup-provider__plan aut-status-label';
    plan.textContent = ps.plan;
    meta.appendChild(plan);
  }
  if (ps.source) {
    const source = document.createElement('span');
    source.className = 'popup-provider__source aut-status-label aut-status-label--good';
    source.textContent = sourceLabel(ps.lastSuccessSource || ps.source);
    meta.appendChild(source);
  }
  if (ps.stale) {
    const staleLabel = document.createElement('span');
    staleLabel.className = 'aut-status-label aut-status-label--warn';
    staleLabel.textContent = ps.lastSuccessISO
      ? i18n.t('status.stale', { relative: i18n.formatRelative(ps.lastSuccessISO) })
      : i18n.t('status.staleShort');
    staleLabel.title = ps.lastErrorDetail
      ? `Last error: ${ps.lastErrorDetail}`
      : 'Preserved from a previous successful fetch';
    meta.appendChild(staleLabel);
  }
  if (meta.childNodes.length) head.appendChild(meta);
  wrap.appendChild(head);

  for (const b of buckets) {
    wrap.appendChild(renderBucket(b, history, thresholds, i18n));
  }
  return wrap;
}

function renderBucket(b, history, thresholds, i18n = createI18n('en')) {
  const row = createElement('div', {
    className: `popup-bucket popup-bucket--${statusTone(b.percentUsed, thresholds)}`,
    attrs: { role: 'group' },
  });

  const percent = Math.max(0, Math.min(100, b.percentUsed || 0));
  const remaining = 100 - percent;
  const offset = RING_C * (1 - remaining / 100);
  if (b.metric) {
    row.appendChild(renderMetric(b.metric, i18n));
  } else {
    const ring = createElement('div', { className: 'popup-bucket__ring' });
    const svg = createSvgElement('svg', { attrs: { viewBox: '0 0 52 52', style: 'transform:rotate(-90deg);' } });
    appendChildren(svg, [
      createSvgElement('circle', {
        attrs: { cx: 26, cy: 26, r: RING_R, fill: 'none', stroke: 'var(--aut-surface0)', 'stroke-width': 4 },
      }),
      createSvgElement('circle', {
        attrs: {
          cx: 26,
          cy: 26,
          r: RING_R,
          fill: 'none',
          stroke: ringColor(percent, thresholds),
          'stroke-width': 4,
          'stroke-dasharray': RING_C,
          'stroke-dashoffset': offset,
          'stroke-linecap': 'round',
        },
      }),
    ]);
    appendChildren(ring, [
      svg,
      createElement('div', {
        className: 'popup-bucket__remaining',
        text: i18n.formatPercent(remaining),
      }),
    ]);
    row.appendChild(ring);
  }

  const main = createElement('div', { className: 'popup-bucket__main' });
  const subClass = b.resetISO ? 'popup-bucket__sub' : 'popup-bucket__sub popup-bucket__sub--missing';
  const sub = createElement('div', { className: subClass });
  if (b.resetISO) {
    appendChildren(sub, [
      createElement('span', { text: `Resets ${formatResetAbsolute(b.resetISO, i18n.locale)} - ` }),
      createElement('span', {
        className: 'popup-bucket__countdown',
        text: formatCountdown(b.resetISO),
        attrs: {
          role: 'timer',
          'aria-live': 'polite',
          'aria-atomic': 'true',
          'data-target': b.resetISO,
        },
      }),
    ]);
  } else {
    sub.textContent = b.rawResetText || 'Reset not published';
  }
  appendChildren(main, [
    createElement('div', { className: 'popup-bucket__label', text: humanBucketLabel(b) }),
    sub,
  ]);
  row.appendChild(main);

  const spark = document.createElement('div');
  spark.className = 'popup-bucket__spark';
  buildSparkline(spark, history, b.id, i18n);
  row.appendChild(spark);
  setSafeAttribute(row, 'aria-label', `${humanBucketLabel(b)}: ${Math.round(percent)} percent used`);

  return row;
}

function buildOverview(snapshot, settings, thresholds, i18n = createI18n('en')) {
  const buckets = [];
  const providers = snapshot?.providers || {};
  for (const provider of providerKeys(snapshot)) {
    if (settings?.showProviders?.[provider] === false) continue;
    const ps = providers[provider];
    if (!ps?.ok) continue;
    for (const bucket of ps.buckets || []) {
      if (bucket.metric) continue;
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
    title: `${i18n.t(`provider.${best.provider}`)} ${humanBucketLabel(best.bucket)}`,
    detail: `${i18n.formatPercent(100 - best.percent)} remaining - ${reset}`,
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

function buildSparkline(host, history, bucketId, i18n = createI18n('en')) {
  const samples = sparklineSamplesFor(history, bucketId, { n: 24 });
  const pts = samples.map((sample) => sample.percentUsed);
  const svg = createSvgElement('svg', { attrs: { viewBox: '0 0 80 28', preserveAspectRatio: 'none' } });
  if (pts.length < 2) {
    const text = createSvgElement('text', {
      attrs: { x: 40, y: 20, 'text-anchor': 'middle', fill: 'var(--aut-overlay1)', 'font-size': 9 },
      children: ['-'],
    });
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
  const path = createSvgElement('path', { attrs: { d } });
  svg.appendChild(path);
  host.appendChild(svg);
  attachSparklineTooltip(host, samples, i18n);
}

function attachSparklineTooltip(host, samples, i18n) {
  if (!samples.length) return;
  host.tabIndex = 0;
  setSafeAttribute(host, 'role', 'img');
  setSafeAttribute(host, 'aria-label', sparklineAriaLabel(samples, i18n));

  const tip = document.createElement('div');
  tip.className = 'popup-spark-tooltip';
  tip.setAttribute('role', 'tooltip');
  host.appendChild(tip);

  const show = (sample, x = host.clientWidth / 2) => {
    tip.textContent = `${i18n.formatPercent(sample.percentUsed, 1)} used - ${formatHistoryTime(sample.ts, i18n)}`;
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

function sparklineAriaLabel(samples, i18n = createI18n('en')) {
  const latest = samples[samples.length - 1];
  return `Usage history sparkline, latest ${i18n.formatPercent(latest.percentUsed, 1)} at ${formatHistoryTime(latest.ts, i18n)}`;
}

function formatHistoryPercent(percentUsed) {
  const n = Number(percentUsed) || 0;
  return `${n.toFixed(Math.abs(n - Math.round(n)) < 0.05 ? 0 : 1)}%`;
}

function formatHistoryTime(ts, i18n = createI18n('en')) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return 'unknown time';
  return i18n.formatDateTime(d.toISOString());
}

function renderError(provider, error, i18n = createI18n('en')) {
  const wrap = createElement('section', { className: 'popup-provider' });
  const heading = createElement('div', { className: 'popup-provider__head' });
  appendChildren(heading, [
    createElement('span', { className: 'aut-widget__brand-dot' }),
    i18n.t(`provider.${provider}`),
  ]);
  const errorBox = createElement('div', { className: 'popup-error' });
  const waiting = error === 'shell-response';
  const openButton = ['claude', 'codex'].includes(provider)
    ? createElement('button', {
      className: 'aut-link-btn',
      text: i18n.t(provider === 'claude' ? 'empty.openClaude' : 'empty.openCodex'),
      attrs: { type: 'button', 'data-provider': provider },
    })
    : null;
  appendChildren(errorBox, [
    createElement('div', {
      className: 'popup-error__title',
      text: waiting ? i18n.t('empty.title') : i18n.t('error.provider', { provider: i18n.t(`provider.${provider}`) }),
    }),
    createElement('div', {
      text: waiting
        ? i18n.t('empty.body')
        : (error || 'Unknown error'),
    }),
    openButton ? createElement('div', { className: 'popup-error__actions', children: [openButton] }) : null,
  ]);
  appendChildren(wrap, [heading, errorBox]);
  if (openButton) openButton.addEventListener('click', () => openAnalytics(provider));
  return wrap;
}

function humanBucketLabel(b) {
  if (b.kind === 'api') return b.label || 'API usage';
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
  if (source === 'api-key') return 'API key';
  return String(source).slice(0, 12);
}

function providerKeys(snapshot) {
  const present = Object.keys(snapshot?.providers || {});
  return [...new Set(['claude', 'codex', ...API_PROVIDER_IDS, ...present])];
}

function renderMetric(metric, i18n) {
  const wrap = createElement('div', { className: `popup-bucket__metric popup-bucket__metric--${metric.kind || 'unknown'}` });
  appendChildren(wrap, [
    createElement('strong', { text: formatMetricValue(metric, i18n) }),
    createElement('span', { text: formatMetricDetail(metric, i18n) }),
  ]);
  return wrap;
}

function formatMetricValue(metric, i18n) {
  const locale = i18n.locale === 'en' ? 'en-US' : i18n.locale;
  if (metric.kind === 'currency') {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 4 })
      .format(Number(metric.costUSD) || 0);
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Number(metric.totalTokens) || 0)} tokens`;
}

function formatMetricDetail(metric, i18n) {
  const locale = i18n.locale === 'en' ? 'en-US' : i18n.locale;
  const number = (value) => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Number(value) || 0);
  const parts = [];
  if (metric.inputTokens != null) parts.push(`${number(metric.inputTokens)} in`);
  if (metric.outputTokens != null) parts.push(`${number(metric.outputTokens)} out`);
  if (metric.cachedInputTokens != null) parts.push(`${number(metric.cachedInputTokens)} cached`);
  if (metric.requests != null) parts.push(`${number(metric.requests)} requests`);
  if (metric.costUSD != null && metric.kind !== 'currency') {
    parts.push(new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 4 })
      .format(Number(metric.costUSD) || 0));
  }
  if (metric.webSearchRequests != null && Number(metric.webSearchRequests) > 0) {
    parts.push(`${number(metric.webSearchRequests)} web searches`);
  }
  return parts.join(' · ') || 'Month to date';
}

function applyTheme(settings = {}) {
  const requested = settings.theme || 'mocha';
  const systemLight = typeof matchMedia === 'function'
    && matchMedia('(prefers-color-scheme: light)').matches;
  document.body.dataset.autTheme = requested === 'system'
    ? (systemLight ? 'latte' : 'mocha')
    : (requested === 'latte' || requested === 'mocha-light' ? 'latte' : 'mocha');
  document.body.dataset.autContrast = settings.highContrast === true ? 'high' : 'normal';
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
