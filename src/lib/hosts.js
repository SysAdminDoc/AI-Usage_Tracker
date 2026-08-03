// Canonical provider host contract shared by runtime predicates and build
// validation. Keep wildcard content matches separate from apex-only host
// permissions and web-accessible-resource matches.

export const HOST_MATRIX = Object.freeze({
  claude: Object.freeze({
    apex: 'claude.ai',
    matches: Object.freeze(['https://claude.ai/*', 'https://*.claude.ai/*']),
    analyticsMatches: Object.freeze([
      'https://claude.ai/settings/usage*',
      'https://*.claude.ai/settings/usage*',
    ]),
    connect: 'claude.ai',
  }),
  codex: Object.freeze({
    apex: 'chatgpt.com',
    matches: Object.freeze(['https://chatgpt.com/*', 'https://*.chatgpt.com/*']),
    analyticsMatches: Object.freeze([
      'https://chatgpt.com/codex/cloud/settings/analytics*',
      'https://*.chatgpt.com/codex/cloud/settings/analytics*',
    ]),
    connect: 'chatgpt.com',
  }),
});

export const SUPPORTED_HOSTS = Object.freeze(
  Object.values(HOST_MATRIX).map((provider) => provider.apex),
);

export function isSupportedHost(hostname) {
  const host = normalizeHostname(hostname);
  return SUPPORTED_HOSTS.some((apex) => host === apex || host.endsWith(`.${apex}`));
}

export function isClaudeHost(hostname) {
  return matchesApex(hostname, HOST_MATRIX.claude.apex);
}

export function isCodexHost(hostname) {
  return matchesApex(hostname, HOST_MATRIX.codex.apex);
}

function matchesApex(hostname, apex) {
  const host = normalizeHostname(hostname);
  return host === apex || host.endsWith(`.${apex}`);
}

function normalizeHostname(hostname) {
  return String(hostname || '').trim().toLowerCase().replace(/\.+$/, '');
}
