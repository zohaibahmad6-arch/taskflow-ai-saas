import "server-only";
import { db, newId } from "./db";
import { randomToken, sha256Hex } from "./crypto";

/**
 * Pure, DB-backed session storage — no cookies, no `next/headers`, so this
 * is directly unit-testable outside a Next.js request context. `auth.ts`
 * wraps these with the actual cookie read/write.
 */

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type SessionUser = {
  id: string;
  email: string;
  name: string;
};

export type StoredSession = {
  sessionId: string;
  user: SessionUser;
  csrfSecret: string;
};

type SessionRow = {
  id: string;
  user_id: string;
  token_hash: string;
  csrf_secret: string;
  expires_at: string;
};

export function createSessionRecord(
  userId: string,
  userAgent: string | null
): { token: string; csrfSecret: string; expiresAt: string; sessionId: string } {
  const token = randomToken(32);
  const csrfSecret = randomToken(24);
  const tokenHash = sha256Hex(token);
  const sessionId = newId("sess");
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();

  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, csrf_secret, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(sessionId, userId, tokenHash, csrfSecret, userAgent, expiresAt);

  return { token, csrfSecret, expiresAt, sessionId };
}

/** Looks up a session by its raw cookie token. Deletes and returns null if expired. */
export function getSessionByToken(token: string): StoredSession | null {
  const tokenHash = sha256Hex(token);
  const session = db.prepare("SELECT * FROM sessions WHERE token_hash = ?").get(tokenHash) as
    | SessionRow
    | undefined;
  if (!session) return null;

  if (new Date(session.expires_at).getTime() < Date.now()) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(session.id);
    return null;
  }

  const user = db
    .prepare("SELECT id, email, name FROM users WHERE id = ?")
    .get(session.user_id) as SessionUser | undefined;
  if (!user) return null;

  return { sessionId: session.id, user, csrfSecret: session.csrf_secret };
}

export function deleteSessionByToken(token: string): void {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256Hex(token));
}

/**
 * Revokes every session for `userId` except `exceptSessionId`. Used both
 * for "sign out other devices" and automatically after a password change,
 * so a credential compromise can't be waited out by keeping an old
 * session alive for up to 30 days. Revocation takes effect immediately —
 * every request re-reads the session row from the DB (see
 * getSessionByToken), there is no cache to invalidate.
 */
export function revokeOtherSessions(userId: string, exceptSessionId: string): number {
  const result = db
    .prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?")
    .run(userId, exceptSessionId);
  return result.changes;
}
