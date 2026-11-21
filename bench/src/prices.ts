// USD per million tokens. Source: https://platform.claude.com/docs/en/about-claude/pricing (read 2026-11-21).
// Claude API, global routing, standard speed, no batch discount. Code execution container time is not
// priced here: each organization gets 1,550 free container-hours a month, and these runs stay inside it.

export interface PriceTier {
  input: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
}

export interface ModelPrice {
  /** Applies when the request's prompt (input + cache write + cache read) is at or below the threshold. */
  base: PriceTier;
  /** Long-prompt tier, when the model has one. */
  long?: { overPromptTokens: number; tier: PriceTier };
}

export const PRICES: Record<string, ModelPrice> = {
  "claude-sonnet-5-5": {
    base: { input: 2, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.1, output: 10 },
  },
  "claude-haiku-5-5": {
    base: { input: 0.1, cacheWrite5m: 0.125, cacheWrite1h: 0.2, cacheRead: 0.01, output: 0.5 },
    long: { overPromptTokens: 100_000, tier: { input: 0.5, cacheWrite5m: 0.625, cacheWrite1h: 1, cacheRead: 0.05, output: 2.5 } },
  },
  "claude-opus-5-5": {
    base: { input: 4, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2, output: 20 },
  },
};

export function priceFor(model: string): ModelPrice {
  const p = PRICES[model];
  if (!p) throw new Error(`No price for model ${model}. Add it to bench/src/prices.ts from the pricing page.`);
  return p;
}
