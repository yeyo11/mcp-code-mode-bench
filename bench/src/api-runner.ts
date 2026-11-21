// Modes A-C: one manual agent loop over the Messages API. The client is injected, so the tests can
// replay recorded responses without an API key.

import type Anthropic from "@anthropic-ai/sdk";
import { grade } from "../../tasks/src/checker.js";
import { SYSTEM_PROMPT, type Task } from "../../tasks/src/tasks.js";
import type { ToolBackend } from "./mcp-client.js";
import { type ApiMode, buildRequest, buildTools, type RequestSettings } from "./modes.js";
import type { RunRecord } from "./record.js";
import { addUsage, BudgetExceededError, type CostGuard, emptyTotals, requestCost } from "./usage.js";

export interface MessagesClient {
  create(params: Anthropic.Messages.MessageCreateParamsNonStreaming): Promise<Anthropic.Messages.Message>;
}

export interface ApiRunOptions {
  mode: ApiMode;
  task: Task;
  rep: number;
  batchId: string;
  settings: RequestSettings;
  client: MessagesClient;
  backend: ToolBackend;
  guard: CostGuard;
  /** Safety stop for runaway loops. */
  maxRequests?: number;
  smoke?: boolean;
  /** Called with every request body, before it is sent (used by tests and --log-requests). */
  onRequest?: (params: Anthropic.Messages.MessageCreateParamsNonStreaming, index: number) => void;
}

export interface ApiRunResult {
  record: RunRecord;
  /** Set when the cost guard tripped: the caller must stop the whole run. */
  budgetExceeded?: BudgetExceededError;
}

type ToolUse = Anthropic.Messages.ToolUseBlock;

function textOf(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

export async function runApiTask(opts: ApiRunOptions): Promise<ApiRunResult> {
  const { mode, task, settings, client, backend, guard } = opts;
  const maxRequests = opts.maxRequests ?? 60;
  const tools = buildTools(mode, backend.tools);
  const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: task.prompt }];

  let totals = emptyTotals();
  let cost = 0;
  let requests = 0;
  let container: string | undefined;
  let cacheState: RunRecord["cache_state"] = "unknown";
  let stopReason: string | null = null;
  let answer = "";
  let error: string | null = null;
  let budgetExceeded: BudgetExceededError | undefined;
  const toolCalls = { direct: 0, programmatic: 0, by_name: {} as Record<string, number> };
  const started = Date.now();

  try {
    for (;;) {
      if (requests >= maxRequests) throw new Error(`stopped after ${maxRequests} requests`);
      guard.check();
      const params = buildRequest(settings, SYSTEM_PROMPT, tools, messages, container);
      opts.onRequest?.(params, requests);
      const res = await client.create(params);
      requests++;

      totals = addUsage(totals, res.usage);
      const usd = requestCost(settings.model, res.usage);
      cost += usd;
      if (requests === 1) cacheState = (res.usage.cache_read_input_tokens ?? 0) > 0 ? "warm" : "cold";
      if (res.container?.id) container = res.container.id;
      stopReason = res.stop_reason;
      messages.push({ role: "assistant", content: res.content as unknown as Anthropic.Messages.ContentBlockParam[] });
      guard.charge(usd);

      if (res.stop_reason === "end_turn" || res.stop_reason === "stop_sequence") {
        answer = textOf(res.content);
        break;
      }
      if (res.stop_reason === "pause_turn") continue; // server tool still working: send the turn back as is
      if (res.stop_reason !== "tool_use") throw new Error(`unexpected stop_reason ${res.stop_reason}`);

      const uses = res.content.filter((b): b is ToolUse => b.type === "tool_use");
      if (uses.length === 0) throw new Error("stop_reason tool_use without tool_use blocks");
      const results = await Promise.all(
        uses.map(async (u): Promise<Anthropic.Messages.ToolResultBlockParam> => {
          const programmatic = u.caller?.type !== undefined && u.caller.type !== "direct";
          if (programmatic) toolCalls.programmatic++;
          else toolCalls.direct++;
          toolCalls.by_name[u.name] = (toolCalls.by_name[u.name] ?? 0) + 1;
          const out = await backend.call(u.name, (u.input ?? {}) as Record<string, unknown>);
          return { type: "tool_result", tool_use_id: u.id, content: out.text, ...(out.isError ? { is_error: true } : {}) };
        }),
      );
      // Only tool_result blocks: required when answering pending programmatic calls, harmless otherwise.
      messages.push({ role: "user", content: results });
    }
  } catch (err) {
    if (err instanceof BudgetExceededError) budgetExceeded = err;
    error = err instanceof Error ? err.message : String(err);
  }

  const g = error ? { correct: false, problems: [`error: ${error}`] } : grade(task, answer);
  const record: RunRecord = {
    schema: 1,
    batch_id: opts.batchId,
    timestamp: new Date(started).toISOString(),
    harness: "api",
    mode,
    task: task.id,
    rep: opts.rep,
    model: settings.model,
    effort: settings.effort,
    padding: task.padding,
    smoke: opts.smoke ?? false,
    usage: totals,
    requests,
    tool_calls: toolCalls,
    wall_ms: Date.now() - started,
    cost_usd: cost,
    cost_source: "price-table",
    cache_state: cacheState,
    correct: g.correct,
    problems: g.problems,
    stop_reason: stopReason,
    error,
    answer,
    extra: { tools_in_request: tools.length, cache: settings.cache, container: container ?? null },
  };
  return { record, ...(budgetExceeded ? { budgetExceeded } : {}) };
}
