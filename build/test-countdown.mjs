import assert from 'node:assert/strict';
import { parseResetString, formatCountdown, normalizeThresholds, ringColor } from '../src/lib/countdown.js';

// --- parseResetString: relative duration ---
{
  const now = new Date('2026-06-16T12:00:00.000Z');
  const result = parseResetString('Resets in 1 hr 5 min', { now });
  assert.ok(result, 'Should parse "Resets in X hr Y min"');
  const d = new Date(result);
  const diffMs = d.getTime() - now.getTime();
  assert.equal(diffMs, (65) * 60 * 1000, 'Should add 1hr 5min');
}

// --- parseResetString: minutes only ---
{
  const now = new Date('2026-06-16T12:00:00.000Z');
  const result = parseResetString('Resets in 45 min', { now });
  assert.ok(result, 'Should parse "Resets in X min"');
  const diffMs = new Date(result).getTime() - now.getTime();
  assert.equal(diffMs, 45 * 60 * 1000);
}

// --- parseResetString: hours only ---
{
  const now = new Date('2026-06-16T12:00:00.000Z');
  const result = parseResetString('Resets in 3 hr', { now });
  assert.ok(result, 'Should parse "Resets in X hr"');
  const diffMs = new Date(result).getTime() - now.getTime();
  assert.equal(diffMs, 3 * 60 * 60 * 1000);
}

// --- parseResetString: absolute date ---
{
  const now = new Date('2026-05-14T12:00:00');
  const result = parseResetString('Resets May 19, 2026 2:05 AM', { now });
  assert.ok(result, 'Should parse absolute date');
  const d = new Date(result);
  assert.equal(d.getMonth(), 4); // May = 4
  assert.equal(d.getDate(), 19);
  assert.equal(d.getFullYear(), 2026);
}

// --- parseResetString: weekday reset ---
{
  // June 16 2026 is a Tuesday
  const now = new Date('2026-06-16T12:00:00');
  const result = parseResetString('Resets Tue 1:00 PM', { now });
  assert.ok(result, 'Should parse weekday reset');
  const d = new Date(result);
  assert.equal(d.getDay(), 2); // Tuesday
  // Should be NEXT Tuesday since current time is past 1:00 PM on Tuesday
  // (depends on whether now is before or after 1 PM local — we use a local Date)
}

// --- parseResetString: time-only reset (today or tomorrow) ---
{
  const now = new Date('2026-05-14T10:00:00');
  const result = parseResetString('Resets 3:34 PM', { now });
  assert.ok(result, 'Should parse time-only reset');
  const d = new Date(result);
  // Should be today at 3:34 PM since now is 10 AM
  assert.equal(d.getDate(), 14);
}

// --- parseResetString: time-only reset rolls to next day ---
{
  const now = new Date('2026-05-14T16:00:00'); // 4 PM, after 3:34 PM
  const result = parseResetString('Resets 3:34 PM', { now });
  assert.ok(result, 'Should parse time-only reset (next day)');
  const d = new Date(result);
  // Should be tomorrow at 3:34 PM since now is past that time
  assert.equal(d.getDate(), 15);
}

// --- parseResetString: month-end rollover ---
{
  const now = new Date('2026-01-31T23:00:00'); // Last day of January, 11 PM
  const result = parseResetString('Resets in 3 hr', { now });
  assert.ok(result, 'Should handle month-end rollover');
  const d = new Date(result);
  // Jan 31 + 3hr = Feb 1 at 2 AM
  assert.equal(d.getMonth(), 1); // February
  assert.equal(d.getDate(), 1);
}

// --- parseResetString: null/empty input ---
assert.equal(parseResetString(null), null);
assert.equal(parseResetString(''), null);
assert.equal(parseResetString('Not a reset string'), null);

// --- formatCountdown: various durations ---
{
  const target = '2026-06-16T15:30:00.000Z';
  const now = new Date('2026-06-16T12:00:00.000Z');
  assert.equal(formatCountdown(target, { now }), '3h 30m');
}
{
  const target = '2026-06-16T12:05:30.000Z';
  const now = new Date('2026-06-16T12:00:00.000Z');
  assert.equal(formatCountdown(target, { now }), '5m 30s');
}
{
  const target = '2026-06-16T12:00:45.000Z';
  const now = new Date('2026-06-16T12:00:00.000Z');
  assert.equal(formatCountdown(target, { now }), '45s');
}
{
  const now = new Date('2026-06-16T12:00:00.000Z');
  assert.equal(formatCountdown('2026-06-16T11:59:00.000Z', { now }), 'now', 'Past target should show "now"');
}
{
  assert.equal(formatCountdown(null), '—', 'Null target should show em-dash');
}

// --- normalizeThresholds edge cases ---
{
  const t = normalizeThresholds({ warnAt: -5, dangerAt: 200 });
  assert.equal(t.warnAt, 1, 'warnAt should be clamped to 1');
  assert.equal(t.dangerAt, 99, 'dangerAt should be clamped to 99');
}
{
  const t = normalizeThresholds({ warnAt: 90, dangerAt: 85 });
  // dangerAt must be > warnAt
  assert.ok(t.dangerAt > t.warnAt, 'dangerAt must be greater than warnAt');
}
{
  const t = normalizeThresholds({});
  assert.equal(t.warnAt, 50, 'Default warnAt should be 50');
  assert.equal(t.dangerAt, 80, 'Default dangerAt should be 80');
}
{
  const t = normalizeThresholds(null);
  assert.equal(t.warnAt, 50, 'Null input should use defaults');
}

// --- ringColor ---
{
  const t = { warnAt: 50, dangerAt: 80 };
  assert.equal(ringColor(0, t), 'var(--aut-green)');
  assert.equal(ringColor(49, t), 'var(--aut-green)');
  assert.equal(ringColor(50, t), 'var(--aut-amber)');
  assert.equal(ringColor(79, t), 'var(--aut-amber)');
  assert.equal(ringColor(80, t), 'var(--aut-red)');
  assert.equal(ringColor(100, t), 'var(--aut-red)');
}

console.log('countdown smoke: OK');
