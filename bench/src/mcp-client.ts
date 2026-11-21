// Spawns the mock server over stdio as an MCP client and exposes its tools to the harness.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SERVER_ENTRY } from "../../shared/paths.js";

export interface McpToolDef {
  name: string;
  description: string;
  input_schema: { type: "object"; [k: string]: unknown };
}

export interface ToolCallOutcome {
  text: string;
  isError: boolean;
}

export interface ToolBackend {
  tools: McpToolDef[];
  call(name: string, args: Record<string, unknown>): Promise<ToolCallOutcome>;
  close(): Promise<void>;
}

export async function connectMockServer(padding: number): Promise<ToolBackend> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_ENTRY, "--padding", String(padding)],
    stderr: "ignore",
  });
  const client = new Client({ name: "mcp-code-mode-bench", version: "0.1.0" });
  await client.connect(transport);

  const tools: McpToolDef[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : {});
    for (const t of page.tools) {
      tools.push({
        name: t.name,
        description: t.description ?? "",
        input_schema: t.inputSchema as McpToolDef["input_schema"],
      });
    }
    cursor = page.nextCursor;
  } while (cursor);

  return {
    tools,
    async call(name, args) {
      const res = await client.callTool({ name, arguments: args });
      const content = Array.isArray(res.content) ? res.content : [];
      const text = content
        .map((c: { type: string; text?: string }) => (c.type === "text" ? (c.text ?? "") : `[${c.type}]`))
        .join("\n");
      return { text, isError: res.isError === true };
    },
    close: () => client.close(),
  };
}
