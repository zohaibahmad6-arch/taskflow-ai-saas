import "server-only";
import { env } from "./env";

/**
 * Thin, direct wrapper around the Microsoft identity platform's OAuth 2.0
 * + token endpoints (no SDK) so exactly what's sent/logged is fully
 * auditable in this one file — mirrors googleOAuth.ts exactly.
 *
 * HARD RULE for every function here: never log, throw-with, or otherwise
 * surface a raw access token, refresh token, authorization code, or the
 * client secret. Errors carry only Microsoft's machine-readable error code
 * (e.g. "invalid_grant") — never response bodies verbatim, which could
 * echo back sensitive request parameters.
 *
 * Uses the "common" tenant endpoint so both personal Microsoft accounts
 * and work/school accounts can sign in — this is a single-user app, so
 * whichever account the owner connects is simply the one that gets used.
 */

const AUTH_ENDPOINT = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const TOKEN_ENDPOINT = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

/**
 * Delegated Microsoft Graph scopes requested, and why each one is needed.
 * Every scope here is required for a capability this build actually
 * implements — nothing is requested "just in case":
 *   - openid, profile, email: standard OIDC scopes to identify the signed-in
 *     account (used only to label the connection, e.g. "Connected as
 *     you@outlook.com" — verified via a real Graph /me call, never trusted
 *     from the ID token alone).
 *   - offline_access: required to receive a refresh token, so the
 *     connection survives past the first access token's ~1 hour lifetime
 *     without asking the user to re-consent every hour.
 *   - Mail.Read: read/search/summarize the mailbox (the core read-only
 *     capability).
 *   - Mail.ReadWrite: required for the approved mailbox-organization
 *     actions this build implements (move, archive, delete, mark
 *     read/unread, flag/unflag, apply category) — every one of these is an
 *     EXTERNAL_ACTION tool that only ever runs after explicit user
 *     approval in the Approval Center; the scope is what makes an already-
 *     approved action possible to execute at all, never a standing grant
 *     to act unsupervised.
 *   - Mail.Send: required for the approved send-reply/forward actions,
 *     same approval-gated reasoning as Mail.ReadWrite.
 * No calendar, contacts, files, directory, or admin-level permission is
 * ever requested.
 */
export const MICROSOFT_GRAPH_SCOPES =
  "openid profile email offline_access Mail.Read Mail.ReadWrite Mail.Send";

export class MicrosoftOAuthError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "MicrosoftOAuthError";
    this.code = code;
  }
}

export function buildMicrosoftAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.microsoftOAuthClientId,
    redirect_uri: env.microsoftOAuthRedirectUri,
    response_type: "code",
    response_mode: "query",
    scope: MICROSOFT_GRAPH_SCOPES,
    prompt: "consent", // force a fresh consent + refresh_token on every connect, not just the first ever grant
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export type MicrosoftTokenSet = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string; // ISO 8601
  scope: string;
};

async function postToken(body: URLSearchParams): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch {
    throw new MicrosoftOAuthError("Could not reach Microsoft's token endpoint (network error).");
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = typeof data.error === "string" ? data.error : String(res.status);
    throw new MicrosoftOAuthError(`Microsoft rejected the token request (${code}).`, code);
  }
  return data;
}

/** Exchanges a one-time authorization code for an access/refresh token pair. */
export async function exchangeCodeForTokens(code: string): Promise<MicrosoftTokenSet> {
  const data = await postToken(
    new URLSearchParams({
      code,
      client_id: env.microsoftOAuthClientId,
      client_secret: env.microsoftOAuthClientSecret,
      redirect_uri: env.microsoftOAuthRedirectUri,
      grant_type: "authorization_code",
      scope: MICROSOFT_GRAPH_SCOPES,
    })
  );

  if (typeof data.access_token !== "string" || !data.access_token) {
    throw new MicrosoftOAuthError("Microsoft's token response was missing an access token.");
  }

  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
  return {
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : null,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    scope: typeof data.scope === "string" ? data.scope : "",
  };
}

/** Exchanges a stored refresh token for a new access token. Microsoft rotates refresh tokens on every use, so the new one (if returned) must be stored — unlike Google, the old one may stop working. */
export async function refreshAccessToken(
  refreshToken: string
): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: string }> {
  const data = await postToken(
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.microsoftOAuthClientId,
      client_secret: env.microsoftOAuthClientSecret,
      grant_type: "refresh_token",
      scope: MICROSOFT_GRAPH_SCOPES,
    })
  );

  if (typeof data.access_token !== "string" || !data.access_token) {
    throw new MicrosoftOAuthError("Microsoft's refresh response was missing an access token.");
  }

  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
  return {
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : null,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}

/**
 * Best-effort remote revocation. Unlike Google, the Microsoft identity
 * platform (v2 endpoint) does not expose a public token-revocation REST
 * API for confidential client apps — there is no equivalent call to make
 * here. This always returns false (documented, not a bug): disconnecting
 * in this app still fully removes the locally stored encrypted tokens
 * (see connections.ts disconnectProvider), which is what actually matters
 * for this app's own access; the user can additionally revoke access
 * directly from https://myaccount.microsoft.com/ or
 * https://account.live.com/consent/Manage if they want to fully revoke it
 * on Microsoft's side.
 */
export async function revokeMicrosoftToken(): Promise<boolean> {
  return false;
}
