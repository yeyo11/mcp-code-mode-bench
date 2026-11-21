import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type Anthropic from "@anthropic-ai/sdk";
import { buildTasks } from "../tasks/src/tasks.js";

export const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Loads a recorded file, filling in the fixture-dependent values (T2's document id and count). */
export function loadRecorded(name: string): string {
  const t2 = buildTasks().T2.expected as { document_id: string; open_comments: number };
  const prompt = JSON.stringify(buildTasks().T2.prompt).slice(1, -1);
  return readFileSync(path.join(HERE, "recorded", name), "utf8")
    .replace(/__PROMPT__/g, () => prompt)
    .replace(/__BUDGET_ID__/g, t2.document_id)
    .replace(/__OPEN__/g, String(t2.open_comments));
}

export function recordedResponses(name: string): Anthropic.Messages.Message[] {
  return (JSON.parse(loadRecorded(name)) as { responses: Anthropic.Messages.Message[] }).responses;
}

/** A Messages client that replays responses in order and keeps a deep copy of every request. */
export function replayClient(responses: Anthropic.Messages.Message[]) {
  const requests: Anthropic.Messages.MessageCreateParamsNonStreaming[] = [];
  let i = 0;
  return {
    requests,
    async create(params: Anthropic.Messages.MessageCreateParamsNonStreaming) {
      requests.push(structuredClone(params));
      const res = responses[i++];
      if (!res) throw new Error("replay client ran out of responses");
      return structuredClone(res);
    },
  };
}
