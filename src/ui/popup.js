import { getActiveProfile, isIncognitoContext, loadState } from '../lib/storage.js';
import { formatCountdown, formatResetAbsolute, ringColor, normalizeThresholds } from '../lib/countdown.js';
import { paceMarkerPoint, paceProjection, sparklineSamplesFor } from '../lib/history.js';
import { CACHE_REUSE_DAY_MS, CACHE_REUSE_WEEK_MS, cacheReuseStats } from '../lib/cache-timer.js';
import {
  appendChildren,
  clearChildren,
  createElement,
  createSvgElement,
  setSafeAttribute,
} from '../lib/dom.js';
import { applyDocumentLocale, createI18n } from '../lib/i18n.js';
import { API_PROVIDER_IDS } from '../providers/api-contract.js';
import { forecastMonthEnd } from '../lib/forecast.js';
import { buildPlanRecommendations } from '../lib/optimization.js';

const RING_R = 22;
const RING_C = 2 * Math.PI * RING_R;
const VERSION = '0.2.3';

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
  const i18n = createI18n(state.settings.locale);
  applyDocumentLocale(i18n);
  const profileName = document.getElementById('profileName');
  const incognito = isIncognitoContext();
  if (profileName) {
    const name = activeProfile?.name || i18n.t('app.defaultProfile');
    profileName.textContent = incognito ? i18n.t('app.incognitoProfile', { name }) : name;
    profileName.title = i18n.t('widget.profileTitle', {
      name,
      incognito: incognito ? ` (${i18n.t('app.incognito')})` : '',
    });
    profileName.classList.toggle('popup-profile--incognito', incognito);
  }
  const { snapshot, settings, history, cache } = state;
  applyTheme(settings);
  const thresholds = normalizeThresholds(settings.thresholds);

  clearChildren(dashboard);
  const overview = buildOverview(snapshot, settings, thresholds, i18n);
  if (overview) dashboard.appendChild(renderOverview(overview, i18n));
  const forecast = forecastMonthEnd(snapshot);
  if (forecast.providers.length) dashboard.appendChild(renderForecast(forecast, i18n));
  const optimization = buildPlanRecommendations(snapshot, forecast);
  if (optimization.recommendations.length) dashboard.appendChild(renderOptimization(optimization, i18n));
  const cacheAnalytics = buildCacheAnalytics(cache, new Date());
  if (cacheAnalytics.week.eventCount) dashboard.appendChild(renderCacheReuse(cacheAnalytics, i18n));

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
    attrs: { 'aria-label': i18n.t('overview.aria') },
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

function buildCacheAnalytics(cache, now) {
  const events = cache?.claude?.reuseEvents || [];
  return {
    day: cacheReuseStats(events, { now, windowMs: CACHE_REUSE_DAY_MS }),
    week: cacheReuseStats(events, { now, windowMs: CACHE_REUSE_WEEK_MS }),
  };
}

function renderCacheReuse(analytics, i18n = createI18n('en')) {
  const wrap = createElement('section', {
    className: 'popup-cache-reuse',
    attrs: { 'aria-label': i18n.t('cache.aria') },
  });
  const windows = createElement('div', { className: 'popup-cache-reuse__windows' });
  for (const [label, stats] of [[i18n.tp('plural.hour', 24), analytics.day], [i18n.tp('plural.day', 7), analytics.week]]) {
    const card = createElement('div', { className: 'popup-cache-reuse__window' });
    const percent = stats.reusePercent == null ? i18n.t('app.noData') : i18n.t('cache.inferredReuse', { percent: i18n.formatPercent(stats.reusePercent) });
    card.append(
      createElement('strong', { text: percent }),
      createElement('span', { text: label }),
      createElement('small', { text: stats.eventCount ? i18n.t('cache.reuseMeta', { used: stats.reuseCount, total: stats.eventCount }) : i18n.t('app.noData') }),
    );
    windows.appendChild(card);
  }
  wrap.append(
    createElement('div', { className: 'popup-cache-reuse__head', text: i18n.t('cache.aria') }),
    windows,
    createElement('p', {
      className: 'popup-cache-reuse__note',
      text: i18n.t('cache.reuseNote'),
    }),
  );
  return wrap;
}

