import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { CodeModeInactiveError, initTools, runClaudeCodeTask } from "../bench/src/claude-code.js";
import { parseTranscript, projectDirFor, TranscriptCodeModeError, transcriptToRecord } from "../bench/src/transcript.js";
import { buildTasks } from "../tasks/src/tasks.js";
import { loadRecorded } from "./helpers.js";

const task = buildTasks().T2;

test("an interactive Code Mode transcript becomes a run record", () => {
  const s = parseTranscript(loadRecorded("interactive-transcript-E.jsonl"));
  assert.equal(s.requests, 3, "one per message id, sidechain included");
  assert.equal(s.sidechainRequests, 1);
  assert.equal(s.replCalls, 1);
  assert.deepEqual(s.usage, { input: 505, cache_creation: 12300, cache_read: 12000, output: 250, total_input: 24805, code_execution_requests: 0 });
  assert.equal(s.wallMs, 9000);
  assert.equal(s.firstRequestPromptTokens, 12003);
  // Sonnet: 3*2 + 12000*2.5 + 200*10 ; 2*2 + 300*2.5 + 12000*0.1 + 40*10 ; Haiku: 500*0.1 + 10*0.5 (per MTok)
  assert.ok(Math.abs(s.costUsd - (32006 + 2354 + 55) / 1e6) < 1e-12, String(s.costUsd));

  const record = transcriptToRecord({ file: "x.jsonl", mode: "E", task, rep: 1, batchId: "t" }, s);
  assert.equal(record.correct, true, record.problems.join("; "));
  assert.equal(record.extra?.code_mode_active, true);
  assert.equal(record.cache_state, "cold");
});

test("a mode E transcript without REPL fails loudly", () => {
  const noRepl = loadRecorded("interactive-transcript-E.jsonl").replace('"name":"REPL"', '"name":"mcp__gdocs__list_comments"');
  assert.throws(
    () => transcriptToRecord({ file: "x.jsonl", mode: "E", task, rep: 1, batchId: "t" }, parseTranscript(noRepl)),
    TranscriptCodeModeError,
  );
});

test("transcript folder follows Claude Code's naming", () => {
  assert.equal(projectDirFor("/tmp/mcp-code-mode-bench-session", "/h"), "/h/.claude/projects/-tmp-mcp-code-mode-bench-session");
});

test("initTools reads the init event, and waits for it", () => {
  assert.equal(initTools('{"type":"system","subtype":"hook_started"}\n'), undefined);
  assert.deepEqual(initTools('{"type":"system","subtype":"init","tools":["REPL","mcp__gdocs__x"]}\n'), ["REPL", "mcp__gdocs__x"]);
});

test("mode E under -p stops as soon as init shows no REPL", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "fake-claude-"));
  const bin = path.join(dir, "claude");
  // Prints an init event without REPL, then would hang: the runner must kill it, not wait.
  writeFileSync(
    bin,
    `#!${process.execPath}\nconsole.log(JSON.stringify({type:"system",subtype:"init",tools:["mcp__gdocs__list_comments"]}));\nsetTimeout(()=>{},60000);\n`,
  );
  chmodSync(bin, 0o755);
  const started = Date.now();
  await assert.rejects(
    runClaudeCodeTask({ mode: "E", task, rep: 1, batchId: "t", model: "m", effort: "medium", claudeBin: bin, timeoutMs: 30_000 }),
    CodeModeInactiveError,
  );
  assert.ok(Date.now() - started < 10_000);
});
