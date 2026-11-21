// Normalized model. Same shapes as @yeyo11/google-docs-mcp (src/google.ts), so tool outputs match.

export interface Person {
  name: string;
  email?: string;
  /** true when this is the signed-in account */
  isMe: boolean;
}

export interface CommentReply {
  id: string;
  author: Person;
  createdTime: string;
  modifiedTime?: string;
  content: string;
  /** Present when the reply resolves or reopens the thread. */
  action?: "resolve" | "reopen";
  deleted: boolean;
}

export interface CommentContext {
  paragraphIndex: number;
  paragraph: string;
}

export interface DocComment {
  id: string;
  author: Person;
  createdTime: string;
  modifiedTime?: string;
  content: string;
  /** Fragment of the document the comment was made on. */
  quotedText?: string;
  status: "open" | "resolved";
  deleted: boolean;
  replies: CommentReply[];
  resolution?: { by: Person; at: string };
  /** Document paragraph where the quoted text appears (optional). */
  context?: CommentContext;
}

export interface DocumentInfo {
  id: string;
  name: string;
  createdTime?: string;
  modifiedTime?: string;
  owners: Person[];
  lastModifiedBy?: Person;
  webViewLink?: string;
}

export interface DocumentText {
  title: string;
  paragraphs: string[];
  text: string;
}

/** One document of the mock drive: metadata, body and every comment (deleted ones included). */
export interface MockDocument {
  info: DocumentInfo;
  paragraphs: string[];
  comments: DocComment[];
}

export interface MockDrive {
  seed: number;
  /** Fixed "today" of the fixtures, so expected answers never drift. */
  today: string;
  folder: string;
  team: string;
  me: Person;
  people: Person[];
  documents: MockDocument[];
}
