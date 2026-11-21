// --padding N: N plausible "workspace" tools that have nothing to do with the tasks. They exist only to
// make the tool catalogue bigger (6 -> 50 -> 206 tools), which is the axis where tool search and Code
// Mode compete. Names, descriptions and schemas are deterministic, so every run sees the same bytes.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

interface Domain {
  prefix: string;
  noun: string;
  plural: string;
  service: string;
  idField: string;
  fields: { name: string; description: string; kind: "string" | "number" | "boolean" | "enum" | "date"; values?: string[] }[];
}

const DOMAINS: Domain[] = [
  {
    prefix: "calendar", noun: "event", plural: "events", service: "Google Calendar", idField: "event_id",
    fields: [
      { name: "calendar_id", description: "Calendar ID, or 'primary' for the user's main calendar.", kind: "string" },
      { name: "time_min", description: "Lower bound (inclusive) for an event's end time, RFC 3339.", kind: "date" },
      { name: "time_max", description: "Upper bound (exclusive) for an event's start time, RFC 3339.", kind: "date" },
      { name: "attendee", description: "Email address of an attendee to filter by.", kind: "string" },
    ],
  },
  {
    prefix: "sheets", noun: "spreadsheet", plural: "spreadsheets", service: "Google Sheets", idField: "spreadsheet_id",
    fields: [
      { name: "range", description: "A1 notation range, for example 'Sheet1!A1:D20'.", kind: "string" },
      { name: "value_render", description: "How values are rendered in the output.", kind: "enum", values: ["formatted", "unformatted", "formula"] },
      { name: "include_grid_data", description: "Return cell-level data and formatting.", kind: "boolean" },
    ],
  },
  {
    prefix: "gmail", noun: "message", plural: "messages", service: "Gmail", idField: "message_id",
    fields: [
      { name: "label", description: "Label to filter by, for example INBOX or a user label name.", kind: "string" },
      { name: "from", description: "Sender address to filter by.", kind: "string" },
      { name: "newer_than_days", description: "Only messages newer than this many days.", kind: "number" },
      { name: "include_spam_trash", description: "Include messages from SPAM and TRASH.", kind: "boolean" },
    ],
  },
  {
    prefix: "tasks", noun: "task", plural: "tasks", service: "Google Tasks", idField: "task_id",
    fields: [
      { name: "tasklist_id", description: "Task list ID. Use the default list when omitted.", kind: "string" },
      { name: "show_completed", description: "Include completed tasks.", kind: "boolean" },
      { name: "due_before", description: "Only tasks due before this date, RFC 3339.", kind: "date" },
    ],
  },
  {
    prefix: "slides", noun: "presentation", plural: "presentations", service: "Google Slides", idField: "presentation_id",
    fields: [
      { name: "slide_index", description: "Zero-based index of the slide.", kind: "number" },
      { name: "include_notes", description: "Include speaker notes.", kind: "boolean" },
      { name: "thumbnail_size", description: "Thumbnail size for rendered slides.", kind: "enum", values: ["small", "medium", "large"] },
    ],
  },
  {
    prefix: "chat", noun: "space message", plural: "space messages", service: "Google Chat", idField: "space_id",
    fields: [
      { name: "space_name", description: "Display name of the space.", kind: "string" },
      { name: "thread_key", description: "Thread key to reply within an existing thread.", kind: "string" },
      { name: "since", description: "Only messages created after this time, RFC 3339.", kind: "date" },
    ],
  },
  {
    prefix: "crm", noun: "contact", plural: "contacts", service: "the CRM", idField: "contact_id",
    fields: [
      { name: "company", description: "Company name to filter by.", kind: "string" },
      { name: "lifecycle_stage", description: "Lifecycle stage of the contact.", kind: "enum", values: ["lead", "opportunity", "customer", "churned"] },
      { name: "owner_email", description: "Email of the account owner.", kind: "string" },
    ],
  },
  {
    prefix: "tickets", noun: "ticket", plural: "tickets", service: "the help desk", idField: "ticket_id",
    fields: [
      { name: "priority", description: "Ticket priority.", kind: "enum", values: ["low", "normal", "high", "urgent"] },
      { name: "assignee", description: "Email of the assigned agent.", kind: "string" },
      { name: "created_after", description: "Only tickets created after this time, RFC 3339.", kind: "date" },
    ],
  },
  {
    prefix: "drive_files", noun: "file", plural: "files", service: "Google Drive", idField: "file_id",
    fields: [
      { name: "mime_type", description: "MIME type to filter by, for example application/pdf.", kind: "string" },
      { name: "folder_id", description: "Parent folder ID.", kind: "string" },
      { name: "include_trashed", description: "Include files in the trash.", kind: "boolean" },
    ],
  },
  {
    prefix: "forms", noun: "form response", plural: "form responses", service: "Google Forms", idField: "form_id",
    fields: [
      { name: "submitted_after", description: "Only responses submitted after this time, RFC 3339.", kind: "date" },
      { name: "question_id", description: "Restrict the output to one question.", kind: "string" },
    ],
  },
  {
    prefix: "meet", noun: "meeting recording", plural: "meeting recordings", service: "Google Meet", idField: "conference_id",
    fields: [
      { name: "organizer", description: "Email of the meeting organizer.", kind: "string" },
      { name: "include_transcript", description: "Attach the transcript when one exists.", kind: "boolean" },
    ],
  },
  {
    prefix: "analytics", noun: "report", plural: "reports", service: "the analytics workspace", idField: "report_id",
    fields: [
      { name: "start_date", description: "First day of the report, YYYY-MM-DD.", kind: "date" },
      { name: "end_date", description: "Last day of the report, YYYY-MM-DD.", kind: "date" },
      { name: "granularity", description: "Bucket size for time series.", kind: "enum", values: ["day", "week", "month"] },
      { name: "segment", description: "Saved segment name to apply.", kind: "string" },
    ],
  },
];

