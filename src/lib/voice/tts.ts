"use client";

/**
 * Output-only text-to-speech via the browser's native Web Speech
 * Synthesis API (well supported in iOS Safari, unlike speech
 * RECOGNITION, which Safari doesn't support at all — see
 * useVoiceRecorder.ts for why microphone capture uses MediaRecorder
 * instead). There is deliberately no server round-trip and no callback
 * wiring here: this file has exactly one thing it can do — read text
 * aloud — and nothing here parses, listens to, or reacts to anything the
 * synthesized speech "says". Nothing could trigger a tool call or an
 * approval from this file even in principle, because it never receives
 * or produces anything other than the act of speaking.
 */

export function ttsSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function speak(text: string): void {
  if (!ttsSupported() || !text.trim()) return;
  window.speechSynthesis.cancel(); // never overlap with a previous utterance
  const utterance = new SpeechSynthesisUtterance(text);
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  if (ttsSupported()) window.speechSynthesis.cancel();
}
