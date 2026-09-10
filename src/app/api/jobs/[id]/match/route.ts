import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ensureToolsRegistered } from "@/lib/tools";
import { invokeTool } from "@/lib/tools/execute";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { id } = await params;
  ensureToolsRegistered();
  try {
    const result = await invokeTool("jobs.matchProfile", { jobId: id }, { userId: session.user.id });
    return NextResponse.json({ ok: true, output: result.output });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not match that job.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
