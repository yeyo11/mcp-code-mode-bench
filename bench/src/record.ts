// One JSONL line per run, the same shape for the API harness (A-C) and the Claude Code runner (D-E).

import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { RAW_DIR } from "../../shared/paths.js";
import type { UsageTotals } from "./usage.js";

export type ModeId = "A" | "B" | "C" | "D" | "E";

export const MODE_LABELS: Record<ModeId, string> = {
  A: "A. Classic (API)",
  B: "B. Classic + tool search (API)",
  C: "C. Programmatic tool calling (API)",
  D: "D. Claude Code, classic",
  E: "E. Claude Code, Code Mode",
};

export interface RunRecord {
  schema: 1;
  batch_id: string;
  timestamp: string;
  harness: "api" | "claude-code";
  mode: ModeId;
  task: string;
  rep: number;
  model: string;
  effort: string | null;
  padding: number;
  /** Smoke runs check the plumbing; the report leaves them out. */
  smoke: boolean;
  usage: UsageTotals;
  requests: number;
  tool_calls: { direct: number; programmatic: number; by_name: Record<string, number> };
  wall_ms: number;
  cost_usd: number;
  cost_source: "price-table" | "claude-code-estimate";
  /** cold: the run's first request read nothing from the prompt cache. */
  cache_state: "cold" | "warm" | "unknown";
  correct: boolean;
  problems: string[];
  stop_reason: string | null;
  error: string | null;
  answer: string;
  extra?: Record<string, unknown>;
}

export function writeRecord(record: RunRecord, file = defaultFile(record)): string {
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(record)}\n`);
  return file;
}

function defaultFile(record: RunRecord): string {
  return path.join(RAW_DIR, `${record.batch_id}${record.smoke ? ".smoke" : ""}.jsonl`);
}

export function newBatchId(prefix: string, now = new Date()): string {
  return `${now.toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${prefix}`;
}
