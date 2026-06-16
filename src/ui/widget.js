// Floating widget renderer. Pure DOM, no framework. Reads snapshot+settings
// from storage, renders SVG radial rings, ticks countdowns every 1s.

import { loadState, saveState } from '../lib/storage.js';
import { formatCountdown, ringColor } from '../lib/countdown.js';
import { send } from '../lib/browser.js';

function openAnalytics(which) {
  send({ type: 'aut/open-analytics', provider: which });
}

const RING_R = 18;
const RING_C = 2 * Math.PI * RING_R;
const VERSION = '0.2.0';

let rootEl = null;
let tickHandle = null;
let dragState = null;
let refreshBusy = false;

export async function mountWidget({ onRefresh, onOpenSettings } = {}) {
  if (rootEl) return rootEl;

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
  shadow.appendChild(root);

  rootEl = root;
  await render({ onRefresh, onOpenSettings });
  startTicker();
  return rootEl;
}

export async function refreshWidget({ onRefresh, onOpenSettings } = {}) {
  if (!rootEl) return;
  await render({ onRefresh, onOpenSettings });
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
  const state = await loadState();
  const { snapshot, settings, widget } = state;

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
    wrap.title = 'AI Usage Tracker - click to expand';
    wrap.addEventListener('click', async () => {
      const s = await loadState();
      s.widget.minimized = false;
      await saveState(s);
      await render({ onRefresh, onOpenSettings });
    });
    swapRoot(wrap);
    return;
  }

  wrap.appendChild(renderHeader({ onRefresh, onOpenSettings }));

  const body = document.createElement('div');
  body.className = 'aut-widget__body';

  let drewSomething = false;
  for (const provider of ['claude', 'codex']) {
    if (!settings.showProviders[provider]) continue;
    const ps = snapshot && snapshot.providers ? snapshot.providers[provider] : null;
    const context = provider === 'claude' ? state.context?.claude : null;
    const cache = provider === 'claude' ? state.cache?.claude : null;
    if (!ps && (context || cache)) {
      body.appendChild(renderProvider(provider, { ok: true, buckets: [], source: null }, [], { context, cache }));
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
    body.appendChild(renderProvider(provider, ps, visibleBuckets, { context, cache }));
    drewSomething = true;
  }

  if (!drewSomething) {
    const empty = document.createElement('div');
    empty.className = 'aut-widget__empty';
    empty.innerHTML = `
      <div class="aut-widget__empty-title">No usage data yet</div>
      <div>Open a signed-in usage page once to seed the local tracker.</div>
      <div class="aut-widget__empty-actions">
        <button class="aut-link-btn" data-act="open-claude">Open Claude</button>
        <button class="aut-link-btn" data-act="open-codex">Open Codex</button>
      </div>
    `;
    empty.querySelector('[data-act="open-claude"]').addEventListener('click', () => openAnalytics('claude'));
    empty.querySelector('[data-act="open-codex"]').addEventListener('click', () => openAnalytics('codex'));
    body.appendChild(empty);
  }

  wrap.appendChild(body);

  if (snapshot && snapshot.fetchedAtISO) {
    const foot = document.createElement('div');
    foot.className = 'aut-widget__footer';
    const ago = formatAgo(snapshot.fetchedAtISO);
    foot.innerHTML = `<span>Updated ${ago}</span><span>v${VERSION}</span>`;
    wrap.appendChild(foot);
  }

  enableDrag(wrap);
  swapRoot(wrap);
}

function swapRoot(newWrap) {
  // Replace the single child inside .aut-root so we don't accumulate.
  const root = rootEl;
  while (root.firstChild) root.removeChild(root.firstChild);
  root.appendChild(newWrap);
}

