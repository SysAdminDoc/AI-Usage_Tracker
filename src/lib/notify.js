// Notification rule evaluator. Evaluates a snapshot + history against the
// user's enabled rules and returns a list of notifications to fire. Each
// notification has an idempotent `fireKey`; caller persists fired keys.

import { forecastExhaustion } from './history.js';

const LEAD_MS = {
  'R1-60': 60 * 60 * 1000,
  'R1-15': 15 * 60 * 1000,
  'R1-0':  0,
};

export function evaluateRules({ snapshot, history, settings, firedRules, now = new Date() }) {
  const out = [];
  if (!snapshot || !snapshot.providers) return out;
  if (isSnoozed(settings, now)) return out;

  for (const provider of Object.keys(snapshot.providers)) {
    const ps = snapshot.providers[provider];
    if (!ps || !ps.ok) continue;
    if (!settings.showProviders[provider]) continue;

    for (const bucket of ps.buckets) {
      // Skip rows the user has hidden.
      if (settings.showRows[bucket.id] === false) continue;

      // R1 imminent-reset notifications.
      for (const ruleId of ['R1-60', 'R1-15', 'R1-0']) {
        if (!settings.notifications[ruleId]) continue;
        if (!bucket.resetISO) continue;
        const lead = LEAD_MS[ruleId];
        const fireAt = new Date(bucket.resetISO).getTime() - lead;
        if (fireAt <= now.getTime() && now.getTime() < new Date(bucket.resetISO).getTime() + 60_000) {
          const key = `${provider}-${bucket.id}-${ruleId}-${bucket.resetISO}`;
          if (!firedRules[key]) {
            out.push({
              fireKey: key,
              ruleId,
              title: ruleTitle(ruleId, provider, bucket),
              body:  ruleBody(ruleId, provider, bucket),
              tone:  ruleId === 'R1-0' ? 'good' : 'info',
            });
          }
        }
      }

      // R2 on-reset positive.
      if (settings.notifications['R2'] && bucket.resetISO) {
        const resetTs = new Date(bucket.resetISO).getTime();
        if (resetTs <= now.getTime() && now.getTime() - resetTs < 5 * 60_000) {
          const key = `${provider}-${bucket.id}-R2-${bucket.resetISO}`;
          if (!firedRules[key]) {
            out.push({
              fireKey: key,
              ruleId: 'R2',
              title: `${humanProvider(provider)} ${humanBucket(bucket)} renewed`,
              body:  `Fresh quota is available — go use it.`,
              tone:  'good',
            });
          }
        }
      }

      // U1 usage thresholds (one-shot per current reset window).
      for (const ruleId of ['U1-75', 'U1-90', 'U1-95']) {
        if (!settings.notifications[ruleId]) continue;
        const threshold = parseInt(ruleId.split('-')[1], 10);
        if (bucket.percentUsed >= threshold) {
          const windowKey = bucket.resetISO || 'unknown';
          const key = `${provider}-${bucket.id}-${ruleId}-${windowKey}`;
          if (!firedRules[key]) {
            out.push({
              fireKey: key,
              ruleId,
              title: `${humanProvider(provider)} ${humanBucket(bucket)} at ${bucket.percentUsed.toFixed(0)}%`,
              body:  `Threshold ${threshold}% reached. Resets ${humanReset(bucket)}.`,
              tone:  threshold >= 95 ? 'bad' : 'warn',
            });
          }
        }
      }

      // U2 burn-rate forecast (weekly buckets only).
      if (settings.notifications['U2'] && bucket.kind === 'weekly' && bucket.resetISO) {
        const eta = forecastExhaustion(history, bucket.id, { now });
        if (eta && eta.getTime() < new Date(bucket.resetISO).getTime()) {
          const slot = `${eta.toISOString().slice(0, 10)}`; // dedupe per day
          const key = `${provider}-${bucket.id}-U2-${bucket.resetISO}-${slot}`;
          if (!firedRules[key]) {
            const hoursEarly = Math.round((new Date(bucket.resetISO).getTime() - eta.getTime()) / 3600_000);
            out.push({
              fireKey: key,
              ruleId: 'U2',
              title: `${humanProvider(provider)} weekly forecast — pace too fast`,
              body:  `At current burn rate you'll hit the cap ${hoursEarly}h before reset (${humanReset(bucket)}).`,
              tone:  'warn',
            });
          }
        }
      }
    }
  }

  // D1 daily briefing — single fire per local day at the configured hour.
  if (settings.notifications['D1']) {
    const hour = settings.notifications.dailyBriefingHour ?? 8;
    if (now.getHours() === hour && now.getMinutes() < 10) {
      const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
      const key = `D1-${day}`;
      if (!firedRules[key]) {
        out.push({
          fireKey: key,
          ruleId: 'D1',
          title: 'AI Usage briefing',
          body:  briefingBody(snapshot),
          tone:  'info',
        });
      }
    }
  }

  return out;
}

function isSnoozed(settings, now) {
  const until = settings?.notifications?.snoozedUntilISO;
  if (!until) return false;
  const ts = new Date(until).getTime();
  return Number.isFinite(ts) && ts > now.getTime();
}

function ruleTitle(ruleId, provider, bucket) {
  if (ruleId === 'R1-0') return `${humanProvider(provider)} ${humanBucket(bucket)} resetting now`;
  const mins = ruleId === 'R1-60' ? 60 : 15;
  return `${humanProvider(provider)} ${humanBucket(bucket)} resets in ${mins} min`;
}

function ruleBody(ruleId, provider, bucket) {
  if (ruleId === 'R1-0') return `Fresh quota available — go!`;
  return `Currently ${bucket.percentUsed.toFixed(0)}% used. Resets ${humanReset(bucket)}.`;
}

function humanProvider(p) {
  return p === 'claude' ? 'Claude' : p === 'codex' ? 'Codex' : p;
}

function humanBucket(bucket) {
  if (bucket.kind === 'session') return 'session';
  if (bucket.kind === '5h')      return '5-hour limit';
  if (bucket.kind === 'weekly')  return bucket.model === 'all' ? 'weekly' : `${bucket.model} weekly`;
  return bucket.label;
}

function humanReset(bucket) {
  if (!bucket.resetISO) return bucket.rawResetText || 'soon';
  return new Date(bucket.resetISO).toLocaleString(undefined, {
    weekday: 'short', hour: 'numeric', minute: '2-digit',
  });
}

function briefingBody(snapshot) {
  const lines = [];
  for (const provider of Object.keys(snapshot.providers || {})) {
    const ps = snapshot.providers[provider];
    if (!ps || !ps.ok) continue;
    const head = ps.buckets.find((b) => b.model === 'all' && b.kind === 'weekly')
      || ps.buckets[0];
    if (head) {
      lines.push(`${humanProvider(provider)}: ${head.percentUsed.toFixed(0)}% used, resets ${humanReset(head)}.`);
    }
  }
  return lines.join('\n') || 'No data yet.';
}
