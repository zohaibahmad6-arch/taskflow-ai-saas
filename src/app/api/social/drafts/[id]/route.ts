import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { getSocialDraft, updateSocialDraftStatus } from "@/lib/socialDrafts";
import { ensureToolsRegistered } from "@/lib/tools";
import { invokeTool } from "@/lib/tools/execute";

const patchSchema = z.object({
  action: z.enum(["publish", "discard"]),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { id } = await params;
  const draft = getSocialDraft(id);
  if (!draft || draft.user_id !== session.user.id) {
    return NextResponse.json({ error: "Draft not found." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  if (parsed.data.action === "discard") {
    updateSocialDraftStatus(id, "rejected");
    return NextResponse.json({ ok: true });
  }

  ensureToolsRegistered();
  try {
    const result = await invokeTool("social.publishPost", { draftId: id }, { userId: session.user.id });
    return NextResponse.json({ ok: true, approvalId: result.approvalId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not prepare that action.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
