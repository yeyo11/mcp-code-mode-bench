// Modes D-E: Claude Code headless (`claude -p`) against the same mock server, with and without
// Code Mode. Output is stream-json, whose last line is the same `result` object `--output-format json`
// prints, plus the per-message events needed to count requests and see which tools ran.

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { grade } from "../../tasks/src/checker.js";
import type { Task } from "../../tasks/src/tasks.js";
import { RAW_DIR, SERVER_ENTRY } from "../../shared/paths.js";
import type { RunRecord } from "./record.js";
import { emptyTotals, type UsageTotals } from "./usage.js";

export type CcMode = "D" | "E";
export const MCP_SERVER_NAME = "gdocs";
const CODE_MODE_ENV = "CLAUDE_CODE_EXPERIMENTAL_CODE_MODE";

export interface CcRunOptions {
  mode: CcMode;
  task: Task;
  rep: number;
  batchId: string;
  model: string;
  effort: string;
  smoke?: boolean;
  claudeBin?: string;
  timeoutMs?: number;
}

export function mcpConfig(padding: number): object {
  return {
    mcpServers: {
      [MCP_SERVER_NAME]: { type: "stdio", command: process.execPath, args: [SERVER_ENTRY, "--padding", String(padding)] },
    },
  };
}

/**
 * The exact command line. Notes:
 * - `--setting-sources ""` keeps the owner's user/project settings, hooks and plugins out of the run.
 * - Code Mode is documented for interactive sessions only. Under `-p` (verified on 2.1.330) the REPL tool
 *   does not appear, with the variable in the shell or in `--settings`, so mode E under `-p` is refused
 *   by `runClaudeCodeTask` as soon as the init event lists no REPL. Measure E from an interactive
 *   session's transcript instead (see docs/claude-code-code-mode.md and bench/src/transcript.ts).
 * - `--tools` must name REPL (the tool that runs Code Mode's JavaScript); D gets only ToolSearch, since
 *   Claude Code may defer MCP tools behind it (it does in interactive sessions) and `""` would hide them.
 */
export function buildClaudeArgs(opts: Pick<CcRunOptions, "mode" | "task" | "model" | "effort">, mcpConfigPath: string): {
  args: string[];
  env: Record<string, string>;
} {
  const codeMode = opts.mode === "E";
  const args = [
    "-p",
    opts.task.prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--strict-mcp-config",
    "--mcp-config",
    mcpConfigPath,
    "--setting-sources",
    "",
    "--model",
    opts.model,
    "--effort",
    opts.effort,
    "--no-session-persistence",
    "--tools",
    codeMode ? "REPL" : "ToolSearch",
    "--permission-mode",
    "dontAsk",
    "--allowedTools",
    `mcp__${MCP_SERVER_NAME}`,
    ...(codeMode ? ["REPL", "--settings", JSON.stringify({ env: { [CODE_MODE_ENV]: "1" } })] : []),
  ];
  return { args, env: { [CODE_MODE_ENV]: codeMode ? "1" : "0" } };
}

interface StreamEvent {
  type: string;
  subtype?: string;
  [k: string]: unknown;
}

export interface CcParsed {
  usage: UsageTotals;
  requests: number;
  numTurns: number | null;
  durationMs: number | null;
  durationApiMs: number | null;
  costUsd: number;
  answer: string;
  isError: boolean;
  stopReason: string | null;
  toolCalls: { direct: number; programmatic: number; by_name: Record<string, number> };
  toolsAtInit: string[];
  codeModeNotices: string[];
  firstRequestCacheRead: number | null;
  /** input + cache writes + cache reads of the first request: shows how big the tool definitions are. */
  firstRequestPromptTokens: number | null;
  modelUsage: unknown;
}

