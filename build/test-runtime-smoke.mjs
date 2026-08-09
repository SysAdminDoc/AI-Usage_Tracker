// Packaged extension smoke lane. This intentionally uses only the installed
// headless browsers and their wire protocols, with fresh temporary profiles.
// It never attaches to a user's browser or creates an interactive window.

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { ROOT, VERSION } from './common.mjs';

const DIST = path.join(ROOT, 'dist');
const CHROME_DIR = path.join(DIST, 'chrome');
const CHROME_MANIFEST = JSON.parse(await fs.readFile(path.join(CHROME_DIR, 'manifest.json'), 'utf8'));
const FIREFOX_XPI = path.join(DIST, `ai-usage-tracker-firefox-v${VERSION}.xpi`);
const CHROME_CANDIDATES = [
  process.env.AUT_CHROME_PATH,
  ...await playwrightChromiumCandidates(),
  path.join(process.env.ProgramFiles || 'C:/Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
].filter(Boolean);

const CHROME_PATH = await firstExisting(CHROME_CANDIDATES);
const FIREFOX_PATH = await findFirefox();
const GECKODRIVER_PATH = await firstExisting([
  process.env.AUT_GECKODRIVER_PATH,
  'C:\\Users\\--\\AppData\\Local\\Microsoft\\WinGet\\Links\\geckodriver.exe',
]);
let activeCDP = null;

async function smokeChrome(browserPath, extensionDir) {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'aut-runtime-chrome-'));
  const extensionId = extensionIdFromManifest(CHROME_MANIFEST);
  let browser = null;
  let cdp = null;
  let pages = [];

  const launch = async () => {
    const port = await freePort();
    browser = await launchIsolatedChrome(browserPath, [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-features=Translate,MediaRouter,OptimizationHints',
      '--disable-popup-blocking',
      '--disable-extensions-except=' + extensionDir,
      '--load-extension=' + extensionDir,
      '--user-data-dir=' + profile,
      '--remote-debugging-port=' + port,
      '--remote-allow-origins=*',
      '--window-size=1280,800',
      'about:blank',
    ]);
    const version = await waitFor(
      async () => fetchJSON('http://127.0.0.1:' + port + '/json/version'),
      15_000,
    );
    cdp = new CDPClient(version.webSocketDebuggerUrl);
    activeCDP = cdp;
    await cdp.ready;
  };

  const closeBrowser = async () => {
    const currentPages = pages.reverse();
    pages = [];
    const currentCDP = cdp;
    cdp = null;
    if (currentCDP) {
      for (const page of currentPages) {
        await currentCDP.send('Target.closeTarget', { targetId: page.targetId }).catch(() => {});
      }
      await currentCDP.send('Browser.close').catch(() => {});
      await currentCDP.close().catch(() => {});
      if (activeCDP === currentCDP) activeCDP = null;
    }
    const currentBrowser = browser;
    browser = null;
    await stopProcessByPid(currentBrowser?.processId);
  };

  try {
    await launch();

    const extensionsPage = await openRawPage(cdp, 'chrome://extensions');
    pages.push(extensionsPage);
    const incognitoSetup = await enableIncognitoAccess(cdp, extensionsPage, extensionId);
    assert.equal(incognitoSetup.found, true, 'Chrome extension details must expose incognito access');
    assert.equal(incognitoSetup.enabled, true, 'Chrome incognito access must be enabled before runtime checks');
    await closeBrowser();

    await launch();
    const popup = await openExtensionPage(cdp, extensionId, 'ui/popup.html');
    pages.push(popup);
    await waitFor(
      () => evaluate(popup.sessionId, "document.readyState === 'complete' && !!document.querySelector('#dashboard')"),
      15_000,
    );
    await waitFor(() => evaluate(popup.sessionId, "!!document.querySelector('.popup-empty')"), 10_000);

    const worker = await waitFor(() => findExtensionWorker(cdp, extensionId), 15_000);
    assert.ok(worker, 'Chrome extension service worker did not start');
    assert.equal(worker.url, 'chrome-extension://' + extensionId + '/background.js');
    const workerSession = (await cdp.send('Target.attachToTarget', {
      targetId: worker.targetId,
      flatten: true,
    })).sessionId;
    const manifest = await evaluate(workerSession, 'chrome.runtime.getManifest()');
    assert.equal(manifest.name, CHROME_MANIFEST.name);
    assert.equal(manifest.version, CHROME_MANIFEST.version);
    const resource = await evaluate(
      workerSession,
      "fetch(chrome.runtime.getURL('ui/popup.html')).then((response) => ({ status: response.status, ok: response.ok }))",
      true,
    );
    assert.deepEqual(resource, { status: 200, ok: true }, 'packaged popup resource must be readable by the worker');

    const snapshot = await evaluate(
      popup.sessionId,
      "chrome.runtime.sendMessage({ type: 'aut/get-snapshot' })",
      true,
    );
    assert.equal(snapshot?.snapshot?.fetchedAtISO, null, 'fresh browser profile should start empty');

    const rejected = await evaluate(
      popup.sessionId,
      'chrome.runtime.sendMessage(' + JSON.stringify({
        type: 'aut/scraped',
        provider: 'claude',
        parsed: { ok: true, provider: 'claude', buckets: [] },
        observedAtISO: new Date().toISOString(),
      }) + ')',
      true,
    );
    assert.equal(rejected?.ok, false, 'extension-page spoof must fail content-message provenance');

    const scheduleResult = await evaluate(popup.sessionId, "chrome.runtime.sendMessage({ type: 'aut/settings-updated' })", true);
    assert.equal(scheduleResult?.ok, true, 'settings update must reach the worker scheduling seam');
    const rescheduleResult = await evaluate(popup.sessionId, "chrome.runtime.sendMessage({ type: 'aut/reschedule' })", true);
    assert.equal(rescheduleResult?.ok, true, 'reschedule must reach the worker alarm seam');
    const notificationAlarm = await evaluate(
      workerSession,
      "new Promise((resolve) => chrome.alarms.get('aut-notification', (alarm) => resolve(alarm ? { present: true, scheduledTime: alarm.scheduledTime } : { present: false })))",
      true,
    );
    assert.equal(typeof notificationAlarm.present, 'boolean', 'notification alarm seam must be callable');

    const permission = await evaluate(
      popup.sessionId,
      "new Promise((resolve) => chrome.permissions.contains({ origins: ['https://api.openai.com/*'] }, (granted) => resolve({ granted: !!granted })))",
      true,
    );
    assert.equal(permission.granted, false, 'unconfigured profile must not have optional API permission');
    const denial = await evaluate(
      popup.sessionId,
      "new Promise((resolve) => { let settled = false; const finish = (value) => { if (!settled) { settled = true; resolve(value); } }; const timer = setTimeout(() => finish({ granted: false, timeout: true }), 1500); try { chrome.permissions.request({ origins: ['https://api.openai.com/*'] }).then((granted) => { clearTimeout(timer); finish({ granted: !!granted }); }).catch((error) => { clearTimeout(timer); finish({ granted: false, error: String(error) }); }); } catch (error) { clearTimeout(timer); finish({ granted: false, error: String(error) }); } })",
      true,
    );
    assert.equal(denial.granted, false, 'permission request without user gesture must fail closed');

    const options = await openExtensionPage(cdp, extensionId, 'ui/options.html');
    pages.push(options);
    await waitFor(
      () => evaluate(options.sessionId, "document.readyState === 'complete' && document.querySelector('#saveStatus')?.textContent === 'Ready'"),
      15_000,
    );
    assert.ok(await evaluate(options.sessionId, "!!document.querySelector('#apiCredentialsStatus')"));

    const sidepanel = await openExtensionPage(cdp, extensionId, 'ui/sidepanel.html');
    pages.push(sidepanel);
    await waitFor(
      () => evaluate(sidepanel.sessionId, "document.readyState === 'complete' && !!document.querySelector('#sidepanelDiagnostics')"),
      15_000,
    );

    const contentPage = await openRawPage(cdp, 'https://claude.ai/');
    pages.push(contentPage);
    await waitFor(
      () => evaluate(contentPage.sessionId, "location.hostname === 'claude.ai' && !!document.querySelector('#aut-host')"),
      15_000,
    );
    await waitFor(
      () => evaluate(contentPage.sessionId, "!!document.querySelector('#aut-host')?.shadowRoot?.querySelector('[data-act=\"refresh\"]')"),
      10_000,
    );
    const contentRefresh = await evaluate(
      contentPage.sessionId,
      "(() => { const host = document.querySelector('#aut-host'); const button = host?.shadowRoot?.querySelector('[data-act=\"refresh\"]'); if (!button) return false; button.click(); return true; })()",
    );
    assert.equal(contentRefresh, true, 'provider content script must mount and reach the refresh messaging seam');

    const staleMarker = '2000-01-01T00:00:00.000Z';
    const staleState = JSON.parse(JSON.stringify(snapshot));
    staleState.snapshot = staleState.snapshot || { fetchedAtISO: null, providers: {} };
    staleState.snapshot.fetchedAtISO = staleMarker;
    staleState.snapshot.providers = {
      ...(staleState.snapshot.providers || {}),
      claude: {
        ok: true,
        provider: 'claude',
        buckets: [{
          id: 'runtime-smoke',
          label: 'Runtime smoke',
          kind: 'rolling',
          percentUsed: 42,
          resetISO: '2099-01-01T00:00:00.000Z',
        }],
        source: 'runtime-smoke',
        stale: true,
        staleReason: 'runtime-smoke',
        lastSuccessISO: staleMarker,
        lastErrorDetail: 'runtime-smoke',
      },
    };
    const regularStateKey = 'aut.state.v1.profile.default';
    await evaluate(
      popup.sessionId,
      'new Promise((resolve) => chrome.storage.local.set('
        + JSON.stringify({ [regularStateKey]: staleState })
        + ', () => resolve(true)))',
      true,
    );
    await cdp.send('Page.reload', {}, popup.sessionId);
    const regularBody = await waitFor(
      () => evaluate(popup.sessionId, "document.body?.innerText?.toLowerCase().includes('stale')"),
      10_000,
    );
    assert.equal(regularBody, true, 'popup must render a stale provider state');

    const incognitoAccess = await evaluate(
      workerSession,
      "new Promise((resolve) => chrome.extension.isAllowedIncognitoAccess((allowed) => resolve({ allowed: !!allowed })))",
      true,
    );
    assert.equal(incognitoAccess.allowed, true, 'Chrome must retain incognito access after restart');
    let incognitoPage = null;
    let incognitoContextId = null;
    try {
      const incognitoContext = await cdp.send('Target.createBrowserContext', { disposeOnDetach: true });
      incognitoContextId = incognitoContext.browserContextId;
      assert.equal(typeof incognitoContextId, 'string', 'Chrome must create an isolated incognito browser context');
      incognitoPage = await openExtensionPage(cdp, extensionId, 'ui/popup.html', incognitoContextId);
      pages.push(incognitoPage);
      assert.notEqual(incognitoPage.browserContextId, popup.browserContextId, 'incognito page must use a separate browser context');
      await waitFor(
        () => evaluate(incognitoPage.sessionId, "document.readyState === 'complete' && !!document.querySelector('#dashboard')"),
        15_000,
      );
      assert.equal(
        await evaluate(incognitoPage.sessionId, "!!chrome.extension?.inIncognitoContext"),
        true,
        'split-incognito page must report incognito context',
      );
      const incognitoSnapshot = await evaluate(
        incognitoPage.sessionId,
        "chrome.runtime.sendMessage({ type: 'aut/get-snapshot' })",
        true,
      );
      assert.equal(
        incognitoSnapshot?.snapshot?.fetchedAtISO,
        null,
        'incognito profile must not reuse the regular profile state key',
      );
      assert.equal(
        await evaluate(incognitoPage.sessionId, "!!document.querySelector('.popup-empty')"),
        true,
        'incognito profile must start with an empty popup state',
      );
    } finally {
      await cdp.send('Target.disposeBrowserContext', { browserContextId: incognitoContextId }).catch(() => {});
    }

    const workerBefore = worker.targetId;
    await closeBrowser();
    await launch();
    const restartedPage = await openExtensionPage(cdp, extensionId, 'ui/popup.html');
    pages.push(restartedPage);
    await waitFor(
      () => evaluate(restartedPage.sessionId, "document.readyState === 'complete' && !!document.querySelector('#dashboard')"),
      15_000,
    );
    const restartedWorker = await waitFor(() => findExtensionWorker(cdp, extensionId), 15_000);
    assert.ok(restartedWorker, 'browser restart must start the packaged service worker');
    assert.notEqual(restartedWorker.targetId, workerBefore, 'worker restart must create a new service-worker target');
    const restartedSnapshot = await evaluate(
      restartedPage.sessionId,
      "chrome.runtime.sendMessage({ type: 'aut/get-snapshot' })",
      true,
    );
    assert.ok(restartedSnapshot?.snapshot, 'restarted worker must answer runtime messages');
  } finally {
    await closeBrowser().catch(() => {});
    await removeTemp(profile);
  }
}

