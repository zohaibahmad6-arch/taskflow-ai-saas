import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listSocialDrafts } from "@/lib/socialDrafts";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const drafts = listSocialDrafts(session.user.id);
  return NextResponse.json({ drafts });
}
