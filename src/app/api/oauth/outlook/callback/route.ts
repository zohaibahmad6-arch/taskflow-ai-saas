import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { consumeOAuthState } from "@/lib/oauthState";
import { exchangeCodeForTokens, MicrosoftOAuthError } from "@/lib/microsoftOAuth";
import { verifyOutlookAccessToken } from "@/lib/email/outlook";
import { storeVerifiedConnection, markConnectionError, ensureConnectionRows } from "@/lib/connections";
import { writeAuditEvent } from "@/lib/audit";

function toEmail(req: NextRequest, status: "connected" | "error" | "cancelled", detail?: string) {
  const url = new URL("/email", req.url);
  url.searchParams.set("outlook", status);
  if (detail) url.searchParams.set("outlook_detail", detail);
  return NextResponse.redirect(url);
}

/**
 * The Outlook OAuth callback. Nothing here is allowed to mark a connection
 * "connected" except the success path at the bottom, and only after:
 *  1) the state param is validated (single-use, matches this user, unexpired),
 *  2) the authorization code is exchanged for real tokens,
 *  3) a real Graph API call (verifyOutlookAccessToken) succeeds with those tokens.
 * Any failure at any step leaves the connection as not_connected/error —
 * never a false "connected". Mirrors /api/oauth/gmail/callback exactly.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  ensureConnectionRows(session.user.id);

  const params = req.nextUrl.searchParams;
  const oauthError = params.get("error");
  const code = params.get("code");
  const state = params.get("state");

  // Consume the state regardless of outcome, so it can never be replayed.
  const stateUserId = state ? consumeOAuthState(state, "outlook") : null;

  if (oauthError) {
    // The user declined consent, or Microsoft rejected the request outright.
    writeAuditEvent({
      userId: session.user.id,
      toolId: "system.connections",
      eventType: "info",
      summary: `Outlook connection was not completed (${oauthError}).`,
      target: "outlook",
    });
    return toEmail(req, oauthError === "access_denied" ? "cancelled" : "error", oauthError);
  }

  if (!state || !stateUserId) {
    writeAuditEvent({
      userId: session.user.id,
      toolId: "system.connections",
      eventType: "failed",
      summary: "Outlook connection rejected: missing or invalid OAuth state.",
      target: "outlook",
    });
    return toEmail(req, "error", "invalid_state");
  }

  if (stateUserId !== session.user.id) {
    // The state was valid but was issued for a different session — never
    // attach these tokens to the currently logged-in user.
    writeAuditEvent({
      userId: session.user.id,
      toolId: "system.connections",
      eventType: "failed",
      summary: "Outlook connection rejected: OAuth state did not match the current session.",
      target: "outlook",
    });
    return toEmail(req, "error", "state_mismatch");
  }

  if (!code) {
    return toEmail(req, "error", "missing_code");
  }

  try {
    const tokens = await exchangeCodeForTokens(code);

    if (!tokens.refreshToken) {
      // Should not happen given offline_access + prompt=consent, but a
      // connection with no refresh token would silently die once the
      // access token expires — refuse it explicitly instead.
      throw new MicrosoftOAuthError("Microsoft did not return a refresh token. Please try connecting again.");
    }

    // Step 3: verify against a REAL Graph API call before storing anything as connected.
    const { emailAddress } = await verifyOutlookAccessToken(tokens.accessToken);

    storeVerifiedConnection({
      userId: session.user.id,
      provider: "outlook",
      category: "email",
      accountLabel: emailAddress,
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        scope: tokens.scope,
      },
    });

    writeAuditEvent({
      userId: session.user.id,
      toolId: "system.connections",
      eventType: "info",
      summary: `Connected Outlook (${emailAddress}).`,
      target: "outlook",
    });

    return toEmail(req, "connected");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Outlook connection failed.";
    markConnectionError(session.user.id, "outlook", message);
    writeAuditEvent({
      userId: session.user.id,
      toolId: "system.connections",
      eventType: "failed",
      summary: "Outlook connection failed.",
      target: "outlook",
      error: message,
    });
    return toEmail(req, "error", "connection_failed");
  }
}
