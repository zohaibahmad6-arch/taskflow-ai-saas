/**
 * The email provider contract. Deliberately READ-ONLY: there is no
 * send/reply/forward/delete/archive/label/markRead method anywhere on
 * this interface, on purpose, for this phase. A future write phase would
 * add a *separate* interface (e.g. EmailActionProvider) whose methods
 * only ever get called from an EXTERNAL_ACTION tool's execute(), behind
 * the Approval Center — never from here.
 */

export type EmailConnectionStatus = {
  connected: boolean;
  accountLabel: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
};

/** Lightweight — no body. Used for search results and inbox listings. */
export type EmailMessageSummary = {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  date: string; // ISO 8601
  snippet: string;
};

/** Only fetched when a feature genuinely needs body content (thread summary, draft reply). */
export type EmailMessageFull = EmailMessageSummary & {
  to: string;
  body: string; // plain text, length-capped — see MAX_BODY_LENGTH in gmail.ts
};

export type EmailThread = {
  threadId: string;
  subject: string;
  messages: EmailMessageFull[];
};

export interface EmailProvider {
  readonly providerId: string;
  getConnectionStatus(): Promise<EmailConnectionStatus>;
  searchMessages(query: string, maxResults?: number): Promise<EmailMessageSummary[]>;
  getMessage(messageId: string): Promise<EmailMessageFull>;
  getThread(threadId: string): Promise<EmailThread>;
  getRecentMessages(maxResults?: number): Promise<EmailMessageSummary[]>;
}

export class EmailProviderError extends Error {
  code: "not_connected" | "auth_expired" | "rate_limited" | "api_error" | "network_error";
  constructor(message: string, code: EmailProviderError["code"]) {
    super(message);
    this.name = "EmailProviderError";
    this.code = code;
  }
}
