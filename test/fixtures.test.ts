import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DEFAULT_SEED, generateDrive, serializeDrive, STALE_CUTOFF } from "../server/src/fixtures.js";
import { EXPECTED_PATH, FIXTURES_PATH } from "../shared/paths.js";
import { buildTasks, lastReplyTime } from "../tasks/src/tasks.js";

test("fixtures are deterministic and match the committed snapshot", () => {
  const a = serializeDrive(generateDrive(DEFAULT_SEED));
  const b = serializeDrive(generateDrive(DEFAULT_SEED));
  assert.equal(a, b);
  assert.equal(a, readFileSync(FIXTURES_PATH, "utf8"), "run `npm run fixtures` and commit the snapshot");
  assert.notEqual(serializeDrive(generateDrive(DEFAULT_SEED + 1)), a, "the seed must matter");
});

test("fixtures have the designed shape", () => {
  const drive = generateDrive();
  assert.equal(drive.documents.length, 20);
  assert.equal(drive.today, "2026-11-20T00:00:00.000Z");
  const comments = drive.documents.flatMap((d) => d.comments);
  assert.equal(comments.length, 300);
  assert.ok(comments.some((c) => c.status === "resolved") && comments.some((c) => c.status === "open"));
  assert.ok(comments.some((c) => c.deleted), "some deleted comments");
  assert.ok(comments.some((c) => c.replies.some((r) => r.action === "reopen")), "some reopened threads");
  assert.ok(comments.filter((c) => c.quotedText).length > 200, "most comments quote text");
  const ids = new Set(comments.map((c) => c.id));
  assert.equal(ids.size, 300, "comment ids are unique");
  assert.equal(drive.documents.filter((d) => d.info.name === "Budget 2027").length, 1);
  for (const c of comments) {
    assert.ok(c.createdTime < drive.today, "nothing happens after today");
    for (const r of c.replies) assert.ok(r.createdTime >= c.createdTime && r.createdTime < drive.today);
  }
  // No last-reply time sits within 12 h of T1's cutoff, so the answer never depends on rounding.
  const cutoff = Date.parse(STALE_CUTOFF);
  for (const c of comments) assert.ok(Math.abs(Date.parse(lastReplyTime(c)) - cutoff) >= 12 * 3_600_000);
  // No personal data: every address is on the reserved .example TLD.
  for (const p of drive.people) assert.match(p.email ?? "", /@harbor-analytics\.example$/);
});

test("expected answers are stable", () => {
  const tasks = buildTasks();
  const t1 = tasks.T1.expected as { by_document: Record<string, string[]>; by_author: Record<string, number> };
  const total = Object.values(t1.by_document).reduce((n, ids) => n + ids.length, 0);
  assert.equal(total, Object.values(t1.by_author).reduce((n, k) => n + k, 0));
  assert.ok(total > 20, "T1 has a real answer");
  assert.deepEqual(tasks.T2.expected, tasks.T3.expected);
  assert.equal(tasks.T3.padding, 200);
  assert.equal(`${JSON.stringify(tasks, null, 2)}\n`, readFileSync(EXPECTED_PATH, "utf8"), "run `npm run fixtures`");
});
