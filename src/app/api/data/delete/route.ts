import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAuditEvent } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rateLimit";

const USER_SCOPED_TABLES = [
  "connected_accounts",
  "email_summaries",
  "social_drafts",
  "approvals",
  "audit_events",
  "capability_requests",
  "notifications",
  "chat_messages",
  "push_subscriptions",
];

const schema = z.object({ password: z.string().min(1) });

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const rate = checkRateLimit({
    bucket: `data-delete:${session.user.id}`,
    limit: 5,
    windowMs: 15 * 60 * 1000,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Password required to confirm." }, { status: 400 });

  const user = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(session.user.id) as
    | { password_hash: string }
    | undefined;
  if (!user || !(await bcrypt.compare(parsed.data.password, user.password_hash))) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const tx = db.transaction(() => {
    for (const table of USER_SCOPED_TABLES) {
      db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(session.user.id);
    }
    db.prepare("DELETE FROM preferences WHERE user_id = ?").run(session.user.id);
    db.prepare("INSERT INTO preferences (user_id) VALUES (?)").run(session.user.id);
  });
  tx();

  // This audit entry is written after the wipe, intentionally: it is the
  // one record of the deletion itself.
  writeAuditEvent({
    userId: session.user.id,
    toolId: "system.data",
    eventType: "info",
    summary: "All assistant data was deleted by the user.",
  });

  return NextResponse.json({ ok: true });
}
