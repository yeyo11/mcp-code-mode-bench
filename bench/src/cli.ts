#!/usr/bin/env node
// npm run bench -- <api|claude-code|tasks|tools> [flags]   (see README for examples)

import Anthropic from "@anthropic-ai/sdk";
import { parseArgs } from "node:util";
import { buildTasks, SYSTEM_PROMPT, TASK_IDS, type Task, type TaskId } from "../../tasks/src/tasks.js";
import { runApiTask } from "./api-runner.js";
import { runClaudeCodeTask, type CcMode } from "./claude-code.js";
import { connectMockServer } from "./mcp-client.js";
import { API_MODES, type ApiMode, buildRequest, buildTools, type RequestSettings } from "./modes.js";
import { newBatchId, writeRecord, type RunRecord } from "./record.js";
import { CostGuard } from "./usage.js";

const DEFAULT_MODEL = "claude-sonnet-5-5";
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

function list<T extends string>(value: string, allowed: readonly T[], what: string): T[] {
  const items = value.split(",").map((s) => s.trim()).filter(Boolean);
  for (const i of items) if (!allowed.includes(i as T)) throw new Error(`unknown ${what} "${i}" (use ${allowed.join(", ")})`);
  return items as T[];
}

function summary(r: RunRecord): string {
  const u = r.usage;
  return (
    `${r.mode} ${r.task} rep ${r.rep}: ${r.correct ? "correct" : `WRONG (${r.problems.slice(0, 3).join("; ")})`} · ` +
    `${r.requests} req · in ${u.total_input} (cache w ${u.cache_creation} r ${u.cache_read}) · out ${u.output} · ` +
    `${(r.wall_ms / 1000).toFixed(1)} s · ${r.cost_usd.toFixed(4)} USD · ${r.cache_state}`
  );
}

async function api(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      mode: { type: "string", default: "A,B,C" },
      task: { type: "string", default: "T1,T2,T3" },
      reps: { type: "string", default: "5" },
      model: { type: "string", default: DEFAULT_MODEL },
      effort: { type: "string", default: "medium" },
      cap: { type: "string", default: "9" },
      spent: { type: "string", default: "0" },
      "max-requests": { type: "string", default: "60" },
      "no-cache": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      smoke: { type: "boolean", default: false },
      batch: { type: "string" },
    },
  });
  const modes = list(values.mode, API_MODES, "mode");
  const taskIds = list(values.task, TASK_IDS, "task");
  const effort = list(values.effort, EFFORTS, "effort")[0]!;
  const settings: RequestSettings = { model: values.model, effort, maxTokens: 16_000, cache: !values["no-cache"] };
  const tasks = buildTasks();

  if (values["dry-run"]) {
    for (const id of taskIds) {
      const task = tasks[id];
      const backend = await connectMockServer(task.padding);
      for (const mode of modes) {
        const tools = buildTools(mode, backend.tools);
        const body = buildRequest(settings, SYSTEM_PROMPT, tools, [{ role: "user", content: task.prompt }]);
        const deferred = tools.filter((t) => "defer_loading" in t && t.defer_loading).length;
        console.error(`# dry run ${mode} ${id}: ${tools.length} tools (${deferred} deferred), no request sent`);
        console.log(JSON.stringify({ mode, task: id, request: body }, null, 2));
      }
      await backend.close();
    }
    return;
  }

  const reps = Number(values.reps);
  const guard = new CostGuard(Number(values.cap), Number(values.spent));
  const batchId = values.batch ?? newBatchId(`api-${values.model}`);
  const anthropic = new Anthropic();
  const client = { create: (p: Anthropic.Messages.MessageCreateParamsNonStreaming) => anthropic.messages.create(p) };
  const backends = new Map<number, Awaited<ReturnType<typeof connectMockServer>>>();
  const backendFor = async (t: Task) => {
    let b = backends.get(t.padding);
    if (!b) backends.set(t.padding, (b = await connectMockServer(t.padding)));
    return b;
  };

  let file = "";
  try {
    // Interleave modes inside each repetition, so drift over time hits every mode alike.
    outer: for (let rep = 1; rep <= reps; rep++) {
      for (const id of taskIds) {
        for (const mode of modes) {
          const task = tasks[id as TaskId];
          const { record, budgetExceeded } = await runApiTask({
            mode: mode as ApiMode,
            task,
            rep,
            batchId,
            settings,
            client,
            backend: await backendFor(task),
            guard,
            maxRequests: Number(values["max-requests"]),
            smoke: values.smoke,
          });
          file = writeRecord(record);
          console.log(`${summary(record)} · total ${guard.spentUsd.toFixed(4)} USD`);
          if (budgetExceeded) {
            console.error(budgetExceeded.message);
            process.exitCode = 3;
            break outer;
          }
        }
      }
    }
  } finally {
    for (const b of backends.values()) await b.close();
  }
  if (file) console.log(`raw results: ${file}`);
}

async function claudeCode(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      mode: { type: "string", default: "D,E" },
      task: { type: "string", default: "T1,T2,T3" },
      reps: { type: "string", default: "5" },
      model: { type: "string", default: DEFAULT_MODEL },
      effort: { type: "string", default: "medium" },
      smoke: { type: "boolean", default: false },
      batch: { type: "string" },
      claude: { type: "string", default: "claude" },
    },
  });
  const modes = list(values.mode, ["D", "E"] as const, "mode");
  const taskIds = list(values.task, TASK_IDS, "task");
  const tasks = buildTasks();
  const batchId = values.batch ?? newBatchId(`claude-code-${values.model}`);
  let file = "";
  for (let rep = 1; rep <= Number(values.reps); rep++) {
    for (const id of taskIds) {
      for (const mode of modes) {
        const { record } = await runClaudeCodeTask({
          mode: mode as CcMode,
          task: tasks[id],
          rep,
          batchId,
          model: values.model,
          effort: values.effort,
          smoke: values.smoke,
          claudeBin: values.claude,
        });
        file = writeRecord(record);
        const cm =
          mode === "E" || mode === "D"
            ? ` · first request ${String(record.extra?.first_request_prompt_tokens)} prompt tokens · REPL calls visible ${String(record.extra?.repl_calls_visible ?? 0)}`
            : "";
        console.log(`${summary(record)}${cm}`);
      }
    }
  }
  if (file) console.log(`raw results: ${file}`);
}

async function showTasks(): Promise<void> {
  const tasks = buildTasks();
  for (const id of TASK_IDS) console.log(JSON.stringify(tasks[id], null, 2));
}

async function showTools(argv: string[]): Promise<void> {
  const { values } = parseArgs({ args: argv, options: { padding: { type: "string", default: "0" } } });
  const backend = await connectMockServer(Number(values.padding));
  for (const t of backend.tools) console.log(`${t.name}\t${t.description.slice(0, 90)}`);
  console.error(`${backend.tools.length} tools`);
  await backend.close();
}

const [command, ...rest] = process.argv.slice(2);
const commands: Record<string, (argv: string[]) => Promise<void>> = {
  api,
  "claude-code": claudeCode,
  tasks: showTasks,
  tools: showTools,
};
const run = command ? commands[command] : undefined;
if (!run) {
  console.error("usage: npm run bench -- <api|claude-code|tasks|tools> [flags]");
  process.exit(2);
}
run(rest).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
