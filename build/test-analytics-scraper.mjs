import assert from 'node:assert/strict';
import { createAnalyticsScraperController, detectProvider } from '../src/analytics-scraper.js?lifecycle-contract';

class FakeDocument extends EventTarget {
  constructor(location) {
    super();
    this.hidden = false;
    this.location = location;
    this.documentElement = {};
  }
}

class FakeWindow extends EventTarget {
  constructor(location) {
    super();
    this.location = location;
    this.history = {
      pushState: () => {},
      replaceState: () => {},
    };
  }
}

const location = {
  hostname: 'claude.ai',
  pathname: '/settings/usage',
  search: '',
  hash: '',
};
const document = new FakeDocument(location);
const window = new FakeWindow(location);
const observers = [];
const sent = [];
let abortCount = 0;
let firstScrape = true;

const snapshot = (provider) => ({
  ok: true,
  provider,
  buckets: [{ id: `${provider}-session`, percentUsed: 42, resetISO: '2026-08-08T12:00:00.000Z' }],
});

const observerFactory = (callback) => {
  const observer = {
    callback,
    observeCount: 0,
    disconnectCount: 0,
    observe() { this.observeCount++; },
    disconnect() { this.disconnectCount++; },
  };
  observers.push(observer);
  return observer;
};

const scrapeImpl = ({ provider, signal }) => {
  if (firstScrape) {
    firstScrape = false;
    return new Promise((resolve, reject) => {
      signal?.addEventListener('abort', () => {
        abortCount++;
        reject(new Error('aborted by lifecycle'));
      }, { once: true });
      signal?.throwIfAborted?.();
    });
  }
  return Promise.resolve(snapshot(provider));
};

assert.equal(detectProvider(location), 'claude');
assert.equal(detectProvider({ hostname: 'chatgpt.com', pathname: '/codex/cloud/settings/analytics' }), 'codex');
assert.equal(detectProvider({ hostname: 'chatgpt.com', pathname: '/chat' }), null);

const controller = createAnalyticsScraperController({
  document,
  window,
  providerResolver: () => detectProvider(location),
  observerFactory,
  scrapeImpl,
  sendImpl: async (message) => { sent.push(message); },
  pollMs: 2,
  pollWarmupTicks: 20,
  pollBackoffMs: 10,
  mutationWindowMs: 100,
  mutationMaxTicks: 2,
  backpressureCooldownMs: 5,
  mutationDebounceMs: 1,
  mutationBackoffMs: 2,
});

controller.start();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(controller.getState().activeProvider, 'claude');
assert.equal(controller.getState().inFlight, true, 'initial scrape should be observable as in flight');

document.hidden = true;
document.dispatchEvent(new Event('visibilitychange'));
assert.equal(controller.getState().workActive, false, 'hidden documents must pause active work');
assert.equal(abortCount, 1, 'hidden transition must abort the active fetch');
assert.ok(observers[0].disconnectCount >= 1, 'hidden transition must disconnect the observer');

document.hidden = false;
document.dispatchEvent(new Event('visibilitychange'));
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(controller.getState().workActive, true, 'visible transition must reinitialize active work');
assert.ok(sent.length >= 1, 'reinitialized work must eventually ship a stable snapshot');
assert.equal(sent.at(-1).provider, 'claude');

const observerBeforeRoute = observers.at(-1);
location.hostname = 'chatgpt.com';
location.pathname = '/codex/cloud/settings/analytics';
window.dispatchEvent(new Event('popstate'));
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(controller.getState().activeProvider, 'codex', 'SPA route changes must switch provider controllers');
assert.notEqual(observers.at(-1), observerBeforeRoute, 'route changes must create one fresh observer');
assert.ok(observerBeforeRoute.disconnectCount >= 1, 'route changes must tear down the old observer');

const backpressureObserver = observers.at(-1);
backpressureObserver.callback();
backpressureObserver.callback();
backpressureObserver.callback();
assert.equal(controller.getState().backpressure, true, 'mutation bursts must enter recoverable backpressure');
await new Promise((resolve) => setTimeout(resolve, 12));
assert.equal(controller.getState().backpressure, false, 'backpressure must recover automatically');
assert.ok(observers.length >= 4, 'backpressure recovery must attach a replacement observer');

controller.stop();
assert.equal(controller.getState().running, false);
assert.equal(controller.getState().workActive, false);
const observerCount = observers.length;
controller.start();
await new Promise((resolve) => setTimeout(resolve, 2));
assert.equal(controller.getState().running, true, 'a stopped controller must be restartable');
assert.equal(observers.length, observerCount + 1, 'restart must not duplicate observers');
controller.stop();

console.log('analytics scraper lifecycle smoke: OK');
