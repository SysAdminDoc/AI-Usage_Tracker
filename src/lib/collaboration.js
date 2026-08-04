import { extractProviderCost } from './forecast.js';
import { API_PROVIDER_IDS, API_PROVIDER_META } from '../providers/api-contract.js';

export const COLLABORATION_SCHEMA = 'ai-usage-tracker.collaboration';
export const COLLABORATION_VERSION = 1;

const MAX_CONTRIBUTIONS = 128;
const MAX_LABEL_LENGTH = 64;

/**
 * The collaboration contract is deliberately file-based and narrow. It is
 * not a transport adapter: the app never sends this payload anywhere.
 */
export function defaultCollaborationState() {
  return {
    enabled: false,
    teamName: '',
    memberName: '',
    attribution: defaultAttribution(),
    ledger: emptyLedger(),
  };
}

export function normalizeCollaborationState(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const ledger = normalizeLedger(source.ledger);
  return {
    enabled: source.enabled === true,
    teamName: safeLabel(source.teamName),
    memberName: safeLabel(source.memberName),
    attribution: normalizeAttribution(source.attribution),
    ledger,
  };
}

export function buildCollaborationContribution(snapshot = {}, {
  teamName = '',
  memberName = '',
  attribution = null,
  now = new Date(),
} = {}) {
  const nowISO = asISO(now) || new Date().toISOString();
  const providers = [];
  const rangeStarts = [];
  const rangeEnds = [];

  for (const provider of API_PROVIDER_IDS) {
    const providerSnapshot = snapshot?.providers?.[provider];
    if (!providerSnapshot?.ok) continue;

    const cost = extractProviderCost(providerSnapshot);
    const buckets = Array.isArray(providerSnapshot.buckets) ? providerSnapshot.buckets : [];
    const metrics = buckets.reduce((totals, bucket) => {
      const metric = bucket?.metric;
      if (!metric || typeof metric !== 'object' || Array.isArray(metric)) return totals;
      totals.totalTokens += finiteAmount(metric.totalTokens) || 0;
      totals.requests += finiteAmount(metric.requests) || 0;
      totals.activeDays = Math.max(totals.activeDays, finiteAmount(metric.activeDays) || 0);
      return totals;
    }, { totalTokens: 0, requests: 0, activeDays: 0 });

    if (!cost && metrics.totalTokens === 0 && metrics.requests === 0) continue;
    const startISO = asISO(providerSnapshot.range?.startISO);
    const endISO = asISO(providerSnapshot.range?.endISO) || asISO(providerSnapshot.lastSuccessISO) || nowISO;
    if (startISO) rangeStarts.push(startISO);
    if (endISO) rangeEnds.push(endISO);
    providers.push({
      provider,
      providerLabel: API_PROVIDER_META[provider]?.label || provider,
      costUSD: cost?.amountUSD ?? null,
      costSource: cost?.source || null,
      totalTokens: metrics.totalTokens || null,
      requests: metrics.requests || null,
      activeDays: metrics.activeDays || null,
    });
  }

  const periodStartISO = minISO(rangeStarts) || monthStartISO(nowISO);
  const periodEndISO = maxISO(rangeEnds) || nowISO;
  const normalizedAttribution = normalizeAttribution(attribution);
  const contributionInput = {
    memberLabel: memberName || 'Local member',
    exportedAtISO: nowISO,
    periodStartISO,
    periodEndISO,
    providers,
  };
  if (hasAttribution(normalizedAttribution)) contributionInput.attribution = normalizedAttribution;
  const contribution = normalizeContribution(contributionInput);

  return {
    schema: COLLABORATION_SCHEMA,
    version: COLLABORATION_VERSION,
    kind: 'contribution',
    teamName: safeLabel(teamName) || 'Local team',
    contribution,
    redaction: redactionContract(),
  };
}

