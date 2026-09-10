import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listAuditEvents } from "@/lib/audit";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const events = listAuditEvents(session.user.id, 200);
  return NextResponse.json({ events });
}
