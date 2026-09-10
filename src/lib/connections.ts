import "server-only";
import { db, newId, nowIso } from "./db";
import { encryptSecret, decryptSecret } from "./crypto";

export type ConnectedAccountRow = {
  id: string;
  user_id: string;
  provider: string;
  category: "email" | "social";
  account_label: string | null;
  status: "not_connected" | "connected" | "error" | "revoked";
  scopes_json: string;
  encrypted_tokens: string | null;
  last_error: string | null;
  connected_at: string | null;
  last_synced_at: string | null;
  updated_at: string;
};

export const EMAIL_PROVIDERS = ["gmail", "outlook"] as const;
export const SOCIAL_PROVIDERS = ["linkedin", "x", "facebook", "instagram"] as const;

/** Guarantees a row exists (as not_connected) for every known provider. */
export function ensureConnectionRows(userId: string): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO connected_accounts (id, user_id, provider, category, status)
     VALUES (?, ?, ?, ?, 'not_connected')`
  );
  const tx = db.transaction(() => {
    for (const provider of EMAIL_PROVIDERS) {
      insert.run(newId("conn"), userId, provider, "email");
    }
    for (const provider of SOCIAL_PROVIDERS) {
      insert.run(newId("conn"), userId, provider, "social");
    }
  });
  tx();
}

export function listConnections(userId: string): ConnectedAccountRow[] {
  ensureConnectionRows(userId);
  return db
    .prepare("SELECT * FROM connected_accounts WHERE user_id = ? ORDER BY category, provider")
    .all(userId) as ConnectedAccountRow[];
}

export function getConnection(
  userId: string,
  provider: string
): ConnectedAccountRow | undefined {
  ensureConnectionRows(userId);
  return db
    .prepare("SELECT * FROM connected_accounts WHERE user_id = ? AND provider = ?")
    .get(userId, provider) as ConnectedAccountRow | undefined;
}

export function isConnected(userId: string, provider: string): boolean {
  return getConnection(userId, provider)?.status === "connected";
}

/**
 * Manually disconnects a provider and clears any stored tokens. Real
 * revocation at the provider (best-effort, e.g. Google's /revoke) must
 * happen BEFORE calling this, using the still-present encrypted tokens —
 * this function is the final "forget everything locally" step.
 */
export function disconnectProvider(userId: string, provider: string): void {
  ensureConnectionRows(userId);
  db.prepare(
    `UPDATE connected_accounts SET status = 'not_connected', encrypted_tokens = NULL,
       account_label = NULL, connected_at = NULL, last_synced_at = NULL, last_error = NULL, updated_at = ?
     WHERE user_id = ? AND provider = ?`
  ).run(nowIso(), userId, provider);
}

export type OAuthTokenSet = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string;
  scope: string;
};

/**
 * Marks a provider connected. This is the ONLY function that should ever
 * set status='connected' — callers (the OAuth callback) must have
 * already verified the tokens work against a real API call before
 * calling this; it does not verify anything itself.
 */
export function storeVerifiedConnection(params: {
  userId: string;
  provider: string;
  category: "email" | "social";
  accountLabel: string;
  tokens: OAuthTokenSet;
}): void {
  ensureConnectionRows(params.userId);
  const encrypted = encryptSecret(JSON.stringify(params.tokens));
  const now = nowIso();
  db.prepare(
    `UPDATE connected_accounts SET
       status = 'connected', account_label = ?, scopes_json = ?, encrypted_tokens = ?,
       last_error = NULL, connected_at = ?, last_synced_at = ?, updated_at = ?
     WHERE user_id = ? AND provider = ?`
  ).run(
    params.accountLabel,
    JSON.stringify([params.tokens.scope]),
    encrypted,
    now,
    now,
    now,
    params.userId,
    params.provider
  );
}

/** Decrypts and returns the stored token set for a connected provider, or null if there isn't one. */
export function getDecryptedTokens(userId: string, provider: string): OAuthTokenSet | null {
  const row = getConnection(userId, provider);
  if (!row?.encrypted_tokens) return null;
  try {
    return JSON.parse(decryptSecret(row.encrypted_tokens)) as OAuthTokenSet;
  } catch {
    return null;
  }
}

/** After a successful token refresh: re-encrypts and stores the new access token, keeping the existing refresh token. */
export function updateAccessToken(
  userId: string,
  provider: string,
  update: { accessToken: string; expiresAt: string }
): void {
  const existing = getDecryptedTokens(userId, provider);
  if (!existing) return;
  const merged: OAuthTokenSet = { ...existing, accessToken: update.accessToken, expiresAt: update.expiresAt };
  db.prepare("UPDATE connected_accounts SET encrypted_tokens = ?, updated_at = ? WHERE user_id = ? AND provider = ?").run(
    encryptSecret(JSON.stringify(merged)),
    nowIso(),
    userId,
    provider
  );
}

/** Records that a real, successful API read just happened — never called speculatively. */
export function touchLastSynced(userId: string, provider: string): void {
  ensureConnectionRows(userId);
  const now = nowIso();
  db.prepare(
    "UPDATE connected_accounts SET last_synced_at = ?, updated_at = ? WHERE user_id = ? AND provider = ?"
  ).run(now, now, userId, provider);
}

/** Marks a connection as failing without discarding its tokens (a transient error may resolve on the next call). */
export function markConnectionError(userId: string, provider: string, message: string): void {
  ensureConnectionRows(userId);
  db.prepare(
    "UPDATE connected_accounts SET status = 'error', last_error = ?, updated_at = ? WHERE user_id = ? AND provider = ?"
  ).run(message, nowIso(), userId, provider);
}
