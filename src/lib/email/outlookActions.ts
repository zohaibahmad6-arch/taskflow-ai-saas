import "server-only";
import {
  getDecryptedTokens,
  updateAccessToken,
  markConnectionError,
} from "../connections";
import { refreshAccessToken, MicrosoftOAuthError } from "../microsoftOAuth";
import { EmailProviderError } from "./provider";

/**
 * Mailbox MUTATION primitives for Outlook/Microsoft Graph. This is the
 * "separate interface" anticipated by the doc comment on EmailProvider in
 * provider.ts: nothing in here is reachable from the read-only
 * OutlookProvider, and every function here must ONLY ever be called from
 * inside an EXTERNAL_ACTION tool's `execute()` (see tools/email/index.ts)
 * — never from a READ_ONLY/PREPARATION tool's `run()`, never directly from
 * chat/voice handling. The Approval Center (src/lib/approvals.ts) is the
 * only thing that invokes a tool's `execute()`, and only after a human has
 * explicitly approved the exact payload these functions receive.
 *
 * Every function reports per-message success/failure explicitly rather
 * than an all-or-nothing boolean — a partial failure must never be
 * reported as a full success ("No Fake Capabilities").
 */

const API_BASE = "https://graph.microsoft.com/v1.0/me";
const REFRESH_MARGIN_MS = 60_000;
const MAX_BATCH = 50; // data minimization / abuse-limit: cap how many messages one approved action can touch

export type BatchOutcome = {
  succeeded: string[];
  failed: { messageId: string; error: string }[];
};

const WELL_KNOWN_FOLDERS = new Set([
  "inbox",
  "archive",
  "deleteditems",
  "junkemail",
  "drafts",
  "sentitems",
  "outbox",
]);

async function getValidAccessToken(userId: string): Promise<string> {
  const tokens = getDecryptedTokens(userId, "outlook");
  if (!tokens) {
    throw new EmailProviderError("Outlook is not connected.", "not_connected");
  }

  const expiresAtMs = new Date(tokens.expiresAt).getTime();
  if (expiresAtMs - REFRESH_MARGIN_MS > Date.now()) {
    return tokens.accessToken;
  }

  if (!tokens.refreshToken) {
    const message = "Outlook access expired and no refresh token is stored. Reconnect Outlook.";
    markConnectionError(userId, "outlook", message);
    throw new EmailProviderError(message, "auth_expired");
  }

  try {
    const refreshed = await refreshAccessToken(tokens.refreshToken);
    updateAccessToken(userId, "outlook", refreshed);
    return refreshed.accessToken;
  } catch (err) {
    const reason = err instanceof MicrosoftOAuthError ? err.message : "Could not refresh Outlook access.";
    markConnectionError(userId, "outlook", `${reason} Reconnect Outlook from Settings.`);
    throw new EmailProviderError(`${reason} Reconnect Outlook from Settings.`, "auth_expired");
  }
}

