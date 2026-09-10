import { NextResponse } from "next/server";
import { getSession, revokeOtherSessions } from "@/lib/auth";
import { writeAuditEvent } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rateLimit";

/** "Sign out other devices" — keeps the current session, revokes every other one immediately. */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const rate = checkRateLimit({
    bucket: `revoke-sessions:${session.user.id}`,
    limit: 10,
    windowMs: 15 * 60 * 1000,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const revokedCount = revokeOtherSessions(session.user.id, session.sessionId);

  writeAuditEvent({
    userId: session.user.id,
    toolId: "system.account",
    eventType: "info",
    summary: `Signed out ${revokedCount} other session(s).`,
  });

  return NextResponse.json({ ok: true, revokedSessions: revokedCount });
}
