// How each API mode turns the same MCP tools into the `tools` array of a Messages request.

import type Anthropic from "@anthropic-ai/sdk";
import type { McpToolDef } from "./mcp-client.js";

export type ApiMode = "A" | "B" | "C";
export const API_MODES: readonly ApiMode[] = ["A", "B", "C"];

/** Tool search mode keeps the server's entry point loaded; never defer every tool. */
export const NON_DEFERRED_TOOLS = ["list_documents"] as const;

export const CODE_EXECUTION_TOOL = { type: "code_execution_20260120", name: "code_execution" } as const;
export const TOOL_SEARCH_TOOL = { type: "tool_search_tool_bm25_20251119", name: "tool_search_tool_bm25" } as const;

/** MCP input schemas carry a JSON Schema `$schema` key the Messages API does not need. */
function toCustomTool(t: McpToolDef): Anthropic.Messages.Tool {
  const { $schema: _ignored, ...schema } = t.input_schema as Record<string, unknown>;
  return {
    name: t.name,
    description: t.description,
    input_schema: { ...schema, type: "object" } as Anthropic.Messages.Tool.InputSchema,
  };
}

export function buildTools(mode: ApiMode, mcpTools: McpToolDef[]): Anthropic.Messages.ToolUnion[] {
  const custom = mcpTools.map(toCustomTool);
  switch (mode) {
    case "A":
      return custom;
    case "B": {
      const tools: Anthropic.Messages.ToolUnion[] = [
        TOOL_SEARCH_TOOL,
        ...custom.map((t) =>
          (NON_DEFERRED_TOOLS as readonly string[]).includes(t.name) ? t : { ...t, defer_loading: true },
        ),
      ];
      if (!tools.some((t) => !("defer_loading" in t) || !t.defer_loading)) throw new Error("mode B would defer every tool");
      return tools;
    }
    case "C":
      // No strict: true anywhere (PTC rejects it).
      return [CODE_EXECUTION_TOOL, ...custom.map((t) => ({ ...t, allowed_callers: ["code_execution_20260120" as const] }))];
  }
}

export interface RequestSettings {
  model: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens: number;
  /** Top-level automatic prompt caching (5-minute TTL). On by default in every mode. */
  cache: boolean;
}

export function buildRequest(
  settings: RequestSettings,
  system: string,
  tools: Anthropic.Messages.ToolUnion[],
  messages: Anthropic.Messages.MessageParam[],
  container?: string,
): Anthropic.Messages.MessageCreateParamsNonStreaming {
  // No temperature / top_p: current models reject non-default sampling parameters.
  return {
    model: settings.model,
    max_tokens: settings.maxTokens,
    system,
    tools,
    messages,
    output_config: { effort: settings.effort },
    ...(settings.cache ? { cache_control: { type: "ephemeral" as const } } : {}),
    ...(container ? { container } : {}),
  };
}
