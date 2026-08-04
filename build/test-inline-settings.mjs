import assert from 'node:assert/strict';
import { defaultSettings } from '../src/lib/storage.js';
import {
  KNOWN_ROWS,
  defaultRowEnabled,
  listRowOptions,
  normalizeSettings,
  normalizeThemeValue,
} from '../src/lib/settings.js';

const normalized = normalizeSettings({
  refreshMinutes: 999,
  silentTabRefresh: 1,
  showProviders: { claude: false },
  showRows: { custom: true },
  notifications: { dailyBriefingHour: 99, 'R1-60': false },
  theme: 'mocha-light',
  thresholds: { warnAt: 90, dangerAt: 80 },
});
assert.equal(normalized.refreshMinutes, 5, 'unsupported refresh cadence should use the safe default');
assert.equal(normalized.silentTabRefresh, false, 'fallback toggle must be boolean');
assert.equal(normalized.showProviders.claude, false, 'provider override should persist');
assert.equal(normalized.showProviders.codex, true, 'missing provider should use its default');
assert.equal(normalized.showRows.custom, true, 'dynamic row override should persist');
assert.equal(normalized.notifications['R1-60'], false, 'notification override should persist');
assert.equal(normalized.notifications.U3, false, 'anomaly alerts should remain opt-in by default');
assert.equal(normalized.anomalyThresholdPercent, 20, 'anomaly threshold should use its safe default');
assert.equal(normalized.notifications.dailyBriefingHour, 23, 'briefing hour should be clamped');
assert.equal(normalized.theme, 'latte', 'legacy light theme should normalize');
assert.deepEqual(normalized.thresholds, { warnAt: 90, dangerAt: 91 }, 'danger threshold should stay above warn');

const rows = listRowOptions({
  snapshot: {
    providers: {
      claude: { ok: true, buckets: [{ id: 'claude-session', label: 'duplicate' }, { id: 'claude-custom', label: 'Custom' }] },
      codex: { ok: true, buckets: [{ id: 'codex-custom', label: 'Custom' }] },
    },
  },
});
assert.equal(rows.filter((row) => row.id === 'claude-session').length, 1, 'known rows should not duplicate');
assert.ok(rows.some((row) => row.id === 'claude-custom'), 'Claude dynamic rows should be listed');
assert.ok(rows.some((row) => row.id === 'codex-custom'), 'Codex dynamic rows should be listed');
assert.equal(defaultRowEnabled('claude-session'), true, 'headline rows should default on');
assert.equal(defaultRowEnabled('claude-weekly-sonnet'), false, 'detail rows should default off');
assert.equal(KNOWN_ROWS.length, 6, 'base row catalog should remain explicit');
assert.deepEqual(normalizeSettings(), defaultSettings(), 'empty normalization should match defaults');
assert.equal(normalizeThemeValue('unknown'), 'mocha', 'unknown themes should fail closed');

console.log('inline settings smoke: OK');