const ACTIONS: { verb: string; summary: (d: Domain) => string; needsId: boolean; usesFilters: boolean; extra?: string }[] = [
  { verb: "list", summary: (d) => `List ${d.plural} in ${d.service}, newest first. Supports filters and pagination.`, needsId: false, usesFilters: true },
  { verb: "get", summary: (d) => `Fetch one ${d.noun} from ${d.service} by ID with all of its fields.`, needsId: true, usesFilters: false },
  { verb: "search", summary: (d) => `Full-text search across ${d.plural} in ${d.service}. Returns the best matches with a snippet.`, needsId: false, usesFilters: true, extra: "query" },
  { verb: "create", summary: (d) => `Create a new ${d.noun} in ${d.service}. Returns the created object.`, needsId: false, usesFilters: true, extra: "title" },
  { verb: "update", summary: (d) => `Update fields of an existing ${d.noun} in ${d.service}. Only the given fields change.`, needsId: true, usesFilters: true },
  { verb: "delete", summary: (d) => `Delete a ${d.noun} from ${d.service}. This cannot be undone.`, needsId: true, usesFilters: false },
  { verb: "archive", summary: (d) => `Archive a ${d.noun} in ${d.service} so it no longer shows in default lists.`, needsId: true, usesFilters: false },
  { verb: "export", summary: (d) => `Export ${d.plural} from ${d.service} as CSV or JSON.`, needsId: false, usesFilters: true, extra: "export_format" },
  { verb: "count", summary: (d) => `Count ${d.plural} in ${d.service} that match the filters, without returning them.`, needsId: false, usesFilters: true },
  { verb: "share", summary: (d) => `Share a ${d.noun} from ${d.service} with a user or group.`, needsId: true, usesFilters: false, extra: "share" },
  { verb: "get_history", summary: (d) => `Return the change history of a ${d.noun} in ${d.service}: who changed what and when.`, needsId: true, usesFilters: false },
  { verb: "list_watchers", summary: (d) => `List the users who follow a ${d.noun} in ${d.service} and get notified on changes.`, needsId: true, usesFilters: false },
  { verb: "bulk_update", summary: (d) => `Apply the same change to many ${d.plural} in ${d.service} at once.`, needsId: false, usesFilters: true, extra: "ids" },
  { verb: "duplicate", summary: (d) => `Make a copy of a ${d.noun} in ${d.service}.`, needsId: true, usesFilters: false, extra: "title" },
  { verb: "restore", summary: (d) => `Restore an archived or deleted ${d.noun} in ${d.service}.`, needsId: true, usesFilters: false },
  { verb: "get_permissions", summary: (d) => `List who can view or edit a ${d.noun} in ${d.service}.`, needsId: true, usesFilters: false },
  { verb: "subscribe", summary: (d) => `Register a webhook that is called when ${d.plural} in ${d.service} change.`, needsId: false, usesFilters: true, extra: "webhook" },
  { verb: "get_stats", summary: (d) => `Aggregate statistics about ${d.plural} in ${d.service} for a time range.`, needsId: false, usesFilters: true },
];

