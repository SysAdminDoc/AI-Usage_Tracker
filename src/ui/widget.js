// Floating widget renderer. Pure DOM, no framework. Reads snapshot+settings
// from storage, renders SVG radial rings, ticks countdowns every 1s.

import { getActiveProfile, isIncognitoContext, loadState, saveState } from '../lib/storage.js';
import { formatCountdown, ringColor, normalizeThresholds } from '../lib/countdown.js';
import { send } from '../lib/browser.js';
import {
  appendChildren,
  clearChildren,
  createElement,
  createSvgElement,
  setSafeAttribute,
  setStaticMarkup,
} from '../lib/dom.js';

function openAnalytics(which) {
  if (hasExtensionRuntime()) {
    send({ type: 'aut/open-analytics', provider: which }).catch(() => openAnalyticsFallback(which));
    return;
  }
  openAnalyticsFallback(which);
}

const RING_R = 18;
const RING_C = 2 * Math.PI * RING_R;
const VERSION = '0.2.2';

let rootEl = null;
let tickHandle = null;
let dragState = null;
let refreshBusy = false;
let contextMenuEl = null;
let hiddenForSession = false;
let widgetCallbacks = {};

export async function mountWidget({ onRefresh, onOpenSettings } = {}) {
  if (rootEl) return rootEl;
  widgetCallbacks = { onRefresh, onOpenSettings };

  // Detached shadow DOM container so host page CSS can't reach us.
  const host = document.createElement('div');
  host.id = 'aut-host';
  host.style.cssText = 'all: initial;';
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  const themeCSS = await fetchInlineCSS('ui/theme.css');
  const widgetCSS = await fetchInlineCSS('ui/widget.css');
  const style = document.createElement('style');
  style.textContent = themeCSS + '\n' + widgetCSS;
  shadow.appendChild(style);

  const root = document.createElement('div');
  root.className = 'aut-root';
  root.dataset.autTheme = 'mocha';
  shadow.appendChild(root);

  rootEl = root;
  await render({ onRefresh, onOpenSettings });
  startTicker();
  return rootEl;
}

export async function refreshWidget({ onRefresh, onOpenSettings } = {}) {
  if (!rootEl) return;
  const active = rootEl.getRootNode?.().activeElement;
  const focusAction = active?.dataset?.act || '';
  widgetCallbacks = {
    onRefresh: onRefresh || widgetCallbacks.onRefresh,
    onOpenSettings: onOpenSettings || widgetCallbacks.onOpenSettings,
  };
  await render(widgetCallbacks);
  if (focusAction) rootEl.querySelector(`[data-act="${focusAction}"]`)?.focus();
}

async function fetchInlineCSS(relPath) {
  // In extensions we resolve via runtime.getURL; in userscripts we inline at build.
  // Build step replaces these placeholders.
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
    const url = chrome.runtime.getURL(relPath);
    const res = await fetch(url);
    return await res.text();
  }
  if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.getURL) {
    const url = browser.runtime.getURL(relPath);
    const res = await fetch(url);
    return await res.text();
  }
  // Userscript path: replaced by build with literal CSS strings.
  if (relPath.endsWith('theme.css'))  return globalThis.__AUT_THEME_CSS__  || '';
  if (relPath.endsWith('widget.css')) return globalThis.__AUT_WIDGET_CSS__ || '';
  return '';
}

