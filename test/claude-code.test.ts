import assert from "node:assert/strict";
import { test } from "node:test";
import { buildClaudeArgs, parseStreamJson, toRecord } from "../bench/src/claude-code.js";
import { buildTasks } from "../tasks/src/tasks.js";
import { loadRecorded } from "./helpers.js";

const task = buildTasks().T2;

test("D and E command lines differ only in Code Mode", () => {
  const d = buildClaudeArgs({ mode: "D", task, model: "claude-sonnet-5-5", effort: "medium" }, "/tmp/mcp.json");
  const e = buildClaudeArgs({ mode: "E", task, model: "claude-sonnet-5-5", effort: "medium" }, "/tmp/mcp.json");
  for (const flag of ["-p", "--strict-mcp-config", "--mcp-config", "--no-session-persistence", "--setting-sources"]) {
    assert.ok(d.args.includes(flag) && e.args.includes(flag), flag);
  }
  assert.equal(d.env.CLAUDE_CODE_EXPERIMENTAL_CODE_MODE, "0");
  assert.equal(e.env.CLAUDE_CODE_EXPERIMENTAL_CODE_MODE, "1");
  assert.equal(d.args[d.args.indexOf("--tools") + 1], "");
  assert.equal(e.args[e.args.indexOf("--tools") + 1], "REPL");
  assert.ok(!d.args.includes("--settings"));
  assert.deepEqual(JSON.parse(e.args[e.args.indexOf("--settings") + 1]!), { env: { CLAUDE_CODE_EXPERIMENTAL_CODE_MODE: "1" } });
});

test("stream-json output is parsed into usage, requests, cost and the answer", () => {
  const parsed = parseStreamJson(loadRecorded("claude-code-stream.jsonl"));
  assert.equal(parsed.requests, 2);
  assert.equal(parsed.numTurns, 2);
  assert.equal(parsed.costUsd, 0.0512);
  // modelUsage covers every model the session used, side calls included.
  assert.deepEqual(parsed.usage, { input: 405, cache_creation: 9200, cache_read: 9000, output: 170, total_input: 18605, code_execution_requests: 0 });
  assert.deepEqual(parsed.toolCalls.by_name, { REPL: 1 });
  assert.equal(parsed.firstRequestCacheRead, 0);

  const record = toRecord({ mode: "E", task, rep: 1, batchId: "t", model: "claude-sonnet-5-5", effort: "medium" }, parsed, 9000, new Date(0), null);
  assert.equal(record.correct, true, record.problems.join("; "));
  assert.equal(record.cache_state, "cold");
  assert.equal(record.cost_source, "claude-code-estimate");
  assert.equal(record.extra?.repl_calls_visible, 1);
  assert.equal(record.extra?.first_request_prompt_tokens, 9003);
});

test("published streams carry no local paths", async () => {
  const { redactPaths } = await import("../bench/src/claude-code.js");
  const { homedir } = await import("node:os");
  const out = redactPaths(`{"cwd":"/tmp/run-1","memory":"${homedir()}/.claude/x"}`, "/tmp/run-1");
  assert.equal(out, '{"cwd":"<run-dir>","memory":"~/.claude/x"}');
});

test("a run with no result line is an error, not a pass", () => {
  const parsed = parseStreamJson('{"type":"system","subtype":"init","tools":[]}\n');
  const record = toRecord({ mode: "D", task, rep: 1, batchId: "t", model: "m", effort: "medium" }, parsed, 10, new Date(0), null);
  assert.equal(record.correct, false);
});
