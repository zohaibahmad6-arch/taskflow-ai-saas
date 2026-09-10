import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { env } from "@/lib/env";
import { createOAuthState, pruneExpiredOAuthStates } from "@/lib/oauthState";
import { buildGoogleAuthUrl } from "@/lib/googleOAuth";
import { writeAuditEvent } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rateLimit";

/**
 * Reached via a real top-level browser navigation (a link, not fetch) —
 * OAuth requires the user to actually land on Google's consent screen.
 * Creates a single-use state value and redirects there. Never itself
 * marks anything "connected" — that only happens in callback/route.ts,
 * after the code exchange is verified against a real Gmail API call.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const rate = checkRateLimit({
    bucket: `gmail-oauth-start:${session.user.id}`,
    limit: 10,
    windowMs: 10 * 60 * 1000,
  });
  if (!rate.allowed) {
    const url = new URL("/email", req.url);
    url.searchParams.set("gmail", "error");
    url.searchParams.set("gmail_detail", "rate_limited");
    return NextResponse.redirect(url);
  }

  if (!env.googleOAuthConfigured) {
    const url = new URL("/email", req.url);
    url.searchParams.set("gmail", "error");
    url.searchParams.set("gmail_detail", "not_configured");
    return NextResponse.redirect(url);
  }

  pruneExpiredOAuthStates();
  const state = createOAuthState(session.user.id, "gmail");

  writeAuditEvent({
    userId: session.user.id,
    toolId: "system.connections",
    eventType: "info",
    summary: "Started Gmail connection (OAuth).",
    target: "gmail",
  });

  return NextResponse.redirect(buildGoogleAuthUrl(state));
}
