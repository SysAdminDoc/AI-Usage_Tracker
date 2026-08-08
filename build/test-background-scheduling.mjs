import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const background = await fs.readFile(new URL('../src/background.js', import.meta.url), 'utf8');
const options = await fs.readFile(new URL('../src/ui/options.js', import.meta.url), 'utf8');

const settingsUpdate = background.match(
  /if \(msg\.type === 'aut\/settings-updated'\) \{([\s\S]*?)\n    \}/,
)?.[1] || '';
assert.match(settingsUpdate, /const state = await loadState\(\);/);
assert.match(settingsUpdate, /await scheduleNotificationAlarm\(state, new Date\(\)\);/);
assert.match(settingsUpdate, /await refreshToolbarBadge\(\);/);
assert.doesNotMatch(settingsUpdate, /syncNativeScheduler/);

const bindAlarm = background.match(/async function bindAlarm\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
assert.match(bindAlarm, /await scheduleNotificationAlarm\(state, new Date\(\)\);/);

const changeHandler = options.match(/document\.body\.addEventListener\('change', async \(e\) => \{([\s\S]*?)\n  \}\);/)?.[1] || '';
assert.match(changeHandler, /sendRuntimeMessage\(\{ type: 'aut\/settings-updated' \}\)/);
assert.match(options, /snoozedUntilISO/);
assert.match(options, /sessionBudgetCap/);
assert.match(options, /dailyBudgetCap/);

console.log('background notification scheduling smoke: OK');