async function enableIncognitoAccess(cdp, page, extensionId) {
  const extensionLiteral = JSON.stringify(extensionId);
  const findItemExpression = '(() => {'
    + ' const find = (node, predicate) => {'
    + '  if (!node) return null;'
    + '  if (predicate(node)) return node;'
    + '  for (const child of node.children || []) {'
    + '   const found = find(child, predicate);'
    + '   if (found) return found;'
    + '   const shadowFound = child.shadowRoot ? find(child.shadowRoot, predicate) : null;'
    + '   if (shadowFound) return shadowFound;'
    + '  }'
    + '  return null;'
    + ' };'
    + ' return !!find(document, (node) => node.nodeType === 1 && node.tagName === "EXTENSIONS-ITEM" && node.id === ' + extensionLiteral + ');'
    + '})()';
  await waitFor(() => evaluate(page.sessionId, findItemExpression), 15_000);

  const detailOpened = await evaluate(page.sessionId, '(() => {'
    + ' const find = (node, predicate) => {'
    + '  if (!node) return null;'
    + '  if (predicate(node)) return node;'
    + '  for (const child of node.children || []) {'
    + '   const found = find(child, predicate);'
    + '   if (found) return found;'
    + '   const shadowFound = child.shadowRoot ? find(child.shadowRoot, predicate) : null;'
    + '   if (shadowFound) return shadowFound;'
    + '  }'
    + '  return null;'
    + ' };'
    + ' const item = find(document, (node) => node.nodeType === 1 && node.tagName === "EXTENSIONS-ITEM" && node.id === ' + extensionLiteral + ');'
    + ' const button = item?.shadowRoot?.querySelector("#detailsButton");'
    + ' if (!button) return false;'
    + ' button.click();'
    + ' return true;'
    + '})()', false, true);
  assert.equal(detailOpened, true, 'Chrome extension details button must be available');

  const toggleStateExpression = '(() => {'
    + ' const find = (node, predicate) => {'
    + '  if (!node) return null;'
    + '  if (predicate(node)) return node;'
    + '  for (const child of node.children || []) {'
    + '   const found = find(child, predicate);'
    + '   if (found) return found;'
    + '   const shadowFound = child.shadowRoot ? find(child.shadowRoot, predicate) : null;'
    + '   if (shadowFound) return shadowFound;'
    + '  }'
    + '  return null;'
    + ' };'
    + ' const row = find(document, (node) => node.nodeType === 1 && node.id === "allow-incognito");'
    + ' const toggle = row?.shadowRoot?.querySelector("#crToggle");'
    + ' if (!toggle) return { found: false, enabled: false };'
    + ' const enabled = toggle.checked === true'
    + '   || toggle.getAttribute("aria-pressed") === "true"'
    + '   || toggle.getAttribute("aria-pressed") === "true";'
    + ' return { found: true, enabled };'
    + '})()';
  const before = await waitFor(() => evaluate(page.sessionId, toggleStateExpression), 10_000);
  assert.equal(before.found, true, 'Chrome extension details must expose the incognito toggle');
  if (!before.enabled) {
    const clicked = await evaluate(page.sessionId, '(() => {'
      + ' const find = (node, predicate) => {'
      + '  if (!node) return null;'
      + '  if (predicate(node)) return node;'
      + '  for (const child of node.children || []) {'
      + '   const found = find(child, predicate);'
      + '   if (found) return found;'
      + '   const shadowFound = child.shadowRoot ? find(child.shadowRoot, predicate) : null;'
      + '   if (shadowFound) return shadowFound;'
      + '  }'
      + '  return null;'
      + ' };'
      + ' const row = find(document, (node) => node.nodeType === 1 && node.id === "allow-incognito");'
      + ' const toggle = row?.shadowRoot?.querySelector("#crToggle");'
      + ' if (!toggle) return false;'
      + ' toggle.click();'
      + ' return true;'
      + '})()', false, true);
    assert.equal(clicked, true, 'Chrome incognito toggle must be clickable');
  }
  const enabled = await waitFor(async () => {
    const state = await evaluate(page.sessionId, toggleStateExpression);
    return state?.found && state.enabled ? state : null;
  }, 10_000);
  await new Promise((resolve) => setTimeout(resolve, 500));
  return enabled;
}

