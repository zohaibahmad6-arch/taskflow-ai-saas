import "server-only";
import {
  getDecryptedTokens,
  updateAccessToken,
  touchLastSynced,
  markConnectionError,
  getConnection,
} from "../connections";
import { refreshAccessToken, GoogleOAuthError } from "../googleOAuth";
import {
  EmailProvider,
  EmailProviderError,
  type EmailConnectionStatus,
  type EmailMessageSummary,
  type EmailMessageFull,
  type EmailThread,
} from "./provider";

const API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const REFRESH_MARGIN_MS = 60_000; // refresh a bit before actual expiry, not right at the deadline
const MAX_RESULTS_CAP = 50; // data minimization: never pull more than this in one call, regardless of what's asked
const MAX_BODY_LENGTH = 12_000; // data minimization: cap how much of any one message body we ever hold/pass to the AI

/**
 * Real Gmail implementation of EmailProvider. Every network call goes
 * through `request()`, which (a) makes sure the access token is valid
 * (refreshing if needed), (b) never treats a failed/expired/rate-limited
 * call as a working connection, and (c) only records a successful sync
 * timestamp after Gmail actually returned 2xx.
 *
 * This class intentionally implements ONLY the read-only EmailProvider
 * interface — see provider.ts for why there is no send/modify method to
 * even accidentally call.
 */
export class GmailProvider implements EmailProvider {
  readonly providerId = "gmail";

  constructor(private userId: string) {}

  private async getValidAccessToken(): Promise<string> {
    const tokens = getDecryptedTokens(this.userId, "gmail");
    if (!tokens) {
      throw new EmailProviderError("Gmail is not connected.", "not_connected");
    }

    const expiresAtMs = new Date(tokens.expiresAt).getTime();
    if (expiresAtMs - REFRESH_MARGIN_MS > Date.now()) {
      return tokens.accessToken;
    }

    if (!tokens.refreshToken) {
      const message = "Gmail access expired and no refresh token is stored. Reconnect Gmail.";
      markConnectionError(this.userId, "gmail", message);
      throw new EmailProviderError(message, "auth_expired");
    }

    try {
      const refreshed = await refreshAccessToken(tokens.refreshToken);
      updateAccessToken(this.userId, "gmail", refreshed);
      return refreshed.accessToken;
    } catch (err) {
      const reason = err instanceof GoogleOAuthError ? err.message : "Could not refresh Gmail access.";
      markConnectionError(this.userId, "gmail", `${reason} Reconnect Gmail from Settings.`);
      throw new EmailProviderError(`${reason} Reconnect Gmail from Settings.`, "auth_expired");
    }
  }

  private async request<T>(
    path: string,
    searchParams?: Record<string, string | string[]>
  ): Promise<T> {
    const accessToken = await this.getValidAccessToken();
    const url = new URL(`${API_BASE}${path}`);
    for (const [key, value] of Object.entries(searchParams ?? {})) {
      if (Array.isArray(value)) {
        for (const v of value) url.searchParams.append(key, v);
      } else {
        url.searchParams.set(key, value);
      }
    }

    let res: Response;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    } catch {
      throw new EmailProviderError("Could not reach Gmail (network error).", "network_error");
    }

