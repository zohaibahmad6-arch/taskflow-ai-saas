import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listConnections } from "@/lib/connections";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const connections = listConnections(session.user.id).map((c) => ({
    provider: c.provider,
    category: c.category,
    status: c.status,
    accountLabel: c.account_label,
    connectedAt: c.connected_at,
  }));
  return NextResponse.json({ connections });
}