export function normalizeCollaborationImport(input) {
  let payload = input;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { throw new Error('Collaboration file is not valid JSON'); }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Collaboration import must be a JSON object');
  }
  if (payload.schema !== COLLABORATION_SCHEMA || payload.version !== COLLABORATION_VERSION) {
    throw new Error(`Unsupported collaboration schema: ${String(payload.schema || 'missing')}`);
  }
  if (payload.kind === 'contribution') {
    return {
      teamName: safeLabel(payload.teamName),
      contributions: [normalizeContribution(payload.contribution)],
    };
  }
  if (payload.kind === 'ledger') {
    const ledger = normalizeLedger(payload);
    return { teamName: ledger.teamName, contributions: ledger.contributions };
  }
  throw new Error('Collaboration import kind must be contribution or ledger');
}

export function mergeCollaborationImport(current = {}, input) {
  const existing = normalizeCollaborationState(current);
  const incoming = normalizeCollaborationImport(input);
  const contributions = dedupeContributions([
    ...existing.ledger.contributions,
    ...incoming.contributions,
  ]).slice(-MAX_CONTRIBUTIONS);
  const teamName = existing.teamName || incoming.teamName || existing.ledger.teamName;
  return {
    ...existing,
    enabled: true,
    teamName,
    ledger: buildLedger(teamName, contributions),
  };
}

export function buildCollaborationLedger(collaboration = {}) {
  const state = normalizeCollaborationState(collaboration);
  return {
    schema: COLLABORATION_SCHEMA,
    version: COLLABORATION_VERSION,
    kind: 'ledger',
    teamName: state.teamName || state.ledger.teamName || 'Local team',
    periodStartISO: state.ledger.periodStartISO,
    periodEndISO: state.ledger.periodEndISO,
    contributions: state.ledger.contributions,
    redaction: redactionContract(),
  };
}

export function buildCollaborationInvoiceRows(collaboration = {}) {
  const state = normalizeCollaborationState(collaboration);
  const rows = [];
  for (const contribution of state.ledger.contributions) {
    if (!hasAttribution(contribution.attribution)) continue;
    const attribution = normalizeAttribution(contribution.attribution);
    for (const provider of contribution.providers) {
      rows.push({
        clientName: attribution.clientName,
        projectName: attribution.projectName,
        branchName: attribution.branchName,
        memberLabel: contribution.memberLabel,
        provider: provider.provider,
        providerLabel: provider.providerLabel,
        costUSD: provider.costUSD,
        totalTokens: provider.totalTokens,
        requests: provider.requests,
        costSource: provider.costSource,
        periodStartISO: contribution.periodStartISO,
        periodEndISO: contribution.periodEndISO,
      });
    }
  }
  return rows;
}

export function collaborationToCSV(collaboration = {}) {
  const rows = buildCollaborationInvoiceRows(collaboration);
  const output = ['client,project,branch,member,provider,providerLabel,costUSD,totalTokens,requests,costSource,periodStartISO,periodEndISO'];
  for (const row of rows) {
    output.push([
      row.clientName,
      row.projectName,
      row.branchName,
      row.memberLabel,
      row.provider,
      row.providerLabel,
      row.costUSD == null ? '' : row.costUSD,
      row.totalTokens == null ? '' : row.totalTokens,
      row.requests == null ? '' : row.requests,
      row.costSource || '',
      row.periodStartISO || '',
      row.periodEndISO || '',
    ].map(csvCell).join(','));
  }
  return `${output.join('\r\n')}\r\n`;
}

