import "server-only";
import {
  getDecryptedTokens,
  updateAccessToken,
  touchLastSynced,
  markConnectionError,
  getConnection,
} from "../connections";
import { refreshAccessToken, MicrosoftOAuthError } from "../microsoftOAuth";
import {
  EmailProvider,
  EmailProviderError,
  type EmailConnectionStatus,
  type EmailMessageSummary,
  type EmailMessageFull,
  type EmailThread,
} from "./provider";

const API_BASE = "https://graph.microsoft.com/v1.0/me";
const REFRESH_MARGIN_MS = 60_000; // refresh a bit before actual expiry, not right at the deadline
const MAX_RESULTS_CAP = 50; // data minimization: never pull more than this in one call, regardless of what's asked
const MAX_BODY_LENGTH = 12_000; // data minimization: cap how much of any one message body we ever hold/pass to the AI

const SUMMARY_SELECT = "id,conversationId,subject,from,receivedDateTime,bodyPreview";
const FULL_SELECT = "id,conversationId,subject,from,toRecipients,receivedDateTime,body,bodyPreview";

/**
 * Real Outlook/Microsoft 365 implementation of EmailProvider, backed by
 * Microsoft Graph. Every network call goes through `request()`, which (a)
 * makes sure the access token is valid (refreshing if needed), (b) never
 * treats a failed/expired/rate-limited call as a working connection, and
 * (c) only records a successful sync timestamp after Graph actually
 * returned 2xx. Mirrors gmail.ts's structure exactly.
 *
 * This class intentionally implements ONLY the read-only EmailProvider
 * interface — see provider.ts and outlookActions.ts for why mailbox
 * mutations live in a completely separate module, never here.
 */
export class OutlookProvider implements EmailProvider {
  readonly providerId = "outlook";

  constructor(private userId: string) {}

  private async getValidAccessToken(): Promise<string> {
    const tokens = getDecryptedTokens(this.userId, "outlook");
    if (!tokens) {
      throw new EmailProviderError("Outlook is not connected.", "not_connected");
    }

    const expiresAtMs = new Date(tokens.expiresAt).getTime();
    if (expiresAtMs - REFRESH_MARGIN_MS > Date.now()) {
      return tokens.accessToken;
    }

    if (!tokens.refreshToken) {
      const message = "Outlook access expired and no refresh token is stored. Reconnect Outlook.";
      markConnectionError(this.userId, "outlook", message);
      throw new EmailProviderError(message, "auth_expired");
    }

    try {
      const refreshed = await refreshAccessToken(tokens.refreshToken);
      updateAccessToken(this.userId, "outlook", refreshed);
      return refreshed.accessToken;
    } catch (err) {
      const reason = err instanceof MicrosoftOAuthError ? err.message : "Could not refresh Outlook access.";
      markConnectionError(this.userId, "outlook", `${reason} Reconnect Outlook from Settings.`);
      throw new EmailProviderError(`${reason} Reconnect Outlook from Settings.`, "auth_expired");
    }
  }

