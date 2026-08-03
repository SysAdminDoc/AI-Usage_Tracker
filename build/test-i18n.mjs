import assert from 'node:assert/strict';
import { createI18n, localeLabel, resolveLocale, SUPPORTED_LOCALES } from '../src/lib/i18n.js';

assert.deepEqual(SUPPORTED_LOCALES, ['en', 'es', 'fr', 'de']);
assert.equal(resolveLocale('fr-CA'), 'fr');
assert.equal(resolveLocale('xx'), 'en');
assert.equal(localeLabel('de'), 'German');
const english = createI18n('en');
const spanish = createI18n('es');
const french = createI18n('fr');
assert.equal(english.t('overview.mostConstrained'), 'Most constrained');
assert.equal(spanish.t('overview.mostConstrained'), 'Más limitado');
assert.equal(french.t('overview.used', { percent: french.formatPercent(50) }), '50 % utilisé');
assert.notEqual(english.formatDateTime('2026-08-03T12:00:00Z'), french.formatDateTime('2026-08-03T12:00:00Z'));
assert.match(english.formatRelative(new Date(Date.now() - 5 * 60_000).toISOString()), /5 minutes ago/);
console.log('i18n locale and Intl formatting smoke: OK');
