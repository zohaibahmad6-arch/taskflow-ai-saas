import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { listJobs } from "@/lib/jobs/store";
import { ensureToolsRegistered } from "@/lib/tools";
import { invokeTool } from "@/lib/tools/execute";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const jobs = listJobs(session.user.id);
  return NextResponse.json({ jobs });
}

const captureSchema = z.object({
  rawText: z.string().min(20).max(30_000),
  sourceUrl: z.string().url().max(1000).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = captureSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Paste the full job posting text (at least 20 characters)." }, { status: 400 });
  }

  ensureToolsRegistered();
  try {
    const result = await invokeTool("jobs.captureFromText", parsed.data, { userId: session.user.id });
    return NextResponse.json({ ok: true, output: result.output });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not capture that job posting.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
