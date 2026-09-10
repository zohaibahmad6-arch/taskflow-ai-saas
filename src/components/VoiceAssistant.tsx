"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/csrfClient";
import { useVoiceRecorder, VoiceRecorderStartError, type VoiceRecorderError } from "@/hooks/useVoiceRecorder";
import { speak, stopSpeaking, ttsSupported } from "@/lib/voice/tts";

type Phase = "ready" | "listening" | "processing" | "transcribed" | "response" | "error";

type PendingSummary = { id: string; action: string; target: string; revision: number };

type Exchange = { role: "user" | "assistant"; content: string };

const PERMISSION_MESSAGES: Record<VoiceRecorderError, string> = {
  unsupported: "Voice input isn't supported in this browser. You can still type your command below.",
  "permission-denied":
    "Microphone access is blocked. Enable microphone permission for this app in your browser settings and try again.",
  "no-microphone": "No microphone was found on this device.",
  unknown: "Couldn't access the microphone. Please try again.",
};

export function VoiceAssistant({
  conversationId,
  onExchange,
  onClose,
}: {
  conversationId: string;
  onExchange: (exchange: Exchange[]) => void;
  onClose: () => void;
}) {
  const recorder = useVoiceRecorder();
  const [phase, setPhase] = useState<Phase>("ready");
  const [transcript, setTranscript] = useState("");
  const [responseText, setResponseText] = useState("");
  const [ambiguous, setAmbiguous] = useState<PendingSummary[] | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [trackedApproval, setTrackedApproval] = useState<{ id: string } | null>(null);

  async function handleSpeak() {
    setErrorMessage("");
    setAmbiguous(null);
    try {
      await recorder.start();
      setPhase("listening");
    } catch (err) {
      // Read the classified reason from the thrown error itself, never
      // from the hook's `error` state read synchronously right after —
      // that state update is not guaranteed visible until the next
      // render (a stale-closure trap), while the exception always
      // carries the right answer immediately.
      const type: VoiceRecorderError = err instanceof VoiceRecorderStartError ? err.type : "unknown";
      setErrorMessage(PERMISSION_MESSAGES[type]);
      setPhase("error");
    }
  }

  async function handleStopListening() {
    const blob = await recorder.stop();
    if (!blob || blob.size === 0) {
      setErrorMessage("Didn't catch that. Please try again.");
      setPhase("error");
      return;
    }
    setPhase("processing");
    try {
      const form = new FormData();
      form.append("audio", blob, "command.webm");
      const res = await apiFetch("/api/voice/transcribe", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error ?? "Could not transcribe that.");
        setPhase("error");
        return;
      }
      setTranscript(data.text);
      setPhase("transcribed");
    } catch {
      setErrorMessage("Could not reach the server.");
      setPhase("error");
    }
  }

  function handleCancelListening() {
    recorder.cancel();
    setPhase("ready");
  }

  async function sendCommand(text: string) {
    setPhase("processing");
    setErrorMessage("");
    setAmbiguous(null);
    try {
      const res = await apiFetch("/api/voice/command", {
        method: "POST",
        body: JSON.stringify({ conversationId, text, trackedApprovalId: trackedApproval?.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error ?? "Something went wrong.");
        setPhase("error");
        return;
      }

      if (data.type === "chat") {
        const reply = data.reply || "(no response)";
        setResponseText(reply);
        onExchange([
          { role: "user", content: text },
          { role: "assistant", content: reply },
        ]);
        const approvalActivity = (data.toolActivity ?? []).find((t: { awaitingApproval: boolean; approvalId?: string }) => t.awaitingApproval && t.approvalId);
        setTrackedApproval(approvalActivity ? { id: approvalActivity.approvalId } : null);
        setPhase("response");
      } else if (data.type === "decided") {
        const a = data.approval;
        const reply =
          data.decision === "approved"
            ? a.status === "executed"
              ? `Approved. ${a.action} → ${a.target} completed.`
              : a.status === "failed"
                ? `Approved, but it failed: ${a.error ?? "unknown error"}.`
                : `Approved: ${a.action} → ${a.target}.`
            : `Rejected: ${a.action} → ${a.target}. Nothing was done.`;
        setResponseText(reply);
        onExchange([{ role: "assistant", content: reply }]);
        setTrackedApproval(null);
        setPhase("response");
      } else if (data.type === "no_pending") {
        setResponseText(data.message);
        setTrackedApproval(null);
        setPhase("response");
      } else if (data.type === "ambiguous") {
        setResponseText(data.message);
        setAmbiguous(data.pending);
        setPhase("response");
      }
    } catch {
      setErrorMessage("Could not reach the server.");
      setPhase("error");
    }
  }

  function reset() {
    stopSpeaking();
    setTranscript("");
    setResponseText("");
    setAmbiguous(null);
    setErrorMessage("");
    setPhase("ready");
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex items-center justify-between border-b border-border px-4 py-3.5 safe-top">
        <p className="text-sm font-semibold text-foreground">Voice</p>
        <button
          onClick={() => {
            recorder.cancel();
            stopSpeaking();
            onClose();
          }}
          aria-label="Close"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted active:scale-95"
        >
          ✕
        </button>
      </div>

      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-6 px-6 pb-24 text-center">
        {phase === "ready" && (
          <>
            <p className="text-lg font-medium text-foreground">How can I help?</p>
            <button
              onClick={handleSpeak}
              className="flex h-20 w-20 items-center justify-center rounded-full bg-accent text-3xl text-accent-foreground active:scale-95"
              aria-label="Speak"
            >
              🎙
            </button>
            <button onClick={onClose} className="text-sm text-muted underline">
              ⌨ Type instead
            </button>
          </>
        )}

        {phase === "listening" && (
          <>
            <p className="text-lg font-medium text-foreground">Listening…</p>
            <button
              onClick={handleStopListening}
              className="flex h-20 w-20 animate-pulse items-center justify-center rounded-full bg-danger text-3xl text-white active:scale-95"
              aria-label="Stop"
            >
              🎙
            </button>
            <button onClick={handleCancelListening} className="text-sm text-muted underline">
              Cancel
            </button>
          </>
        )}

        {phase === "processing" && (
          <>
            <p className="text-lg font-medium text-foreground">Understanding…</p>
            <div className="h-2 w-32 animate-pulse rounded-full bg-accent/30" />
          </>
        )}

        {phase === "transcribed" && (
          <>
            <p className="text-sm text-muted">You said:</p>
            <p className="rounded-2xl border border-border bg-surface px-4 py-3 text-base text-foreground">
              &quot;{transcript}&quot;
            </p>
            <div className="flex w-full gap-2">
              <button
                onClick={() => void sendCommand(transcript)}
                className="flex-1 rounded-xl bg-accent py-3 text-sm font-medium text-accent-foreground active:scale-[0.97]"
              >
                Send
              </button>
              <button onClick={reset} className="flex-1 rounded-xl border border-border py-3 text-sm font-medium text-foreground active:scale-[0.97]">
                Try Again
              </button>
            </div>
            <button onClick={reset} className="text-sm text-muted underline">
              Cancel
            </button>
          </>
        )}

        {phase === "response" && (
          <>
            <p className="whitespace-pre-wrap rounded-2xl border border-border bg-surface px-4 py-3 text-base text-foreground">
              {responseText}
            </p>
            {ambiguous && (
              <div className="w-full space-y-1.5 text-left">
                {ambiguous.map((a) => (
                  <p key={a.id} className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-muted">
                    {a.action} → {a.target}
                  </p>
                ))}
              </div>
            )}
            {ttsSupported() && (
              <button onClick={() => speak(responseText)} className="text-sm text-accent underline">
                🔊 Speak response
              </button>
            )}
            <div className="flex w-full gap-2">
              <button
                onClick={handleSpeak}
                className="flex-1 rounded-xl bg-accent py-3 text-sm font-medium text-accent-foreground active:scale-[0.97]"
              >
                🎙 Speak
              </button>
              <button onClick={onClose} className="flex-1 rounded-xl border border-border py-3 text-sm font-medium text-foreground active:scale-[0.97]">
                Done
              </button>
            </div>
          </>
        )}

        {phase === "error" && (
          <>
            <p className="rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
              {errorMessage}
            </p>
            <div className="flex w-full gap-2">
              <button onClick={reset} className="flex-1 rounded-xl bg-accent py-3 text-sm font-medium text-accent-foreground active:scale-[0.97]">
                Try Again
              </button>
              <button onClick={onClose} className="flex-1 rounded-xl border border-border py-3 text-sm font-medium text-foreground active:scale-[0.97]">
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