/** Parses `claude -p --output-format stream-json --verbose` output (one JSON object per line). */
export function parseStreamJson(stdout: string): CcParsed {
  const events: StreamEvent[] = [];
  for (const line of stdout.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      events.push(JSON.parse(t) as StreamEvent);
    } catch {
      /* ignore partial lines */
    }
  }
  const init = events.find((e) => e.type === "system" && e.subtype === "init");
  const result = [...events].reverse().find((e) => e.type === "result");
  const notices = events
    .filter((e) => e.type === "system" && e.subtype === "notification" && String(e.key ?? "").includes("code-mode"))
    .map((e) => String(e.text ?? ""));

  // One API request per distinct assistant message id (parallel tool calls share one id).
  const seen = new Map<string, Record<string, number>>();
  const toolCalls = { direct: 0, programmatic: 0, by_name: {} as Record<string, number> };
  for (const e of events) {
    if (e.type !== "assistant") continue;
    const msg = e.message as { id?: string; content?: { type: string; name?: string }[]; usage?: Record<string, number> };
    if (msg?.id && !seen.has(msg.id)) seen.set(msg.id, msg.usage ?? {});
    for (const block of msg?.content ?? []) {
      if (block.type !== "tool_use" || !block.name) continue;
      toolCalls.direct++;
      toolCalls.by_name[block.name] = (toolCalls.by_name[block.name] ?? 0) + 1;
    }
  }

  // Totals: sum of modelUsage over every model the session used (side calls included), else `usage`.
  const usage = emptyTotals();
  const modelUsage = result?.modelUsage as Record<string, Record<string, number>> | undefined;
  if (modelUsage && Object.keys(modelUsage).length) {
    for (const m of Object.values(modelUsage)) {
      usage.input += m.inputTokens ?? 0;
      usage.output += m.outputTokens ?? 0;
      usage.cache_read += m.cacheReadInputTokens ?? 0;
      usage.cache_creation += m.cacheCreationInputTokens ?? 0;
    }
  } else if (result?.usage) {
    const u = result.usage as Record<string, number>;
    usage.input = u.input_tokens ?? 0;
    usage.output = u.output_tokens ?? 0;
    usage.cache_read = u.cache_read_input_tokens ?? 0;
    usage.cache_creation = u.cache_creation_input_tokens ?? 0;
  }
  usage.total_input = usage.input + usage.cache_creation + usage.cache_read;

  const first = seen.values().next().value as Record<string, number> | undefined;
  return {
    usage,
    requests: seen.size,
    numTurns: typeof result?.num_turns === "number" ? result.num_turns : null,
    durationMs: typeof result?.duration_ms === "number" ? result.duration_ms : null,
    durationApiMs: typeof result?.duration_api_ms === "number" ? result.duration_api_ms : null,
    costUsd: typeof result?.total_cost_usd === "number" ? result.total_cost_usd : 0,
    answer: typeof result?.result === "string" ? result.result : "",
    isError: result === undefined || result.is_error === true,
    stopReason: typeof result?.stop_reason === "string" ? result.stop_reason : null,
    toolCalls,
    toolsAtInit: Array.isArray(init?.tools) ? (init.tools as string[]) : [],
    codeModeNotices: notices,
    firstRequestCacheRead: first ? (first.cache_read_input_tokens ?? 0) : null,
    firstRequestPromptTokens: first
      ? (first.input_tokens ?? 0) + (first.cache_creation_input_tokens ?? 0) + (first.cache_read_input_tokens ?? 0)
      : null,
    modelUsage: modelUsage ?? null,
  };
}

export function toRecord(opts: CcRunOptions, parsed: CcParsed, wallMs: number, startedAt: Date, error: string | null): RunRecord {
  const g = error || parsed.isError ? { correct: false, problems: [`error: ${error ?? "claude reported is_error"}`] } : grade(opts.task, parsed.answer);
  const replCalls = parsed.toolCalls.by_name.REPL ?? 0;
  return {
    schema: 1,
    batch_id: opts.batchId,
    timestamp: startedAt.toISOString(),
    harness: "claude-code",
    mode: opts.mode,
    task: opts.task.id,
    rep: opts.rep,
    model: opts.model,
    effort: opts.effort,
    padding: opts.task.padding,
    smoke: opts.smoke ?? false,
    usage: parsed.usage,
    requests: parsed.requests,
    tool_calls: parsed.toolCalls,
    wall_ms: wallMs,
    cost_usd: parsed.costUsd,
    cost_source: "claude-code-estimate",
    cache_state:
      parsed.firstRequestCacheRead === null ? "unknown" : parsed.firstRequestCacheRead > 0 ? "warm" : "cold",
    correct: g.correct,
    problems: g.problems,
    stop_reason: parsed.stopReason,
    error,
    answer: parsed.answer,
    extra: {
      num_turns: parsed.numTurns,
      duration_ms: parsed.durationMs,
      duration_api_ms: parsed.durationApiMs,
      code_mode_requested: opts.mode === "E",
      // In Code Mode, MCP tools are callable only inside REPL, and the transcript shows the inner tool calls
      // rather than the code, so a REPL block may never appear in the stream. Visible REPL calls prove Code
      // Mode ran; their absence proves nothing. Compare first_request_prompt_tokens with mode D as well.
      repl_calls_visible: replCalls,
      first_request_prompt_tokens: parsed.firstRequestPromptTokens,
      tools_at_init: parsed.toolsAtInit,
      code_mode_notices: parsed.codeModeNotices,
      model_usage: parsed.modelUsage,
    },
  };
}

