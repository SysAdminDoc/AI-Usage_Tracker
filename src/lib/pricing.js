// Versioned list-price fallback for API providers whose billing endpoint does
// not return a model dimension. Provider-reported costs always take precedence
// over this table. Unknown models deliberately remain unpriced instead of
// presenting a guess as an invoice total.

export const PRICING_TABLE_VERSION = '2026-08-03';

const TOKEN_PRICING = Object.freeze({
  'anthropic-api': Object.freeze([
    model('claude-opus-4-6', { input: 5, cacheRead: 0.5, cacheCreation5m: 6.25, cacheCreation1h: 10, output: 25 }),
    model('claude-sonnet-4-6', { input: 3, cacheRead: 0.3, cacheCreation5m: 3.75, cacheCreation1h: 6, output: 15 }),
    model('claude-haiku-4-5', { input: 1, cacheRead: 0.1, cacheCreation5m: 1.25, cacheCreation1h: 2, output: 5 }),
  ]),
  'openai-api': Object.freeze([
    model('gpt-5.4-pro', { input: 30, output: 180 }),
    model('gpt-5.4', { input: 2.5, cachedInput: 0.25, output: 15 }),
    model('gpt-5.2-pro', { input: 21, output: 168 }),
    model('gpt-5.2', { input: 1.75, cachedInput: 0.175, output: 14 }),
    model('gpt-5', { input: 1.25, cachedInput: 0.125, output: 10 }),
    model('gpt-5-mini', { input: 0.25, cachedInput: 0.025, output: 2 }),
    model('gpt-5-nano', { input: 0.05, cachedInput: 0.005, output: 0.4 }),
    model('gpt-4.1-nano', { input: 0.1, cachedInput: 0.025, output: 0.4 }),
    model('gpt-4.1-mini', { input: 0.4, cachedInput: 0.1, output: 1.6 }),
    model('gpt-4.1', { input: 2, cachedInput: 0.5, output: 8 }),
    model('gpt-4o-mini', { input: 0.15, cachedInput: 0.075, output: 0.6 }),
    model('gpt-4o', { input: 2.5, cachedInput: 1.25, output: 10 }),
  ]),
});

export function estimateTokenCost(provider, modelName, {
  inputTokens = 0,
  outputTokens = 0,
  cachedInputTokens = 0,
  cacheReadTokens = 0,
  cacheCreation5mTokens = 0,
  cacheCreation1hTokens = 0,
} = {}) {
  const pricing = resolveTokenPricing(provider, modelName);
  if (!pricing) return null;

  const input = nonNegative(inputTokens);
  const cached = Math.min(input, nonNegative(cachedInputTokens));
  const uncached = input - cached;
  const output = nonNegative(outputTokens);
  let cost = output * pricing.output / 1_000_000;

  if (provider === 'anthropic-api') {
    cost += uncached * pricing.input / 1_000_000;
    cost += nonNegative(cacheReadTokens) * pricing.cacheRead / 1_000_000;
    cost += nonNegative(cacheCreation5mTokens) * pricing.cacheCreation5m / 1_000_000;
    cost += nonNegative(cacheCreation1hTokens) * pricing.cacheCreation1h / 1_000_000;
  } else {
    cost += uncached * pricing.input / 1_000_000;
    cost += cached * (pricing.cachedInput ?? pricing.input) / 1_000_000;
  }

  return {
    costUSD: roundCost(cost),
    costSource: 'pricing-table',
    pricingVersion: PRICING_TABLE_VERSION,
  };
}

export function resolveTokenPricing(provider, modelName) {
  const normalized = String(modelName || '').trim().toLowerCase();
  if (!normalized || normalized === 'all') return null;
  return TOKEN_PRICING[provider]?.find((entry) => normalized === entry.model
    || normalized.startsWith(`${entry.model}-`)) || null;
}

export function hasTokenPricing(provider, modelName) {
  return resolveTokenPricing(provider, modelName) !== null;
}

function model(modelName, prices) {
  return Object.freeze({ model: modelName, ...prices });
}

function nonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function roundCost(value) {
  return Number(Math.max(0, value).toFixed(8));
}