async function smokeFirefox(browserPath, driverPath, xpiPath) {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'aut-runtime-firefox-'));
  const port = await freePort();
  const driver = spawn(driverPath, ['--port', String(port), '--log', 'fatal'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const output = collectOutput(driver);
  let sessionId = null;
  try {
    await waitFor(async () => {
      const status = await fetchJSON(`http://127.0.0.1:${port}/status`).catch(() => null);
      return status?.value?.ready === true;
    }, 15_000);
    const xpi = (await fs.readFile(xpiPath)).toString('base64');
    const created = await webdriverRequest(port, '/session', 'POST', {
      capabilities: {
        alwaysMatch: {
          browserName: 'firefox',
          'moz:firefoxOptions': {
            binary: browserPath,
            args: ['-headless', '-no-remote', '-profile', profile],
            prefs: {
              'dom.webnotifications.enabled': false,
              'app.update.auto': false,
              'datareporting.policy.dataSubmissionEnabled': false,
            },
          },
        },
      },
    });
    sessionId = created.value?.sessionId || created.sessionId;
    assert.ok(sessionId, `Firefox WebDriver session was not created: ${JSON.stringify(created)}`);
    const installed = await webdriverRequest(port, `/session/${sessionId}/moz/addon/install`, 'POST', {
      addon: xpi,
      temporary: true,
    });
    assert.equal(installed.value, 'ai-usage-tracker@sysadmindoc.dev', 'Firefox must install the packaged add-on ID');
    await webdriverRequest(port, `/session/${sessionId}/url`, 'POST', { url: 'about:debugging#/runtime/this-firefox' });
    const addonPage = await waitFor(async () => {
      const page = await webdriverRequest(port, `/session/${sessionId}/execute/sync`, 'POST', {
        script: "return (function walk(node) { if (!node) return ''; let text = node.nodeType === 3 ? (node.textContent || '') : ''; for (const child of node.childNodes || []) text += ' ' + walk(child); if (node.shadowRoot) text += ' ' + walk(node.shadowRoot); return text; })(document.documentElement);",
        args: [],
      }).catch(() => null);
      return /AI Usage Tracker|ai-usage-tracker/i.test(String(page?.value || '')) ? page : null;
    }, 15_000);
    assert.match(String(addonPage.value), /AI Usage Tracker|ai-usage-tracker/i);
    const manifestURL = String(addonPage.value).match(/moz-extension:\/\/[a-f0-9-]+\/manifest\.json/i)?.[0];
    assert.ok(manifestURL, 'Firefox debugging page must expose the packaged manifest URL');
    const baseURL = manifestURL.replace(/manifest\.json$/i, '');
    await webdriverRequest(port, `/session/${sessionId}/url`, 'POST', { url: baseURL + 'ui/popup.html' });
    const popupSource = await waitFor(async () => {
      const page = await webdriverRequest(port, `/session/${sessionId}/source`, 'GET').catch(() => null);
      return /AI Usage Tracker|ai-usage-tracker/i.test(String(page?.value || '')) ? page : null;
    }, 15_000);
    assert.match(String(popupSource.value), /AI Usage Tracker|ai-usage-tracker/i);
    await webdriverRequest(port, `/session/${sessionId}/url`, 'POST', { url: baseURL + 'ui/options.html' });
    const optionsSource = await waitFor(async () => {
      const page = await webdriverRequest(port, `/session/${sessionId}/source`, 'GET').catch(() => null);
      return /AI Usage Tracker|ai-usage-tracker/i.test(String(page?.value || '')) ? page : null;
    }, 15_000);
    assert.match(String(optionsSource.value), /AI Usage Tracker|ai-usage-tracker/i);
  } catch (error) {
    throw new Error(`Firefox packaged runtime smoke failed: ${error.message}; ${output()}`);
  } finally {
    if (sessionId) await webdriverRequest(port, `/session/${sessionId}`, 'DELETE').catch(() => {});
    await stopProcess(driver);
    await removeTemp(profile);
  }
}

async function openExtensionPage(cdp, extensionId, relativePath, browserContextId = undefined) {
  const url = `chrome-extension://${extensionId}/${relativePath}`;
  const target = await cdp.send('Target.createTarget', {
    url,
    ...(browserContextId ? { browserContextId } : {}),
  });
  const attached = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  await cdp.send('Page.enable', {}, attached.sessionId);
  await cdp.send('Page.navigate', { url }, attached.sessionId);
  const info = await cdp.send('Target.getTargetInfo', { targetId: target.targetId });
  return {
    targetId: target.targetId,
    sessionId: attached.sessionId,
    browserContextId: info.targetInfo?.browserContextId,
  };
}

async function openRawPage(cdp, url) {
  const target = await cdp.send('Target.createTarget', { url });
  const attached = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  await cdp.send('Page.enable', {}, attached.sessionId);
  return { targetId: target.targetId, sessionId: attached.sessionId };
}

async function findExtensionWorker(cdp, extensionId, browserContextId = undefined) {
  const targets = await cdp.send('Target.getTargets');
  return targets.targetInfos?.find((target) => target.type === 'service_worker'
    && target.url === 'chrome-extension://' + extensionId + '/background.js'
    && (browserContextId === undefined || target.browserContextId === browserContextId)) || null;
}

async function evaluate(sessionId, expression, awaitPromise = false, userGesture = false) {
  const result = await activeCDP.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture,
  }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed');
  return result.result?.value;
}