async function graphFetch(
  accessToken: string,
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

async function graphErrorMessage(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  return typeof body?.error?.message === "string" ? body.error.message : `Graph API error (${res.status})`;
}

/**
 * Resolves a human-readable destination (a well-known Outlook folder name,
 * or any custom folder's display name) to what Graph's move action
 * expects. Custom folders that don't exist yet are created — this is
 * deliberate: an approved "move to Newsletters" action should succeed even
 * if the user has never manually created a "Newsletters" folder before,
 * exactly like every major mail client's auto-sort feature does. Only
 * called from execute() paths, after approval, never speculatively.
 */
async function resolveFolderId(accessToken: string, folderName: string): Promise<string> {
  const normalized = folderName.trim().toLowerCase();
  if (WELL_KNOWN_FOLDERS.has(normalized)) {
    return normalized;
  }

  const escaped = folderName.replace(/'/g, "''");
  const list = await graphFetch(
    accessToken,
    `/mailFolders?$filter=${encodeURIComponent(`displayName eq '${escaped}'`)}`
  );
  if (list.ok) {
    const data = (await list.json()) as { value?: { id: string }[] };
    if (data.value && data.value.length > 0) {
      return data.value[0].id;
    }
  }

  const created = await graphFetch(accessToken, "/mailFolders", {
    method: "POST",
    body: { displayName: folderName },
  });
  if (!created.ok) {
    throw new EmailProviderError(`Could not find or create the "${folderName}" folder: ${await graphErrorMessage(created)}`, "api_error");
  }
  const createdFolder = (await created.json()) as { id: string };
  return createdFolder.id;
}

function capBatch(messageIds: string[]): string[] {
  return messageIds.slice(0, MAX_BATCH);
}

async function runPerMessage(
  userId: string,
  messageIds: string[],
  action: (accessToken: string, messageId: string) => Promise<Response>
): Promise<BatchOutcome> {
  const accessToken = await getValidAccessToken(userId);
  const outcome: BatchOutcome = { succeeded: [], failed: [] };
  for (const messageId of capBatch(messageIds)) {
    try {
      const res = await action(accessToken, messageId);
      if (res.ok) {
        outcome.succeeded.push(messageId);
      } else if (res.status === 401) {
        markConnectionError(userId, "outlook", "Outlook rejected the access token mid-action.");
        outcome.failed.push({ messageId, error: "Outlook access was rejected. Reconnect Outlook and try again." });
      } else {
        outcome.failed.push({ messageId, error: await graphErrorMessage(res) });
      }
    } catch {
      outcome.failed.push({ messageId, error: "Network error reaching Outlook." });
    }
  }
  return outcome;
}

export async function moveMessages(userId: string, messageIds: string[], destinationFolder: string): Promise<BatchOutcome> {
  const accessToken = await getValidAccessToken(userId);
  const destinationId = await resolveFolderId(accessToken, destinationFolder);
  return runPerMessage(userId, messageIds, (token, messageId) =>
    graphFetch(token, `/messages/${encodeURIComponent(messageId)}/move`, {
      method: "POST",
      body: { destinationId },
    })
  );
}

export async function archiveMessages(userId: string, messageIds: string[]): Promise<BatchOutcome> {
  return moveMessages(userId, messageIds, "archive");
}

export async function deleteMessages(userId: string, messageIds: string[]): Promise<BatchOutcome> {
  return runPerMessage(userId, messageIds, (token, messageId) =>
    graphFetch(token, `/messages/${encodeURIComponent(messageId)}`, { method: "DELETE" })
  );
}

export async function setReadState(userId: string, messageIds: string[], isRead: boolean): Promise<BatchOutcome> {
  return runPerMessage(userId, messageIds, (token, messageId) =>
    graphFetch(token, `/messages/${encodeURIComponent(messageId)}`, {
      method: "PATCH",
      body: { isRead },
    })
  );
}

export async function setFlagState(userId: string, messageIds: string[], flagged: boolean): Promise<BatchOutcome> {
  return runPerMessage(userId, messageIds, (token, messageId) =>
    graphFetch(token, `/messages/${encodeURIComponent(messageId)}`, {
      method: "PATCH",
      body: { flag: { flagStatus: flagged ? "flagged" : "notFlagged" } },
    })
  );
}

/** Sets each message's category list to exactly [category] (not additive) — keeps what will result fully predictable from the approval payload alone. */
export async function applyCategory(userId: string, messageIds: string[], category: string): Promise<BatchOutcome> {
  return runPerMessage(userId, messageIds, (token, messageId) =>
    graphFetch(token, `/messages/${encodeURIComponent(messageId)}`, {
      method: "PATCH",
      body: { categories: [category] },
    })
  );
}

export async function sendReply(
  userId: string,
  messageId: string,
  comment: string,
  replyAll: boolean
): Promise<void> {
  const accessToken = await getValidAccessToken(userId);
  const res = await graphFetch(accessToken, `/messages/${encodeURIComponent(messageId)}/${replyAll ? "replyAll" : "reply"}`, {
    method: "POST",
    body: { comment },
  });
  if (!res.ok) {
    if (res.status === 401) {
      markConnectionError(userId, "outlook", "Outlook rejected the access token mid-action.");
      throw new EmailProviderError("Outlook access was rejected. Reconnect Outlook and try again.", "auth_expired");
    }
    throw new EmailProviderError(await graphErrorMessage(res), "api_error");
  }
}

export async function forwardMessage(
  userId: string,
  messageId: string,
  toRecipients: string[],
  comment: string
): Promise<void> {
  const accessToken = await getValidAccessToken(userId);
  const res = await graphFetch(accessToken, `/messages/${encodeURIComponent(messageId)}/forward`, {
    method: "POST",
    body: {
      comment,
      toRecipients: toRecipients.map((address) => ({ emailAddress: { address } })),
    },
  });
  if (!res.ok) {
    if (res.status === 401) {
      markConnectionError(userId, "outlook", "Outlook rejected the access token mid-action.");
      throw new EmailProviderError("Outlook access was rejected. Reconnect Outlook and try again.", "auth_expired");
    }
    throw new EmailProviderError(await graphErrorMessage(res), "api_error");
  }
}