export const MAX_PADDING = DOMAINS.length * ACTIONS.length;

export interface PaddingToolSpec {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, z.ZodType>;
}

function fieldSchema(f: Domain["fields"][number]): z.ZodType {
  switch (f.kind) {
    case "number":
      return z.number().int().min(0).optional().describe(f.description);
    case "boolean":
      return z.boolean().optional().describe(f.description);
    case "enum":
      return z.enum(f.values as [string, ...string[]]).optional().describe(f.description);
    case "date":
    case "string":
      return z.string().optional().describe(f.description);
  }
}

/** Interleaves domains so a small N already spans several services: calendar_list, sheets_list, ... */
export function paddingSpecs(n: number): PaddingToolSpec[] {
  if (n > MAX_PADDING) throw new Error(`--padding supports at most ${MAX_PADDING} tools.`);
  const specs: PaddingToolSpec[] = [];
  for (let i = 0; i < n; i++) {
    const domain = DOMAINS[i % DOMAINS.length]!;
    const action = ACTIONS[Math.floor(i / DOMAINS.length)]!;
    const inputSchema: Record<string, z.ZodType> = {};
    if (action.needsId) inputSchema[domain.idField] = z.string().min(1).describe(`ID of the ${domain.noun}.`);
    if (action.extra === "query") inputSchema.query = z.string().min(1).describe("Search terms.");
    if (action.extra === "title") inputSchema.title = z.string().min(1).describe(`Title of the new ${domain.noun}.`);
    if (action.extra === "export_format") inputSchema.export_format = z.enum(["csv", "json"]).default("csv").describe("Output format.");
    if (action.extra === "ids") inputSchema.ids = z.array(z.string()).min(1).max(100).describe(`IDs of the ${domain.plural} to change.`);
    if (action.extra === "share") {
      inputSchema.email = z.string().min(3).describe("Email of the user or group.");
      inputSchema.role = z.enum(["reader", "commenter", "writer"]).default("reader").describe("Access level to grant.");
    }
    if (action.extra === "webhook") inputSchema.callback_url = z.string().url().describe("HTTPS URL that receives the notifications.");
    if (action.usesFilters) for (const f of domain.fields) inputSchema[f.name] = fieldSchema(f);
    if (action.verb === "list" || action.verb === "search") {
      inputSchema.max_results = z.number().int().min(1).max(100).default(25).describe("Page size.");
      inputSchema.page_token = z.string().optional().describe("Token from a previous call to fetch the next page.");
    }
    specs.push({
      name: `${domain.prefix}_${action.verb}`,
      title: `${action.verb.replace(/_/g, " ")} ${domain.plural}`.replace(/^\w/, (c) => c.toUpperCase()),
      description: action.summary(domain),
      inputSchema,
    });
  }
  return specs;
}

export function registerPadding(server: McpServer, n: number): void {
  for (const spec of paddingSpecs(n)) {
    server.registerTool(
      spec.name,
      { title: spec.title, description: spec.description, inputSchema: spec.inputSchema },
      async () => ({
        isError: true,
        content: [{ type: "text", text: `${spec.name} is not connected in this workspace (benchmark padding tool).` }],
      }),
    );
  }
}
