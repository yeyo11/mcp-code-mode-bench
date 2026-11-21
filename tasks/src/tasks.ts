// T1-T3: prompts, and expected answers computed from the fixtures (never typed by hand).

import { generateDrive, STALE_CUTOFF } from "../../server/src/fixtures.js";
import type { DocComment, MockDrive } from "../../server/src/model.js";

export type TaskId = "T1" | "T2" | "T3";
export const TASK_IDS: readonly TaskId[] = ["T1", "T2", "T3"];

export interface T1Answer {
  by_document: Record<string, string[]>;
  by_author: Record<string, number>;
}

export interface T2Answer {
  document_id: string;
  open_comments: number;
}

export interface Task {
  id: TaskId;
  title: string;
  /** Filler tools the server is started with. */
  padding: number;
  prompt: string;
  expected: T1Answer | T2Answer;
}

export const BUDGET_DOC_TITLE = "Budget 2027";

const ANSWER_RULE = "End your answer with exactly one fenced ```json code block holding the answer in this shape, and nothing after it:";

/** The time of the newest visible reply, or of the comment itself when nobody replied. */
export function lastReplyTime(c: DocComment): string {
  const visible = c.replies.filter((r) => !r.deleted);
  return visible.reduce((max, r) => (r.createdTime > max ? r.createdTime : max), c.createdTime);
}

export function staleOpenComments(drive: MockDrive): T1Answer {
  const byDocument: Record<string, string[]> = {};
  const byAuthor: Record<string, number> = {};
  for (const doc of drive.documents) {
    const stale = doc.comments.filter((c) => !c.deleted && c.status === "open" && lastReplyTime(c) < STALE_CUTOFF);
    if (stale.length === 0) continue;
    byDocument[doc.info.id] = stale.map((c) => c.id).sort();
    for (const c of stale) {
      const key = (c.author.email ?? c.author.name).toLowerCase();
      byAuthor[key] = (byAuthor[key] ?? 0) + 1;
    }
  }
  return { by_document: byDocument, by_author: byAuthor };
}

export function openCommentsOf(drive: MockDrive, title: string): T2Answer {
  const doc = drive.documents.find((d) => d.info.name === title);
  if (!doc) throw new Error(`No document titled ${title}`);
  return {
    document_id: doc.info.id,
    open_comments: doc.comments.filter((c) => !c.deleted && c.status === "open").length,
  };
}

const T1_PROMPT = [
  "Today is 2026-11-20. In every document of the Q4 planning folder (every document you can see through these tools is in that folder),",
  "find the open comments that have had no reply for more than 7 days.",
  "A comment counts when it is open, not deleted, and the most recent reply in its thread (or the comment itself, if it has no replies)",
  "was created before 2026-11-13T00:00:00Z. Group those comments by document and count them per comment author.",
  ANSWER_RULE,
  '{"by_document": {"<document id>": ["<comment id>", "..."]}, "by_author": {"<comment author email>": <number of such comments>}}',
  "List only documents that have at least one such comment.",
].join("\n");

const T2_PROMPT = [
  `How many open comments does the ${BUDGET_DOC_TITLE} document have? Count open comments that are not deleted.`,
  ANSWER_RULE,
  '{"document_id": "<document id>", "open_comments": <number>}',
].join("\n");

export function buildTasks(drive: MockDrive = generateDrive()): Record<TaskId, Task> {
  const t2 = openCommentsOf(drive, BUDGET_DOC_TITLE);
  return {
    T1: {
      id: "T1",
      title: "Multi-step: stale open comments across 20 documents",
      padding: 0,
      prompt: T1_PROMPT,
      expected: staleOpenComments(drive),
    },
    T2: {
      id: "T2",
      title: "Single call: open comments of one document (control)",
      padding: 0,
      prompt: T2_PROMPT,
      expected: t2,
    },
    T3: {
      id: "T3",
      title: "T2 with 200 filler tools in the catalogue",
      padding: 200,
      prompt: T2_PROMPT,
      expected: t2,
    },
  };
}

/** Same system prompt for every API mode. Claude Code keeps its own system prompt. */
export const SYSTEM_PROMPT =
  "You answer questions about a team's Google Docs and their comments using the tools you have. " +
  "Use the tools to get the facts; never guess IDs or counts. Be concise.";