class CDPClient {
  constructor(url) {
    this.pending = new Map();
    this.nextId = 1;
    this.socket = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.socket.onopen = resolve;
      this.socket.onerror = () => reject(new Error('Chrome DevTools WebSocket failed to open'));
    });
    this.socket.onmessage = (event) => {
      let message;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
      else pending.resolve(message.result || {});
    };
    this.socket.onclose = () => {
      for (const pending of this.pending.values()) pending.reject(new Error('Chrome DevTools connection closed'));
      this.pending.clear();
    };
  }

  async send(method, params = {}, sessionId = null) {
    await this.ready;
    const id = this.nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify(message));
    });
  }

  async close() {
    try { this.socket.close(); } catch { /* already closed */ }
  }
}

async function webdriverRequest(port, route, method, body = undefined) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let value = null;
  try { value = text ? JSON.parse(text) : null; } catch { value = { raw: text }; }
  if (!response.ok) throw new Error(`WebDriver ${method} ${route} ${response.status}: ${JSON.stringify(value)}`);
  return value;
}

async function fetchJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.json();
}

async function waitFor(read, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out after ${timeoutMs}ms${lastError ? `: ${lastError.message}` : ''}`);
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function firstExisting(paths) {
  for (const candidate of paths) {
    if (!candidate) continue;
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return candidate;
    } catch { /* try the next installed browser */ }
  }
  return null;
}

async function playwrightChromiumCandidates() {
  const root = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  let entries = [];
  try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { return []; }
  const candidates = [];
  const chromiumEntries = entries
    .filter((item) => item.isDirectory() && /^chromium-/.test(item.name))
    .sort((left, right) => {
      const buildNumber = (name) => Number(name.match(/(\d+)$/)?.[1] || 0);
      return buildNumber(right.name) - buildNumber(left.name);
    });
  for (const entry of chromiumEntries) {
    candidates.push(path.join(root, entry.name, 'chrome-win64', 'chrome.exe'));
    candidates.push(path.join(root, entry.name, 'chrome-win', 'chrome.exe'));
  }
  return candidates;
}

async function findFirefox() {
  const candidates = [
    process.env.AUT_FIREFOX_PATH,
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'firefox.exe'),
  ].filter(Boolean);
  const direct = await firstExisting([process.env.AUT_FIREFOX_PATH]);
  if (direct) return direct;

  const appx = await runPowerShell("Get-AppxPackage -Name 'Mozilla.MozillaFirefox' | Select-Object -First 1 -ExpandProperty InstallLocation")
    .catch(() => null);
  const packageRoot = appx?.output.trim();
  if (packageRoot) {
    const candidate = path.join(packageRoot, 'VFS', 'ProgramFiles', 'MozillaFirefox Package Root', 'firefox.exe');
    if (await firstExisting([candidate])) return candidate;
  }

  const windowsApps = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'WindowsApps');
  let entries = [];
  try { entries = await fs.readdir(windowsApps, { withFileTypes: true }); } catch { return null; }
  for (const entry of entries.filter((item) => item.isDirectory() && /^Mozilla\.MozillaFirefox_/.test(item.name))) {
    const candidate = path.join(windowsApps, entry.name, 'VFS', 'ProgramFiles', 'MozillaFirefox Package Root', 'firefox.exe');
    if (await firstExisting([candidate])) return candidate;
  }
  // Microsoft Store app aliases can deny stat() even though CreateProcess can
  // resolve them. Keep the known alias as a final executable candidate.
  const alias = candidates.find((candidate) => /[\\/]WindowsApps[\\/]firefox\.exe$/i.test(candidate));
  if (alias) return alias;
  return null;
}

async function assertArtifact(target, label) {
  const stat = await fs.stat(target).catch(() => null);
  assert.ok(stat && (stat.isDirectory() || stat.isFile()), `${label} is missing; run npm run build first`);
}

function extensionIdFromManifest(manifest) {
  assert.ok(typeof manifest.key === 'string' && manifest.key.length > 0, 'Chrome manifest must pin an extension key');
  const hash = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest();
  return [...hash.subarray(0, 16)]
    .flatMap((byte) => [byte >> 4, byte & 0x0f])
    .map((nibble) => String.fromCharCode(97 + nibble))
    .join('');
}

function collectOutput(process) {
  let text = '';
  const append = (chunk) => { text = `${text}${chunk}`.slice(-4000); };
  process.stdout?.on('data', append);
  process.stderr?.on('data', append);
  return () => text.replace(/\s+/g, ' ').trim();
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  if (globalThis.process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      const timer = setTimeout(resolve, 5_000);
      const finish = () => { clearTimeout(timer); resolve(); };
      killer.once('exit', finish);
      killer.once('error', finish);
    });
  } else {
    child.kill();
  }
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

async function stopProcessByPid(processId) {
  if (!processId) return;
  if (globalThis.process.platform === 'win32') {
    await runPowerShell(`& taskkill.exe /PID ${Number(processId)} /T /F`)
      .catch(() => {});
    await runPowerShell(`for ($i = 0; $i -lt 100; $i++) { if (-not (Get-Process -Id ${Number(processId)} -ErrorAction SilentlyContinue)) { break }; Start-Sleep -Milliseconds 100 }`, 15_000)
      .catch(() => {});
    return;
  }
  try { globalThis.process.kill(processId); } catch { /* already stopped */ }
}

async function launchIsolatedChrome(browserPath, args) {
  const isolationScript = path.join(
    process.env.USERPROFILE || 'C:\\Users\\--',
    '.claude', 'scripts', 'visual-isolation.ps1',
  );
  const ensured = await runPowerShell(`& ${quotePowerShell(isolationScript)} ensure`);
  const bounds = parseLastJson(ensured.output, 'visual isolation ensure bounds');
  assert.equal(bounds.primary, false, 'isolated display must not be primary');
  const argList = args.map(quotePowerShell).join(', ');
  const launch = await runPowerShell(
    `& ${quotePowerShell(isolationScript)} launch -FilePath ${quotePowerShell(browserPath)} -ArgumentList @(${argList})`,
    45_000,
  );
  const placement = parseLastJson(launch.output, 'isolated browser launch placement');
  assert.ok(Number.isInteger(placement.processId));
  assert.equal(typeof placement.desktop, 'string');
  assert.equal(placement.display, bounds.deviceName,
    'runtime smoke must use the exact display established by visual isolation');
  const verify = await runPowerShell(
    `& ${quotePowerShell(isolationScript)} verify -ProcessId ${placement.processId} -DesktopName ${quotePowerShell(placement.desktop)}`,
    15_000,
  );
  assert.match(verify.output, /placement proof passed/i);
  return { ...placement, output: `${launch.output}\n${verify.output}` };
}

async function runPowerShell(command, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const child = spawn('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const output = collectOutput(child);
    const timer = setTimeout(() => {
      void stopProcess(child);
      reject(new Error(`PowerShell command timed out: ${output()}`));
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      const text = output();
      if (code === 0) resolve({ code, output: text });
      else reject(new Error(`PowerShell command failed (${code}): ${text}`));
    });
  });
}

function quotePowerShell(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function parseLastJson(output, label) {
  const start = String(output || '').lastIndexOf('{');
  assert.ok(start >= 0, `${label} returned no JSON proof: ${output}`);
  try {
    return JSON.parse(String(output).slice(start));
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${error.message}; ${output}`);
  }
}

async function removeTemp(target) {
  await fs.rm(target, { recursive: true, force: true, maxRetries: 24, retryDelay: 500 });
}

await assertArtifact(CHROME_DIR, 'Chrome unpacked artifact');
await assertArtifact(FIREFOX_XPI, 'Firefox packaged artifact');
assert.ok(CHROME_PATH, 'Chrome/Edge executable is required for runtime smoke');
assert.ok(FIREFOX_PATH, 'Firefox executable is required for runtime smoke');
assert.ok(GECKODRIVER_PATH, 'geckodriver is required for Firefox runtime smoke');

await smokeChrome(CHROME_PATH, CHROME_DIR);
await smokeFirefox(FIREFOX_PATH, GECKODRIVER_PATH, FIREFOX_XPI);
console.log('packaged Chrome and Firefox runtime smoke: OK');