    if (res.status === 401) {
      const message = "Gmail rejected the access token. Reconnect Gmail from Settings.";
      markConnectionError(this.userId, "gmail", message);
      throw new EmailProviderError(message, "auth_expired");
    }
    if (res.status === 429) {
      throw new EmailProviderError("Gmail rate limit reached. Try again shortly.", "rate_limited");
    }
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const message =
        typeof body?.error?.message === "string" ? body.error.message : `Gmail API error (${res.status}).`;
      throw new EmailProviderError(message, "api_error");
    }

    touchLastSynced(this.userId, "gmail");
    return (await res.json()) as T;
  }

  async getConnectionStatus(): Promise<EmailConnectionStatus> {
    const row = getConnection(this.userId, "gmail");
    return {
      connected: row?.status === "connected",
      accountLabel: row?.account_label ?? null,
      lastSyncedAt: row?.last_synced_at ?? null,
      lastError: row?.last_error ?? null,
    };
  }

  async searchMessages(query: string, maxResults = 20): Promise<EmailMessageSummary[]> {
    const capped = Math.min(Math.max(Math.floor(maxResults), 1), MAX_RESULTS_CAP);
    const list = await this.request<{ messages?: { id: string }[] }>("/messages", {
      q: query,
      maxResults: String(capped),
    });
    if (!list.messages?.length) return [];
    return this.hydrateSummaries(list.messages.map((m) => m.id));
  }

  async getRecentMessages(maxResults = 20): Promise<EmailMessageSummary[]> {
    const capped = Math.min(Math.max(Math.floor(maxResults), 1), MAX_RESULTS_CAP);
    const list = await this.request<{ messages?: { id: string }[] }>("/messages", {
      maxResults: String(capped),
      labelIds: ["INBOX"],
    });
    if (!list.messages?.length) return [];
    return this.hydrateSummaries(list.messages.map((m) => m.id));
  }

  private async hydrateSummaries(ids: string[]): Promise<EmailMessageSummary[]> {
    // Sequential rather than Promise.all — a deliberate data-minimization
    // and rate-limit-friendliness choice, not an oversight: a modest
    // inbox snapshot doesn't need N parallel calls in flight.
    const results: EmailMessageSummary[] = [];
    for (const id of ids) {
      const msg = await this.request<GmailMessageResource>(`/messages/${id}`, {
        format: "metadata",
        metadataHeaders: ["Subject", "From", "Date"],
      });
      results.push(summaryFromResource(msg));
    }
    return results;
  }

  async getMessage(messageId: string): Promise<EmailMessageFull> {
    const msg = await this.request<GmailMessageResource>(`/messages/${messageId}`, { format: "full" });
    return fullFromResource(msg);
  }

  async getThread(threadId: string): Promise<EmailThread> {
    const thread = await this.request<{ id: string; messages?: GmailMessageResource[] }>(
      `/threads/${threadId}`,
      { format: "full" }
    );
    const messages = (thread.messages ?? []).map(fullFromResource);
    return {
      threadId: thread.id,
      subject: messages[0]?.subject ?? "(no subject)",
      messages,
    };
  }
}

/**
 * Calls Gmail's own profile endpoint with a freshly-issued access token.
 * This is the ONLY acceptable way to confirm a connection actually
 * works — used exclusively by the OAuth callback, before it is allowed
 * to mark a connection "connected". Returns the mailbox's own email
 * address for display (e.g. "Connected as you@gmail.com").
 */
export async function verifyGmailAccessToken(accessToken: string): Promise<{ emailAddress: string }> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/profile`, { headers: { Authorization: `Bearer ${accessToken}` } });
  } catch {
    throw new EmailProviderError("Could not reach Gmail to verify the connection (network error).", "network_error");
  }
  if (!res.ok) {
    throw new EmailProviderError(`Gmail did not accept the new connection (status ${res.status}).`, "api_error");
  }
  const data = (await res.json().catch(() => ({}))) as { emailAddress?: string };
  if (!data.emailAddress) {
    throw new EmailProviderError("Gmail's profile response was missing an email address.", "api_error");
  }
  return { emailAddress: data.emailAddress };
}

// --- Gmail resource parsing (kept private to this file) ----------------

type GmailHeader = { name: string; value: string };
type GmailPart = {
  mimeType?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
};
type GmailMessageResource = {
  id: string;
  threadId: string;
  snippet?: string;
  payload?: GmailPart;
};

function getHeader(headers: GmailHeader[] | undefined, name: string): string {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function decodeBase64Url(data: string): string {
  try {
    return Buffer.from(data, "base64url").toString("utf-8");
  } catch {
    return "";
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** Prefers text/plain; falls back to a crude text/html strip. Depth-first search over the MIME part tree. */
function extractBody(payload: GmailPart | undefined): string {
  if (!payload) return "";

  let plainText: string | null = null;
  let htmlText: string | null = null;

  const visit = (part: GmailPart) => {
    if (plainText) return;
    if (part.mimeType === "text/plain" && part.body?.data) {
      plainText = decodeBase64Url(part.body.data);
      return;
    }
    if (part.mimeType === "text/html" && part.body?.data && !htmlText) {
      htmlText = decodeBase64Url(part.body.data);
    }
    for (const child of part.parts ?? []) visit(child);
  };
  visit(payload);

  const text = plainText ?? (htmlText ? stripHtml(htmlText) : "");
  return text.length > MAX_BODY_LENGTH ? `${text.slice(0, MAX_BODY_LENGTH)}\n[truncated]` : text;
}

function summaryFromResource(msg: GmailMessageResource): EmailMessageSummary {
  const headers = msg.payload?.headers;
  return {
    id: msg.id,
    threadId: msg.threadId,
    from: getHeader(headers, "From"),
    subject: getHeader(headers, "Subject") || "(no subject)",
    date: getHeader(headers, "Date"),
    snippet: msg.snippet ?? "",
  };
}

function fullFromResource(msg: GmailMessageResource): EmailMessageFull {
  const headers = msg.payload?.headers;
  return {
    ...summaryFromResource(msg),
    to: getHeader(headers, "To"),
    body: extractBody(msg.payload),
  };
}
