import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { getPreferences, updatePreferences } from "@/lib/preferences";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const prefs = getPreferences(session.user.id);
  return NextResponse.json({
    preferences: {
      writingStyle: prefs.writing_style ?? "",
      tone: prefs.tone ?? "",
      preferredLength: prefs.preferred_length ?? "",
      audience: prefs.audience ?? "",
      topics: JSON.parse(prefs.topics_json || "[]"),
      avoidTopics: JSON.parse(prefs.avoid_topics_json || "[]"),
      hashtagPreference: prefs.hashtag_preference ?? "",
      formattingNotes: prefs.formatting_notes ?? "",
      aiInstructions: prefs.ai_instructions ?? "",
    },
  });
}

const updateSchema = z.object({
  writingStyle: z.string().max(2000).optional(),
  tone: z.string().max(500).optional(),
  preferredLength: z.string().max(200).optional(),
  audience: z.string().max(500).optional(),
  topics: z.array(z.string().max(200)).max(50).optional(),
  avoidTopics: z.array(z.string().max(200)).max(50).optional(),
  hashtagPreference: z.string().max(500).optional(),
  formattingNotes: z.string().max(2000).optional(),
  aiInstructions: z.string().max(4000).optional(),
});

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid preferences." }, { status: 400 });

  updatePreferences(session.user.id, parsed.data);
  return NextResponse.json({ ok: true });
}