function renderForecast(forecast, i18n) {
  const tone = !forecast.total.confidence || forecast.total.confidence === 'low' ? 'warn' : 'good';
  const wrap = createElement('section', {
    className: `popup-forecast popup-forecast--${tone}`,
    attrs: { 'aria-label': i18n.t('forecast.title') },
  });
  const head = createElement('div', { className: 'popup-forecast__head' });
  const copy = createElement('div', { className: 'popup-forecast__copy' });
  const projectedText = forecast.total.projectedUSD == null
    ? i18n.t('forecast.insufficient')
    : i18n.t('forecast.projected', {
      amount: formatForecastUSD(forecast.total.projectedUSD, i18n),
      date: formatForecastDate(forecast.monthEndISO, i18n),
    });
  copy.append(
    createElement('span', { className: 'popup-forecast__label', text: i18n.t('forecast.title') }),
    createElement('strong', { text: projectedText }),
    createElement('span', {
      text: i18n.t('forecast.observed', {
        amount: formatForecastUSD(forecast.total.observedUSD, i18n),
        providers: forecast.total.providerCount,
      }),
    }),
  );
  const confidence = createElement('span', {
    className: `aut-status-label aut-status-label--${tone}`,
    text: i18n.t('forecast.confidence', { label: forecast.total.confidenceLabel }),
  });
  head.append(copy, confidence);
  wrap.appendChild(head);

  for (const entry of forecast.providers) {
    const row = createElement('div', { className: 'popup-forecast__provider' });
    const provider = createElement('strong', { text: i18n.t(`provider.${entry.provider}`) });
    const value = createElement('span', {
      className: 'popup-forecast__value',
      text: entry.projectedUSD == null
        ? i18n.t('forecast.insufficient')
        : formatForecastUSD(entry.projectedUSD, i18n),
    });
    const meta = createElement('span', {
      className: 'popup-forecast__meta',
      text: `${entry.sourceLabel} · ${i18n.t('forecast.confidence', { label: entry.confidenceLabel })}${entry.stale ? ` · ${i18n.t('status.staleShort').toLowerCase()}` : ''}`,
    });
    row.append(provider, value, meta);
    wrap.appendChild(row);
  }

  const assumptionText = forecast.assumptions.join(' ');
  wrap.appendChild(createElement('p', {
    className: 'popup-forecast__assumptions',
    text: i18n.t('forecast.assumptions', { text: assumptionText }),
  }));
  return wrap;
}

function renderOptimization(optimization, i18n = createI18n('en')) {
  const wrap = createElement('section', {
    className: 'popup-optimization',
    attrs: { 'aria-label': i18n.t('forecast.planGuidance') },
  });
  appendChildren(wrap, [
    createElement('div', { className: 'popup-optimization__label', text: i18n.t('forecast.planGuidance') }),
    createElement('p', {
      className: 'popup-optimization__hint',
      text: i18n.t('forecast.planHint'),
    }),
  ]);
  for (const recommendation of optimization.recommendations) {
    const row = createElement('div', { className: 'popup-optimization__row' });
    const head = createElement('div', { className: 'popup-optimization__head' });
    appendChildren(head, [
      createElement('strong', { text: recommendation.title }),
      createElement('span', { text: i18n.t('optimization.confidence', { label: recommendation.confidenceLabel }) }),
    ]);
    appendChildren(row, [
      head,
      createElement('p', { text: recommendation.detail }),
      createElement('p', { className: 'popup-optimization__uncertainty', text: recommendation.uncertainty }),
    ]);
    wrap.appendChild(row);
  }
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
    source.textContent = sourceLabel(ps.lastSuccessSource || ps.source, i18n);
    meta.appendChild(source);
  }
  if (ps.stale) {
    const staleLabel = document.createElement('span');
    staleLabel.className = 'aut-status-label aut-status-label--warn';
    staleLabel.textContent = ps.lastSuccessISO
      ? i18n.t('status.stale', { relative: i18n.formatRelative(ps.lastSuccessISO) })
      : i18n.t('status.staleShort');
    staleLabel.title = ps.lastErrorDetail
      ? `${i18n.t('status.lastRefreshFailed')}: ${ps.lastErrorDetail}`
      : i18n.t('status.staleData');
    if (ps.staleReason) staleLabel.title += ` (${ps.staleReason})`;
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
  const projection = b.metric ? null : paceProjection(history, b);
  if (b.metric) {
    row.appendChild(renderMetric(b.metric, i18n));
  } else {
    const ring = createElement('div', { className: 'popup-bucket__ring' });
    const svg = createSvgElement('svg', { attrs: { viewBox: '0 0 52 52', style: 'transform:rotate(-90deg);' } });
    const ringChildren = [
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
    ];
    if (projection) {
      const point = paceMarkerPoint(projection.markerPercent, { center: 26, radius: RING_R });
      ringChildren.push(createSvgElement('circle', {
        attrs: {
          class: 'popup-bucket__pace-marker',
          cx: point.x,
          cy: point.y,
          r: 3.2,
          'data-pace-marker': 'true',
          'aria-hidden': 'true',
        },
      }));
    }
    appendChildren(svg, ringChildren);
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
      createElement('span', { text: `${i18n.t('bucket.resetAt', { time: formatResetAbsolute(b.resetISO, i18n.locale) })} - ` }),
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
    sub.textContent = b.rawResetText || i18n.t('bucket.resetNotPublished');
  }
  appendChildren(main, [
    createElement('div', { className: 'popup-bucket__label', text: humanBucketLabel(b, i18n) }),
    sub,
  ]);
  row.appendChild(main);

  const spark = document.createElement('div');
  spark.className = 'popup-bucket__spark';
  buildSparkline(spark, history, b.id, i18n);
  row.appendChild(spark);
  const paceText = projection ? `. ${paceAriaLabel(projection, i18n)}` : '';
  setSafeAttribute(row, 'aria-label', i18n.t('bucket.aria', {
    label: humanBucketLabel(b, i18n),
    percent: Math.round(percent),
    pace: paceText,
  }));

  return row;
}

