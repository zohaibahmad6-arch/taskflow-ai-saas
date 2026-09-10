import "server-only";
import { env } from "./env";
import { fetchWithTimeout, UpstreamTimeoutError } from "./upstreamTimeout";

/**
 * Thin, direct wrapper around Google's OAuth 2.0 + token endpoints (no
 * SDK) so exactly what's sent/logged is fully auditable in this one file.
 *
 * HARD RULE for every function here: never log, throw-with, or otherwise
 * surface a raw access token, refresh token, authorization code, or the
 * client secret. Errors carry only Google's machine-readable error code
 * (e.g. "invalid_grant") — never response bodies verbatim, which could
 * echo back sensitive request parameters.
 */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
// Bounded wait for Google's token/revoke endpoints. Never retried on
// timeout/failure: an authorization-code exchange consumes a single-use
// code, a refresh happens lazily on the next real request, and revoke is
// already explicitly best-effort/never-throws below.
const TOKEN_REQUEST_TIMEOUT_MS = 10_000;
const REVOKE_REQUEST_TIMEOUT_MS = 10_000;

/** Minimum scope for everything this phase needs: read mail, nothing else. No send/modify/delete scope is ever requested. */
export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export class GoogleOAuthError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "GoogleOAuthError";
    this.code = code;
  }
}

export function buildGoogleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.googleOAuthClientId,
    redirect_uri: env.googleOAuthRedirectUri,
    response_type: "code",
    scope: GMAIL_READONLY_SCOPE,
    access_type: "offline", // required to receive a refresh_token
    prompt: "consent", // force a refresh_token on every connect, not just the first ever grant
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export type GoogleTokenSet = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string; // ISO 8601
  scope: string;
};

async function postToken(body: URLSearchParams): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetchWithTimeout(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      timeoutMs: TOKEN_REQUEST_TIMEOUT_MS,
      serviceName: "Google",
    });
  } catch (err) {
    if (err instanceof UpstreamTimeoutError) {
      throw new GoogleOAuthError("Google's token endpoint took too long to respond.");
    }
    throw new GoogleOAuthError("Could not reach Google's token endpoint (network error).");
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = typeof data.error === "string" ? data.error : String(res.status);
    throw new GoogleOAuthError(`Google rejected the token request (${code}).`, code);
  }
  return data;
}

/** Exchanges a one-time authorization code for an access/refresh token pair. */
export async function exchangeCodeForTokens(code: string): Promise<GoogleTokenSet> {
  const data = await postToken(
    new URLSearchParams({
      code,
      client_id: env.googleOAuthClientId,
      client_secret: env.googleOAuthClientSecret,
      redirect_uri: env.googleOAuthRedirectUri,
      grant_type: "authorization_code",
    })
  );

  if (typeof data.access_token !== "string" || !data.access_token) {
    throw new GoogleOAuthError("Google's token response was missing an access token.");
  }

  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
  return {
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : null,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    scope: typeof data.scope === "string" ? data.scope : "",
  };
}

/** Exchanges a stored refresh token for a new access token. Google does not reliably return a new refresh_token here — callers should keep the existing one. */
export async function refreshAccessToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresAt: string }> {
  const data = await postToken(
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.googleOAuthClientId,
      client_secret: env.googleOAuthClientSecret,
      grant_type: "refresh_token",
    })
  );

  if (typeof data.access_token !== "string" || !data.access_token) {
    throw new GoogleOAuthError("Google's refresh response was missing an access token.");
  }

  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}

/**
 * Best-effort revocation at Google (invalidates the token on Google's
 * side too, not just locally). Never throws: disconnecting the account
 * in this app must always succeed locally even if Google's revoke
 * endpoint is unreachable or the token was already invalid.
 */
export async function revokeGoogleToken(token: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      timeoutMs: REVOKE_REQUEST_TIMEOUT_MS,
      serviceName: "Google",
    });
    return res.ok;
  } catch {
    return false;
  }
}
