import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { disconnectProvider, getConnection, getDecryptedTokens } from "@/lib/connections";
import { revokeGoogleToken } from "@/lib/googleOAuth";
import { revokeMicrosoftToken } from "@/lib/microsoftOAuth";
import { writeAuditEvent } from "@/lib/audit";

const OAUTH_ENV_HINT: Record<string, string> = {
  gmail: "GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REDIRECT_URI",
  outlook: "MICROSOFT_OAUTH_CLIENT_ID / MICROSOFT_OAUTH_CLIENT_SECRET",
  linkedin: "LINKEDIN_OAUTH_CLIENT_ID / LINKEDIN_OAUTH_CLIENT_SECRET",
  x: "X_OAUTH_CLIENT_ID / X_OAUTH_CLIENT_SECRET",
  facebook: "FACEBOOK_OAUTH_CLIENT_ID / FACEBOOK_OAUTH_CLIENT_SECRET",
  instagram: "INSTAGRAM_OAUTH_CLIENT_ID / INSTAGRAM_OAUTH_CLIENT_SECRET",
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { provider } = await params;
  const connection = getConnection(session.user.id, provider);
  if (!connection) return NextResponse.json({ error: "Unknown provider." }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  if (action === "disconnect") {
    // Best-effort revoke at the provider using the token we're about to
    // discard, BEFORE discarding it — never blocks the local disconnect
    // on this succeeding (the user must always be able to disconnect
    // locally even if the provider is unreachable).
    if (provider === "gmail") {
      const tokens = getDecryptedTokens(session.user.id, "gmail");
      if (tokens) {
        await revokeGoogleToken(tokens.refreshToken ?? tokens.accessToken).catch(() => false);
      }
    }
    if (provider === "outlook") {
      // Best-effort only: the Microsoft identity platform has no public
      // revoke REST API for this token type (see microsoftOAuth.ts) — this
      // always returns false. Local disconnect below still fully removes
      // the stored tokens regardless.
      await revokeMicrosoftToken().catch(() => false);
    }

    disconnectProvider(session.user.id, provider);
    writeAuditEvent({
      userId: session.user.id,
      toolId: "system.connections",
      eventType: "info",
      summary: `Disconnected ${provider}.`,
      target: provider,
    });
    return NextResponse.json({ ok: true, status: "not_connected" });
  }

  if (action === "connect") {
    if (provider === "gmail") {
      // Gmail uses a real OAuth redirect flow, not a JSON action — the
      // client must navigate to this URL (a top-level browser
      // navigation), not fetch() it.
      return NextResponse.json({ redirectTo: "/api/oauth/gmail/start" });
    }
    if (provider === "outlook") {
      return NextResponse.json({ redirectTo: "/api/oauth/outlook/start" });
    }

    // Honest stub: no real OAuth app is registered for this deployment yet.
    // We do not fake a "connected" state. Wiring up real OAuth is a
    // follow-up development task once you have provider credentials.
    return NextResponse.json(
      {
        error: `Connecting ${provider} requires OAuth credentials for this provider (${
          OAUTH_ENV_HINT[provider] ?? "provider-specific OAuth client"
        }), which are not configured in this deployment. This account will remain "not connected" until that is set up.`,
      },
      { status: 501 }
    );
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
