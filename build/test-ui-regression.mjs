// Render the shipped popup, widget, and options surfaces in an isolated DOM.
// This deliberately avoids a browser process: the contract is structure,
// state, labels, focus hooks, and overflow guards rather than pixels.

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { parseHTML } from 'linkedom';

let defaultState;
let saveState;

const [popupMarkup, optionsMarkup, themeCSS, popupCSS, optionsCSS, widgetCSS] = await Promise.all([
  fs.readFile(new URL('../src/ui/popup.html', import.meta.url), 'utf8'),
  fs.readFile(new URL('../src/ui/options.html', import.meta.url), 'utf8'),
  fs.readFile(new URL('../src/ui/theme.css', import.meta.url), 'utf8'),
  fs.readFile(new URL('../src/ui/popup.css', import.meta.url), 'utf8'),
  fs.readFile(new URL('../src/ui/options.css', import.meta.url), 'utf8'),
  fs.readFile(new URL('../src/ui/widget.css', import.meta.url), 'utf8'),
]);

const savedInterval = globalThis.setInterval;
const savedTimeout = globalThis.setTimeout;
const savedMatchMedia = globalThis.matchMedia;
const savedConsoleError = console.error;
const savedChrome = globalThis.chrome;
const savedWindow = globalThis.window;
const savedDocument = globalThis.document;
const savedLocalStorage = globalThis.localStorage;
const savedAllowLocalStorage = globalThis.__AUT_ALLOW_LOCALSTORAGE__;
const errors = [];
const store = new Map();

globalThis.setInterval = () => 0;
globalThis.setTimeout = (callback, delay = 0, ...args) => savedTimeout(callback, delay >= 400 ? 0 : delay, ...args);
globalThis.matchMedia = () => ({ matches: false });
globalThis.__AUT_ALLOW_LOCALSTORAGE__ = true;
globalThis.localStorage = {
  getItem(key) { return store.get(key) ?? null; },
  setItem(key, value) { store.set(key, String(value)); },
  removeItem(key) { store.delete(key); },
  clear() { store.clear(); },
};
console.error = (...args) => errors.push(args);

