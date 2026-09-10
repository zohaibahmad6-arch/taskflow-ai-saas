import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

const USER_SCOPED_TABLES = [
  "preferences",
  "connected_accounts",
  "email_summaries",
  "social_drafts",
  "approvals",
  "audit_events",
  "capability_requests",
  "notifications",
  "chat_messages",
];

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const data: Record<string, unknown> = {
    exportedAt: new Date().toISOString(),
    user: session.user,
  };

  for (const table of USER_SCOPED_TABLES) {
    data[table] = db
      .prepare(`SELECT * FROM ${table} WHERE user_id = ?`)
      .all(session.user.id);
  }

  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": "attachment; filename=personal-agent-export.json",
    },
  });
}
