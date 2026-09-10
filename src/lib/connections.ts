import "server-only";
import { db, newId, nowIso } from "./db";

export type ConnectedAccountRow = {
  id: string;
  user_id: string;
  provider: string;
  category: "email" | "social";
  account_label: string | null;
  status: "not_connected" | "connected" | "error" | "revoked";
  scopes_json: string;
  last_error: string | null;
  connected_at: string | null;
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
 * Manually disconnects a provider (revokes locally). Real OAuth
 * disconnect/token-revocation happens once a provider is actually wired
 * up; for now this only clears local state.
 */
export function disconnectProvider(userId: string, provider: string): void {
  db.prepare(
    `UPDATE connected_accounts SET status = 'not_connected', encrypted_tokens = NULL,
       account_label = NULL, connected_at = NULL, updated_at = ?
     WHERE user_id = ? AND provider = ?`
  ).run(nowIso(), userId, provider);
}