  private async request<T>(path: string, searchParams?: Record<string, string>): Promise<T> {
    const accessToken = await this.getValidAccessToken();
    const url = new URL(`${API_BASE}${path}`);
    for (const [key, value] of Object.entries(searchParams ?? {})) {
      url.searchParams.set(key, value);
    }

    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      });
    } catch {
      throw new EmailProviderError("Could not reach Outlook (network error).", "network_error");
    }

    if (res.status === 401) {
      const message = "Outlook rejected the access token. Reconnect Outlook from Settings.";
      markConnectionError(this.userId, "outlook", message);
      throw new EmailProviderError(message, "auth_expired");
    }
    if (res.status === 429 || res.status === 503) {
      throw new EmailProviderError("Outlook rate limit reached. Try again shortly.", "rate_limited");
    }
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const message =
        typeof body?.error?.message === "string" ? body.error.message : `Outlook API error (${res.status}).`;
      throw new EmailProviderError(message, "api_error");
    }

    touchLastSynced(this.userId, "outlook");
    return (await res.json()) as T;
  }

  async getConnectionStatus(): Promise<EmailConnectionStatus> {
    const row = getConnection(this.userId, "outlook");
    return {
      connected: row?.status === "connected",
      accountLabel: row?.account_label ?? null,
      lastSyncedAt: row?.last_synced_at ?? null,
      lastError: row?.last_error ?? null,
    };
  }

  async searchMessages(query: string, maxResults = 20): Promise<EmailMessageSummary[]> {
    const capped = Math.min(Math.max(Math.floor(maxResults), 1), MAX_RESULTS_CAP);
    const list = await this.request<{ value?: GraphMessage[] }>("/messages", {
      $search: JSON.stringify(query),
      $top: String(capped),
      $select: SUMMARY_SELECT,
    });
    return (list.value ?? []).map(summaryFromResource);
  }

  async getRecentMessages(maxResults = 20): Promise<EmailMessageSummary[]> {
    const capped = Math.min(Math.max(Math.floor(maxResults), 1), MAX_RESULTS_CAP);
    const list = await this.request<{ value?: GraphMessage[] }>("/mailFolders/inbox/messages", {
      $top: String(capped),
      $orderby: "receivedDateTime desc",
      $select: SUMMARY_SELECT,
    });
    return (list.value ?? []).map(summaryFromResource);
  }

  async getMessage(messageId: string): Promise<EmailMessageFull> {
    const msg = await this.request<GraphMessage>(`/messages/${encodeURIComponent(messageId)}`, {
      $select: FULL_SELECT,
    });
    return fullFromResource(msg);
  }

  async getThread(threadId: string): Promise<EmailThread> {
    // Graph has no separate "thread" resource for mail (unlike Gmail) — a
    // conversation is just the set of messages sharing a conversationId.
    const list = await this.request<{ value?: GraphMessage[] }>("/messages", {
      $filter: `conversationId eq '${threadId.replace(/'/g, "''")}'`,
      $orderby: "receivedDateTime asc",
      $select: FULL_SELECT,
      $top: String(MAX_RESULTS_CAP),
    });
    const messages = (list.value ?? []).map(fullFromResource);
    return {
      threadId,
      subject: messages[0]?.subject ?? "(no subject)",
      messages,
    };
  }
}

/**
 * Calls Graph's own /me endpoint with a freshly-issued access token. This
 * is the ONLY acceptable way to confirm a connection actually works —
 * used exclusively by the OAuth callback, before it is allowed to mark a
 * connection "connected". Returns the mailbox's own address for display
 * (e.g. "Connected as you@outlook.com").
 */
export async function verifyOutlookAccessToken(accessToken: string): Promise<{ emailAddress: string }> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}?$select=mail,userPrincipalName`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
  } catch {
    throw new EmailProviderError("Could not reach Outlook to verify the connection (network error).", "network_error");
  }
  if (!res.ok) {
    throw new EmailProviderError(`Outlook did not accept the new connection (status ${res.status}).`, "api_error");
  }
  const data = (await res.json().catch(() => ({}))) as { mail?: string; userPrincipalName?: string };
  const emailAddress = data.mail || data.userPrincipalName;
  if (!emailAddress) {
    throw new EmailProviderError("Outlook's profile response was missing an email address.", "api_error");
  }
  return { emailAddress };
}

// --- Graph resource parsing (kept private to this file) -----------------

type GraphEmailAddress = { emailAddress?: { name?: string; address?: string } };
type GraphMessage = {
  id: string;
  conversationId?: string;
  subject?: string;
  from?: GraphEmailAddress;
  toRecipients?: GraphEmailAddress[];
  receivedDateTime?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
};

function formatAddress(addr?: GraphEmailAddress): string {
  const name = addr?.emailAddress?.name;
  const address = addr?.emailAddress?.address ?? "";
  return name && name !== address ? `${name} <${address}>` : address;
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

function extractBody(body: GraphMessage["body"]): string {
  if (!body?.content) return "";
  const text = body.contentType === "html" ? stripHtml(body.content) : body.content;
  return text.length > MAX_BODY_LENGTH ? `${text.slice(0, MAX_BODY_LENGTH)}\n[truncated]` : text;
}

function summaryFromResource(msg: GraphMessage): EmailMessageSummary {
  return {
    id: msg.id,
    threadId: msg.conversationId ?? msg.id,
    from: formatAddress(msg.from),
    subject: msg.subject || "(no subject)",
    date: msg.receivedDateTime ?? "",
    snippet: msg.bodyPreview ?? "",
  };
}

function fullFromResource(msg: GraphMessage): EmailMessageFull {
  return {
    ...summaryFromResource(msg),
    to: (msg.toRecipients ?? []).map(formatAddress).filter(Boolean).join(", "),
    body: extractBody(msg.body) || msg.bodyPreview || "",
  };
}
