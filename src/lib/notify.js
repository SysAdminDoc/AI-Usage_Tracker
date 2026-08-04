// Notification rule evaluator. Evaluates a snapshot + history against the
// user's enabled rules and returns a list of notifications to fire. Each
// notification has an idempotent `fireKey`; caller persists fired keys.

import { detectAnomaly, forecastExhaustion } from './history.js';

export const WEBHOOK_SCHEMA = 'ai-usage-tracker.webhook';
export const WEBHOOK_SCHEMA_VERSION = 1;
export const WEBHOOK_MAX_ATTEMPTS = 3;

const LEAD_MS = {
  'R1-60': 60 * 60 * 1000,
  'R1-15': 15 * 60 * 1000,
  'R1-0':  0,
};

// A sleeping browser can miss the narrow notification windows. Keep the
// grace periods explicit so the evaluator and the next-alarm derivation share
// one contract, while firedRules still provides durable de-duplication.
export const NOTIFICATION_GRACE_MS = Object.freeze({
  renewal: 2 * 60 * 60 * 1000,
  reset: 30 * 60 * 1000,
  briefing: 2 * 60 * 60 * 1000,
});

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
        const resetTs = new Date(bucket.resetISO).getTime();
        if (!Number.isFinite(resetTs)) continue;
        const nowTs = now.getTime();
        const fireAt = resetTs - lead;
        const inNormalWindow = fireAt <= nowTs && nowTs < resetTs + 60_000;
        // After a late wake, only the reset-moment rule is useful. This avoids
        // firing three stale renewal notices for the same missed reset.
        const inCatchUpWindow = ruleId === 'R1-0'
          && nowTs >= resetTs + 60_000
          && nowTs < resetTs + NOTIFICATION_GRACE_MS.renewal;
        if (inNormalWindow || inCatchUpWindow) {
          const key = `${provider}-${bucket.id}-${ruleId}-${bucket.resetISO}`;
          if (!firedRules[key]) {
            out.push({
              fireKey: key,
              ruleId,
              title: ruleTitle(ruleId, provider, bucket, { catchUp: inCatchUpWindow }),
              body:  ruleBody(ruleId, provider, bucket, { catchUp: inCatchUpWindow }),
              tone:  ruleId === 'R1-0' ? 'good' : 'info',
              catchUp: inCatchUpWindow,
              provider,
              bucketId: bucket.id,
              bucketLabel: bucket.label,
              percentUsed: bucket.percentUsed,
              resetISO: bucket.resetISO,
            });
          }
        }
      }

      // R2 on-reset positive.
      if (settings.notifications['R2'] && bucket.resetISO) {
        const resetTs = new Date(bucket.resetISO).getTime();
        if (Number.isFinite(resetTs)
            && resetTs <= now.getTime()
            && now.getTime() - resetTs < NOTIFICATION_GRACE_MS.reset) {
          const key = `${provider}-${bucket.id}-R2-${bucket.resetISO}`;
          if (!firedRules[key]) {
          out.push({
            fireKey: key,
            ruleId: 'R2',
              title: `${humanProvider(provider)} ${humanBucket(bucket)} renewed`,
            body:  `Fresh quota is available — go use it.`,
            tone:  'good',
            provider,
            bucketId: bucket.id,
            bucketLabel: bucket.label,
            percentUsed: bucket.percentUsed,
            resetISO: bucket.resetISO,
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
              provider,
              bucketId: bucket.id,
              bucketLabel: bucket.label,
              percentUsed: bucket.percentUsed,
              resetISO: bucket.resetISO,
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
              provider,
              bucketId: bucket.id,
              bucketLabel: bucket.label,
              percentUsed: bucket.percentUsed,
              resetISO: bucket.resetISO,
            });
          }
        }
      }

      // U3 sudden-spike detection. This is ingest-scoped: the history helper
      // ignores old samples, while the sample timestamp makes the alert key
      // idempotent across repeated notification passes.
      if (settings.notifications['U3'] && bucket.kind !== 'api' && !bucket.metric) {
        const anomaly = detectAnomaly(history, bucket.id, {
          now,
          thresholdPercent: settings.anomalyThresholdPercent,
        });
        if (anomaly) {
          const key = `${provider}-${bucket.id}-U3-${anomaly.sampleTs}`;
          if (!firedRules[key]) {
            out.push({
              fireKey: key,
              ruleId: 'U3',
              title: `${humanProvider(provider)} ${humanBucket(bucket)} usage spike detected`,
              body: `Usage jumped ${anomaly.jumpPercent.toFixed(0)} points above the recent ${anomaly.baselineSampleCount}-sample average (${anomaly.baselineAverage.toFixed(0)}%); now ${anomaly.currentPercent.toFixed(0)}%.`,
              tone: 'warn',
              provider,
              bucketId: bucket.id,
              bucketLabel: bucket.label,
              percentUsed: bucket.percentUsed,
              resetISO: bucket.resetISO,
            });
          }
        }
      }
    }
  }

  // D1 daily briefing — single fire per local day at the configured hour.
  if (settings.notifications['D1']) {
    const hour = settings.notifications.dailyBriefingHour ?? 8;
    const scheduled = localBriefingTime(now, hour);
    if (now.getTime() >= scheduled.getTime()
        && now.getTime() - scheduled.getTime() < NOTIFICATION_GRACE_MS.briefing) {
      const day = localDayKey(now);
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

/**
 * Return the next durable notification deadline after `now`.
 *
 * The service worker uses this to create a one-shot alarms entry in addition
 * to its recurring refresh alarm. The result is intentionally descriptive so
 * it can be asserted without a browser runtime.
 */
export function deriveNextNotificationAlarm({ snapshot, settings, firedRules = {}, now = new Date() }) {
  if (!snapshot?.providers || isSnoozed(settings, now)) return null;

  const candidates = [];
  const nowTs = now.getTime();
  for (const provider of Object.keys(snapshot.providers)) {
    const ps = snapshot.providers[provider];
    if (!ps?.ok || settings.showProviders?.[provider] === false) continue;
    for (const bucket of ps.buckets || []) {
      if (settings.showRows?.[bucket.id] === false || !bucket.resetISO) continue;
      const resetTs = new Date(bucket.resetISO).getTime();
      if (!Number.isFinite(resetTs)) continue;
      for (const ruleId of ['R1-60', 'R1-15', 'R1-0']) {
        if (!settings.notifications?.[ruleId]) continue;
        const at = resetTs - LEAD_MS[ruleId];
        const fireKey = `${provider}-${bucket.id}-${ruleId}-${bucket.resetISO}`;
        if (at > nowTs && !firedRules[fireKey]) {
          candidates.push({ at, ruleId, fireKey, provider, bucketId: bucket.id });
        }
      }
      if (settings.notifications?.R2 && resetTs > nowTs) {
        const fireKey = `${provider}-${bucket.id}-R2-${bucket.resetISO}`;
        if (!firedRules[fireKey]) {
          candidates.push({ at: resetTs, ruleId: 'R2', fireKey, provider, bucketId: bucket.id });
        }
      }
    }
  }

  if (settings.notifications?.D1) {
    const hour = settings.notifications.dailyBriefingHour ?? 8;
    const today = localBriefingTime(now, hour);
    const briefing = today.getTime() > nowTs ? today : addLocalDays(today, 1);
    const fireKey = `D1-${localDayKey(briefing)}`;
    if (!firedRules[fireKey]) candidates.push({
      at: briefing.getTime(),
      ruleId: 'D1',
      fireKey,
      provider: null,
      bucketId: null,
    });
  }

  candidates.sort((a, b) => a.at - b.at || a.ruleId.localeCompare(b.ruleId));
  const next = candidates[0];
  return next ? { ...next, atISO: new Date(next.at).toISOString() } : null;
}

/** Return a safe HTTP(S) webhook URL or an empty string for invalid input. */
export function normalizeWebhookURL(value) {
  const text = String(value || '').trim().slice(0, 2048);
  if (!text || typeof URL === 'undefined') return '';
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    return url.href;
  } catch {
    return '';
  }
}

/**
 * Build the default-redacted event body. Provider/bucket values are only
 * included when the user explicitly enables detail delivery.
 */
export function buildWebhookPayload(notification, { includeDetails = false, now = new Date() } = {}) {
  const payload = {
    schema: WEBHOOK_SCHEMA,
    schemaVersion: WEBHOOK_SCHEMA_VERSION,
    event: 'notification-rule-fired',
    emittedAtISO: now.toISOString(),
    ruleId: boundedWebhookText(notification?.ruleId, 32) || 'unknown',
    tone: boundedWebhookText(notification?.tone, 16) || 'info',
    catchUp: notification?.catchUp === true,
  };
  if (includeDetails) {
    payload.details = {
      provider: boundedWebhookText(notification?.provider, 64) || null,
      bucketId: boundedWebhookText(notification?.bucketId, 160) || null,
      bucketLabel: boundedWebhookText(notification?.bucketLabel, 240) || null,
      percentUsed: Number.isFinite(Number(notification?.percentUsed))
        ? Math.max(0, Math.min(100, Number(notification.percentUsed))) : null,
      resetISO: validISO(notification?.resetISO),
      title: boundedWebhookText(notification?.title, 240) || null,
      body: boundedWebhookText(notification?.body, 500) || null,
    };
  }
  return payload;
}

/**
 * Deliver one JSON event with bounded retries. Network failures and 408/429/
 * 5xx responses retry; permanent 4xx responses fail immediately. The return
 * value contains no URL, response body, or request headers.
 */
export async function deliverWebhook({
  url,
  payload,
  fetchImpl = null,
  maxAttempts = WEBHOOK_MAX_ATTEMPTS,
  baseDelayMs = 250,
  sleep = null,
} = {}) {
  const normalizedURL = normalizeWebhookURL(url);
  if (!normalizedURL) return { ok: false, attempts: 0, errorCode: 'webhook.url-invalid' };
  const doFetch = typeof fetchImpl === 'function'
    ? fetchImpl
    : typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function'
      ? globalThis.fetch.bind(globalThis)
      : null;
  if (!doFetch) return { ok: false, attempts: 0, errorCode: 'webhook.fetch-unavailable' };

  let body;
  try { body = JSON.stringify(payload || {}); } catch {
    return { ok: false, attempts: 0, errorCode: 'webhook.payload-invalid' };
  }

  const attemptsLimit = Math.max(1, Math.min(WEBHOOK_MAX_ATTEMPTS, Math.floor(Number(maxAttempts) || WEBHOOK_MAX_ATTEMPTS)));
  const delay = Math.max(0, Math.min(2_000, Number(baseDelayMs) || 0));
  const wait = typeof sleep === 'function'
    ? sleep
    : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let attempts = 0;
  let status = null;
  let errorCode = 'webhook.network-failed';

  while (attempts < attemptsLimit) {
    attempts += 1;
    try {
      const response = await doFetch(normalizedURL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-AI-Usage-Tracker-Schema': `${WEBHOOK_SCHEMA}/${WEBHOOK_SCHEMA_VERSION}`,
        },
        body,
      });
      status = Number(response?.status) || null;
      if (response?.ok === true) return { ok: true, attempts, status };
      errorCode = status ? `webhook.http-${status}` : 'webhook.invalid-response';
      if (!isRetryableWebhookStatus(status)) break;
    } catch {
      status = null;
      errorCode = 'webhook.network-failed';
    }
    if (attempts < attemptsLimit) await wait(delay * (2 ** (attempts - 1)));
  }
  return { ok: false, attempts, status, errorCode };
}

