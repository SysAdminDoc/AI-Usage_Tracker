import { isClaudeHost, isCodexHost } from './hosts.js';

/** Return the only provider whose first-party page is currently in scope. */
export function providerForLocation(locationLike = globalThis.location) {
  const hostname = locationLike?.hostname || '';
  if (isClaudeHost(hostname)) return 'claude';
  if (isCodexHost(hostname)) return 'codex';
  return null;
}