async function render({ onRefresh, onOpenSettings }) {
  if (hiddenForSession) {
    if (rootEl) rootEl.style.display = 'none';
    return;
  }
  if (rootEl) rootEl.style.display = '';

  const state = await loadState();
  const activeProfile = await getActiveProfile();
  const incognito = isIncognitoContext();
  const { snapshot, settings, widget } = state;
  applyTheme(rootEl, settings);
  const thresholds = normalizeThresholds(settings.thresholds);

  const wrap = document.createElement('div');
  wrap.className = 'aut-widget aut-glass aut-shimmer';
  if (widget.minimized) wrap.classList.add('aut-widget--mini');

  // Position
  if (widget.x != null && widget.y != null) {
    wrap.style.left = `${widget.x}px`;
    wrap.style.top  = `${widget.y}px`;
    wrap.style.right = 'auto';
    wrap.style.bottom = 'auto';
  }

  if (widget.minimized) {
    wrap.title = `AI Usage Tracker${incognito ? ' - Incognito' : ''} - click to expand`;
    wrap.setAttribute('aria-label', wrap.title);
    wrap.addEventListener('click', async () => {
      const s = await loadState();
      s.widget.minimized = false;
      await saveState(s);
      await render({ onRefresh, onOpenSettings });
    });
    enableDrag(wrap);
    enableContextMenu(wrap, { onRefresh, onOpenSettings });
    swapRoot(wrap);
    return;
  }

  wrap.appendChild(renderHeader({
    onRefresh,
    onOpenSettings,
    profileName: activeProfile?.name,
    incognito,
  }));

  const body = document.createElement('div');
  body.className = 'aut-widget__body';

  let drewSomething = false;
  for (const provider of ['claude', 'codex']) {
    if (!settings.showProviders[provider]) continue;
    const ps = snapshot && snapshot.providers ? snapshot.providers[provider] : null;
    const context = provider === 'claude' ? state.context?.claude : null;
    const cache = provider === 'claude' ? state.cache?.claude : null;
    if (!ps && (context || cache)) {
      body.appendChild(renderProvider(provider, { ok: true, buckets: [], source: null }, [], { context, cache, thresholds }));
      drewSomething = true;
      continue;
    }
    if (!ps) continue;
    if (!ps.ok) {
      body.appendChild(renderProviderError(provider, ps.error));
      drewSomething = true;
      continue;
    }
    const visibleBuckets = ps.buckets.filter((b) => settings.showRows[b.id] !== false);
    if (visibleBuckets.length === 0 && !context && !cache) continue;
    body.appendChild(renderProvider(provider, ps, visibleBuckets, { context, cache, thresholds }));
    drewSomething = true;
  }

  if (!drewSomething) {
    const empty = createElement('div', { className: 'aut-widget__empty' });
    const claudeButton = createElement('button', {
      className: 'aut-link-btn',
      text: 'Open Claude',
      attrs: { type: 'button', 'data-act': 'open-claude' },
    });
    const codexButton = createElement('button', {
      className: 'aut-link-btn',
      text: 'Open Codex',
      attrs: { type: 'button', 'data-act': 'open-codex' },
    });
    appendChildren(empty, [
      createElement('div', { className: 'aut-widget__empty-title', text: 'No usage data yet' }),
      createElement('div', { text: 'Open a signed-in usage page once to seed the local tracker.' }),
      createElement('div', { className: 'aut-widget__empty-actions', children: [claudeButton, codexButton] }),
    ]);
    claudeButton.addEventListener('click', () => openAnalytics('claude'));
    codexButton.addEventListener('click', () => openAnalytics('codex'));
    body.appendChild(empty);
  }

  wrap.appendChild(body);

  if (snapshot && snapshot.fetchedAtISO) {
    const foot = createElement('div', { className: 'aut-widget__footer' });
    const ago = formatAgo(snapshot.fetchedAtISO);
    appendChildren(foot, [
      createElement('span', { text: `Updated ${ago}` }),
      createElement('span', { text: `v${VERSION}` }),
    ]);
    wrap.appendChild(foot);
  }

  enableDrag(wrap);
  enableContextMenu(wrap, { onRefresh, onOpenSettings });
  swapRoot(wrap);
}

function swapRoot(newWrap) {
  // Replace the single child inside .aut-root so we don't accumulate.
  const root = rootEl;
  clearChildren(root);
  root.appendChild(newWrap);
}

function renderHeader({ onRefresh, onOpenSettings, profileName = 'Default', incognito = false }) {
  const header = document.createElement('div');
  header.className = 'aut-widget__header';
  setStaticMarkup(header, `
    <span class="aut-widget__brand-dot"></span>
    <span class="aut-widget__brand">AI Usage</span>
    <div class="aut-widget__actions">
      <button class="aut-iconbtn" data-act="refresh" title="Refresh now" aria-label="Refresh">
        <svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 4 21 9 16 9"/></svg>
      </button>
      <button class="aut-iconbtn" data-act="settings" title="Settings" aria-label="Settings">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>
      <button class="aut-iconbtn" data-act="minimize" title="Minimize" aria-label="Minimize">
        <svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>
      </button>
    </div>
  `);
  const visibleProfile = incognito ? `Incognito · ${profileName || 'Default'}` : (profileName || 'Default');
  const profile = createElement('span', {
    className: `aut-widget__profile${incognito ? ' aut-widget__profile--incognito' : ''}`,
    text: visibleProfile,
  });
  setSafeAttribute(profile, 'title', `Active local profile: ${profileName || 'Default'}${incognito ? ' (Incognito)' : ''}`);
  header.insertBefore(profile, header.querySelector('.aut-widget__actions'));
  header.querySelector('[data-act="refresh"]').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!onRefresh || refreshBusy) return;
    const button = e.currentTarget;
    refreshBusy = true;
    button.classList.add('is-loading');
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    try {
      await onRefresh();
    } finally {
      refreshBusy = false;
      button.classList.remove('is-loading');
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  });
  header.querySelector('[data-act="settings"]').addEventListener('click', (e) => {
    e.stopPropagation();
    if (onOpenSettings) onOpenSettings();
  });
  header.querySelector('[data-act="minimize"]').addEventListener('click', async (e) => {
    e.stopPropagation();
    const s = await loadState();
    s.widget.minimized = true;
    await saveState(s);
    await render({ onRefresh, onOpenSettings });
  });
  return header;
}

