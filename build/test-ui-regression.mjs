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

  await saveState(makeState({
    claude: provider({ percentUsed: 86, stale: true, lastErrorDetail: 'usage unavailable' }),
  }));
  await popup.render();
  assert.ok(document.querySelector('.popup-bucket--bad'), 'popup stale state should preserve the danger bucket');
  assert.ok(document.querySelector('.popup-provider .aut-status-label--warn'), 'popup stale state should expose a visible stale label');
  await widget.refreshWidget();
  assert.ok(widgetHost.shadowRoot.querySelector('.aut-provider__stale'), 'widget stale state should expose a visible stale label');

  await saveState(makeState({
    claude: { ok: false, provider: 'claude', error: 'shell-response', errorCode: 'claude.html.shell', stale: true },
  }));
  await popup.render();
  assert.ok(document.querySelector('.popup-error'), 'popup error state should render recovery copy');
  await widget.refreshWidget();
  assert.ok(widgetHost.shadowRoot.querySelector('.aut-widget__error'), 'widget error state should render recovery copy');

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
  assert.equal(document.querySelectorAll('[data-provider]').length, 4, 'options should render web and official API provider toggles');
  assert.equal(document.querySelector('[data-provider="claude"]').checked, false, 'options should render disabled-provider state');
  assert.equal(document.querySelector('#highContrast').checked, true, 'options should render persisted high-contrast state');
  assert.ok(document.querySelector('#exportDiagnostics'), 'options should expose a redacted diagnostics export');
  assert.ok(document.querySelector('#profileList'), 'options should expose local profile management');
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
  assert.match(optionsCSS, /word-break:\s*break-word/, 'options diagnostics must wrap long values');
  assert.match(widgetCSS, /overflow:\s*auto/, 'widget body must contain long state without page overflow');
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

function makeState({ claude = null, codex = null } = {}) {
  const state = defaultState();
  state.snapshot = {
    fetchedAtISO: new Date(Date.now() - 60_000).toISOString(),
    providers: { claude, codex },
  };
  return state;
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
