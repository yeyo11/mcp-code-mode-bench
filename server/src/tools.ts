// The six tools of @yeyo11/google-docs-mcp, with the same names, input schemas, descriptions and
// output text, answered from the seeded fixtures instead of Google.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { attachContext, type MockDriveApi, parseDocumentId } from "./drive.js";
import { formatComment, formatCommentList, formatDocument, formatDocumentList, formatSummary } from "./format.js";
import type { DocComment } from "./model.js";
import { summarizeComments } from "./summary.js";

export const CORE_TOOL_NAMES = [
  "get_auth_status",
  "list_documents",
  "get_document",
  "list_comments",
  "get_comment",
  "get_comments_summary",
] as const;

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const documentParam = z
  .string()
  .min(1)
  .describe("Google Docs document ID or full URL (https://docs.google.com/document/d/<id>/edit).");

function text(body: string): CallToolResult {
  return { content: [{ type: "text", text: body }] };
}

function jsonOrMarkdown(format: "markdown" | "json", markdown: () => string, data: unknown): CallToolResult {
  return format === "json" ? text(JSON.stringify(data, null, 2)) : text(markdown());
}

function safe<A>(fn: (args: A) => Promise<CallToolResult> | CallToolResult): (args: A) => Promise<CallToolResult> {
  return async (args) => {
    try {
      return await fn(args);
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }] };
    }
  };
}

function filterByStatus(comments: DocComment[], status: "all" | "open" | "resolved"): DocComment[] {
  return status === "all" ? comments : comments.filter((c) => c.status === status);
}

export function registerTools(server: McpServer, api: MockDriveApi): void {
  const me = api.drive.me;

  server.registerTool(
    "get_auth_status",
    {
      title: "Get authentication status",
      description:
        "Check whether the server is signed in to Google and which account is being used. " +
        "Call this first if other tools fail with authentication errors.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    safe(() =>
      text(
        [
          `Signed in as ${me.name} <${me.email ?? "?"}>`,
          "Access mode: READ-ONLY",
          "Granted scopes: https://www.googleapis.com/auth/documents.readonly, https://www.googleapis.com/auth/drive.readonly",
          "Token file: (none: mock server for mcp-code-mode-bench, no Google account involved)",
        ].join("\n"),
      ),
    ),
  );

  server.registerTool(
    "list_documents",
    {
      title: "List Google Docs",
      description:
        "Search the user's Google Drive for Google Docs documents (including shared drives). " +
        "Returns name, ID, owner and last-modified date, newest first. Use the returned ID with the other tools.",
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe("Optional free-text search matched against the document title and full text."),
        max_results: z.number().int().min(1).max(100).default(20),
        page_token: z.string().optional().describe("Token from a previous call to fetch the next page."),
      },
      annotations: READ_ONLY,
    },
    safe(({ query, max_results, page_token }) => {
      const result = api.listDocuments({
        ...(query ? { query } : {}),
        pageSize: max_results,
        ...(page_token ? { pageToken: page_token } : {}),
      });
      return text(
        formatDocumentList(result.documents, {
          ...(query ? { query } : {}),
          ...(result.nextPageToken ? { nextPageToken: result.nextPageToken } : {}),
        }),
      );
    }),
  );

  server.registerTool(
    "get_document",
    {
      title: "Get document",
      description:
        "Read a Google Doc: metadata (title, owner, last modified) and its plain-text content across all tabs. " +
        "Useful to understand what the comments refer to.",
      inputSchema: {
        document: documentParam,
        include_content: z.boolean().default(true).describe("Include the document text. Set false for metadata only."),
        max_chars: z
          .number()
          .int()
          .min(100)
          .max(500_000)
          .default(20_000)
          .describe("Maximum number of characters of content to return."),
      },
      annotations: READ_ONLY,
    },
    safe(({ document, include_content, max_chars }) => {
      const id = parseDocumentId(document);
      const info = api.getDocumentInfo(id);
      return text(formatDocument(info, include_content ? api.getDocumentText(id) : undefined, max_chars));
    }),
  );

  server.registerTool(
    "list_comments",
    {
      title: "List comments",
      description:
        "List the comments of a Google Doc in full detail: author, dates, open/resolved status, the quoted text " +
        "each comment refers to, every reply in the thread (with who resolved or reopened it) and, optionally, " +
        "the surrounding paragraph of the document. This is the main tool of this server.",
      inputSchema: {
        document: documentParam,
        status: z.enum(["all", "open", "resolved"]).default("all").describe("Filter by resolution status."),
        include_deleted: z.boolean().default(false).describe("Also return deleted comments and replies."),
        include_context: z
          .boolean()
          .default(false)
          .describe("Fetch the document text and attach the paragraph where each quoted text appears."),
        max_results: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(100)
          .describe("Page size. Comments are returned newest first."),
        page_token: z.string().optional().describe("Token from a previous call to fetch the next page."),
        format: z
          .enum(["markdown", "json"])
          .default("markdown")
          .describe("markdown is easier to read; json returns the structured objects."),
      },
      annotations: READ_ONLY,
    },
    safe(({ document, status, include_deleted, include_context, max_results, page_token, format }) => {
      const id = parseDocumentId(document);
      const info = api.getDocumentInfo(id);
      const page = api.listCommentsPage(id, {
        includeDeleted: include_deleted,
        pageSize: max_results,
        ...(page_token ? { pageToken: page_token } : {}),
      });
      const comments = filterByStatus(page.comments, status);
      if (include_context && comments.some((c) => c.quotedText)) attachContext(comments, api.getDocumentText(id));

      const filterLabel = [status, include_deleted ? "including deleted" : null].filter(Boolean).join(", ");
      return jsonOrMarkdown(
        format,
        () =>
          formatCommentList(info, comments, {
            filterLabel,
            ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}),
          }),
        { document: info, comments, nextPageToken: page.nextPageToken ?? null },
      );
    }),
  );

  server.registerTool(
    "get_comment",
    {
      title: "Get a single comment thread",
      description:
        "Fetch one comment of a Google Doc by ID with its full reply thread, quoted text and surrounding paragraph.",
      inputSchema: {
        document: documentParam,
        comment_id: z.string().min(1).describe("Comment ID as returned by list_comments."),
        include_context: z.boolean().default(true).describe("Attach the paragraph where the quoted text appears."),
        format: z.enum(["markdown", "json"]).default("markdown"),
      },
      annotations: READ_ONLY,
    },
    safe(({ document, comment_id, include_context, format }) => {
      const id = parseDocumentId(document);
      const info = api.getDocumentInfo(id);
      const comment = api.getComment(id, comment_id);
      if (include_context && comment.quotedText) attachContext([comment], api.getDocumentText(id));
      return jsonOrMarkdown(
        format,
        () => `${formatComment(comment)}\n\nDocument: **${info.name}** (\`${info.id}\`)`,
        { document: info, comment },
      );
    }),
  );

  server.registerTool(
    "get_comments_summary",
    {
      title: "Summarize comments",
      description:
        "Aggregate view of all comments in a Google Doc: counts by status, participants and their activity, " +
        "open comments with no replies, open comments waiting for the original author, oldest open comment and " +
        "latest activity. Reads every page of comments.",
      inputSchema: {
        document: documentParam,
        format: z.enum(["markdown", "json"]).default("markdown"),
      },
      annotations: READ_ONLY,
    },
    safe(({ document, format }) => {
      const id = parseDocumentId(document);
      const info = api.getDocumentInfo(id);
      const summary = summarizeComments(api.listAllComments(id, true));
      return jsonOrMarkdown(format, () => formatSummary(info, summary), { document: info, summary });
    }),
  );
}
