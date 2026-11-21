// Grades a model's final answer against the expected answer: exact set and count matches.

import type { T1Answer, T2Answer, Task, TaskId } from "./tasks.js";

export interface Grade {
  correct: boolean;
  /** Short machine-readable reasons when the answer is wrong (empty when correct). */
  problems: string[];
  parsed: unknown;
}

/** The last ```json fenced block; failing that, the last balanced {...} in the text. */
export function extractJson(answer: string): unknown {
  const fences = [...answer.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)];
  for (const m of fences.reverse()) {
    try {
      return JSON.parse(m[1]!.trim());
    } catch {
      /* try the next one */
    }
  }
  for (let end = answer.lastIndexOf("}"); end !== -1; end = answer.lastIndexOf("}", end - 1)) {
    let depth = 0;
    for (let i = end; i >= 0; i--) {
      if (answer[i] === "}") depth++;
      else if (answer[i] === "{" && --depth === 0) {
        try {
          return JSON.parse(answer.slice(i, end + 1));
        } catch {
          break;
        }
      }
    }
  }
  return undefined;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function gradeT1(parsed: unknown, expected: T1Answer): string[] {
  if (!isRecord(parsed) || !isRecord(parsed.by_document) || !isRecord(parsed.by_author)) {
    return ["shape: expected {by_document: {...}, by_author: {...}}"];
  }
  const problems: string[] = [];
  const gotDocs = parsed.by_document;
  // A document listed with an empty array is harmless; ignore it.
  const gotDocIds = Object.keys(gotDocs).filter((k) => !(Array.isArray(gotDocs[k]) && (gotDocs[k] as unknown[]).length === 0));
  for (const id of Object.keys(expected.by_document)) if (!gotDocIds.includes(id)) problems.push(`missing document ${id}`);
  for (const id of gotDocIds) if (!(id in expected.by_document)) problems.push(`unexpected document ${id}`);
  for (const [id, want] of Object.entries(expected.by_document)) {
    const got = gotDocs[id];
    if (!Array.isArray(got)) continue;
    const gotSet = new Set(got.map(String));
    const missing = want.filter((c) => !gotSet.has(c));
    const extra = [...gotSet].filter((c) => !want.includes(c));
    if (missing.length) problems.push(`document ${id}: ${missing.length} missing comment(s)`);
    if (extra.length) problems.push(`document ${id}: ${extra.length} unexpected comment(s)`);
    if (gotSet.size !== got.length) problems.push(`document ${id}: duplicate comment ids`);
  }
  const gotAuthors: Record<string, number> = {};
  for (const [k, v] of Object.entries(parsed.by_author)) gotAuthors[k.trim().toLowerCase()] = Number(v);
  for (const [email, n] of Object.entries(expected.by_author)) {
    if (gotAuthors[email] !== n) problems.push(`author ${email}: expected ${n}, got ${gotAuthors[email] ?? "none"}`);
  }
  for (const email of Object.keys(gotAuthors)) {
    if (!(email in expected.by_author) && gotAuthors[email] !== 0) problems.push(`unexpected author ${email}`);
  }
  return problems;
}

function gradeT2(parsed: unknown, expected: T2Answer): string[] {
  if (!isRecord(parsed)) return ["shape: expected {document_id, open_comments}"];
  const problems: string[] = [];
  if (Number(parsed.open_comments) !== expected.open_comments) {
    problems.push(`open_comments: expected ${expected.open_comments}, got ${String(parsed.open_comments)}`);
  }
  if (parsed.document_id !== expected.document_id) problems.push(`document_id: expected ${expected.document_id}`);
  return problems;
}

export function grade(task: Pick<Task, "id" | "expected">, answer: string): Grade {
  const parsed = extractJson(answer);
  if (parsed === undefined) return { correct: false, problems: ["no JSON answer found"], parsed };
  const id: TaskId = task.id;
  const problems =
    id === "T1" ? gradeT1(parsed, task.expected as T1Answer) : gradeT2(parsed, task.expected as T2Answer);
  return { correct: problems.length === 0, problems, parsed };
}