export function buildCollaborationDashboard(collaboration = {}) {
  const state = normalizeCollaborationState(collaboration);
  const contributions = state.ledger.contributions;
  if (!state.enabled) return emptyDashboard('disabled', state);
  if (!contributions.length) return emptyDashboard('empty', state);

  const members = new Map();
  const providers = new Map();
  const attribution = new Map();
  for (const contribution of contributions) {
    const member = members.get(contribution.memberLabel) || emptyAggregate(contribution.memberLabel);
    member.contributionCount += 1;
    for (const row of contribution.providers) {
      addAggregate(member, row);
      const provider = providers.get(row.provider)
        || emptyAggregate(API_PROVIDER_META[row.provider]?.label || row.provider);
      provider.contributorCount += 1;
      addAggregate(provider, row);
      providers.set(row.provider, provider);
    }
    if (hasAttribution(contribution.attribution)) {
      const details = normalizeAttribution(contribution.attribution);
      const key = `${details.clientName}\u0000${details.projectName}\u0000${details.branchName}`;
      const attributed = attribution.get(key) || {
        ...emptyAggregate(''),
        clientName: details.clientName,
        projectName: details.projectName,
        branchName: details.branchName,
        members: new Set(),
      };
      attributed.contributionCount += 1;
      attributed.members.add(contribution.memberLabel);
      for (const row of contribution.providers) addAggregate(attributed, row);
      attribution.set(key, attributed);
    }
    members.set(contribution.memberLabel, member);
  }

  const total = emptyAggregate('Team total');
  for (const aggregate of members.values()) addAggregate(total, aggregate);
  total.contributionCount = contributions.length;
  total.contributorCount = members.size;
  return {
    status: 'ready',
    enabled: true,
    teamName: state.teamName || state.ledger.teamName || 'Local team',
    contributionCount: contributions.length,
    memberCount: members.size,
    periodStartISO: state.ledger.periodStartISO,
    periodEndISO: state.ledger.periodEndISO,
    total: finalizeAggregate(total),
    members: [...members.values()].map(finalizeAggregate).sort(sortAggregate),
    providers: [...providers.entries()]
      .map(([provider, aggregate]) => ({ provider, ...finalizeAggregate(aggregate) }))
      .sort(sortAggregate),
    attributionRows: [...attribution.values()].map(finalizeAttributionAggregate).sort(sortAttribution),
  };
}

function emptyDashboard(status, state) {
  return {
    status,
    enabled: state.enabled,
    teamName: state.teamName || state.ledger.teamName || 'Local team',
    contributionCount: state.ledger.contributions.length,
    memberCount: new Set(state.ledger.contributions.map((item) => item.memberLabel)).size,
    periodStartISO: state.ledger.periodStartISO,
    periodEndISO: state.ledger.periodEndISO,
    total: finalizeAggregate(emptyAggregate('Team total')),
    members: [],
    providers: [],
    attributionRows: [],
  };
}

function emptyLedger() {
  return {
    schema: COLLABORATION_SCHEMA,
    version: COLLABORATION_VERSION,
    kind: 'ledger',
    teamName: '',
    periodStartISO: null,
    periodEndISO: null,
    contributions: [],
  };
}

function normalizeLedger(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return emptyLedger();
  const contributions = Array.isArray(input.contributions)
    ? dedupeContributions(input.contributions.map(normalizeContribution)).slice(-MAX_CONTRIBUTIONS)
    : [];
  const ledger = buildLedger(safeLabel(input.teamName), contributions);
  return ledger;
}

function buildLedger(teamName, contributions) {
  const starts = contributions.map((item) => item.periodStartISO).filter(Boolean);
  const ends = contributions.map((item) => item.periodEndISO).filter(Boolean);
  return {
    schema: COLLABORATION_SCHEMA,
    version: COLLABORATION_VERSION,
    kind: 'ledger',
    teamName: safeLabel(teamName),
    periodStartISO: minISO(starts),
    periodEndISO: maxISO(ends),
    contributions,
  };
}

function normalizeContribution(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Collaboration contribution is missing');
  }
  const providers = Array.isArray(input.providers)
    ? input.providers.map(normalizeProvider).filter(Boolean)
    : [];
  const contribution = {
    memberLabel: safeLabel(input.memberLabel) || 'Local member',
    exportedAtISO: asISO(input.exportedAtISO),
    periodStartISO: asISO(input.periodStartISO),
    periodEndISO: asISO(input.periodEndISO),
    providers,
    attribution: hasAttribution(input.attribution) ? normalizeAttribution(input.attribution) : null,
  };
  contribution.id = stableContributionId(contribution);
  return contribution;
}

function normalizeProvider(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
      || !API_PROVIDER_IDS.includes(input.provider)) return null;
  const row = {
    provider: input.provider,
    providerLabel: API_PROVIDER_META[input.provider]?.label || input.provider,
    costUSD: finiteAmount(input.costUSD),
    costSource: input.costSource === 'official' || input.costSource === 'estimated' ? input.costSource : null,
    totalTokens: finiteAmount(input.totalTokens),
    requests: finiteAmount(input.requests),
    activeDays: finiteAmount(input.activeDays),
  };
  return row.costUSD == null && row.totalTokens == null && row.requests == null ? null : row;
}

