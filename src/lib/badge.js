const DEFAULT_TITLE = 'AI Usage Tracker';
const DEFAULT_ICON = {
  16: 'icons/icon-16.png',
  32: 'icons/icon-32.png',
  48: 'icons/icon-48.png',
  128: 'icons/icon-128.png',
};

const TONES = {
  good: {
    badge: [46, 125, 50, 255],
    icon: '#a6e3a1',
  },
  warn: {
    badge: [180, 83, 9, 255],
    icon: '#f9e2af',
  },
  bad: {
    badge: [185, 28, 28, 255],
    icon: '#f38ba8',
  },
};

const ICON_CACHE = new Map();

export function pickBadgeBucket(state) {
  const providers = state?.snapshot?.providers || {};
  const settings = state?.settings || {};
  let best = null;

  for (const [provider, snapshot] of Object.entries(providers)) {
    if (!snapshot?.ok || settings.showProviders?.[provider] === false) continue;

    for (const bucket of snapshot.buckets || []) {
      if (!bucket || settings.showRows?.[bucket.id] === false) continue;

      const percentUsed = Number(bucket.percentUsed);
      if (!Number.isFinite(percentUsed)) continue;

      const clamped = clampPercent(percentUsed);
      const resetTime = bucket.resetISO ? new Date(bucket.resetISO).getTime() : Number.POSITIVE_INFINITY;
      const candidate = {
        provider,
        bucketId: bucket.id,
        label: bucket.label || bucket.id,
        percentUsed: clamped,
        resetTime: Number.isFinite(resetTime) ? resetTime : Number.POSITIVE_INFINITY,
        tone: badgeTone(clamped),
      };

      if (!best || candidate.percentUsed > best.percentUsed || (
        candidate.percentUsed === best.percentUsed && candidate.resetTime < best.resetTime
      )) {
        best = candidate;
      }
    }
  }

  return best;
}

export function badgeTone(percentUsed) {
  if (percentUsed >= 80) return 'bad';
  if (percentUsed >= 50) return 'warn';
  return 'good';
}

export async function updateToolbarBadge(state) {
  const action = getActionApi();
  if (!action) return;

  const picked = pickBadgeBucket(state);
  if (!picked) {
    await setBadge(action, { text: '', title: DEFAULT_TITLE, tone: null });
    await setDefaultIcon(action);
    return;
  }

  const percent = Math.round(picked.percentUsed);
  const provider = picked.provider === 'claude' ? 'Claude' : 'Codex';
  const title = `${DEFAULT_TITLE} - ${provider} ${picked.label}: ${percent}% used`;
  await setBadge(action, { text: `${percent}%`, title, tone: picked.tone });
  await setToneIcon(action, picked.tone);
}

function clampPercent(percentUsed) {
  return Math.max(0, Math.min(100, percentUsed));
}

async function setBadge(action, { text, title, tone }) {
  await callAction(action, 'setBadgeText', { text });
  await callAction(action, 'setTitle', { title });
  if (tone && TONES[tone]) {
    await callAction(action, 'setBadgeBackgroundColor', { color: TONES[tone].badge });
    await callAction(action, 'setBadgeTextColor', { color: '#ffffff' });
  }
}

async function setToneIcon(action, tone) {
  if (!globalThis.OffscreenCanvas || !TONES[tone]) return;
  try {
    let imageData = ICON_CACHE.get(tone);
    if (!imageData) {
      imageData = drawIconSet(TONES[tone].icon);
      ICON_CACHE.set(tone, imageData);
    }
    await callAction(action, 'setIcon', { imageData });
  } catch {
    await setDefaultIcon(action);
  }
}

async function setDefaultIcon(action) {
  await callAction(action, 'setIcon', { path: DEFAULT_ICON });
}

async function callAction(action, method, details) {
  const fn = action?.[method];
  if (typeof fn !== 'function') return;
  try {
    const result = fn.call(action, details);
    if (result && typeof result.then === 'function') await result;
  } catch {
    // Browser action support varies between Chrome and Firefox; badge updates are non-critical.
  }
}

function getActionApi() {
  return (typeof browser !== 'undefined' && browser.action)
    || (typeof chrome !== 'undefined' && chrome.action)
    || null;
}

function drawIconSet(accent) {
  const out = {};
  for (const size of [16, 32, 48, 128]) {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    drawIcon(ctx, size, accent);
    out[size] = ctx.getImageData(0, 0, size, size);
  }
  return out;
}

function drawIcon(ctx, size, accent) {
  const cx = size / 2;
  const cy = size / 2;
  const pad = Math.max(1, size * 0.08);
  const radius = size * 0.18;
  const ringRadius = size * 0.32;

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(30, 30, 46, 0.92)';
  roundRect(ctx, pad, pad, size - pad * 2, size - pad * 2, radius);
  ctx.fill();

  ctx.strokeStyle = 'rgba(180, 190, 254, 0.42)';
  ctx.lineWidth = Math.max(1, size * 0.035);
  roundRect(ctx, pad, pad, size - pad * 2, size - pad * 2, radius);
  ctx.stroke();

  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(2, size * 0.09);
  ctx.beginPath();
  ctx.arc(cx, cy, ringRadius, -Math.PI / 2, Math.PI * 1.35);
  ctx.stroke();

  ctx.fillStyle = '#cdd6f4';
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(1.5, size * 0.08), 0, Math.PI * 2);
  ctx.fill();
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}
