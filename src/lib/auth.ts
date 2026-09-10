import "server-only";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { db, newId } from "./db";
import { timingSafeEqual } from "./crypto";
import { env } from "./env";
import {
  createSessionRecord,
  getSessionByToken,
  deleteSessionByToken,
  revokeOtherSessions,
  type SessionUser,
  type StoredSession,
} from "./sessions";

export { revokeOtherSessions };
export type { SessionUser };

export const SESSION_COOKIE = "pa_session";
export const CSRF_COOKIE = "pa_csrf";

type UserRow = {
  id: string;
  email: string;
  name: string;
  password_hash: string;
};

/** Ensures the single authorized user row exists, matching AUTH_USER_EMAIL. */
export function ensureOwnerUser(passwordHashIfCreating?: string): UserRow {
  const existing = db
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(env.authUserEmail) as UserRow | undefined;
  if (existing) return existing;

  if (!passwordHashIfCreating) {
    throw new Error(
      "No owner account exists yet. Run `npm run seed` with ADMIN_PASSWORD set to create it."
    );
  }

  const id = newId("user");
  db.prepare(
    "INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)"
  ).run(id, env.authUserEmail, env.authUserName, passwordHashIfCreating);

  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow;
}

export async function verifyLogin(
  email: string,
  password: string
): Promise<UserRow | null> {
  const user = db
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(email.toLowerCase().trim()) as UserRow | undefined;
  if (!user) {
    // Still run a bcrypt compare against a dummy hash to keep timing
    // consistent between "unknown user" and "wrong password".
    await bcrypt.compare(password, "$2a$10$invalidinvalidinvalidinvalidinvalidin");
    return null;
  }
  const ok = await bcrypt.compare(password, user.password_hash);
  return ok ? user : null;
}

export async function createSession(
  userId: string,
  userAgent: string | null
): Promise<void> {
  const rec = createSessionRecord(userId, userAgent);

  const store = await cookies();
  store.set(SESSION_COOKIE, rec.token, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "lax",
    path: "/",
    expires: new Date(rec.expiresAt),
  });
  store.set(CSRF_COOKIE, rec.csrfSecret, {
    httpOnly: false,
    secure: env.isProduction,
    sameSite: "lax",
    path: "/",
    expires: new Date(rec.expiresAt),
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    deleteSessionByToken(token);
  }
  store.delete(SESSION_COOKIE);
  store.delete(CSRF_COOKIE);
}

export async function getSession(): Promise<StoredSession | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getSessionByToken(token);
}

/**
 * Verifies a double-submit CSRF token for state-changing API requests.
 * The client must echo the (non-httpOnly) csrf cookie back as the
 * `x-csrf-token` header; an attacker's cross-site request cannot read
 * that cookie, so it cannot produce a matching header.
 */
export function verifyCsrf(
  headerToken: string | null,
  sessionCsrfSecret: string
): boolean {
  if (!headerToken) return false;
  return timingSafeEqual(headerToken, sessionCsrfSecret);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}