try {
  ({ defaultState, saveState } = await import('../src/lib/storage.js'));
  const popupWindow = installDocument(popupMarkup);
  globalThis.__AUT_THEME_CSS__ = themeCSS;
  globalThis.__AUT_WIDGET_CSS__ = widgetCSS;

  const popup = await import('../src/ui/popup.js?ui-regression');
  await popup.render();
  assert.ok(document.querySelector('.popup-empty'), 'popup first-run state should show an actionable empty state');
  assert.equal(document.getElementById('updated').textContent, 'Never updated');
  assertNoUnnamedControls(document, 'popup first-run');

  const widget = await import('../src/ui/widget.js?ui-regression');
  const widgetState = defaultState();
  await saveState(widgetState);
  await widget.mountWidget({});
  const widgetHost = document.getElementById('aut-host');
  assert.ok(widgetHost?.shadowRoot?.querySelector('.aut-widget__empty'), 'widget first-run state should render inside its shadow root');
  await widget.refreshWidget({ mobile: true });
  assert.ok(widgetHost.shadowRoot.querySelector('.aut-widget--mobile'), 'userscript mobile mode should add its compact layout class');
  await widget.refreshWidget({ mobile: false });

  await saveState(makeState({
    claude: provider({ percentUsed: 86, stale: true, lastErrorDetail: 'usage unavailable' }),
  }));
  await popup.render();
  assert.ok(document.querySelector('.popup-bucket--bad'), 'popup stale state should preserve the danger bucket');
  assert.ok(document.querySelector('.popup-provider .aut-status-label--warn'), 'popup stale state should expose a visible stale label');
  await widget.refreshWidget();
  assert.ok(widgetHost.shadowRoot.querySelector('.aut-provider__stale'), 'widget stale state should expose a visible stale label');

  const pacedState = makeState({ claude: provider({ percentUsed: 80 }) });
  pacedState.history = paceHistory('claude-session');
  await saveState(pacedState);
  await popup.render();
  const popupPaceMarker = document.querySelector('.popup-bucket__pace-marker');
  assert.ok(popupPaceMarker, 'popup quota ring should render an SVG pace marker');
  assert.equal(popupPaceMarker.parentNode.tagName.toLowerCase(), 'svg', 'popup pace marker should not add layout dimensions');
  assert.match(document.querySelector('.popup-bucket').getAttribute('aria-label'), /Pace forecast/,
    'popup quota ring should expose its pace forecast to assistive technology');
  await widget.refreshWidget();
  const widgetPaceMarker = widgetHost.shadowRoot.querySelector('.aut-ring__pace-marker');
  assert.ok(widgetPaceMarker, 'widget quota ring should render an SVG pace marker');
  assert.equal(widgetPaceMarker.parentNode.tagName.toLowerCase(), 'svg', 'widget pace marker should not add layout dimensions');
  assert.match(widgetHost.shadowRoot.querySelector('.aut-bucket').getAttribute('aria-label'), /Pace forecast/,
    'widget quota ring should expose its pace forecast to assistive technology');

  await saveState(makeState({
    claude: { ok: false, provider: 'claude', error: 'shell-response', errorCode: 'claude.html.shell', stale: true },
  }));
  await popup.render();
  assert.ok(document.querySelector('.popup-error'), 'popup error state should render recovery copy');
  await widget.refreshWidget();
  assert.ok(widgetHost.shadowRoot.querySelector('.aut-widget__error'), 'widget error state should render recovery copy');

  await saveState(makeState({ githubCopilot: copilotProvider() }));
  await popup.render();
  assert.match(document.querySelector('.popup-provider').textContent, /Active|Last activity/,
    'popup should render Copilot seat activity metrics');

  await saveState(makeState({ cursor: cursorProvider() }));
  await popup.render();
  assert.match(document.querySelector('.popup-provider').textContent, /Cursor|requests|spend/i,
    'popup should render Cursor request and spend metrics');
  assert.ok(document.querySelector('.popup-forecast'),
    'popup should render a month-end forecast for cost-bearing API data');
  assert.match(document.querySelector('.popup-forecast').textContent, /confidence|Projected|coverage/i,
    'popup forecast should expose confidence and coverage assumptions');

  await saveState(makeState({ gemini: geminiProvider() }));
  await popup.render();
  assert.match(document.querySelector('.popup-provider').textContent, /Gemini|tokens/i,
    'popup should render Gemini token metrics');

  await saveState(makeState({ openrouter: openRouterProvider() }));
  await popup.render();
  assert.match(document.querySelector('.popup-provider').textContent, /OpenRouter|remaining|credits/i,
    'popup should render OpenRouter credit metrics');

  await saveState(makeState({ anthropicApi: costProvider() }));
  await popup.render();
  assert.match(document.querySelector('.popup-provider').textContent, /reported|estimated/,
    'popup should label API cost provenance beside per-model metrics');

  const disabled = makeState({ claude: provider({ percentUsed: 50 }) });
  disabled.settings.showProviders = { claude: false, codex: false };
  await saveState(disabled);
  await popup.render();
  assert.ok(document.querySelector('.popup-empty'), 'popup disabled-provider state should fall back to the empty action surface');
  await widget.refreshWidget();
  assert.ok(widgetHost.shadowRoot.querySelector('.aut-widget__empty'), 'widget disabled-provider state should fall back to the empty action surface');

  await saveState(makeState({ claude: provider({ percentUsed: 50 }) }));
  await popup.render();
  const refreshButton = document.getElementById('refresh');
  let resolveRefresh;
  globalThis.chrome = { runtime: { sendMessage: () => new Promise((resolve) => { resolveRefresh = resolve; }) } };
  refreshButton.dispatchEvent(new popupWindow.Event('click', { bubbles: true }));
  assert.equal(refreshButton.disabled, true, 'popup loading state should disable refresh');
  assert.equal(refreshButton.getAttribute('aria-busy'), 'true', 'popup loading state should announce busy status');
  resolveRefresh({ ok: true });
  await tick();
  delete globalThis.chrome;

  const snoozed = makeState({ claude: provider({ percentUsed: 40 }) });
  snoozed.settings.notifications.snoozedUntilISO = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  snoozed.settings.highContrast = true;
  await saveState(snoozed);
  await widget.refreshWidget();
  const widgetRoot = widgetHost.shadowRoot.querySelector('.aut-root');
  assert.equal(widgetRoot.dataset.autContrast, 'high', 'widget high-contrast state should propagate to its root');
  widgetRoot.querySelector('.aut-widget').dispatchEvent(new popupWindow.Event('contextmenu', { bubbles: true, cancelable: true }));
  await tick();
  assert.ok(widgetHost.shadowRoot.querySelector('[data-act="unsnooze"]'), 'widget snoozed state should offer resume notifications');
  await tick();

  globalThis.chrome = { extension: { inIncognitoContext: true } };
  await popup.render();
  assert.match(document.getElementById('profileName').textContent, /^Incognito · /,
    'popup should visibly identify incognito context');
  await widget.refreshWidget();
  assert.match(widgetHost.shadowRoot.querySelector('.aut-widget__profile').textContent, /^Incognito · /,
    'widget should visibly identify incognito context');
  delete globalThis.chrome;

  const optionsState = makeState({
    claude: {
      ok: false,
      provider: 'claude',
      error: 'shell-response',
      errorCode: 'claude.html.shell',
      lastErrorCode: 'claude.html.shell',
      stale: true,
    },
  });
  optionsState.settings.showProviders = { claude: false, codex: false };
  optionsState.settings.notifications.snoozedUntilISO = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  optionsState.settings.highContrast = true;
  await saveState(optionsState);
  const optionsWindow = installDocument(optionsMarkup, { patchForms: true });
  const options = await import('../src/ui/options.js?ui-regression');
  await options.ready;
  assert.equal(document.querySelectorAll('[data-provider]').length, 8, 'options should render web and official API provider toggles');
  assert.ok(document.querySelector('[data-api-config="githubCopilotOrganization"]'), 'options should expose Copilot organization configuration');
  assert.ok(document.querySelector('[data-api-provider="cursor"]'), 'options should expose Cursor API credentials');
  assert.ok(document.querySelector('[data-api-config="geminiProjectId"]'), 'options should expose Gemini project configuration');
  assert.ok(document.querySelector('[data-api-provider="openrouter"]'), 'options should expose OpenRouter API credentials');
  assert.ok(document.querySelector('#apiBreakdownStatus'), 'options should expose API breakdown status');
  assert.ok(document.querySelector('#exportApiBreakdown'), 'options should expose a redacted API breakdown export');
  assert.match(document.querySelector('.api-credential__cost-hint').textContent, /cost|usage/i,
    'options should explain API cost coverage');
  assert.equal(document.querySelector('[data-provider="claude"]').checked, false, 'options should render disabled-provider state');
  assert.equal(document.querySelector('#highContrast').checked, true, 'options should render persisted high-contrast state');
  assert.ok(document.querySelector('#exportDiagnostics'), 'options should expose a redacted diagnostics export');
  assert.ok(document.querySelector('#exportMcpState'), 'options should expose an explicit MCP state export');
  assert.ok(document.querySelector('#collaborationEnabled'), 'options should expose the collaboration opt-in');
  assert.ok(document.querySelector('#collaborationStatus'), 'options should expose collaboration status');
  assert.ok(document.querySelector('#exportCollaborationContribution'), 'options should expose contribution export');
  assert.match(document.querySelector('#collaborationStatus').textContent, /Off|Enabled|no contribution/i,
    'options should explain the local collaboration state');
  assert.ok(document.querySelector('#profileList'), 'options should expose local profile management');
  assert.ok(document.querySelector('#forecastStatus'), 'options should expose month-end forecast status');
  assert.ok(document.querySelector('#forecastBreakdown'), 'options should expose per-provider forecast details');
  assert.ok(document.querySelector('#optimizationStatus'), 'options should expose plan guidance status');
  assert.ok(document.querySelector('#optimizationBreakdown'), 'options should expose plan guidance details');
  options.renderOptimizationStatus({
    status: 'ready',
    assumptions: ['Verify provider pricing.'],
    recommendations: [{
      type: 'higher-cap',
      title: 'OpenRouter: review a higher-cap plan or limit',
      confidence: 'medium',
      confidenceLabel: 'Medium',
      detail: 'Projected month-end spend is $95 against the reported $100 limit.',
      reason: 'The current run rate is close to the reported provider limit.',
      uncertainty: 'Plan names and prices are not available in this local usage payload.',
    }],
  });
  assert.match(document.querySelector('#optimizationBreakdown').textContent, /higher-cap|OpenRouter/i,
    'options should render an evidence-based plan recommendation');
  assert.ok(document.querySelector('[data-notif="U3"]'), 'options should expose the anomaly alert toggle');
  assert.ok(document.querySelector('#anomalyThresholdPercent'), 'options should expose the anomaly threshold control');
  assert.equal(document.querySelector('#anomalyThresholdPercent').value, '20', 'options should render the default anomaly threshold');
  assert.ok(document.querySelector('#createProfile'), 'options should expose profile creation');
  assert.match(document.querySelector('#profileStatus').textContent, /Default is active/);
  assert.ok(document.querySelector('#syncSettings'), 'options should expose the sync opt-in');
  assert.match(document.querySelector('#syncStatus').textContent, /Unavailable|Off/);
  assert.ok(document.querySelector('#snoozeStatus').className.includes('warn'), 'options should render active snooze state');
  assert.match(document.querySelector('#diagnostics').textContent, /Claude/);
  assert.match(document.querySelector('#diagnostics').textContent, /claude\.html\.shell/, 'options diagnostics should expose provider error codes');
  assertNoUnnamedControls(document, 'options');
  assertLabelsCoverControls(document);

  assert.match(themeCSS, /prefers-reduced-motion:\s*reduce/, 'reduced-motion media query must be present');
  assert.match(popupCSS, /\.popup-bucket__main\s*\{\s*min-width:\s*0/s, 'popup bucket text must be allowed to shrink');
  assert.match(popupCSS, /\.popup-bucket__pace-marker\s*\{/, 'popup pace marker should be styled inside the ring');
  assert.match(popupCSS, /\.popup-optimization\s*\{/, 'popup should style plan guidance separately from provider rows');
  assert.match(optionsCSS, /word-break:\s*break-word/, 'options diagnostics must wrap long values');
  assert.match(widgetCSS, /overflow:\s*auto/, 'widget body must contain long state without page overflow');
  assert.match(widgetCSS, /\.aut-ring__pace-marker\s*\{/, 'widget pace marker should be styled inside the ring');
  assert.match(widgetCSS, /\.aut-widget--mobile\s*\{/, 'widget mobile mode should have a viewport-anchored layout');
  assert.match(widgetCSS, /touch-action:\s*pan-y/, 'mobile widget should preserve page scrolling');
  assert.equal(errors.length, 0, `rendering should not emit console errors: ${errors.map((e) => e.join(' ')).join('; ')}`);

  console.log('UI render regression harness: OK');
} finally {
  console.error = savedConsoleError;
  globalThis.setInterval = savedInterval;
  globalThis.setTimeout = savedTimeout;
  if (savedMatchMedia === undefined) delete globalThis.matchMedia;
  else globalThis.matchMedia = savedMatchMedia;
  if (savedChrome === undefined) delete globalThis.chrome;
  else globalThis.chrome = savedChrome;
  if (savedWindow === undefined) delete globalThis.window;
  else globalThis.window = savedWindow;
  if (savedDocument === undefined) delete globalThis.document;
  else globalThis.document = savedDocument;
  if (savedLocalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = savedLocalStorage;
  if (savedAllowLocalStorage === undefined) delete globalThis.__AUT_ALLOW_LOCALSTORAGE__;
  else globalThis.__AUT_ALLOW_LOCALSTORAGE__ = savedAllowLocalStorage;
}

function installDocument(markup, { patchForms = false } = {}) {
  const parsed = parseHTML(markup);
  globalThis.window = parsed.window;
  globalThis.document = parsed.document;
  globalThis.matchMedia = () => ({ matches: false });
  if (patchForms) {
    for (const control of parsed.document.querySelectorAll('input, select, textarea')) {
      Object.defineProperty(control, 'value', {
        configurable: true,
        enumerable: true,
        writable: true,
        value: control.getAttribute('value') || '',
      });
    }
  }
  return parsed.window;
}

function makeState({ claude = null, codex = null, anthropicApi = null, openaiApi = null, githubCopilot = null, cursor = null, gemini = null, openrouter = null } = {}) {
  const state = defaultState();
  state.snapshot = {
    fetchedAtISO: new Date(Date.now() - 60_000).toISOString(),
    providers: {
      claude,
      codex,
      'anthropic-api': anthropicApi,
      'openai-api': openaiApi,
      'github-copilot': githubCopilot,
      cursor,
      gemini,
      openrouter,
    },
  };
  return state;
}

function paceHistory(bucketId) {
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  return [20, 35, 50, 65, 80].map((percentUsed, index) => ({
    ts: now - (4 - index) * hour,
    bucketId,
    percentUsed,
  }));
}

function copilotProvider() {
  return {
    ok: true,
    provider: 'github-copilot',
    source: 'api-key',
    plan: 'Copilot Business',
    buckets: [{
      id: 'github-copilot-seat',
      label: 'Copilot Business seat',
      kind: 'api',
      model: null,
      percentUsed: 0,
      resetISO: null,
      metric: {
        kind: 'activity',
        active: true,
        lastActivityISO: new Date(Date.now() - 30_000).toISOString(),
        lastActivityEditor: 'vscode/copilot',
      },
    }],
  };
}

function cursorProvider() {
  return {
    ok: true,
    provider: 'cursor',
    source: 'api-key',
    plan: 'Cursor team',
    buckets: [{
      id: 'cursor-requests',
      label: 'Team usage requests',
      kind: 'api',
      model: null,
      percentUsed: 0,
      resetISO: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      metric: {
        kind: 'requests',
        requests: 16,
        subscriptionIncludedReqs: 12,
        usageBasedReqs: 3,
        apiKeyReqs: 1,
        activeDays: 1,
      },
    }, {
      id: 'cursor-spend',
      label: 'Team spend',
      kind: 'api',
      model: null,
      percentUsed: 0,
      resetISO: null,
      metric: { kind: 'currency', costUSD: 24.5, requests: 4, memberCount: 1 },
    }],
  };
}

function geminiProvider() {
  return {
    ok: true,
    provider: 'gemini',
    source: 'api-key',
    plan: 'Gemini API',
    buckets: [{
      id: 'gemini-token-usage',
      label: 'Gemini token usage',
      kind: 'api',
      model: null,
      percentUsed: 0,
      resetISO: null,
      metric: { kind: 'tokens', outputTokens: 800, totalTokens: 800, requests: 5 },
    }],
  };
}

function openRouterProvider() {
  return {
    ok: true,
    provider: 'openrouter',
    source: 'api-key',
    plan: 'OpenRouter',
    buckets: [{
      id: 'openrouter-credits',
      label: 'Account credits',
      kind: 'api',
      model: null,
      percentUsed: 25.6,
      resetISO: null,
      metric: { kind: 'currency', costUSD: 25.75, totalCreditsUSD: 100.5, remainingCreditsUSD: 74.75 },
    }],
  };
}

function costProvider() {
  return {
    ok: true,
    provider: 'anthropic-api',
    source: 'api-key',
    buckets: [{
      id: 'anthropic-api-claude-sonnet-4-6',
      label: 'claude-sonnet-4-6',
      kind: 'api',
      model: 'claude-sonnet-4-6',
      percentUsed: 0,
      resetISO: null,
      metric: {
        kind: 'tokens',
        totalTokens: 1000,
        inputTokens: 700,
        outputTokens: 300,
        costUSD: 1.2345,
        costSource: 'official',
      },
    }],
  };
}

function provider({ percentUsed = 42, stale = false, lastErrorDetail = null } = {}) {
  return {
    ok: true,
    provider: 'claude',
    source: 'api',
    stale,
    lastSuccessISO: new Date(Date.now() - 60_000).toISOString(),
    lastErrorDetail,
    buckets: [{
      id: 'claude-session',
      label: 'Current session',
      kind: 'session',
      model: 'all',
      percentUsed,
      resetISO: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    }],
  };
}

function assertNoUnnamedControls(root, label) {
  for (const control of root.querySelectorAll('button, input, select, textarea')) {
    const labelled = control.getAttribute('aria-label')
      || control.getAttribute('title')
      || control.textContent.trim()
      || control.closest('label')?.textContent.trim()
      || control.id;
    assert.ok(labelled, `${label} has an unnamed control`);
  }
}

function assertLabelsCoverControls(root) {
  for (const control of root.querySelectorAll('input, select, textarea')) {
    const labelled = control.getAttribute('aria-label')
      || control.closest('label')
      || (control.id && root.querySelector(`label[for="${control.id}"]`));
    assert.ok(labelled, `options control ${control.id || control.tagName} needs a label`);
  }
}

function tick() {
  return new Promise((resolve) => savedTimeout(resolve, 0));
}
