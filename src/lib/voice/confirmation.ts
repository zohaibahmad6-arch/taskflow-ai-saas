/**
 * A deliberately NARROW, deterministic matcher for short spoken
 * confirm/deny utterances only ("yes", "approve", "send it", "no",
 * "cancel", etc.) — this is NOT a general natural-language command
 * parser (that job belongs entirely to the existing AI tool-calling loop
 * in runChatTurn/invokeTool — see /api/voice/command). This exists
 * specifically because approval decisions are too security-sensitive to
 * hand to the model's own judgment of what "yes" might mean: it is
 * intentionally simple enough to read and audit in one glance.
 *
 * Matching this pattern only ever picks WHICH already-secure code path a
 * voice utterance is routed to (decideApproval vs. the normal chat/tool
 * loop) — it is never itself the security boundary. decideApproval()
 * still independently re-validates ownership, pending status, and a
 * revision read fresh from the database no matter how it was reached.
 */

const CONFIRM_PHRASES = [
  "yes",
  "yeah",
  "yep",
  "yup",
  "approve",
  "approved",
  "i approve",
  "confirm",
  "confirmed",
  "do it",
  "send it",
  "go ahead",
  "proceed",
  "ok send it",
  "okay send it",
  "that's correct",
  "correct",
  "submit it",
  "approve it",
];

const DENY_PHRASES = [
  "no",
  "nope",
  "cancel",
  "reject",
  "rejected",
  "don't",
  "do not",
  "stop",
  "abort",
  "never mind",
  "nevermind",
  "don't send it",
  "don't do it",
  "reject it",
  "cancel it",
];

function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[.!?,]+$/g, "")
    .replace(/\s+/g, " ");
}

export type ConfirmationIntent = "approve" | "deny" | null;

/**
 * Only matches SHORT utterances that are ENTIRELY a confirm/deny phrase
 * (optionally with a leading "please" or trailing "please") — a longer
 * sentence that happens to contain the word "yes" (e.g. "yes, I have 10
 * years of experience") is intentionally NOT matched, since it is a real
 * answer to a question, not an approval decision.
 */
export function classifyConfirmation(rawText: string): ConfirmationIntent {
  const text = normalize(rawText).replace(/^please\s+/, "").replace(/\s+please$/, "");
  if (!text || text.split(" ").length > 4) return null;

  if (CONFIRM_PHRASES.includes(text)) return "approve";
  if (DENY_PHRASES.includes(text)) return "deny";
  return null;
}
