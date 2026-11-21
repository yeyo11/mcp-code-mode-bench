// Mode E (and, for comparison, D) from an interactive Claude Code session's transcript:
// ~/.claude/projects/<project folder>/<session id>.jsonl. Code Mode runs only in interactive sessions,
// so this is how its runs are measured. Manual steps: docs/claude-code-code-mode.md.

import { readFileSync } from "node:fs";
import { grade } from "../../tasks/src/checker.js";
import type { Task } from "../../tasks/src/tasks.js";
import type { ModeId, RunRecord } from "./record.js";
import { addUsage, emptyTotals, requestCost, type RequestUsage, type UsageTotals } from "./usage.js";

interface TranscriptLine {
  type?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  timestamp?: string;
  message?: {
    id?: string;
    model?: string;
    role?: string;
    content?: string | { type: string; name?: string; text?: string }[];
    usage?: RequestUsage;
  };
}

export interface TranscriptSummary {
  usage: UsageTotals;
  /** Model requests: distinct assistant message ids (a message is logged once per content block). */
  requests: number;
  sidechainRequests: number;
  models: string[];
  replCalls: number;
  mcpCalls: number;
  otherCalls: Record<string, number>;
  firstPrompt: string;
  answer: string;
  wallMs: number;
  costUsd: number;
  firstRequestPromptTokens: number | null;
  firstRequestCacheRead: number | null;
}

export class TranscriptCodeModeError extends Error {}

function textOf(content: NonNullable<TranscriptLine["message"]>["content"]): string {
  if (typeof content === "string") return content;
  return (content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
}

/** The folder Claude Code keeps a working directory's transcripts in. */
export function projectDirFor(cwd: string, home: string): string {
  return `${home}/.claude/projects/${cwd.replace(/[^A-Za-z0-9]/g, "-")}`;
}

export function parseTranscript(jsonl: string): TranscriptSummary {
  const lines: TranscriptLine[] = [];
  for (const raw of jsonl.split("\n")) {
    if (!raw.trim()) continue;
    try {
      lines.push(JSON.parse(raw) as TranscriptLine);
    } catch {
      /* skip */
    }
  }

  // Last line wins per message id: the logged usage is the same on every block of one message.
  const messages = new Map<string, TranscriptLine>();
  const blocks: { type: string; name?: string }[] = [];
  let firstPrompt = "";
  let firstUserAt: string | undefined;
  let lastAssistantAt: string | undefined;
  let answer = "";
  for (const l of lines) {
    if (l.type === "user" && !l.isMeta && !l.isSidechain && !firstPrompt) {
      const text = textOf(l.message?.content);
      if (text.trim() && !text.startsWith("<")) {
        firstPrompt = text.trim();
        firstUserAt = l.timestamp;
      }
    }
    if (l.type !== "assistant" || !l.message?.id) continue;
    messages.set(l.message.id, l);
    if (!l.isSidechain) {
      lastAssistantAt = l.timestamp ?? lastAssistantAt;
      const t = textOf(l.message.content);
      if (t.trim()) answer = t.trim();
    }
    if (Array.isArray(l.message.content)) blocks.push(...l.message.content);
  }

  let usage = emptyTotals();
  let cost = 0;
  const models = new Set<string>();
  let sidechainRequests = 0;
  let first: RequestUsage | undefined;
  for (const l of messages.values()) {
    const u = l.message!.usage;
    if (!u) continue;
    first ??= u;
    usage = addUsage(usage, u);
    const model = l.message!.model ?? "";
    models.add(model);
    try {
      cost += requestCost(model, u);
    } catch {
      /* model without a price (e.g. a side call): tokens still counted */
    }
    if (l.isSidechain) sidechainRequests++;
  }

  let replCalls = 0;
  let mcpCalls = 0;
  const otherCalls: Record<string, number> = {};
  for (const b of blocks) {
    if (b.type !== "tool_use" || !b.name) continue;
    if (b.name === "REPL") replCalls++;
    else if (b.name.startsWith("mcp__")) mcpCalls++;
    else otherCalls[b.name] = (otherCalls[b.name] ?? 0) + 1;
  }

  const wallMs = firstUserAt && lastAssistantAt ? Date.parse(lastAssistantAt) - Date.parse(firstUserAt) : 0;
  return {
    usage,
    requests: messages.size,
    sidechainRequests,
    models: [...models],
    replCalls,
    mcpCalls,
    otherCalls,
    firstPrompt,
    answer,
    wallMs,
    costUsd: cost,
    firstRequestPromptTokens: first
      ? first.input_tokens + (first.cache_creation_input_tokens ?? 0) + (first.cache_read_input_tokens ?? 0)
      : null,
    firstRequestCacheRead: first ? (first.cache_read_input_tokens ?? 0) : null,
  };
}

export interface TranscriptRunOptions {
  file: string;
  mode: Extract<ModeId, "D" | "E">;
  task: Task;
  rep: number;
  batchId: string;
  smoke?: boolean;
}

export function transcriptToRecord(opts: TranscriptRunOptions, s: TranscriptSummary): RunRecord {
  // Fail loudly: a mode E transcript with no REPL call is a classic run, not a Code Mode one.
  if (opts.mode === "E" && s.replCalls === 0) {
    throw new TranscriptCodeModeError(
      `${opts.file}: mode E but the session never called REPL (${s.mcpCalls} direct MCP calls). ` +
        'Code Mode was not on: check for "Code Mode (experimental) is on" at the top of the session and /status.',
    );
  }
  const problems: string[] = [];
  if (s.firstPrompt !== opts.task.prompt.trim()) problems.push("first prompt differs from the task prompt");
  const g = grade(opts.task, s.answer);
  return {
    schema: 1,
    batch_id: opts.batchId,
    timestamp: new Date().toISOString(),
    harness: "claude-code",
    mode: opts.mode,
    task: opts.task.id,
    rep: opts.rep,
    model: s.models.filter(Boolean).join("+") || "unknown",
    effort: null,
    padding: opts.task.padding,
    smoke: opts.smoke ?? false,
    usage: s.usage,
    requests: s.requests,
    tool_calls: {
      direct: s.mcpCalls + Object.values(s.otherCalls).reduce((a, b) => a + b, 0),
      programmatic: 0,
      by_name: { REPL: s.replCalls, mcp: s.mcpCalls, ...s.otherCalls },
    },
    wall_ms: s.wallMs,
    cost_usd: s.costUsd,
    cost_source: "price-table",
    cache_state: s.firstRequestCacheRead === null ? "unknown" : s.firstRequestCacheRead > 0 ? "warm" : "cold",
    correct: g.correct && problems.length === 0,
    problems: [...problems, ...g.problems],
    stop_reason: null,
    error: null,
    answer: s.answer,
    extra: {
      source: "interactive-transcript",
      code_mode_active: s.replCalls > 0,
      repl_calls_visible: s.replCalls,
      sidechain_requests: s.sidechainRequests,
      first_request_prompt_tokens: s.firstRequestPromptTokens,
      wall_time_note: "first prompt to last assistant message, from transcript timestamps",
    },
  };
}

export function readTranscript(file: string): TranscriptSummary {
  return parseTranscript(readFileSync(file, "utf8"));
}