function isRetryableWebhookStatus(status) {
  return status === 408 || status === 429 || (status != null && status >= 500 && status <= 599);
}

function boundedWebhookText(value, max) {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim().slice(0, max) : '';
}

function validISO(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function isSnoozed(settings, now) {
  const until = settings?.notifications?.snoozedUntilISO;
  if (!until) return false;
  const ts = new Date(until).getTime();
  return Number.isFinite(ts) && ts > now.getTime();
}

function ruleTitle(ruleId, provider, bucket, { catchUp = false } = {}) {
  if (catchUp) return `${humanProvider(provider)} ${humanBucket(bucket)} reset while tracker was asleep`;
  if (ruleId === 'R1-0') return `${humanProvider(provider)} ${humanBucket(bucket)} resetting now`;
  const mins = ruleId === 'R1-60' ? 60 : 15;
  return `${humanProvider(provider)} ${humanBucket(bucket)} resets in ${mins} min`;
}

function ruleBody(ruleId, provider, bucket, { catchUp = false } = {}) {
  if (catchUp) return `The reset window passed during a late refresh. Fresh quota should be available now.`;
  if (ruleId === 'R1-0') return `Fresh quota available — go!`;
  return `Currently ${bucket.percentUsed.toFixed(0)}% used. Resets ${humanReset(bucket)}.`;
}

function localBriefingTime(reference, hour) {
  const scheduled = new Date(reference.getTime());
  scheduled.setHours(Number(hour) || 0, 0, 0, 0);
  return scheduled;
}

function addLocalDays(date, days) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function localDayKey(date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
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
