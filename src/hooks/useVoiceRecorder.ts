"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Deliberate, tap-to-talk microphone capture — NOT the Web Speech
 * Recognition API (window.SpeechRecognition/webkitSpeechRecognition),
 * which iOS Safari has never supported. This uses MediaRecorder +
 * getUserMedia instead (supported in iOS Safari 14.3+), captures a short
 * clip, and hands the raw bytes to the caller to upload for server-side
 * transcription — see /api/voice/transcribe.
 *
 * There is no wake word and no continuous listening: recording only ever
 * starts from an explicit call to start() (a user tap), and always stops
 * — either from an explicit stop()/cancel() or the maxDurationMs safety
 * timer — releasing the microphone track immediately either way.
 */

export type VoiceRecorderError =
  | "unsupported"
  | "permission-denied"
  | "no-microphone"
  | "unknown";

export type VoiceRecorderState = "idle" | "recording";

/**
 * Thrown by start() when it fails, carrying the classified reason
 * directly on the exception. Callers must read `.type` from the CAUGHT
 * error, not from this hook's `error` state read synchronously right
 * after the awaited call — React state updates from setError() inside
 * start() are not guaranteed to be visible on `error` until the next
 * render, so reading hook state immediately after an await is a stale
 * closure, not a reliable signal.
 */
export class VoiceRecorderStartError extends Error {
  type: VoiceRecorderError;
  constructor(type: VoiceRecorderError, message: string) {
    super(message);
    this.name = "VoiceRecorderStartError";
    this.type = type;
  }
}

export function useVoiceRecorder(maxDurationMs = 30_000) {
  const [state, setState] = useState<VoiceRecorderState>("idle");
  const [error, setError] = useState<VoiceRecorderError | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function releaseStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  function isSupported(): boolean {
    return (
      typeof navigator !== "undefined" &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      typeof MediaRecorder !== "undefined"
    );
  }

  async function start(): Promise<void> {
    setError(null);
    if (!isSupported()) {
      setError("unsupported");
      throw new VoiceRecorderStartError("unsupported", "Voice input isn't supported in this browser.");
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = (err as { name?: string } | undefined)?.name ?? "";
      let type: VoiceRecorderError = "unknown";
      if (name === "NotAllowedError" || name === "SecurityError") {
        type = "permission-denied";
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        type = "no-microphone";
      }
      setError(type);
      throw new VoiceRecorderStartError(type, "Could not access the microphone.");
    }

    streamRef.current = stream;
    chunksRef.current = [];

    const mimeType = ["audio/webm", "audio/mp4", "audio/ogg"].find(
      (type) => typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(type)
    );
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.start();
    setState("recording");

    timeoutRef.current = setTimeout(() => {
      void stop();
    }, maxDurationMs);
  }

  function stop(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const recorder = recorderRef.current;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (!recorder || recorder.state === "inactive") {
        setState("idle");
        resolve(null);
        return;
      }
      recorder.onstop = () => {
        const blob = chunksRef.current.length
          ? new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" })
          : null;
        releaseStream();
        setState("idle");
        resolve(blob);
      };
      recorder.stop();
    });
  }

  function cancel(): void {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null; // discard — do not resolve any pending stop() promise with audio
      recorder.stop();
    }
    releaseStream();
    chunksRef.current = [];
    setState("idle");
  }

  // Always release the microphone if the component unmounts mid-recording.
  useEffect(() => {
    return () => {
      releaseStream();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return { state, error, isSupported, start, stop, cancel };
}
