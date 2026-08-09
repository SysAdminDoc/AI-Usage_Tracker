import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { normalizeSettings } from '../src/lib/settings.js';

const [theme, widget, popup, options, inline, userscript, widgetCss, optionsCss, popupCss, sidepanelCss] = await Promise.all([
  fs.readFile(new URL('../src/ui/theme.css', import.meta.url), 'utf8'),
  fs.readFile(new URL('../src/ui/widget.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../src/ui/popup.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../src/ui/options.html', import.meta.url), 'utf8'),
  fs.readFile(new URL('../src/ui/inline-settings.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../userscript/entry.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../src/ui/widget.css', import.meta.url), 'utf8'),
  fs.readFile(new URL('../src/ui/options.css', import.meta.url), 'utf8'),
  fs.readFile(new URL('../src/ui/popup.css', import.meta.url), 'utf8'),
  fs.readFile(new URL('../src/ui/sidepanel.css', import.meta.url), 'utf8'),
]);

assert.match(theme, /prefers-reduced-motion:\s*reduce/, 'reduced-motion rules must remain present');
assert.match(theme, /--aut-control-h:\s*44px/, 'interactive icon targets should be touch-sized');
assert.match(theme, /data-aut-contrast="high"/, 'high-contrast palette must be available');
assert.match(theme, /focus-visible/, 'shared controls need visible keyboard focus');
assert.match(widget, /role:\s*'timer'/, 'widget countdowns need a live timer role');
assert.match(widget, /'aria-live':\s*'polite'/, 'widget countdowns need a polite live region');
assert.match(popup, /role:\s*'timer'/, 'popup countdowns need a live timer role');
assert.match(popup, /'aria-live':\s*'polite'/, 'popup countdowns need a polite live region');
assert.match(widget, /aut-bucket--\$\{severityFor/, 'widget must expose non-color severity classes');
assert.match(popup, /popup-bucket--\$\{statusTone/, 'popup must expose non-color severity classes');
assert.match(options, /id="highContrast"/, 'extension settings must expose high contrast');
assert.match(options, /aria-live="polite"/, 'extension status regions need live announcements');
assert.match(inline, /setAttribute\('aria-modal', 'true'\)/, 'userscript settings must remain a modal dialog');
assert.match(inline, /highContrast/, 'userscript settings must expose high contrast');
assert.match(widget, /enableDrag\(wrap, \{ disabled: mobile \}\)/, 'mobile mode must disable drag listeners');
assert.match(userscript, /isMobileViewport\(\)/, 'userscript must detect narrow or coarse-pointer viewports');
for (const [name, css] of Object.entries({ widgetCss, optionsCss, popupCss, sidepanelCss })) {
  assert.doesNotMatch(css, /(?:margin|padding)-(?:left|right)\s*:/, `${name} should use logical spacing properties`);
  assert.doesNotMatch(css, /text-align:\s*(?:left|right)/, `${name} should use logical text alignment`);
}
assert.doesNotMatch(inline, /(?:margin|padding)-(?:left|right)\s*:/, 'inline settings should use logical spacing properties');
assert.doesNotMatch(inline, /text-align:\s*(?:left|right)/, 'inline settings should use logical text alignment');
assert.match(widgetCss, /margin-inline-start/, 'widget actions need direction-aware spacing');
assert.match(optionsCss, /margin-inline-start/, 'options header needs direction-aware spacing');
assert.match(popupCss, /margin-inline-start/, 'popup actions need direction-aware spacing');
assert.match(sidepanelCss, /text-align:\s*end/, 'side panel diagnostics need direction-aware alignment');

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
