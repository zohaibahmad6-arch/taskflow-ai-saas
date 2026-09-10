import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { disconnectProvider, getConnection } from "@/lib/connections";
import { writeAuditEvent } from "@/lib/audit";

const OAUTH_ENV_HINT: Record<string, string> = {
  gmail: "GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET",
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
