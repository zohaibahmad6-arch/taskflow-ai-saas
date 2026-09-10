import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rateLimit";
import { ensureToolsRegistered } from "@/lib/tools";
import { runChatTurn, getConversationHistory } from "@/lib/ai/chat";
import { AIUnavailableError } from "@/lib/openai";

const chatSchema = z.object({
  conversationId: z.string().min(1).max(100),
  message: z.string().min(1).max(8000),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const rate = checkRateLimit({
    bucket: `chat:${session.user.id}`,
    limit: 30,
    windowMs: 5 * 60 * 1000,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "You're sending messages too quickly. Please wait a moment." },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = chatSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  ensureToolsRegistered();

  try {
    const result = await runChatTurn(session.user.id, parsed.data.conversationId, parsed.data.message);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AIUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    const message = err instanceof Error ? err.message : "Something went wrong.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const conversationId = req.nextUrl.searchParams.get("conversationId");
  if (!conversationId) return NextResponse.json({ error: "Missing conversationId." }, { status: 400 });

  const history = getConversationHistory(session.user.id, conversationId).filter(
    (m) => m.role === "user" || m.role === "assistant"
  );

  return NextResponse.json({
    messages: history.map((m) => ({ role: m.role, content: m.content })),
  });
}
