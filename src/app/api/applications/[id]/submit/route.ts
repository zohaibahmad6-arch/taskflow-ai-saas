import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ensureToolsRegistered } from "@/lib/tools";
import { invokeTool } from "@/lib/tools/execute";

/**
 * Creates a pending Approval Center entry for this application — never
 * submits anything itself. See jobs.submitApplication's execute() for why
 * even an APPROVED decision cannot submit to LinkedIn.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { id } = await params;
  ensureToolsRegistered();
  try {
    const result = await invokeTool("jobs.submitApplication", { applicationId: id }, { userId: session.user.id });
    return NextResponse.json({ ok: true, approvalId: result.approvalId, output: result.output });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not prepare that submission for approval.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
