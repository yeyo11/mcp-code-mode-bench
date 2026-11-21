import assert from "node:assert/strict";
import { test } from "node:test";
import { extractJson, grade } from "../tasks/src/checker.js";
import { buildTasks, type T1Answer, type T2Answer } from "../tasks/src/tasks.js";

const tasks = buildTasks();
const t1 = tasks.T1.expected as T1Answer;
const t2 = tasks.T2.expected as T2Answer;
const fence = (v: unknown) => `Here you go.\n\n\`\`\`json\n${JSON.stringify(v)}\n\`\`\``;

test("extractJson takes the last fenced block, or the last object", () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```\ntext\n```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(extractJson('The answer is {"a": {"b": 3}}.'), { a: { b: 3 } });
  assert.equal(extractJson("no json here"), undefined);
});

test("T2: exact count and document id", () => {
  assert.equal(grade(tasks.T2, fence(t2)).correct, true);
  assert.equal(grade(tasks.T2, fence({ ...t2, open_comments: t2.open_comments + 1 })).correct, false);
  assert.equal(grade(tasks.T2, fence({ ...t2, document_id: "1wrongwrongwrong" })).correct, false);
  assert.equal(grade(tasks.T2, "13").correct, false);
});

test("T1: exact sets per document and counts per author", () => {
  assert.equal(grade(tasks.T1, fence(t1)).correct, true);

  // Order and email case do not matter.
  const shuffled: T1Answer = {
    by_document: Object.fromEntries(Object.entries(t1.by_document).reverse().map(([k, v]) => [k, [...v].reverse()])),
    by_author: Object.fromEntries(Object.entries(t1.by_author).map(([k, v]) => [k.toUpperCase(), v])),
  };
  assert.equal(grade(tasks.T1, fence(shuffled)).correct, true);

  const [docId, ids] = Object.entries(t1.by_document)[0]!;
  const missing = structuredClone(t1);
  missing.by_document[docId] = ids.slice(1);
  const g = grade(tasks.T1, fence(missing));
  assert.equal(g.correct, false);
  assert.match(g.problems.join(";"), /missing comment/);

  const wrongCount = structuredClone(t1);
  const author = Object.keys(wrongCount.by_author)[0]!;
  wrongCount.by_author[author]! += 1;
  assert.equal(grade(tasks.T1, fence(wrongCount)).correct, false);

  assert.equal(grade(tasks.T1, fence({ by_document: {} })).correct, false);
});
