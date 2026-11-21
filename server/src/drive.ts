// In-memory stand-in for the Drive and Docs APIs, over the seeded fixtures.
// Behaviour mirrors @yeyo11/google-docs-mcp's src/google.ts: newest-first ordering, page tokens,
// deleted items hidden unless asked for, and quoted-text context lookup.

import type { CommentContext, DocComment, DocumentInfo, DocumentText, MockDocument, MockDrive } from "./model.js";

export class NotFoundError extends Error {}

/** Accepts a document ID or a Google Docs URL and returns the ID. */
export function parseDocumentId(input: string): string {
  const fromUrl = /\/document\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)/.exec(input);
  if (fromUrl?.[1]) return fromUrl[1];
  const trimmed = input.trim();
  if (/^[A-Za-z0-9_-]{10,}$/.test(trimmed)) return trimmed;
  throw new Error(`"${input}" is not a Google Docs URL or document ID.`);
}

const clone = <T>(v: T): T => structuredClone(v);

function encodeToken(offset: number): string {
  return Buffer.from(`offset:${offset}`).toString("base64url");
}

function decodeToken(token: string | undefined): number {
  if (!token) return 0;
  const m = /^offset:(\d+)$/.exec(Buffer.from(token, "base64url").toString());
  if (!m) throw new Error(`Invalid page_token "${token}".`);
  return Number(m[1]);
}

export class MockDriveApi {
  constructor(readonly drive: MockDrive) {}

  private doc(id: string): MockDocument {
    const doc = this.drive.documents.find((d) => d.info.id === id);
    if (!doc) throw new NotFoundError(`Document not found (404) or not shared with the signed-in account. Details: File not found: ${id}.`);
    return doc;
  }

  getDocumentInfo(id: string): DocumentInfo {
    return clone(this.doc(id).info);
  }

  listDocuments(opts: { query?: string; pageSize: number; pageToken?: string }): {
    documents: DocumentInfo[];
    nextPageToken?: string;
  } {
    const q = opts.query?.trim().toLowerCase();
    const matching = this.drive.documents
      .filter((d) => !q || d.info.name.toLowerCase().includes(q) || d.paragraphs.join("\n").toLowerCase().includes(q))
      .map((d) => d.info)
      .sort((a, b) => (b.modifiedTime ?? "").localeCompare(a.modifiedTime ?? "") || a.id.localeCompare(b.id));
    const start = decodeToken(opts.pageToken);
    const page = matching.slice(start, start + opts.pageSize);
    const next = start + opts.pageSize < matching.length ? encodeToken(start + opts.pageSize) : undefined;
    return { documents: clone(page), ...(next ? { nextPageToken: next } : {}) };
  }

  private visible(c: DocComment, includeDeleted: boolean): DocComment {
    const copy = clone(c);
    if (!includeDeleted) copy.replies = copy.replies.filter((r) => !r.deleted);
    return copy;
  }

  listCommentsPage(
    id: string,
    opts: { includeDeleted: boolean; pageSize: number; pageToken?: string },
  ): { comments: DocComment[]; nextPageToken?: string } {
    const all = this.doc(id).comments.filter((c) => opts.includeDeleted || !c.deleted);
    const start = decodeToken(opts.pageToken);
    const page = all.slice(start, start + opts.pageSize).map((c) => this.visible(c, opts.includeDeleted));
    const next = start + opts.pageSize < all.length ? encodeToken(start + opts.pageSize) : undefined;
    return { comments: page, ...(next ? { nextPageToken: next } : {}) };
  }

  listAllComments(id: string, includeDeleted = false): DocComment[] {
    return this.doc(id)
      .comments.filter((c) => includeDeleted || !c.deleted)
      .map((c) => this.visible(c, includeDeleted));
  }

  getComment(id: string, commentId: string): DocComment {
    const c = this.doc(id).comments.find((x) => x.id === commentId);
    if (!c) throw new NotFoundError(`Document not found (404) or not shared with the signed-in account. Details: Comment not found: ${commentId}.`);
    return this.visible(c, true);
  }

  getDocumentText(id: string): DocumentText {
    const doc = this.doc(id);
    return { title: doc.info.name, paragraphs: [...doc.paragraphs], text: doc.paragraphs.join("\n") };
  }
}

const CONTEXT_MAX_CHARS = 600;

/** Finds the document paragraph that contains the text quoted by a comment. */
export function findContext(paragraphs: string[], quotedText: string): CommentContext | undefined {
  const needle = quotedText.replace(/\s+/g, " ").trim();
  if (!needle) return undefined;
  const normalized = paragraphs.map((p) => p.replace(/\s+/g, " "));
  const probes = [needle, needle.slice(0, 60), needle.slice(0, 25)].filter((p) => p.length >= 8);
  for (const probe of probes) {
    const idx = normalized.findIndex((p) => p.includes(probe));
    if (idx === -1) continue;
    let paragraph = paragraphs[idx] ?? "";
    if (paragraph.length > CONTEXT_MAX_CHARS) {
      const at = Math.max(0, normalized[idx]!.indexOf(probe) - CONTEXT_MAX_CHARS / 3);
      paragraph = `${at > 0 ? "…" : ""}${paragraph.slice(at, at + CONTEXT_MAX_CHARS)}…`;
    }
    return { paragraphIndex: idx, paragraph };
  }
  return undefined;
}

export function attachContext(comments: DocComment[], docText: DocumentText): void {
  for (const c of comments) {
    if (!c.quotedText) continue;
    const ctx = findContext(docText.paragraphs, c.quotedText);
    if (ctx) c.context = ctx;
  }
}
