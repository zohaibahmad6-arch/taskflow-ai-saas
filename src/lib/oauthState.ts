import "server-only";
import crypto from "node:crypto";
import { db } from "./db";

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes — plenty for a consent screen, short enough to limit replay window

/**
 * OAuth CSRF protection: a random, single-use, short-lived, user-bound
 * state value. Created right before redirecting to the provider's
 * consent screen; the callback must present the exact same value and can
 * only use it once (consuming deletes the row), which is what prevents
 * an attacker from forging a callback request that links THEIR Google
 * account to the victim's session (the classic OAuth login-CSRF attack).
 */
export function createOAuthState(userId: string, provider: string): string {
  const state = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString();
  db.prepare(
    "INSERT INTO oauth_states (state, user_id, provider, expires_at) VALUES (?, ?, ?, ?)"
  ).run(state, userId, provider, expiresAt);
  return state;
}

/**
 * Validates and consumes a state value. Returns the userId it was issued
 * for if — and only if — the state exists, hasn't expired, and matches
 * the given provider; returns null otherwise. Always deletes the row
 * (whether valid or not) so a state can never be presented twice.
 */
export function consumeOAuthState(state: string, provider: string): string | null {
  const row = db.prepare("SELECT * FROM oauth_states WHERE state = ?").get(state) as
    | { state: string; user_id: string; provider: string; expires_at: string }
    | undefined;

  if (row) {
    db.prepare("DELETE FROM oauth_states WHERE state = ?").run(state);
  }

  if (!row) return null;
  if (row.provider !== provider) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;

  return row.user_id;
}

/** Best-effort cleanup of abandoned states (never started a callback). Safe to call opportunistically. */
export function pruneExpiredOAuthStates(): void {
  db.prepare("DELETE FROM oauth_states WHERE expires_at < ?").run(new Date().toISOString());
}