function paceAriaLabel(projection, i18n) {
  const exhaustion = i18n.formatDateTime(projection.exhaustionISO);
  if (projection.reachesLimitBeforeReset) {
    return i18n.t('pace.beforeReset', { time: exhaustion });
  }
  return i18n.t('pace.atReset', {
    percent: i18n.formatPercent(projection.markerPercent),
    time: exhaustion,
  });
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
    ? `${formatCountdown(best.bucket.resetISO)} ${i18n.t('bucket.untilReset')}`
    : i18n.t('bucket.resetTimeNotPublished');
  return {
    title: `${i18n.t(`provider.${best.provider}`)} ${humanBucketLabel(best.bucket, i18n)}`,
    detail: `${i18n.t('overview.remaining', { percent: i18n.formatPercent(100 - best.percent) })} - ${reset}`,
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
    tip.textContent = i18n.t('sparkline.tooltip', {
      percent: i18n.formatPercent(sample.percentUsed, 1),
      time: formatHistoryTime(sample.ts, i18n),
    });
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
  return i18n.t('sparkline.aria', {
    percent: i18n.formatPercent(latest.percentUsed, 1),
    time: formatHistoryTime(latest.ts, i18n),
  });
}

function formatHistoryTime(ts, i18n = createI18n('en')) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return i18n.t('app.timeUnavailable');
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
        : (error || i18n.t('error.unknown')),
    }),
    openButton ? createElement('div', { className: 'popup-error__actions', children: [openButton] }) : null,
  ]);
  appendChildren(wrap, [heading, errorBox]);
  if (openButton) openButton.addEventListener('click', () => openAnalytics(provider));
  return wrap;
}

function humanBucketLabel(b, i18n = createI18n('en')) {
  if (b.kind === 'api') return b.label || i18n.t('bucket.apiUsage');
  if (b.kind === 'session') return i18n.t('bucket.currentSession');
  if (b.kind === '5h')      return b.model === 'all' ? i18n.t('bucket.fiveHour') : i18n.t('bucket.modelFiveHour', { model: titleModel(b.model) });
  if (b.kind === 'weekly')  return b.model === 'all' ? i18n.t('bucket.weekly') : i18n.t('bucket.modelWeekly', { model: titleModel(b.model) });
  return b.label;
}

