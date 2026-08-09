import fixture from './provider-sample.json' with { type: 'json' };
import {
  defineProviderPlugin,
  normalizeProviderSnapshot,
} from '../../src/providers/plugin-api.js';

const providerId = fixture.provider.id;

export const sampleProviderPlugin = defineProviderPlugin({
  id: providerId,
  apiVersion: fixture.provider.apiVersion,
  meta: fixture.provider.meta,
  auth: ({ credential }) => ({
    ok: Boolean(String(credential || '').trim()),
    provider: providerId,
    apiKey: String(credential || '').trim(),
  }),
  fetch: () => ({
    ok: true,
    provider: providerId,
    data: fixture.payload,
    meta: { source: 'local-fixture' },
  }),
  parse: (data) => {
    if (data?.usage?.requests !== fixture.snapshot.totals.requests
      || data?.usage?.tokens !== fixture.snapshot.totals.tokens) {
      return {
        ok: false,
        provider: providerId,
        error: 'fixture-payload-mismatch',
        errorCode: 'sample-provider.fixture-payload-mismatch',
      };
    }
    return structuredClone(fixture.snapshot);
  },
  normalize: (snapshot) => normalizeProviderSnapshot(snapshot, providerId),
});

export { fixture as sampleProviderFixture };
