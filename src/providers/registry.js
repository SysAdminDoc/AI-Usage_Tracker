import { API_PROVIDER_IDS, API_PROVIDER_META, apiFailure } from './api-contract.js';
import {
  fetchAnthropicData,
  parseAnthropicResponse,
} from './anthropic.js';
import {
  fetchOpenAIData,
  parseOpenAIResponse,
} from './openai.js';
import {
  fetchGitHubCopilotData,
  parseGitHubCopilotUsage,
} from './github-copilot.js';
import {
  fetchCursorData,
  parseCursorResponse,
} from './cursor.js';
import {
  fetchGeminiData,
  parseGeminiResponse,
} from './gemini.js';
import {
  fetchOpenRouterData,
  parseOpenRouterResponse,
} from './openrouter.js';
import {
  credentialAuth,
  defineProviderPlugin,
  normalizeProviderSnapshot,
  runProviderPlugin,
  validateProviderPlugin,
} from './plugin-api.js';

const builtInPlugins = [
  defineProviderPlugin({
    id: 'anthropic-api',
    meta: API_PROVIDER_META['anthropic-api'],
    auth: credentialAuth('anthropic-api'),
    fetch: ({ auth, now, fetchImpl }) => fetchAnthropicData({ apiKey: auth.apiKey, now, fetchImpl }),
    parse: (data, context) => parseAnthropicResponse(data, context.meta),
    normalize: (snapshot) => normalizeProviderSnapshot(snapshot, 'anthropic-api'),
  }),
  defineProviderPlugin({
    id: 'openai-api',
    meta: API_PROVIDER_META['openai-api'],
    auth: credentialAuth('openai-api'),
    fetch: ({ auth, now, fetchImpl }) => fetchOpenAIData({ apiKey: auth.apiKey, now, fetchImpl }),
    parse: (data, context) => parseOpenAIResponse(data, context.meta),
    normalize: (snapshot) => normalizeProviderSnapshot(snapshot, 'openai-api'),
  }),
  defineProviderPlugin({
    id: 'github-copilot',
    meta: API_PROVIDER_META['github-copilot'],
    auth: githubCopilotAuth,
    fetch: ({ auth, fetchImpl }) => fetchGitHubCopilotData({
      apiKey: auth.apiKey,
      organization: auth.organization,
      username: auth.username,
      fetchImpl,
    }),
    parse: (data, context) => parseGitHubCopilotUsage(data, context.meta),
    normalize: (snapshot) => normalizeProviderSnapshot(snapshot, 'github-copilot'),
  }),
  defineProviderPlugin({
    id: 'cursor',
    meta: API_PROVIDER_META.cursor,
    auth: credentialAuth('cursor'),
    fetch: ({ auth, now, fetchImpl }) => fetchCursorData({ apiKey: auth.apiKey, now, fetchImpl }),
    parse: (data, context) => parseCursorResponse(data, context.meta),
    normalize: (snapshot) => normalizeProviderSnapshot(snapshot, 'cursor'),
  }),
  defineProviderPlugin({
    id: 'gemini',
    meta: API_PROVIDER_META.gemini,
    auth: geminiAuth,
    fetch: ({ auth, now, fetchImpl }) => fetchGeminiData({
      apiKey: auth.apiKey,
      projectId: auth.projectId,
      now,
      fetchImpl,
    }),
    parse: (data, context) => parseGeminiResponse(data, context.meta),
    normalize: (snapshot) => normalizeProviderSnapshot(snapshot, 'gemini'),
  }),
  defineProviderPlugin({
    id: 'openrouter',
    meta: API_PROVIDER_META.openrouter,
    auth: credentialAuth('openrouter'),
    fetch: ({ auth, now, fetchImpl }) => fetchOpenRouterData({ apiKey: auth.apiKey, now, fetchImpl }),
    parse: (data, context) => parseOpenRouterResponse(data, context.meta),
    normalize: (snapshot) => normalizeProviderSnapshot(snapshot, 'openrouter'),
  }),
];

const plugins = new Map(builtInPlugins.map((plugin) => [plugin.id, plugin]));

for (const id of API_PROVIDER_IDS) {
  if (!plugins.has(id)) throw new Error(`Provider metadata has no plugin: ${id}`);
}

/** Return the registered plugin for a provider id. */
export function getProviderPlugin(provider) {
  return plugins.get(String(provider || '').trim()) || null;
}

/** Return an immutable snapshot of the current plugin registry. */
export function listProviderPlugins() {
  return [...plugins.values()];
}

/**
 * Register a provider for an explicitly built or test-injected channel.
 * Production code uses the built-ins above; callers must still pass the same
 * four-phase contract and cannot replace an existing id accidentally.
 */
export function registerProviderPlugin(plugin) {
  const validation = validateProviderPlugin(plugin);
  if (!validation.ok) throw new TypeError(`${validation.errorCode}: ${validation.error}`);
  if (plugins.has(plugin.id)) throw new Error(`Provider plugin already registered: ${plugin.id}`);
  plugins.set(plugin.id, plugin);
  return plugin;
}

/** Execute auth -> fetch -> parse -> normalize for a registered provider. */
export async function fetchProviderUsage(provider, input = {}) {
  const plugin = getProviderPlugin(provider);
  if (!plugin) return apiFailure(String(provider || 'unknown'), 'plugin.missing', 'provider-plugin-missing');
  return runProviderPlugin(plugin, input);
}

function githubCopilotAuth({ credential, settings = {} } = {}) {
  const base = credentialAuth('github-copilot')({ credential, settings });
  if (!base.ok) return base;
  const organization = safeSegment(settings.githubCopilotOrganization);
  const username = safeSegment(settings.githubCopilotUsername);
  if (!organization || !username) {
    return apiFailure('github-copilot', 'configuration.missing', 'organization-and-username-required');
  }
  return { ...base, organization, username };
}

function geminiAuth({ credential, settings = {} } = {}) {
  const base = credentialAuth('gemini')({ credential, settings });
  if (!base.ok) return base;
  const projectId = safeProjectId(settings.geminiProjectId);
  if (!projectId) return apiFailure('gemini', 'configuration.missing', 'project-id-required');
  return { ...base, projectId };
}

function safeSegment(value) {
  const text = String(value || '').trim();
  return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(text) ? text : '';
}

function safeProjectId(value) {
  const project = String(value || '').trim().toLowerCase();
  return /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project) ? project : '';
}
