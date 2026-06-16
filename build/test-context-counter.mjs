import assert from 'node:assert/strict';
import {
  CLAUDE_CONTEXT_WINDOW_TOKENS,
  contextSnapshotsEqual,
  estimateO200kTokens,
  mergeContextSnapshot,
} from '../src/lib/context-counter.js';

assert.equal(CLAUDE_CONTEXT_WINDOW_TOKENS, 200_000);
assert.equal(estimateO200kTokens(''), 0);
assert.equal(estimateO200kTokens('hello'), 2);
assert.equal(estimateO200kTokens('hello world'), 4);
assert.ok(estimateO200kTokens('function estimateTokens(input) { return input.length; }') >= 12);
assert.ok(estimateO200kTokens('こんにちは世界') >= 7);

const snapshot = {
  provider: 'claude',
  maxTokens: 200_000,
  tokenEstimate: 1234,
  conversationTokens: 1200,
  draftTokens: 34,
  percentUsed: 0.617,
  messageCount: 4,
  source: 'message-dom',
  path: '/chat/example',
  sampledAtISO: '2026-06-16T12:00:00.000Z',
};

const state = mergeContextSnapshot({ settings: { refreshMinutes: 5 } }, snapshot);
assert.equal(state.context.claude.tokenEstimate, 1234);
assert.equal(state.settings.refreshMinutes, 5);
assert.equal(contextSnapshotsEqual(snapshot, { ...snapshot, sampledAtISO: '2026-06-16T12:01:00.000Z' }), true);
assert.equal(contextSnapshotsEqual(snapshot, { ...snapshot, tokenEstimate: 1235 }), false);

console.log('context counter smoke: OK');
