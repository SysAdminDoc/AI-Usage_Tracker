// Reset-string parser + tick helpers.
// Resolves every variant Claude or Codex shows into an ISO timestamp in the
// user's local timezone. UI code re-derives a relative string from the ISO.

const WEEKDAYS = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};
const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

export function parseResetString(raw, { now = new Date() } = {}) {
  if (!raw) return null;
  const text = String(raw).trim();

  // 1) "Resets in 1 hr 5 min" / "Resets in 45 min" / "Resets in 3 hr".
  const dur = /^Resets\s+in\s+(?:(\d+)\s*hr)?\s*(?:(\d+)\s*min)?/i.exec(text);
  if (dur && (dur[1] || dur[2])) {
    const hours = parseInt(dur[1] || '0', 10);
    const mins = parseInt(dur[2] || '0', 10);
    const target = new Date(now.getTime() + (hours * 60 + mins) * 60_000);
    return target.toISOString();
  }

  // 2) "Resets May 19, 2026 2:05 AM" — absolute date.
  const abs = /^Resets\s+([A-Za-z]{3,9})\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*([AP]M)/i.exec(text);
  if (abs) {
    const month = MONTHS[abs[1].slice(0, 3).toLowerCase()];
    if (month != null) {
      const day = parseInt(abs[2], 10);
      const year = parseInt(abs[3], 10);
      const { h, m } = to24h(parseInt(abs[4], 10), parseInt(abs[5], 10), abs[6]);
      return new Date(year, month, day, h, m, 0, 0).toISOString();
    }
  }

  // 3) "Resets Tue 1:00 PM" — next occurrence of weekday at time.
  const wkly = /^Resets\s+([A-Za-z]{3,9})\s+(\d{1,2}):(\d{2})\s*([AP]M)/i.exec(text);
  if (wkly) {
    const targetDay = WEEKDAYS[wkly[1].slice(0, 3).toLowerCase()];
    if (targetDay != null) {
      const { h, m } = to24h(parseInt(wkly[2], 10), parseInt(wkly[3], 10), wkly[4]);
      return nextWeekdayAt(now, targetDay, h, m).toISOString();
    }
  }

  // 4) "Resets 3:34 PM" — next occurrence of time (today or tomorrow).
  const tod = /^Resets\s+(\d{1,2}):(\d{2})\s*([AP]M)/i.exec(text);
  if (tod) {
    const { h, m } = to24h(parseInt(tod[1], 10), parseInt(tod[2], 10), tod[3]);
    const candidate = new Date(now);
    candidate.setHours(h, m, 0, 0);
    if (candidate.getTime() <= now.getTime()) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate.toISOString();
  }

  return null;
}

function to24h(h12, m, ampm) {
  let h = h12 % 12;
  if (/PM/i.test(ampm)) h += 12;
  return { h, m };
}

function nextWeekdayAt(now, targetDay, h, m) {
  const result = new Date(now);
  const currentDay = result.getDay();
  let delta = (targetDay - currentDay + 7) % 7;
  result.setHours(h, m, 0, 0);
  if (delta === 0 && result.getTime() <= now.getTime()) {
    delta = 7;
  }
  result.setDate(result.getDate() + delta);
  return result;
}

// Pretty short string for the widget: "3h 5m", "12m 4s", "now".
export function formatCountdown(targetISO, { now = new Date() } = {}) {
  if (!targetISO) return '—';
  const ms = new Date(targetISO).getTime() - now.getTime();
  if (ms <= 0) return 'now';
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86_400);
  const h = Math.floor((totalSec % 86_400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, '0')}s`;
  return `${s}s`;
}

// Long-form "Resets Tuesday at 1:00 PM (in 4d 17h)".
export function formatResetAbsolute(targetISO) {
  if (!targetISO) return '—';
  const d = new Date(targetISO);
  const opts = { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  return d.toLocaleString(undefined, opts);
}

// Color ramp for the radial ring based on remaining headroom (percent FREE).
// percentUsed 0-50  → green
// 50-80  → amber
// 80-100 → red
const DEFAULT_THRESHOLDS = {
  warnAt: 50,
  dangerAt: 80,
};

export function normalizeThresholds(input = {}) {
  const source = input?.thresholds || input || {};
  let warnAt = Number(source.warnAt ?? DEFAULT_THRESHOLDS.warnAt);
  let dangerAt = Number(source.dangerAt ?? DEFAULT_THRESHOLDS.dangerAt);
  if (!Number.isFinite(warnAt)) warnAt = DEFAULT_THRESHOLDS.warnAt;
  if (!Number.isFinite(dangerAt)) dangerAt = DEFAULT_THRESHOLDS.dangerAt;
  warnAt = Math.max(1, Math.min(98, warnAt));
  dangerAt = Math.max(warnAt + 1, Math.min(99, dangerAt));
  return { warnAt, dangerAt };
}

export function ringColor(percentUsed, thresholds) {
  const t = normalizeThresholds(thresholds);
  if (percentUsed >= t.dangerAt) return 'var(--aut-red)';
  if (percentUsed >= t.warnAt) return 'var(--aut-amber)';
  return 'var(--aut-green)';
}
