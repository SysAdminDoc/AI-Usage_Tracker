import { installClaudeMessageLimitInterceptor } from './lib/claude-stream.js';

const SOURCE = 'ai-usage-tracker';

installClaudeMessageLimitInterceptor({
  target: window,
  emit(messageLimit) {
    window.postMessage({
      source: SOURCE,
      type: 'claude-message-limit',
      messageLimit,
      observedAtISO: new Date().toISOString(),
    }, location.origin);
  },
});
