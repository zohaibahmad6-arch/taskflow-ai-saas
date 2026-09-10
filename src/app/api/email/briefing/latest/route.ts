import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getLatestBriefing } from "@/lib/email/briefing";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const briefing = getLatestBriefing(session.user.id);
  return NextResponse.json({ briefing });
}
