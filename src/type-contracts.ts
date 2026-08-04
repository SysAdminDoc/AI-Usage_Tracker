import type {
  HistorySample,
  NotificationSettings,
  ProviderId,
  ProviderSnapshot,
  QuotaBucket,
  TrackerSettings,
  TrackerSnapshot,
  TrackerState,
  WidgetState,
  BudgetLedger,
} from './types.js';

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  'R1-60': true,
  'R1-15': true,
  'R1-0': true,
  R2: true,
  'U1-75': false,
  'U1-90': true,
  'U1-95': true,
  U2: true,
  U3: false,
  D1: true,
  dailyBriefingHour: 8,
};

export const DEFAULT_TRACKER_SETTINGS: TrackerSettings = {
  refreshMinutes: 5,
  silentTabRefresh: false,
  nativeSchedulerEnabled: false,
  highContrast: false,
  showProviders: { claude: true, codex: true },
  showRows: {},
  notifications: DEFAULT_NOTIFICATION_SETTINGS,
  theme: 'mocha',
  thresholds: { warnAt: 50, dangerAt: 80 },
  anomalyThresholdPercent: 20,
  historyRetentionDays: 30,
  apiBudget: { sessionCapUSD: 0, dailyCapUSD: 0 },
};

export function typedBucket(input: Pick<QuotaBucket, 'id' | 'label' | 'percentUsed'>): QuotaBucket {
  return {
    id: input.id,
    label: input.label,
    kind: 'unknown',
    model: null,
    percentUsed: Math.max(0, Math.min(100, input.percentUsed)),
    resetISO: null,
  };
}

export function typedProvider(provider: ProviderId, buckets: QuotaBucket[]): ProviderSnapshot {
  return { ok: true, provider, source: 'api', buckets };
}

export function typedSnapshot(providers: Partial<Record<ProviderId, ProviderSnapshot>> = {}): TrackerSnapshot {
  return {
    fetchedAtISO: null,
    providers,
  };
}

export function typedHistory(history: readonly HistorySample[] = []): HistorySample[] {
  return history.map((sample) => ({
    ts: sample.ts,
    bucketId: sample.bucketId,
    percentUsed: Math.max(0, Math.min(100, sample.percentUsed)),
  }));
}

export function typedState(snapshot = typedSnapshot(), history: HistorySample[] = []): TrackerState {
  const widget: WidgetState = { x: null, y: null, minimized: false };
  return {
    stateVersion: 2,
    snapshot,
    history: typedHistory(history),
    firedRules: {},
    settings: DEFAULT_TRACKER_SETTINGS,
    widget,
    budget: {
      version: 1,
      sessionStartedISO: '1970-01-01T00:00:00.000Z',
      sessionSpentUSD: 0,
      dailyKey: '1970-01-01',
      dailySpentUSD: 0,
      lastTotals: {},
    } satisfies BudgetLedger,
  };
}
