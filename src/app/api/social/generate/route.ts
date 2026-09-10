import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rateLimit";
import { ensureToolsRegistered } from "@/lib/tools";
import { invokeTool } from "@/lib/tools/execute";
import { AIUnavailableError } from "@/lib/openai";

const schema = z.object({
  platform: z.enum(["linkedin", "x", "facebook", "instagram"]),
  topic: z.string().min(1).max(2000),
  notes: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const rate = checkRateLimit({
    bucket: `social-generate:${session.user.id}`,
    limit: 20,
    windowMs: 5 * 60 * 1000,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many requests. Slow down." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  ensureToolsRegistered();
  try {
    const result = await invokeTool("social.createPost", parsed.data, { userId: session.user.id });
    return NextResponse.json(result.output);
  } catch (err) {
    if (err instanceof AIUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    const message = err instanceof Error ? err.message : "Could not generate that post.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