function titleModel(model) {
  return String(model || '')
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatAgo(iso, i18n = createI18n('en')) {
  const ms = Date.now() - new Date(iso).getTime();
  return Number.isFinite(ms) ? i18n.formatRelative(iso) : i18n.t('app.timeUnavailable');
}

function sourceLabel(source, i18n = createI18n('en')) {
  if (source === 'api') return i18n.t('source.api');
  if (source === 'dom') return i18n.t('source.dom');
  if (source === 'html') return i18n.t('source.html');
  if (source === 'live') return i18n.t('source.live');
  if (source === 'fetch') return i18n.t('source.fetch');
  if (source === 'stream') return i18n.t('source.stream');
  if (source === 'headers') return i18n.t('source.headers');
  if (source === 'api-key') return i18n.t('source.apiKey');
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
  if (metric.kind === 'activity') return metric.active ? i18n.t('metric.activity') : i18n.t('metric.noActivity');
  if (metric.kind === 'requests') {
    return i18n.t('metric.requests', { value: i18n.formatNumber(metric.requests) });
  }
  if (metric.kind === 'currency') {
    return i18n.formatCurrency(metric.costUSD, 'USD', 4);
  }
  return i18n.t('metric.tokens', { value: i18n.formatNumber(metric.totalTokens) });
}

function formatMetricDetail(metric, i18n) {
  const number = (value) => i18n.formatNumber(value);
  const parts = [];
  if (metric.kind === 'activity') {
    if (metric.lastActivityISO) parts.push(i18n.t('metric.lastActivity', { time: i18n.formatDateTime(metric.lastActivityISO) }));
    if (metric.lastActivityEditor) parts.push(metric.lastActivityEditor);
    return parts.join(' · ') || i18n.t('metric.noCopilotActivity');
  }
  if (metric.kind === 'requests') {
    if (metric.subscriptionIncludedReqs != null) parts.push(i18n.t('metric.included', { value: number(metric.subscriptionIncludedReqs) }));
    if (metric.usageBasedReqs != null) parts.push(i18n.t('metric.usageBased', { value: number(metric.usageBasedReqs) }));
    if (metric.apiKeyReqs != null) parts.push(i18n.t('metric.apiKey', { value: number(metric.apiKeyReqs) }));
    if (metric.activeDays != null) parts.push(i18n.t('metric.activeDays', { value: number(metric.activeDays) }));
    if (metric.lastActivityISO) parts.push(i18n.t('metric.lastActivity', { time: i18n.formatDateTime(metric.lastActivityISO) }));
    return parts.join(' · ') || i18n.t('metric.requests', { value: number(metric.requests) });
  }
  if (metric.kind === 'currency') {
    if (metric.limitUSD != null) parts.push(i18n.t('metric.limit', { value: i18n.formatCurrency(metric.limitUSD, 'USD', 4) }));
    if (metric.remainingUSD != null) parts.push(i18n.t('metric.remaining', { value: i18n.formatCurrency(metric.remainingUSD, 'USD', 4) }));
    if (metric.usageDailyUSD != null) parts.push(i18n.t('metric.today', { value: i18n.formatCurrency(metric.usageDailyUSD, 'USD', 4) }));
    if (metric.usageWeeklyUSD != null) parts.push(i18n.t('metric.week', { value: i18n.formatCurrency(metric.usageWeeklyUSD, 'USD', 4) }));
    if (metric.totalCreditsUSD != null) parts.push(i18n.t('metric.purchased', { value: i18n.formatCurrency(metric.totalCreditsUSD, 'USD', 4) }));
    if (metric.remainingCreditsUSD != null) parts.push(i18n.t('metric.remaining', { value: i18n.formatCurrency(metric.remainingCreditsUSD, 'USD', 4) }));
    if (metric.costSource === 'official') parts.push(i18n.t('metric.officialCost'));
    return parts.join(' · ') || i18n.t('metric.usageCredits');
  }
  if (metric.inputTokens != null) parts.push(i18n.t('metric.in', { value: number(metric.inputTokens) }));
  if (metric.outputTokens != null) parts.push(i18n.t('metric.out', { value: number(metric.outputTokens) }));
  if (metric.cachedInputTokens != null) parts.push(i18n.t('metric.cached', { value: number(metric.cachedInputTokens) }));
  if (metric.requests != null) parts.push(i18n.t('metric.requests', { value: number(metric.requests) }));
  if (metric.costUSD != null && metric.kind !== 'currency') {
    const label = metric.costSource === 'pricing-table' ? i18n.t('metric.costEstimated') : i18n.t('metric.costReported');
    parts.push(`${i18n.formatCurrency(metric.costUSD, 'USD', 4)} ${label}`);
  }
  if (metric.webSearchRequests != null && Number(metric.webSearchRequests) > 0) {
    parts.push(i18n.t('metric.webSearches', { value: number(metric.webSearchRequests) }));
  }
  return parts.join(' · ') || i18n.t('metric.monthToDate');
}

function formatForecastUSD(value, i18n) {
  return i18n.formatCurrency(value, 'USD', 2);
}

function formatForecastDate(iso, i18n) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return i18n.t('forecast.monthEnd');
  return i18n.formatDate(iso, { month: 'short', day: 'numeric' });
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
