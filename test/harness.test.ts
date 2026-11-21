import assert from "node:assert/strict";
import { test } from "node:test";
import { runApiTask } from "../bench/src/api-runner.js";
import type { ToolBackend } from "../bench/src/mcp-client.js";
import { buildRequest, buildTools, NON_DEFERRED_TOOLS, type RequestSettings } from "../bench/src/modes.js";
import { addUsage, BudgetExceededError, CostGuard, emptyTotals, requestCost } from "../bench/src/usage.js";
import { MockDriveApi } from "../server/src/drive.js";
import { generateDrive } from "../server/src/fixtures.js";
import { buildTasks, SYSTEM_PROMPT } from "../tasks/src/tasks.js";
import { recordedResponses, replayClient } from "./helpers.js";

const settings: RequestSettings = { model: "claude-sonnet-5-5", effort: "medium", maxTokens: 16_000, cache: true };
const tasks = buildTasks();
const close = (a: number, b: number) => Math.abs(a - b) < 1e-12;

/** In-process backend with the same tool names; answers are short and only need to exist. */
function fakeBackend(): ToolBackend & { calls: string[] } {
  const api = new MockDriveApi(generateDrive());
  const calls: string[] = [];
  const names = ["get_auth_status", "list_documents", "get_document", "list_comments", "get_comment", "get_comments_summary"];
  return {
    calls,
    tools: names.map((name) => ({ name, description: `${name} tool`, input_schema: { type: "object", properties: {} } })),
    async call(name) {
      calls.push(name);
      return { text: `${name}: ${api.drive.documents.length} documents`, isError: false };
    },
    async close() {},
  };
}

test("cost per request follows the price table", () => {
  // Sonnet 5.5: $2 in, $2.50 5m write, $4 1h write, $0.10 read, $10 out per MTok.
  assert.ok(close(requestCost("claude-sonnet-5-5", { input_tokens: 1_000_000, output_tokens: 0 }), 2));
  assert.ok(close(requestCost("claude-sonnet-5-5", { input_tokens: 0, output_tokens: 1_000_000 }), 10));
  assert.ok(close(requestCost("claude-sonnet-5-5", { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 }), 0.1));
  assert.ok(close(requestCost("claude-sonnet-5-5", { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000 }), 2.5));
  assert.ok(
    close(
      requestCost("claude-sonnet-5-5", {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 1_000_000,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1_000_000 },
      }),
      4,
    ),
  );
  // Haiku 5.5 switches to its long-prompt prices above 100K prompt tokens, per request.
  assert.ok(close(requestCost("claude-haiku-5-5", { input_tokens: 100_000, output_tokens: 0 }), 0.01));
  assert.ok(close(requestCost("claude-haiku-5-5", { input_tokens: 100_001, output_tokens: 0 }), 100_001 * 0.5 / 1e6));
  assert.ok(close(requestCost("claude-haiku-5-5", { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 }), 0.05));
  assert.throws(() => requestCost("claude-unknown", { input_tokens: 1, output_tokens: 1 }));
});

test("usage is summed over every request", () => {
  let t = emptyTotals();
  t = addUsage(t, { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 100, cache_read_input_tokens: 0 });
  t = addUsage(t, { input_tokens: 3, output_tokens: 7, cache_creation_input_tokens: null, cache_read_input_tokens: 100, server_tool_use: { code_execution_requests: 1 } });
  assert.deepEqual(t, { input: 13, cache_creation: 100, cache_read: 100, output: 12, total_input: 213, code_execution_requests: 1 });
});

test("the cost guard stops at the cap", () => {
  const g = new CostGuard(1, 0.4);
  g.charge(0.5);
  assert.throws(() => g.charge(0.2), BudgetExceededError);
  assert.throws(() => g.check(), BudgetExceededError);
});

test("mode tools: A plain, B defers all but the entry point, C allows code execution callers", () => {
  const tools = fakeBackend().tools;
  const a = buildTools("A", tools);
  assert.equal(a.length, 6);
  assert.ok(a.every((t) => !("defer_loading" in t) && !("allowed_callers" in t)));

  const b = buildTools("B", tools) as { name: string; type?: string; defer_loading?: boolean }[];
  assert.equal(b[0]!.type, "tool_search_tool_bm25_20251119");
  assert.deepEqual(b.filter((t) => !t.defer_loading).map((t) => t.name), ["tool_search_tool_bm25", ...NON_DEFERRED_TOOLS]);

  const c = buildTools("C", tools) as { name: string; type?: string; allowed_callers?: string[]; strict?: boolean }[];
  assert.deepEqual(c[0], { type: "code_execution_20260120", name: "code_execution" });
  assert.ok(c.slice(1).every((t) => t.allowed_callers?.[0] === "code_execution_20260120" && t.strict === undefined));

  const req = buildRequest(settings, SYSTEM_PROMPT, a, [{ role: "user", content: "hi" }]) as unknown as Record<string, unknown>;
  assert.equal(req.temperature, undefined);
  assert.equal(req.top_p, undefined);
  assert.deepEqual(req.output_config, { effort: "medium" });
  assert.deepEqual(req.cache_control, { type: "ephemeral" });
});

