import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { env } from "@/lib/env";
import { createOAuthState, pruneExpiredOAuthStates } from "@/lib/oauthState";
import { buildMicrosoftAuthUrl } from "@/lib/microsoftOAuth";
import { writeAuditEvent } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rateLimit";

/**
 * Reached via a real top-level browser navigation (a link, not fetch) —
 * OAuth requires the user to actually land on Microsoft's consent screen.
 * Creates a single-use state value and redirects there. Never itself
 * marks anything "connected" — that only happens in callback/route.ts,
 * after the code exchange is verified against a real Graph API call.
 * Mirrors /api/oauth/gmail/start exactly.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const rate = checkRateLimit({
    bucket: `outlook-oauth-start:${session.user.id}`,
    limit: 10,
    windowMs: 10 * 60 * 1000,
  });
  if (!rate.allowed) {
    const url = new URL("/email", req.url);
    url.searchParams.set("outlook", "error");
    url.searchParams.set("outlook_detail", "rate_limited");
    return NextResponse.redirect(url);
  }

  if (!env.microsoftOAuthConfigured) {
    const url = new URL("/email", req.url);
    url.searchParams.set("outlook", "error");
    url.searchParams.set("outlook_detail", "not_configured");
    return NextResponse.redirect(url);
  }

  pruneExpiredOAuthStates();
  const state = createOAuthState(session.user.id, "outlook");

  writeAuditEvent({
    userId: session.user.id,
    toolId: "system.connections",
    eventType: "info",
    summary: "Started Outlook connection (OAuth).",
    target: "outlook",
  });

  return NextResponse.redirect(buildMicrosoftAuthUrl(state));
}