export function renderProvider(providerKey, ps, buckets, extras = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'aut-provider';

  const title = document.createElement('div');
  title.className = 'aut-provider__title';
  title.textContent = providerKey === 'claude' ? 'Claude' : 'Codex';
  const meta = document.createElement('span');
  meta.className = 'aut-provider__meta';
  if (ps.plan) {
    const plan = document.createElement('span');
    plan.className = 'aut-provider__plan';
    plan.textContent = ps.plan;
    meta.appendChild(plan);
  }
  if (ps.source) {
    const source = document.createElement('span');
    source.className = 'aut-provider__source';
    source.textContent = sourceLabel(ps.lastSuccessSource || ps.source);
    meta.appendChild(source);
  }
  if (ps.stale) {
    const staleLabel = document.createElement('span');
    staleLabel.className = 'aut-provider__stale';
    staleLabel.textContent = 'Stale';
    staleLabel.title = ps.lastErrorDetail || 'Data preserved from a previous successful fetch';
    meta.appendChild(staleLabel);
  }
  if (meta.childNodes.length) title.appendChild(meta);
  wrap.appendChild(title);

  for (const b of buckets) {
    wrap.appendChild(renderBucket(b, extras.thresholds));
  }
  if (providerKey === 'claude' && extras.context) {
    wrap.appendChild(renderContextCounter(extras.context));
  }
  if (providerKey === 'claude' && extras.cache) {
    wrap.appendChild(renderCacheTimer(extras.cache));
  }
  return wrap;
}

function renderCacheTimer(cache) {
  const row = createElement('div', { className: 'aut-cache' });
  const cachedUntil = cache.cachedUntilISO || null;
  const remainingMs = cachedUntil ? Math.max(0, new Date(cachedUntil).getTime() - Date.now()) : 0;
  const windowMs = Math.max(1, Number(cache.windowMs) || 5 * 60 * 1000);
  const percent = Math.max(0, Math.min(100, (remainingMs / windowMs) * 100));
  const countdown = createElement('span', {
    className: 'aut-cache-countdown',
    text: cachedUntil ? formatCountdown(cachedUntil) : 'unknown',
    attrs: { 'data-target': cachedUntil || '', 'data-window-ms': windowMs },
  });
  const barFill = createElement('span');
  barFill.style.width = `${percent}%`;
  appendChildren(row, [
    createElement('div', {
      className: 'aut-cache__head',
      children: [createElement('span', { text: 'Cache timer' }), countdown],
    }),
    createElement('div', {
      className: 'aut-cache__bar',
      attrs: { 'aria-hidden': 'true' },
      children: [barFill],
    }),
    createElement('div', { className: 'aut-cache__meta', text: 'Continue before expiry for the cheapest follow-up window.' }),
  ]);
  return row;
}

function renderContextCounter(context) {
  const row = createElement('div', { className: 'aut-context' });
  const percent = Math.max(0, Math.min(100, context.percentUsed || 0));
  const tokenEstimate = Math.max(0, Math.round(context.tokenEstimate || 0));
  const maxTokens = Math.max(1, Math.round(context.maxTokens || 200_000));
  const draft = Math.max(0, Math.round(context.draftTokens || 0));
  const messageText = context.messageCount > 0
    ? `${context.messageCount} sampled turns`
    : 'No sampled turns yet';
  const draftText = draft > 0 ? ` + ${formatTokenCount(draft)} draft` : '';

  const contextFill = createElement('span');
  contextFill.style.width = `${percent}%`;
  appendChildren(row, [
    createElement('div', {
      className: 'aut-context__head',
      children: [
        createElement('span', { text: 'Context window' }),
        createElement('span', { text: `${percent.toFixed(percent < 10 ? 1 : 0)}%` }),
      ],
    }),
    createElement('div', {
      className: 'aut-context__bar',
      attrs: {
        role: 'meter',
        'aria-valuemin': 0,
        'aria-valuemax': maxTokens,
        'aria-valuenow': tokenEstimate,
        'aria-label': 'Claude context window usage',
      },
      children: [contextFill],
    }),
    createElement('div', {
      className: 'aut-context__meta',
      children: [
        createElement('span', { text: `~${formatTokenCount(tokenEstimate)} / ${formatTokenCount(maxTokens)} tokens` }),
        createElement('span', { text: `${messageText}${draftText}` }),
      ],
    }),
  ]);
  return row;
}

