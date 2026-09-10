import "server-only";
import OpenAI from "openai";
import { env } from "./env";

let client: OpenAI | null = null;

// Bounded wait per OpenAI request. The SDK's own default is 10 minutes —
// far too long to leave a user-facing request hanging on. Left at the
// SDK's default retry behavior (safe here: chat/transcription calls are
// stateless generation, not mailbox mutations, so an automatic retry after
// a timeout cannot duplicate a real-world external action).
const REQUEST_TIMEOUT_MS = 30_000;

/** Lazily-constructed server-side OpenAI client. Never import this from client components. */
export function getOpenAIClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: env.openaiApiKey, timeout: REQUEST_TIMEOUT_MS });
  }
  return client;
}

export class AIUnavailableError extends Error {}

/** One-shot text generation for tool handlers that just need a completion, no tool loop. */
export async function generateText(params: {
  system: string;
  prompt: string;
  temperature?: number;
}): Promise<string> {
  try {
    const openai = getOpenAIClient();
    const completion = await openai.chat.completions.create({
      model: env.openaiModel,
      temperature: params.temperature ?? 0.7,
      messages: [
        { role: "system", content: params.system },
        { role: "user", content: params.prompt },
      ],
    });
    const text = completion.choices[0]?.message?.content;
    if (!text) throw new AIUnavailableError("The AI returned an empty response.");
    return text;
  } catch (err) {
    if (err instanceof AIUnavailableError) throw err;
    const message = err instanceof Error ? err.message : "Unknown AI error.";
    throw new AIUnavailableError(`AI request failed: ${message}`);
  }
}