function emptyAggregate(label) {
  return {
    label,
    contributionCount: 0,
    contributorCount: 0,
    costUSD: 0,
    totalTokens: 0,
    requests: 0,
    activeDays: 0,
    costSources: new Set(),
  };
}

function addAggregate(target, row) {
  target.costUSD += finiteAmount(row.costUSD) || 0;
  target.totalTokens += finiteAmount(row.totalTokens) || 0;
  target.requests += finiteAmount(row.requests) || 0;
  target.activeDays = Math.max(target.activeDays, finiteAmount(row.activeDays) || 0);
  if (row.costSource) target.costSources.add(row.costSource);
  if (row.costSources instanceof Set) {
    for (const source of row.costSources) target.costSources.add(source);
  }
  if (row.source && row.source !== 'mixed') target.costSources.add(row.source);
}

function finalizeAggregate(aggregate) {
  return {
    label: aggregate.label,
    contributionCount: aggregate.contributionCount,
    contributorCount: aggregate.contributorCount,
    costUSD: round(aggregate.costUSD),
    totalTokens: round(aggregate.totalTokens),
    requests: round(aggregate.requests),
    activeDays: round(aggregate.activeDays),
    source: aggregate.costSources.size === 1 ? [...aggregate.costSources][0] : aggregate.costSources.size ? 'mixed' : null,
  };
}

function finalizeAttributionAggregate(aggregate) {
  return {
    clientName: aggregate.clientName,
    projectName: aggregate.projectName,
    branchName: aggregate.branchName,
    memberCount: aggregate.members.size,
    ...finalizeAggregate(aggregate),
  };
}

function dedupeContributions(contributions) {
  const byId = new Map();
  for (const contribution of contributions) {
    if (contribution?.id) byId.set(contribution.id, contribution);
  }
  return [...byId.values()];
}

function stableContributionId(contribution) {
  const material = JSON.stringify({
    memberLabel: contribution.memberLabel,
    periodStartISO: contribution.periodStartISO,
    periodEndISO: contribution.periodEndISO,
    attribution: contribution.attribution,
    providers: contribution.providers,
  });
  let hash = 2166136261;
  for (let index = 0; index < material.length; index += 1) {
    hash ^= material.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `contribution-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function sortAggregate(a, b) {
  return b.costUSD - a.costUSD || b.requests - a.requests || a.label.localeCompare(b.label);
}

function sortAttribution(a, b) {
  return b.costUSD - a.costUSD
    || a.clientName.localeCompare(b.clientName)
    || a.projectName.localeCompare(b.projectName)
    || a.branchName.localeCompare(b.branchName);
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function redactionContract() {
  return {
    prompts: 'omitted',
    code: 'omitted',
    credentials: 'omitted',
    projectPaths: 'omitted',
    branchNames: 'opt-in labels only',
    clientNames: 'opt-in labels only',
    transport: 'local-file-only',
  };
}

function defaultAttribution() {
  return {
    enabled: false,
    clientName: '',
    projectName: '',
    branchName: '',
  };
}

function normalizeAttribution(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    enabled: source.enabled === true,
    clientName: safeLabel(source.clientName),
    projectName: safeLabel(source.projectName),
    branchName: safeLabel(source.branchName),
  };
}

function hasAttribution(input) {
  const attribution = normalizeAttribution(input);
  return attribution.enabled
    && !!(attribution.clientName || attribution.projectName || attribution.branchName);
}

function safeLabel(value) {
  return value == null ? '' : String(value).replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL_LENGTH);
}

function finiteAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function asISO(value) {
  if (value instanceof Date) {
    const date = new Date(value.getTime());
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function minISO(values) {
  return values.filter(Boolean).sort()[0] || null;
}

function maxISO(values) {
  return values.filter(Boolean).sort().at(-1) || null;
}

function monthStartISO(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString()
    : null;
}

function round(value) {
  return Math.round(Number(value) * 100) / 100;
}
