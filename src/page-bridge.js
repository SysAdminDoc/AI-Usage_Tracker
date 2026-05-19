import { send } from './lib/browser.js';

const SOURCE = 'ai-usage-tracker';

if (/(^|\.)claude\.ai$/.test(location.hostname)) {
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== SOURCE || data.type !== 'claude-message-limit') return;
    if (!data.messageLimit || typeof data.messageLimit !== 'object') return;
    send({
      type: 'aut/claude-message-limit',
      messageLimit: data.messageLimit,
      observedAtISO: data.observedAtISO || new Date().toISOString(),
    });
  });
}
