import "server-only";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { db, newId } from "./db";
import { randomToken, sha256Hex, timingSafeEqual } from "./crypto";
import { env } from "./env";

export const SESSION_COOKIE = "pa_session";
export const CSRF_COOKIE = "pa_csrf";
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type SessionUser = {
  id: string;
  email: string;
  name: string;
};

type UserRow = {
  id: string;
  email: string;
  name: string;
  password_hash: string;
};

type SessionRow = {
  id: string;
  user_id: string;
  token_hash: string;
  csrf_secret: string;
  expires_at: string;
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
  const token = randomToken(32);
  const csrfSecret = randomToken(24);
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();

  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, csrf_secret, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(newId("sess"), userId, tokenHash, csrfSecret, userAgent, expiresAt);

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAt),
  });
  store.set(CSRF_COOKIE, csrfSecret, {
    httpOnly: false,
    secure: env.isProduction,
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAt),
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    const tokenHash = sha256Hex(token);
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  }
  store.delete(SESSION_COOKIE);
  store.delete(CSRF_COOKIE);
}

export async function getSession(): Promise<{
  user: SessionUser;
  csrfSecret: string;
} | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const tokenHash = sha256Hex(token);
  const session = db
    .prepare("SELECT * FROM sessions WHERE token_hash = ?")
    .get(tokenHash) as SessionRow | undefined;
  if (!session) return null;

  if (new Date(session.expires_at).getTime() < Date.now()) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(session.id);
    return null;
  }

  const user = db
    .prepare("SELECT id, email, name FROM users WHERE id = ?")
    .get(session.user_id) as SessionUser | undefined;
  if (!user) return null;

  return { user, csrfSecret: session.csrf_secret };
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
