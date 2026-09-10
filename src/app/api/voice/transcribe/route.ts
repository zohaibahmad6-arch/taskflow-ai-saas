import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rateLimit";
import { transcribeAudio, AIUnavailableError } from "@/lib/voice/transcribe";
import { writeAuditEvent } from "@/lib/audit";

/**
 * Converts a short voice recording to text. This is the ONLY place raw
 * microphone audio ever exists in this system, and only transiently:
 *  - the audio bytes live in memory for the duration of this one request
 *    (read from the incoming multipart body straight into a Buffer, handed
 *    directly to the OpenAI SDK via transcribeAudio()) — nothing is ever
 *    written to disk, so there is no temp file to clean up and nothing
 *    that could survive a crash mid-request.
 *  - the audio is never logged, never stored, and never appears in the
 *    audit log — only a content-free "a voice command was transcribed"
 *    event is recorded (see writeAuditEvent below), same policy as the
 *    rest of this app's audit log for anything privacy-sensitive.
 *  - the returned transcript text is not persisted by this endpoint
 *    either; it only becomes part of the normal conversation history if
 *    the caller goes on to submit it to /api/voice/command (or /api/chat),
 *    exactly like a typed message would be.
 */

const MAX_AUDIO_BYTES = 8 * 1024 * 1024; // ~8MB — generous for a short spoken command, far under Whisper's own 25MB limit
const MAX_DURATION_HINT_SECONDS = 60; // enforced client-side (auto-stop) — see useVoiceRecorder; this is the documented upper bound this endpoint expects

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const rate = checkRateLimit({
    bucket: `voice-transcribe:${session.user.id}`,
    limit: 20,
    windowMs: 10 * 60 * 1000,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many voice requests. Please wait a moment." }, { status: 429 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Could not read the uploaded audio." }, { status: 400 });
  }

  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) {
    return NextResponse.json({ error: "No audio was received. Please try recording again." }, { status: 400 });
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      { error: `That recording is too long (max ~${MAX_DURATION_HINT_SECONDS}s). Try a shorter command.` },
      { status: 413 }
    );
  }

  try {
    const buffer = Buffer.from(await audio.arrayBuffer());
    const text = await transcribeAudio(buffer, audio.type);

    writeAuditEvent({
      userId: session.user.id,
      toolId: "voice.transcribe",
      eventType: "info",
      summary: text ? `Voice command transcribed (${text.length} chars).` : "Voice command transcription returned empty text.",
      // Deliberately no `detail` — the transcript itself is never written
      // to the audit log, only that a transcription happened.
    });

    if (!text) {
      return NextResponse.json({ error: "Didn't catch that — no speech was recognized. Please try again." }, { status: 422 });
    }

    return NextResponse.json({ text });
  } catch (err) {
    const message = err instanceof AIUnavailableError ? err.message : "Could not transcribe that audio right now.";
    writeAuditEvent({
      userId: session.user.id,
      toolId: "voice.transcribe",
      eventType: "failed",
      summary: "Voice transcription failed.",
      error: message,
    });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
