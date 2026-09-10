import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rateLimit";
import { generateDailyBriefing } from "@/lib/dailyBriefing";

/**
 * Returns today's Daily Personal Briefing, generating it on demand if it
 * doesn't exist yet for today (idempotent — see dailyBriefing.ts). Pass
 * ?refresh=1 to force a fresh aggregation instead of reusing today's
 * already-stored briefing.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const forceRefresh = req.nextUrl.searchParams.get("refresh") === "1";

  const rate = checkRateLimit({
    bucket: `briefing:${session.user.id}`,
    limit: forceRefresh ? 10 : 60,
    windowMs: 5 * 60 * 1000,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many requests. Please wait a moment." }, { status: 429 });
  }

  try {
    const briefing = await generateDailyBriefing(session.user.id, { forceRefresh });
    return NextResponse.json({ briefing });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not generate today's briefing.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
