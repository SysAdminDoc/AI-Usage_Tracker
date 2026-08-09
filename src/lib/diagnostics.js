const DIAGNOSTICS_SCHEMA = 'ai-usage-tracker.diagnostics';
const DIAGNOSTICS_VERSION = 1;

/**
 * Build a support-safe snapshot. Raw provider errors, history, credentials,
 * cookies, prompts, and full identifiers are intentionally not represented.
 */
export function buildSupportBundle({ state = {}, usage = {}, version = 'unknown', channel = 'unknown', manifest = null } = {}) {
  const providers = state?.snapshot?.providers || {};
  const manifestPermissions = manifest && typeof manifest === 'object'
    ? {
      api: [...(manifest.permissions || [])].sort(),
      hosts: [...(manifest.host_permissions || [])].sort(),
    }
    : { api: [], hosts: [] };
  return {
    schema: DIAGNOSTICS_SCHEMA,
    schemaVersion: DIAGNOSTICS_VERSION,
    generatedAtISO: new Date().toISOString(),
    app: { version, channel, permissions: manifestPermissions },
    snapshot: {
      fetchedAtISO: state?.snapshot?.fetchedAtISO || null,
      providers: Object.fromEntries(Object.entries(providers).map(([provider, snapshot]) => [
        provider,
        providerSupportSummary(snapshot),
      ])),
    },
    settings: {
      refreshMinutes: Number(state?.settings?.refreshMinutes) || 5,
      silentTabRefresh: state?.settings?.silentTabRefresh === true,
      theme: state?.settings?.theme || 'mocha',
      highContrast: state?.settings?.highContrast === true,
      thresholds: state?.settings?.thresholds || { warnAt: 50, dangerAt: 80 },
    },
    storage: {
      bytes: Number.isFinite(Number(usage.bytes)) ? Number(usage.bytes) : null,
      quotaBytes: Number.isFinite(Number(usage.quotaBytes)) ? Number(usage.quotaBytes) : null,
      source: usage.source || 'unavailable',
      degraded: usage.degraded === true,
      warningCode: typeof usage.warningCode === 'string' ? usage.warningCode : null,
      writes: writeDiagnosticsSummary(usage.writes),
      history: usage.history ? {
        sampleCount: Number(usage.history.sampleCount) || 0,
        byteCount: Number(usage.history.byteCount) || 0,
        maxSamples: Number(usage.history.maxSamples) || null,
        maxBytes: Number(usage.history.maxBytes) || null,
        degraded: usage.history.degraded === true,
      } : null,
    },
    redaction: {
      history: 'omitted', rawErrors: 'omitted', credentials: 'omitted',
      cookies: 'omitted', prompts: 'omitted',
      identifiers: 'shortened to first/last characters where needed',
    },
  };
}

function writeDiagnosticsSummary(writes) {
  if (!writes || typeof writes !== 'object') return null;
  const summarize = (entry) => {
    if (!entry || typeof entry !== 'object') return null;
    return {
      attempts: Math.max(0, Number(entry.attempts) || 0),
      successes: Math.max(0, Number(entry.successes) || 0),
      failures: Math.max(0, Number(entry.failures) || 0),
      bytes: Math.max(0, Number(entry.bytes) || 0),
      lastBytes: Math.max(0, Number(entry.lastBytes) || 0),
    };
  };
  return { state: summarize(writes.state), sync: summarize(writes.sync) };
}

function providerSupportSummary(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return {
    present: false, ok: false, stale: false, source: null,
    lastSuccessISO: null, lastErrorISO: null, errorCode: null,
    identifiers: {}, buckets: [],
  };
  return {
    present: true,
    ok: snapshot.ok === true,
    stale: snapshot.stale === true,
    staleReason: snapshot.staleReason || null,
    source: snapshot.lastSuccessSource || snapshot.source || null,
    lastSuccessISO: snapshot.lastSuccessISO || null,
    lastErrorISO: snapshot.lastErrorISO || null,
    errorCode: snapshot.lastErrorCode || snapshot.errorCode || null,
    schemaVersion: Number.isInteger(snapshot.schemaVersion) ? snapshot.schemaVersion : null,
    schemaFingerprint: typeof snapshot.schemaFingerprint === 'string' ? snapshot.schemaFingerprint : null,
    lastErrorSchemaVersion: Number.isInteger(snapshot.lastErrorSchemaVersion)
      ? snapshot.lastErrorSchemaVersion : null,
    lastErrorSchemaFingerprint: typeof snapshot.lastErrorSchemaFingerprint === 'string'
      ? snapshot.lastErrorSchemaFingerprint : null,
    identifiers: {
      orgId: redactIdentifier(snapshot.orgId),
      accountId: redactIdentifier(snapshot.accountId),
    },
    buckets: (Array.isArray(snapshot.buckets) ? snapshot.buckets : []).map((bucket) => ({
      id: typeof bucket?.id === 'string' ? bucket.id : null,
      percentUsed: Number.isFinite(Number(bucket?.percentUsed)) ? Number(bucket.percentUsed) : null,
      resetISO: bucket?.resetISO || null,
      metric: sanitizeMetric(bucket?.metric),
      dimensions: sanitizeDimensions(bucket?.dimensions),
    })),
  };
}

function sanitizeMetric(metric) {
  if (!metric || typeof metric !== 'object' || Array.isArray(metric)) return null;
  const safe = { kind: typeof metric.kind === 'string' ? metric.kind : 'unknown' };
  for (const key of [
    'totalTokens', 'inputTokens', 'outputTokens', 'cachedInputTokens',
    'cacheReadTokens', 'cacheCreationTokens', 'requests', 'webSearchRequests', 'costUSD',
    'activeDays', 'subscriptionIncludedReqs', 'usageBasedReqs', 'apiKeyReqs', 'memberCount',
  ]) {
    if (Number.isFinite(Number(metric[key]))) safe[key] = Number(metric[key]);
  }
  if (metric.costSource === 'official' || metric.costSource === 'pricing-table') {
    safe.costSource = metric.costSource;
  }
  if (typeof metric.pricingVersion === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(metric.pricingVersion)) {
    safe.pricingVersion = metric.pricingVersion;
  }
  return safe;
}

function sanitizeDimensions(dimensions) {
  if (!dimensions || typeof dimensions !== 'object' || Array.isArray(dimensions)) return {};
  return Object.fromEntries(Object.entries(dimensions)
    .filter(([, value]) => value != null && value !== '')
    .map(([key, value]) => [key, redactIdentifier(value)]));
}

function redactIdentifier(value) {
  if (value == null || value === '') return null;
  const text = String(value);
  if (text.length <= 4) return '•••';
  return `${text.slice(0, 2)}…${text.slice(-2)}`;
}
