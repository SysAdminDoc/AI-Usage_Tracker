import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { normalizeSettings } from '../src/lib/settings.js';

const [theme, widget, popup, options, inline] = await Promise.all([
  fs.readFile(new URL('../src/ui/theme.css', import.meta.url), 'utf8'),
  fs.readFile(new URL('../src/ui/widget.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../src/ui/popup.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../src/ui/options.html', import.meta.url), 'utf8'),
  fs.readFile(new URL('../src/ui/inline-settings.js', import.meta.url), 'utf8'),
]);

assert.match(theme, /prefers-reduced-motion:\s*reduce/, 'reduced-motion rules must remain present');
assert.match(theme, /--aut-control-h:\s*44px/, 'interactive icon targets should be touch-sized');
assert.match(theme, /data-aut-contrast="high"/, 'high-contrast palette must be available');
assert.match(theme, /focus-visible/, 'shared controls need visible keyboard focus');
assert.match(widget, /role="timer" aria-live="polite"/, 'widget countdowns need a live timer label');
assert.match(popup, /role="timer" aria-live="polite"/, 'popup countdowns need a live timer label');
assert.match(widget, /aut-bucket--\$\{severityFor/, 'widget must expose non-color severity classes');
assert.match(popup, /popup-bucket--\$\{statusTone/, 'popup must expose non-color severity classes');
assert.match(options, /id="highContrast"/, 'extension settings must expose high contrast');
assert.match(options, /aria-live="polite"/, 'extension status regions need live announcements');
assert.match(inline, /setAttribute\('aria-modal', 'true'\)/, 'userscript settings must remain a modal dialog');
assert.match(inline, /highContrast/, 'userscript settings must expose high contrast');

assert.equal(normalizeSettings({ highContrast: true }).highContrast, true);
assert.equal(normalizeSettings({ highContrast: 1 }).highContrast, false);

function contrastRatio(foreground, background) {
  const fg = relativeLuminance(hexRgb(foreground));
  const bg = relativeLuminance(hexRgb(background));
  return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
}

assert.ok(contrastRatio('#ffffff', '#111111') >= 7, 'dark high-contrast body text should meet AAA');
assert.ok(contrastRatio('#111111', '#ffffff') >= 7, 'light high-contrast body text should meet AAA');
assert.ok(contrastRatio('#ffd166', '#3a2a00') >= 4.5, 'dark warning cue should meet AA');
assert.ok(contrastRatio('#7dff6f', '#123117') >= 4.5, 'dark success cue should meet AA');
assert.ok(contrastRatio('#a0002a', '#ffdce5') >= 4.5, 'light danger cue should meet AA');

function hexRgb(hex) {
  const value = hex.slice(1);
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255);
}

function relativeLuminance(rgb) {
  const linear = rgb.map((channel) => channel <= 0.03928
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4);
  return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
}

console.log('accessibility contract smoke: OK');
