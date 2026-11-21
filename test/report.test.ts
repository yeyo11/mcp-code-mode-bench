import assert from "node:assert/strict";
import { test } from "node:test";
import type { RunRecord } from "../bench/src/record.js";
import { median, renderReport } from "../bench/src/report.js";
import { emptyTotals } from "../bench/src/usage.js";

function rec(over: Partial<RunRecord>): RunRecord {
  return {
    schema: 1, batch_id: "b", timestamp: "2026-11-21T00:00:00Z", harness: "api", mode: "A", task: "T2", rep: 1,
    model: "claude-sonnet-5-5", effort: "medium", padding: 0, smoke: false, usage: { ...emptyTotals(), total_input: 100 },
    requests: 2, tool_calls: { direct: 1, programmatic: 0, by_name: {} }, wall_ms: 1000, cost_usd: 0.01,
    cost_source: "price-table", cache_state: "cold", correct: true, problems: [], stop_reason: "end_turn", error: null, answer: "",
    ...over,
  };
}

test("median", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
});

test("report keeps cold and warm apart and smoke runs out of the table", () => {
  const md = renderReport([
    rec({ rep: 1, usage: { ...emptyTotals(), total_input: 100 } }),
    rec({ rep: 2, usage: { ...emptyTotals(), total_input: 300 } }),
    rec({ rep: 3, usage: { ...emptyTotals(), total_input: 200 } }),
    rec({ rep: 4, cache_state: "warm" }),
    rec({ mode: "E", harness: "claude-code", smoke: true, cost_source: "claude-code-estimate" }),
  ], new Date("2026-11-21T00:00:00Z"));
  const [main, smoke] = md.split("## Smoke runs");
  assert.match(main!, /\| T2 \| A\. Classic \(API\) \| claude-sonnet-5-5 \| cold \| 3 \| 3\/3 \| 200 \(100–300\)/);
  assert.match(main!, /\| T2 \| A\. Classic \(API\) \| claude-sonnet-5-5 \| warm \| 1 \|/);
  assert.doesNotMatch(main!, /Claude Code, Code Mode/);
  assert.match(smoke!, /Claude Code, Code Mode/);
});
