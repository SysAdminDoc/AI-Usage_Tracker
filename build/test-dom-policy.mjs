import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import {
  createElement,
  setSafeAttribute,
  setStaticMarkup,
} from '../src/lib/dom.js';

const files = await Promise.all([
  fs.readFile(new URL('../src/ui/popup.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../src/ui/widget.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../src/ui/options.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../src/ui/inline-settings.js', import.meta.url), 'utf8'),
]);
const uiSource = files.join('\n');
const unsafeSink = /(?:innerHTML|outerHTML|insertAdjacentHTML|createContextualFragment)\s*=/;

assert.doesNotMatch(uiSource, unsafeSink, 'UI modules must not write directly to HTML sinks');
assert.match(uiSource, /createElement\(/, 'UI modules must use shared DOM builders for dynamic content');

const { document } = parseHTML('<!doctype html><html><body></body></html>');
globalThis.document = document;
const text = createElement('span', { text: '<img src=x onerror=alert(1)>' });
assert.equal(text.textContent, '<img src=x onerror=alert(1)>', 'dynamic copy must remain text');
assert.equal(text.querySelector('img'), null, 'dynamic copy must not become markup');

const attrs = document.createElement('div');
setSafeAttribute(attrs, 'data-provider', 'claude" onmouseover="bad');
assert.equal(attrs.getAttribute('data-provider'), 'claude" onmouseover="bad');
assert.throws(() => setSafeAttribute(attrs, 'onclick', 'alert(1)'), /Unsafe event attribute/);

const staticHost = document.createElement('div');
setStaticMarkup(staticHost, '<span aria-hidden="true">icon</span>');
assert.equal(staticHost.textContent, 'icon');
assert.throws(() => setStaticMarkup(staticHost, '<span>${dynamic}</span>'), /static markup/);
assert.throws(() => setStaticMarkup(staticHost, '<img onerror="bad">'), /static markup/);

console.log('DOM safety policy smoke: OK');
