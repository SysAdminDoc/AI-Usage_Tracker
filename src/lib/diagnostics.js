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
    },
    redaction: {
      history: 'omitted', rawErrors: 'omitted', credentials: 'omitted',
      cookies: 'omitted', prompts: 'omitted',
      identifiers: 'shortened to first/last characters where needed',
    },
  };
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
    source: snapshot.lastSuccessSource || snapshot.source || null,
    lastSuccessISO: snapshot.lastSuccessISO || null,
    lastErrorISO: snapshot.lastErrorISO || null,
    errorCode: snapshot.lastErrorCode || snapshot.errorCode || null,
    identifiers: {
      orgId: redactIdentifier(snapshot.orgId),
      accountId: redactIdentifier(snapshot.accountId),
    },
    buckets: (Array.isArray(snapshot.buckets) ? snapshot.buckets : []).map((bucket) => ({
      id: typeof bucket?.id === 'string' ? bucket.id : null,
      percentUsed: Number.isFinite(Number(bucket?.percentUsed)) ? Number(bucket.percentUsed) : null,
      resetISO: bucket?.resetISO || null,
    })),
  };
}

function redactIdentifier(value) {
  if (value == null || value === '') return null;
  const text = String(value);
  if (text.length <= 4) return '•••';
  return `${text.slice(0, 2)}…${text.slice(-2)}`;
}
