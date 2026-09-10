import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { getSession, hashPassword, revokeOtherSessions } from "@/lib/auth";
import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/rateLimit";
import { writeAuditEvent } from "@/lib/audit";

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10).max(200),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const rate = checkRateLimit({
    bucket: `change-password:${session.user.id}`,
    limit: 5,
    windowMs: 15 * 60 * 1000,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "New password must be at least 10 characters." },
      { status: 400 }
    );
  }

  const user = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(session.user.id) as
    | { password_hash: string }
    | undefined;
  if (!user) return NextResponse.json({ error: "Account not found." }, { status: 404 });

  const ok = await bcrypt.compare(parsed.data.currentPassword, user.password_hash);
  if (!ok) return NextResponse.json({ error: "Current password is incorrect." }, { status: 401 });

  const newHash = await hashPassword(parsed.data.newPassword);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(newHash, session.user.id);

  // A password change is often a direct response to a suspected
  // compromise — an old session cookie must not remain valid for up to
  // 30 more days just because the browser that holds it wasn't the one
  // used to change the password. The current session is kept active
  // (the user making this change stays logged in); every other session
  // is deleted immediately and fails on its very next request.
  const revokedCount = revokeOtherSessions(session.user.id, session.sessionId);

  writeAuditEvent({
    userId: session.user.id,
    toolId: "system.account",
    eventType: "info",
    summary:
      revokedCount > 0
        ? `Password changed. Signed out ${revokedCount} other session(s).`
        : "Password changed.",
  });

  return NextResponse.json({ ok: true, revokedSessions: revokedCount });
}
