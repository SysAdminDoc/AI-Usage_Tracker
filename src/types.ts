export type ProviderId = 'claude' | 'codex' | 'anthropic-api' | 'openai-api' | 'github-copilot' | 'cursor' | 'gemini' | 'openrouter';

export type UsageSource = 'api' | 'dom' | 'html' | 'live' | 'fetch' | 'stream' | 'headers' | string;

export interface QuotaBucket {
  id: string;
  label: string;
  kind: string;
  model: string | null;
  percentUsed: number;
  resetISO: string | null;
  rawResetText?: string | null;
  metric?: {
    kind: 'tokens' | 'currency' | 'requests' | string;
    totalTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    requests?: number;
    costUSD?: number;
    costSource?: 'official' | 'pricing-table' | string;
    pricingVersion?: string;
    activeDays?: number;
    subscriptionIncludedReqs?: number;
    usageBasedReqs?: number;
    apiKeyReqs?: number;
    memberCount?: number;
    lastActivityISO?: string | null;
    [key: string]: number | string | null | undefined;
  };
  dimensions?: Record<string, string | null>;
}

export interface ProviderSnapshot {
  ok: boolean;
  provider?: ProviderId;
  source?: UsageSource | null;
  lastSuccessSource?: UsageSource | null;
  lastSuccessISO?: string | null;
  lastErrorISO?: string | null;
  lastErrorCode?: string | null;
  lastErrorDetail?: string | null;
  refreshBackoffLevel?: number;
  nextRetryISO?: string | null;
  refreshSkippedReason?: string | null;
  error?: string | null;
  errorCode?: string | null;
  stale?: boolean;
  plan?: string | null;
  orgId?: string | null;
  accountId?: string | null;
  buckets: QuotaBucket[];
  [key: string]: unknown;
}

export interface TrackerSnapshot {
  fetchedAtISO: string | null;
  providers: Partial<Record<ProviderId, ProviderSnapshot | null>>;
}

export interface HistorySample {
  ts: number;
  bucketId: string;
  percentUsed: number;
}

export interface NotificationSettings {
  'R1-60': boolean;
  'R1-15': boolean;
  'R1-0': boolean;
  R2: boolean;
  'U1-75': boolean;
  'U1-90': boolean;
  'U1-95': boolean;
  U2: boolean;
  U3: boolean;
  D1: boolean;
  dailyBriefingHour: number;
  snoozedUntilISO?: string;
  [key: string]: boolean | number | string | undefined;
}

export interface TrackerSettings {
  refreshMinutes: 1 | 5 | 15 | 30;
  silentTabRefresh: boolean;
  nativeSchedulerEnabled: boolean;
  highContrast: boolean;
  showProviders: Record<string, boolean>;
  showRows: Record<string, boolean>;
  notifications: NotificationSettings;
  theme: 'mocha' | 'latte' | 'system';
  thresholds: { warnAt: number; dangerAt: number };
  anomalyThresholdPercent?: number;
  historyRetentionDays: 7 | 14 | 30 | 60 | 90;
  apiBudget: ApiBudgetSettings;
  syncSettings?: boolean;
  githubCopilotOrganization?: string;
  githubCopilotUsername?: string;
  geminiProjectId?: string;
}

export interface ApiBudgetSettings {
  sessionCapUSD: number;
  dailyCapUSD: number;
}

export interface BudgetLedger {
  version: number;
  sessionStartedISO: string;
  sessionSpentUSD: number;
  dailyKey: string;
  dailySpentUSD: number;
  lastTotals: Record<string, { amountUSD: number; source: 'official' | 'estimated' }>;
}

export interface CollaborationProviderTotal {
  provider: ProviderId;
  providerLabel: string;
  costUSD: number | null;
  costSource: 'official' | 'estimated' | null;
  totalTokens: number | null;
  requests: number | null;
  activeDays: number | null;
}

export interface CollaborationAttribution {
  enabled: boolean;
  clientName: string;
  projectName: string;
  branchName: string;
}

export interface CollaborationContribution {
  id: string;
  memberLabel: string;
  exportedAtISO: string | null;
  periodStartISO: string | null;
  periodEndISO: string | null;
  providers: CollaborationProviderTotal[];
  attribution: CollaborationAttribution | null;
}

export interface CollaborationLedger {
  schema: string;
  version: number;
  kind: 'ledger';
  teamName: string;
  periodStartISO: string | null;
  periodEndISO: string | null;
  contributions: CollaborationContribution[];
}

export interface CollaborationState {
  enabled: boolean;
  teamName: string;
  memberName: string;
  attribution: CollaborationAttribution;
  ledger: CollaborationLedger;
}

export interface WidgetState {
  x: number | null;
  y: number | null;
  minimized: boolean;
}

export interface CacheReuseEvent {
  sampledAtISO: string;
  reused: boolean;
  source?: string;
}

export interface ClaudeCacheState {
  provider?: 'claude' | string;
  cachedUntilISO?: string | null;
  windowMs?: number;
  source?: string;
  sampledAtISO?: string;
  reuseEvents?: CacheReuseEvent[];
}

export interface TrackerState {
  stateVersion: number;
  snapshot: TrackerSnapshot;
  history: HistorySample[];
  firedRules: Record<string, number>;
  settings: TrackerSettings;
  widget: WidgetState;
  budget: BudgetLedger;
  collaboration?: CollaborationState;
  cache?: { claude?: ClaudeCacheState; [key: string]: unknown };
  [key: string]: unknown;
}

export interface NotificationCandidate {
  fireKey: string;
  ruleId: string;
  provider: ProviderId;
  title: string;
  body: string;
  tone: 'info' | 'warn' | 'bad';
  catchUp?: boolean;
}
