import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rateLimit";
import { ensureToolsRegistered } from "@/lib/tools";
import { AIUnavailableError } from "@/lib/openai";
import { handleVoiceCommand, VoiceCommandError } from "@/lib/voice/command";
import { writeAuditEvent } from "@/lib/audit";

const bodySchema = z.object({
  conversationId: z.string().min(1).max(100),
  text: z.string().min(1).max(2000),
  // Optional hint from the client: the approval id it just displayed and
  // is asking the user to confirm/deny. Only ever used as a hint —
  // handleVoiceCommand independently re-verifies ownership, pending
  // status, and current revision before deciding anything.
  trackedApprovalId: z.string().max(100).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const rate = checkRateLimit({
    bucket: `voice-command:${session.user.id}`,
    limit: 30,
    windowMs: 5 * 60 * 1000,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many voice commands. Please wait a moment." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  ensureToolsRegistered();

  writeAuditEvent({
    userId: session.user.id,
    toolId: "voice.command",
    eventType: "info",
    summary: "Voice command received.",
    // No `detail` — the spoken text itself is not written to the audit
    // log here; if it results in a tool call, that tool's own audit
    // event (with its own redaction rules) is what gets recorded.
  });

  try {
    const result = await handleVoiceCommand(session.user.id, parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof VoiceCommandError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof AIUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    const message = err instanceof Error ? err.message : "Something went wrong.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