test("mode A replays a classic loop: sums, cost, request count, warm cache", async () => {
  const client = replayClient(recordedResponses("classic-t2.json"));
  const backend = fakeBackend();
  const { record } = await runApiTask({ mode: "A", task: tasks.T2, rep: 1, batchId: "test", settings, client, backend, guard: new CostGuard(9) });
  assert.equal(record.error, null);
  assert.equal(record.correct, true, record.problems.join("; "));
  assert.equal(record.requests, 3);
  assert.deepEqual(record.usage, { input: 30, cache_creation: 5800, cache_read: 8200, output: 170, total_input: 14030, code_execution_requests: 0 });
  assert.ok(close(record.cost_usd, 0.01708), String(record.cost_usd));
  assert.equal(record.cache_state, "warm");
  assert.deepEqual(record.tool_calls, { direct: 2, programmatic: 0, by_name: { list_documents: 1, list_comments: 1 } });
  assert.deepEqual(backend.calls, ["list_documents", "list_comments"]);
  // Every request resends the whole history (that is what classic mode pays for).
  assert.deepEqual(client.requests.map((r) => r.messages.length), [1, 3, 5]);
});

test("mode C replays programmatic tool calling: container passed back, tool_result-only replies", async () => {
  const client = replayClient(recordedResponses("ptc-t2.json"));
  const backend = fakeBackend();
  const { record } = await runApiTask({ mode: "C", task: tasks.T2, rep: 1, batchId: "test", settings, client, backend, guard: new CostGuard(9) });
  assert.equal(record.error, null);
  assert.equal(record.correct, true, record.problems.join("; "));
  assert.equal(record.requests, 3);
  assert.deepEqual(record.usage, { input: 3200, cache_creation: 3420, cache_read: 3300, output: 270, total_input: 9920, code_execution_requests: 1 });
  assert.ok(close(record.cost_usd, 0.01798), String(record.cost_usd));
  assert.equal(record.cache_state, "cold");
  assert.equal(record.tool_calls.programmatic, 3);
  assert.equal(record.tool_calls.direct, 0);

  assert.equal(client.requests[0]!.container, undefined);
  assert.equal(client.requests[1]!.container, "container_abc");
  assert.equal(client.requests[2]!.container, "container_abc");
  for (const req of client.requests.slice(1)) {
    const last = req.messages.at(-1)!;
    assert.equal(last.role, "user");
    assert.ok(Array.isArray(last.content) && last.content.every((b) => b.type === "tool_result"), "only tool_result blocks");
  }
  const tools = client.requests[0]!.tools as { name: string; allowed_callers?: string[] }[];
  assert.ok(tools.filter((t) => t.name !== "code_execution").every((t) => t.allowed_callers?.includes("code_execution_20260120")));
});

test("the guard stops a run mid-loop and reports it", async () => {
  const client = replayClient(recordedResponses("classic-t2.json"));
  const { record, budgetExceeded } = await runApiTask({
    mode: "A", task: tasks.T2, rep: 1, batchId: "test", settings, client, backend: fakeBackend(), guard: new CostGuard(0.002),
  });
  assert.ok(budgetExceeded instanceof BudgetExceededError);
  assert.equal(record.requests, 2, "stops right after the request that crossed the cap");
  assert.equal(record.correct, false);
  assert.match(record.error ?? "", /Cost guard/);
});

test("pause_turn is sent back without a new user message", async () => {
  const [first, , last] = recordedResponses("classic-t2.json");
  const paused = { ...first!, content: [{ type: "text", text: "working" }], stop_reason: "pause_turn" } as typeof first;
  const client = replayClient([paused!, last!]);
  const { record } = await runApiTask({ mode: "A", task: tasks.T2, rep: 1, batchId: "test", settings, client, backend: fakeBackend(), guard: new CostGuard(9) });
  assert.equal(record.correct, true);
  assert.equal(client.requests[1]!.messages.at(-1)!.role, "assistant");
});
