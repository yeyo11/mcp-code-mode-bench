// Usage summed over EVERY request of a run, the cost of each request, and the running cost guard.

import { priceFor } from "./prices.js";

/** The subset of the API's `usage` object that is billed. */
export interface RequestUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation?: { ephemeral_5m_input_tokens?: number | null; ephemeral_1h_input_tokens?: number | null } | null;
  /** The docs show `code_execution_requests` here; the SDK's type does not list it yet, so read it loosely. */
  server_tool_use?: object | null;
}

export interface UsageTotals {
  /** Uncached input tokens. */
  input: number;
  cache_creation: number;
  cache_read: number;
  output: number;
  /** input + cache_creation + cache_read: everything the model read. */
  total_input: number;
  code_execution_requests: number;
}

export const emptyTotals = (): UsageTotals => ({
  input: 0,
  cache_creation: 0,
  cache_read: 0,
  output: 0,
  total_input: 0,
  code_execution_requests: 0,
});

export function addUsage(t: UsageTotals, u: RequestUsage): UsageTotals {
  const cw = u.cache_creation_input_tokens ?? 0;
  const cr = u.cache_read_input_tokens ?? 0;
  return {
    input: t.input + u.input_tokens,
    cache_creation: t.cache_creation + cw,
    cache_read: t.cache_read + cr,
    output: t.output + u.output_tokens,
    total_input: t.total_input + u.input_tokens + cw + cr,
    code_execution_requests:
      t.code_execution_requests + ((u.server_tool_use as { code_execution_requests?: number } | null)?.code_execution_requests ?? 0),
  };
}

/** USD for one request. Prices per tier are chosen per request, on that request's prompt size. */
export function requestCost(model: string, u: RequestUsage): number {
  const price = priceFor(model);
  const cw = u.cache_creation_input_tokens ?? 0;
  const cr = u.cache_read_input_tokens ?? 0;
  const prompt = u.input_tokens + cw + cr;
  const tier = price.long && prompt > price.long.overPromptTokens ? price.long.tier : price.base;
  // Split cache writes by TTL when the API reports it; otherwise they are 5-minute writes (our default).
  const w1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const w5m = u.cache_creation ? (u.cache_creation.ephemeral_5m_input_tokens ?? cw - w1h) : cw;
  const usd =
    u.input_tokens * tier.input +
    w5m * tier.cacheWrite5m +
    w1h * tier.cacheWrite1h +
    cr * tier.cacheRead +
    u.output_tokens * tier.output;
  return usd / 1_000_000;
}

export class BudgetExceededError extends Error {
  constructor(
    readonly spentUsd: number,
    readonly capUsd: number,
  ) {
    super(`Cost guard: spent ${spentUsd.toFixed(4)} USD, cap is ${capUsd.toFixed(2)} USD. Stopping the whole run.`);
  }
}

/** Running total across every run of one invocation. `charge` throws once the cap is reached. */
export class CostGuard {
  private spent = 0;
  constructor(
    readonly capUsd: number,
    alreadySpentUsd = 0,
  ) {
    this.spent = alreadySpentUsd;
  }

  get spentUsd(): number {
    return this.spent;
  }

  /** Throws before a request when the cap is already reached. */
  check(): void {
    if (this.spent >= this.capUsd) throw new BudgetExceededError(this.spent, this.capUsd);
  }

  charge(usd: number): void {
    this.spent += usd;
    this.check();
  }
}