export function renderBucket(b, thresholds) {
  const row = createElement('div', {
    className: `aut-bucket aut-bucket--${severityFor(b.percentUsed, thresholds)}`,
    attrs: { role: 'group' },
  });

  const ring = createElement('div', { className: 'aut-ring' });
  const percent = Math.max(0, Math.min(100, b.percentUsed || 0));
  const remaining = 100 - percent;
  const offset = RING_C * (1 - remaining / 100);
  const svg = createSvgElement('svg', { attrs: { viewBox: '0 0 44 44' } });
  appendChildren(svg, [
    createSvgElement('circle', {
      attrs: { class: 'aut-ring__track', cx: 22, cy: 22, r: RING_R, fill: 'none', 'stroke-width': 4 },
    }),
    createSvgElement('circle', {
      attrs: {
        class: 'aut-ring__fill',
        cx: 22,
        cy: 22,
        r: RING_R,
        fill: 'none',
        'stroke-width': 4,
        'stroke-dasharray': RING_C,
        'stroke-dashoffset': offset,
        style: `stroke: ${ringColor(percent, thresholds)};`,
      },
    }),
  ]);
  appendChildren(ring, [
    svg,
    createElement('div', { className: 'aut-ring__label', text: `${Math.round(remaining)}%` }),
  ]);
  row.appendChild(ring);

  const text = createElement('div', { className: 'aut-bucket__text' });
  const reset = b.resetISO
    ? createElement('div', {
      className: 'aut-bucket__reset',
      children: [
        createElement('span', { text: 'resets in' }),
        createElement('span', {
          className: 'aut-countdown',
          text: formatCountdown(b.resetISO),
          attrs: {
            role: 'timer',
            'aria-live': 'polite',
            'aria-atomic': 'true',
            'data-target': b.resetISO,
          },
        }),
      ],
    })
    : createElement('div', {
      className: 'aut-bucket__reset aut-bucket__reset--missing',
      text: b.rawResetText || 'Reset not published',
    });
  appendChildren(text, [
    createElement('div', { className: 'aut-bucket__label', text: humanBucketLabel(b) }),
    reset,
  ]);
  row.appendChild(text);
  setSafeAttribute(row, 'aria-label', `${humanBucketLabel(b)}: ${Math.round(percent)} percent used`);
  return row;
}

export function renderProviderError(provider, error) {
  const wrap = createElement('div', { className: 'aut-provider' });
  const title = createElement('div', {
    className: 'aut-provider__title',
    text: provider === 'claude' ? 'Claude' : 'Codex',
  });
  const err = createElement('div', { className: 'aut-widget__error' });
  const waiting = error === 'shell-response' || error === 'unhydrated' || error === 'no-rows-rendered';
  const openButton = createElement('button', {
    className: 'aut-link-btn',
    text: 'Open usage page',
    attrs: { type: 'button', 'data-act': `open-${provider}` },
  });
  appendChildren(err, [
    createElement('div', {
      className: 'aut-widget__error-title',
      text: waiting ? 'Waiting for a signed-in reading' : `Unable to refresh ${provider === 'claude' ? 'Claude' : 'Codex'}`,
    }),
    createElement('span', {
      text: waiting ? 'Open the usage page once so the local scraper can recover. ' : `${error || 'Unknown error'}. `,
    }),
    openButton,
  ]);
  appendChildren(wrap, [title, err]);
  openButton.addEventListener('click', () => openAnalytics(provider));
  return wrap;
}

