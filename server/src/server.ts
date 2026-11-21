import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MockDriveApi } from "./drive.js";
import { DEFAULT_SEED, generateDrive } from "./fixtures.js";
import { registerPadding } from "./padding.js";
import { registerTools } from "./tools.js";

export const SERVER_NAME = "google-docs-mcp-mock";
export const SERVER_VERSION = "0.1.0";

export interface ServerOptions {
  padding?: number;
  seed?: number;
}

export function createServer(opts: ServerOptions = {}): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "Read-only access to the user's Google Docs. The main purpose of this server is to describe the comments " +
        "of a document in detail (authors, dates, status, quoted text, reply threads). Start with list_documents " +
        "to find a document, then list_comments or get_comments_summary. Nothing here can modify Google data.",
    },
  );
  registerTools(server, new MockDriveApi(generateDrive(opts.seed ?? DEFAULT_SEED)));
  if (opts.padding) registerPadding(server, opts.padding);
  return server;
}
