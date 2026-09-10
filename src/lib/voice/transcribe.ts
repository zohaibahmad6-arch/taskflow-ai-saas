import "server-only";
import { toFile } from "openai";
import { getOpenAIClient, AIUnavailableError } from "../openai";

/**
 * Converts raw audio bytes to text via OpenAI's transcription API. The
 * ONLY place raw microphone audio exists in this system — it lives only
 * as a function parameter for the duration of this one async call
 * (nothing writes it to disk, nothing logs it, nothing returns it) — see
 * the route handler for the full data-lifecycle rationale.
 */
export async function transcribeAudio(buffer: Buffer, mimeType: string): Promise<string> {
  const openai = getOpenAIClient();
  const file = await toFile(buffer, "command.webm", { type: mimeType || "audio/webm" });
  const transcription = await openai.audio.transcriptions.create({ file, model: "whisper-1" });
  return transcription.text?.trim() ?? "";
}

export { AIUnavailableError };
