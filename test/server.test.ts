import assert from "node:assert/strict";
import { test } from "node:test";
import { connectMockServer } from "../bench/src/mcp-client.js";
import { CORE_TOOL_NAMES } from "../server/src/tools.js";
import { buildTasks, type T2Answer } from "../tasks/src/tasks.js";

test("the server lists the 6 tools of google-docs-mcp over stdio", async () => {
  const backend = await connectMockServer(0);
  try {
    assert.deepEqual(backend.tools.map((t) => t.name).sort(), [...CORE_TOOL_NAMES].sort());
  } finally {
    await backend.close();
  }
});

test("--padding N adds N filler tools", async () => {
  for (const n of [44, 200]) {
    const backend = await connectMockServer(n);
    try {
      assert.equal(backend.tools.length, 6 + n);
      assert.equal(new Set(backend.tools.map((t) => t.name)).size, 6 + n, "names are unique");
    } finally {
      await backend.close();
    }
  }
});

test("tool answers agree with the expected answers", async () => {
  const t2 = buildTasks().T2.expected as T2Answer;
  const backend = await connectMockServer(0);
  try {
    const docs = await backend.call("list_documents", {});
    assert.match(docs.text, /^# Recent Google Docs: 20/);
    assert.ok(docs.text.includes(t2.document_id));

    const open = await backend.call("list_comments", { document: t2.document_id, status: "open", format: "json" });
    assert.equal((JSON.parse(open.text) as { comments: unknown[] }).comments.length, t2.open_comments);

    const md = await backend.call("list_comments", { document: t2.document_id, status: "open" });
    assert.match(md.text, new RegExp(`## Comments \\(open\\): ${t2.open_comments}`));

    const summary = await backend.call("get_comments_summary", {
      document: `https://docs.google.com/document/d/${t2.document_id}/edit`,
      format: "json",
    });
    assert.equal((JSON.parse(summary.text) as { summary: { open: number } }).summary.open, t2.open_comments);

    const missing = await backend.call("get_document", { document: "1doesnotexist0000" });
    assert.equal(missing.isError, true);
  } finally {
    await backend.close();
  }
});