function humanBucketLabel(b) {
  if (b.kind === 'session') return 'Session (5 hr)';
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

function formatTokenCount(value) {
  const n = Math.max(0, Math.round(Number(value) || 0));
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 10_000) return `${Math.round(n / 1_000)}k`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
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

function formatAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function hasExtensionRuntime() {
  return !!((typeof chrome !== 'undefined' && chrome.runtime?.id)
    || (typeof browser !== 'undefined' && browser.runtime?.id));
}

function openAnalyticsFallback(which) {
  const urls = [];
  if (which === 'both' || which === 'claude') urls.push('https://claude.ai/settings/usage');
  if (which === 'both' || which === 'codex') urls.push('https://chatgpt.com/codex/cloud/settings/analytics#usage');
  for (const url of urls) window.open(url, '_blank', 'noopener,noreferrer');
}

function applyTheme(root, settings = {}) {
  if (!root) return;
  const requested = settings.theme || 'mocha';
  const systemLight = typeof matchMedia === 'function'
    && matchMedia('(prefers-color-scheme: light)').matches;
  const resolved = requested === 'system'
    ? (systemLight ? 'latte' : 'mocha')
    : (requested === 'latte' || requested === 'mocha-light' ? 'latte' : 'mocha');
  root.dataset.autTheme = resolved;
  root.dataset.autContrast = settings.highContrast === true ? 'high' : 'normal';
}

function severityFor(percentUsed, thresholds) {
  const t = normalizeThresholds(thresholds);
  const percent = Number(percentUsed) || 0;
  if (percent >= t.dangerAt) return 'danger';
  if (percent >= t.warnAt) return 'warn';
  return 'good';
}

function startTicker() {
  if (tickHandle) clearInterval(tickHandle);
  tickHandle = setInterval(() => {
    if (!rootEl) return;
    const els = rootEl.querySelectorAll('.aut-countdown');
    for (const el of els) {
      const target = el.getAttribute('data-target');
      if (!target) continue;
      el.textContent = formatCountdown(target);
    }
    const cacheEls = rootEl.querySelectorAll('.aut-cache-countdown');
    for (const el of cacheEls) {
      const target = el.getAttribute('data-target');
      if (!target) continue;
      el.textContent = formatCountdown(target);
      const windowMs = Math.max(1, Number(el.getAttribute('data-window-ms')) || 5 * 60 * 1000);
      const remainingMs = Math.max(0, new Date(target).getTime() - Date.now());
      const pct = Math.max(0, Math.min(100, (remainingMs / windowMs) * 100));
      const bar = el.closest('.aut-cache')?.querySelector('.aut-cache__bar span');
      if (bar) bar.style.width = `${pct}%`;
    }
  }, 1000);
}

function enableDrag(wrap) {
  const onPointerDown = (e) => {
    if (e.target.closest('.aut-iconbtn')) return;
    const rect = wrap.getBoundingClientRect();
    dragState = {
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      el: wrap,
    };
    wrap.classList.add('aut-widget--dragging');
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup',   onPointerUp, { once: true });
  };
  const onPointerMove = (e) => {
    if (!dragState) return;
    const x = Math.max(8, Math.min(window.innerWidth  - dragState.el.offsetWidth  - 8, e.clientX - dragState.offsetX));
    const y = Math.max(8, Math.min(window.innerHeight - dragState.el.offsetHeight - 8, e.clientY - dragState.offsetY));
    dragState.el.style.left = `${x}px`;
    dragState.el.style.top  = `${y}px`;
    dragState.el.style.right = 'auto';
    dragState.el.style.bottom = 'auto';
  };
  const onPointerUp = async () => {
    if (!dragState) return;
    const rect = dragState.el.getBoundingClientRect();
    dragState.el.classList.remove('aut-widget--dragging');
    document.removeEventListener('pointermove', onPointerMove);
    const s = await loadState();
    s.widget.x = rect.left;
    s.widget.y = rect.top;
    await saveState(s);
    dragState = null;
  };
  wrap.querySelector('.aut-widget__header')?.addEventListener('pointerdown', onPointerDown);
  if (wrap.classList.contains('aut-widget--mini')) {
    wrap.addEventListener('pointerdown', onPointerDown);
  }
}

function enableContextMenu(wrap, { onRefresh, onOpenSettings }) {
  wrap.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    showContextMenu(event, { onRefresh, onOpenSettings });
  });
}