export class CodeModeInactiveError extends Error {
  constructor(tools: string[]) {
    super(
      `Code Mode was requested but the init event lists no REPL tool (tools: ${tools.join(", ") || "none"}). ` +
        "Claude Code does not run Code Mode under -p; measure mode E from an interactive session " +
        "(docs/claude-code-code-mode.md). Run stopped before the model was asked anything.",
    );
  }
}

/** Returns the init event's tool list once it is in `out`, or undefined while it has not arrived. */
export function initTools(out: string): string[] | undefined {
  for (const line of out.split("\n")) {
    if (!line.includes('"subtype":"init"')) continue;
    try {
      const e = JSON.parse(line) as StreamEvent;
      if (e.type === "system" && e.subtype === "init") return Array.isArray(e.tools) ? (e.tools as string[]) : [];
    } catch {
      /* partial line */
    }
  }
  return undefined;
}

export async function runClaudeCodeTask(opts: CcRunOptions): Promise<{ record: RunRecord; stdout: string; stderr: string }> {
  const dir = mkdtempSync(path.join(tmpdir(), "mcp-code-mode-bench-"));
  const configPath = path.join(dir, "mcp.json");
  writeFileSync(configPath, JSON.stringify(mcpConfig(opts.task.padding)));
  const { args, env } = buildClaudeArgs(opts, configPath);

  const startedAt = new Date();
  const started = Date.now();
  let inactive: CodeModeInactiveError | undefined;
  const { stdout, stderr, code } = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve) => {
    const child = spawn(opts.claudeBin ?? "claude", args, {
      cwd: dir, // an empty folder: no CLAUDE.md, no git repository
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    let checked = opts.mode !== "E";
    child.stdout.on("data", (d) => {
      out += d;
      if (checked) return;
      const tools = initTools(out);
      if (tools === undefined) return;
      checked = true;
      // Fail loudly, and early: without REPL this would silently be a second classic run.
      if (!tools.includes("REPL")) {
        inactive = new CodeModeInactiveError(tools);
        child.kill("SIGTERM");
      }
    });
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => child.kill("SIGTERM"), opts.timeoutMs ?? 15 * 60_000);
    child.on("close", (c) => {
      clearTimeout(timer);
      resolve({ stdout: out, stderr: err, code: c });
    });
  });
  const wallMs = Date.now() - started;
  rmSync(dir, { recursive: true, force: true });
  if (inactive) throw inactive;

  const parsed = parseStreamJson(stdout);
  const streamFile = saveStream(opts, stdout, dir);
  const error = code === 0 ? null : `claude exited with code ${code}: ${stderr.slice(0, 500)}`;
  const record = toRecord(opts, parsed, wallMs, startedAt, error);
  record.extra = { ...record.extra, stream_file: path.relative(path.dirname(RAW_DIR), streamFile) };
  return { record, stdout, stderr };
}

/** Local paths (home folder, temp folder) are replaced, so the stream can be published. */
export function redactPaths(text: string, tempDir: string): string {
  return text.split(tempDir).join("<run-dir>").split(homedir()).join("~");
}

function saveStream(opts: CcRunOptions, stdout: string, tempDir: string): string {
  const dir = path.join(RAW_DIR, "streams");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${opts.batchId}-${opts.mode}-${opts.task.id}-${opts.rep}.jsonl`);
  writeFileSync(file, redactPaths(stdout, tempDir));
  return file;
}