function renderHeader({ onRefresh, onOpenSettings }) {
  const header = document.createElement('div');
  header.className = 'aut-widget__header';
  header.innerHTML = `
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
  `;
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

function renderProvider(providerKey, ps, buckets, extras = {}) {
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
    source.textContent = sourceLabel(ps.source);
    meta.appendChild(source);
  }
  if (meta.childNodes.length) title.appendChild(meta);
  wrap.appendChild(title);

  for (const b of buckets) {
    wrap.appendChild(renderBucket(b));
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
  const row = document.createElement('div');
  row.className = 'aut-cache';
  const cachedUntil = cache.cachedUntilISO || null;
  const remainingMs = cachedUntil ? Math.max(0, new Date(cachedUntil).getTime() - Date.now()) : 0;
  const windowMs = Math.max(1, Number(cache.windowMs) || 5 * 60 * 1000);
  const percent = Math.max(0, Math.min(100, (remainingMs / windowMs) * 100));

  row.innerHTML = `
    <div class="aut-cache__head">
      <span>Cache timer</span>
      <span class="aut-cache-countdown" data-target="${escapeHtml(cachedUntil || '')}" data-window-ms="${windowMs}">${cachedUntil ? formatCountdown(cachedUntil) : 'unknown'}</span>
    </div>
    <div class="aut-cache__bar" aria-hidden="true">
      <span style="width: ${percent}%;"></span>
    </div>
    <div class="aut-cache__meta">Continue before expiry for the cheapest follow-up window.</div>
  `;
  return row;
}

function renderContextCounter(context) {
  const row = document.createElement('div');
  row.className = 'aut-context';
  const percent = Math.max(0, Math.min(100, context.percentUsed || 0));
  const tokenEstimate = Math.max(0, Math.round(context.tokenEstimate || 0));
  const maxTokens = Math.max(1, Math.round(context.maxTokens || 200_000));
  const draft = Math.max(0, Math.round(context.draftTokens || 0));
  const messageText = context.messageCount > 0
    ? `${context.messageCount} sampled turns`
    : 'No sampled turns yet';
  const draftText = draft > 0 ? ` + ${formatTokenCount(draft)} draft` : '';

  row.innerHTML = `
    <div class="aut-context__head">
      <span>Context window</span>
      <span>${percent.toFixed(percent < 10 ? 1 : 0)}%</span>
    </div>
    <div class="aut-context__bar" role="meter" aria-valuemin="0" aria-valuemax="${maxTokens}" aria-valuenow="${tokenEstimate}" aria-label="Claude context window usage">
      <span style="width: ${percent}%;"></span>
    </div>
    <div class="aut-context__meta">
      <span>~${formatTokenCount(tokenEstimate)} / ${formatTokenCount(maxTokens)} tokens</span>
      <span>${messageText}${draftText}</span>
    </div>
  `;
  return row;
}

function renderBucket(b) {
  const row = document.createElement('div');
  row.className = 'aut-bucket';

  const ring = document.createElement('div');
  ring.className = 'aut-ring';
  const percent = Math.max(0, Math.min(100, b.percentUsed || 0));
  const remaining = 100 - percent;
  const offset = RING_C * (1 - remaining / 100);
  const resetLine = b.resetISO
    ? `<div class="aut-bucket__reset">
        <span>resets in</span>
        <span class="aut-countdown" data-target="${b.resetISO}">${formatCountdown(b.resetISO)}</span>
      </div>`
    : `<div class="aut-bucket__reset aut-bucket__reset--missing">${escapeHtml(b.rawResetText || 'Reset not published')}</div>`;
  ring.innerHTML = `
    <svg viewBox="0 0 44 44">
      <circle class="aut-ring__track" cx="22" cy="22" r="${RING_R}" fill="none" stroke-width="4"></circle>
      <circle class="aut-ring__fill"  cx="22" cy="22" r="${RING_R}" fill="none" stroke-width="4"
              stroke-dasharray="${RING_C}" stroke-dashoffset="${offset}"
              style="stroke: ${ringColor(percent)};"></circle>
    </svg>
    <div class="aut-ring__label">${Math.round(remaining)}%</div>
  `;
  row.appendChild(ring);

  const text = document.createElement('div');
  text.className = 'aut-bucket__text';
  text.innerHTML = `
    <div class="aut-bucket__label">${escapeHtml(humanBucketLabel(b))}</div>
    ${resetLine}
  `;
  row.appendChild(text);
  row.setAttribute('aria-label', `${humanBucketLabel(b)}: ${Math.round(percent)} percent used`);
  return row;
}

function renderProviderError(provider, error) {
  const wrap = document.createElement('div');
  wrap.className = 'aut-provider';
  const title = document.createElement('div');
  title.className = 'aut-provider__title';
  title.textContent = provider === 'claude' ? 'Claude' : 'Codex';
  wrap.appendChild(title);

  const err = document.createElement('div');
  err.className = 'aut-widget__error';
  const link = `<button class="aut-link-btn" data-act="open-${provider}">Open usage page</button>`;
  if (error === 'shell-response' || error === 'unhydrated' || error === 'no-rows-rendered') {
    err.innerHTML = `<div class="aut-widget__error-title">Waiting for a signed-in reading</div>Open the usage page once so the local scraper can recover. ${link}`;
  } else {
    err.innerHTML = `<div class="aut-widget__error-title">Unable to refresh ${provider === 'claude' ? 'Claude' : 'Codex'}</div>${escapeHtml(error || 'Unknown error')}. ${link}`;
  }
  wrap.appendChild(err);
  err.querySelector('button')?.addEventListener('click', () => openAnalytics(provider));
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

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
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