async function showContextMenu(event, { onRefresh, onOpenSettings }) {
  closeContextMenu();
  const state = await loadState();
  const snoozedUntil = state.settings?.notifications?.snoozedUntilISO || '';
  const snoozedActive = isFutureISO(snoozedUntil);
  const menu = createElement('div', {
    className: 'aut-menu',
    attrs: { role: 'menu', 'aria-label': 'AI Usage widget actions' },
  });
  const menuButton = (act, text) => createElement('button', {
    text,
    attrs: { type: 'button', role: 'menuitem', 'data-act': act },
  });
  appendChildren(menu, [
    createElement('div', { className: 'aut-menu__label', text: 'Widget actions' }),
    menuButton(snoozedActive ? 'unsnooze' : 'snooze', snoozedActive ? 'Resume notifications' : 'Snooze notifications 1 hr'),
    menuButton('hide', 'Hide for session'),
    menuButton('refresh', 'Refresh now'),
    createElement('div', { className: 'aut-menu__rule' }),
    menuButton('analytics', 'Open analytics'),
    menuButton('settings', 'Open settings'),
  ]);
  rootEl.appendChild(menu);
  contextMenuEl = menu;

  const { left, top } = clampMenuPosition(event.clientX, event.clientY, menu);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.querySelector('button')?.focus();

  menu.addEventListener('click', async (clickEvent) => {
    const button = clickEvent.target.closest('button[data-act]');
    if (!button) return;
    clickEvent.stopPropagation();
    const feedback = await runMenuAction(button.dataset.act, { onRefresh, onOpenSettings });
    closeContextMenu();
    if (feedback) showToast(feedback.text, feedback.tone);
  });

  setTimeout(() => {
    document.addEventListener('pointerdown', closeContextMenuOnOutsidePointer, { once: true });
    document.addEventListener('keydown', closeContextMenuOnEscape, { once: true });
  }, 0);
}

function clampMenuPosition(x, y, menu) {
  const rect = menu.getBoundingClientRect();
  return {
    left: Math.max(8, Math.min(window.innerWidth - rect.width - 8, x)),
    top: Math.max(8, Math.min(window.innerHeight - rect.height - 8, y)),
  };
}

async function runMenuAction(action, { onRefresh, onOpenSettings }) {
  if (action === 'snooze') {
    const state = await loadState();
    state.settings = state.settings || {};
    state.settings.notifications = state.settings.notifications || {};
    state.settings.notifications.snoozedUntilISO = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await saveState(state);
    return { text: 'Notifications snoozed for 1 hour', tone: 'good' };
  }
  if (action === 'unsnooze') {
    const state = await loadState();
    state.settings = state.settings || {};
    state.settings.notifications = state.settings.notifications || {};
    delete state.settings.notifications.snoozedUntilISO;
    await saveState(state);
    return { text: 'Notifications resumed', tone: 'good' };
  }
  if (action === 'hide') {
    hiddenForSession = true;
    if (rootEl) rootEl.style.display = 'none';
    return;
  }
  if (action === 'refresh' && onRefresh) {
    await onRefresh();
    return { text: 'Usage refresh requested', tone: 'info' };
  }
  if (action === 'analytics') {
    openAnalytics('both');
    return { text: 'Opening usage pages', tone: 'info' };
  }
  if (action === 'settings' && onOpenSettings) {
    onOpenSettings();
    return { text: 'Opening settings', tone: 'info' };
  }
  return null;
}

function closeContextMenu() {
  if (contextMenuEl) {
    contextMenuEl.remove();
    contextMenuEl = null;
  }
}

function closeContextMenuOnOutsidePointer(event) {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  if (contextMenuEl && path.includes(contextMenuEl)) {
    document.addEventListener('pointerdown', closeContextMenuOnOutsidePointer, { once: true });
    return;
  }
  closeContextMenu();
}

function closeContextMenuOnEscape(event) {
  if (event.key === 'Escape') closeContextMenu();
  else document.addEventListener('keydown', closeContextMenuOnEscape, { once: true });
}

function isFutureISO(iso) {
  if (!iso) return false;
  const ts = new Date(iso).getTime();
  return Number.isFinite(ts) && ts > Date.now();
}

function showToast(text, tone = 'info') {
  if (!rootEl || !text) return;
  const previous = rootEl.querySelector('.aut-toast');
  if (previous) previous.remove();
  const toast = document.createElement('div');
  toast.className = `aut-toast aut-toast--${tone}`;
  toast.setAttribute('role', 'status');
  toast.textContent = text;
  rootEl.appendChild(toast);
  setTimeout(() => toast.classList.add('is-visible'), 20);
  setTimeout(() => {
    toast.classList.remove('is-visible');
    setTimeout(() => toast.remove(), 180);
  }, 1800);
}
