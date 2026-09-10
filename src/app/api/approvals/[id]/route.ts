import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { decideApproval } from "@/lib/approvals";
import { checkRateLimit } from "@/lib/rateLimit";

const decisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  editedContent: z.string().max(20000).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const rate = checkRateLimit({
    bucket: `approval-decision:${session.user.id}`,
    limit: 40,
    windowMs: 5 * 60 * 1000,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many requests. Slow down." }, { status: 429 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = decisionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    const updated = await decideApproval(
      session.user.id,
      id,
      parsed.data.decision,
      parsed.data.editedContent
    );
    return NextResponse.json({ approval: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not process that decision.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
