import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import {
  decideApproval,
  editApproval,
  ApprovalNotFoundError,
  ApprovalStateError,
  ApprovalRevisionMismatchError,
} from "@/lib/approvals";
import { checkRateLimit } from "@/lib/rateLimit";
import { ensureToolsRegistered } from "@/lib/tools";

const decisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  expectedRevision: z.number().int().min(0),
});

const editSchema = z.object({
  payload: z.record(z.string(), z.unknown()),
});

function errorStatus(err: unknown): number {
  if (err instanceof ApprovalNotFoundError) return 404;
  if (err instanceof ApprovalRevisionMismatchError) return 409;
  if (err instanceof ApprovalStateError) return 400;
  return 400;
}

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

  // Defensive: this must behave correctly as the very first request handled
  // by a fresh server process (e.g. a serverless cold start), not rely on
  // some earlier page render having already populated the tool registry.
  ensureToolsRegistered();

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = decisionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body. A decision requires expectedRevision (the revision you last viewed)." },
      { status: 400 }
    );
  }

  try {
    const updated = await decideApproval(
      session.user.id,
      id,
      parsed.data.decision,
      parsed.data.expectedRevision
    );
    return NextResponse.json({ approval: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not process that decision.";
    return NextResponse.json({ error: message }, { status: errorStatus(err) });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const rate = checkRateLimit({
    bucket: `approval-edit:${session.user.id}`,
    limit: 40,
    windowMs: 5 * 60 * 1000,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many requests. Slow down." }, { status: 429 });
  }

  ensureToolsRegistered();

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = editSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid edit request." }, { status: 400 });
  }

  try {
    const updated = await editApproval(session.user.id, id, parsed.data.payload);
    return NextResponse.json({ approval: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not apply that edit.";
    return NextResponse.json({ error: message }, { status: errorStatus(err) });
  }
}
