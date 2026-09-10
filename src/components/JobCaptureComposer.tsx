"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/csrfClient";

export function JobCaptureComposer({ onCaptured }: { onCaptured: () => void }) {
  const [rawText, setRawText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function capture() {
    if (!rawText.trim() || loading) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await apiFetch("/api/jobs", {
        method: "POST",
        body: JSON.stringify({ rawText, sourceUrl: sourceUrl.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not capture that job posting.");
        return;
      }
      setMessage(data.output?.message ?? "Captured.");
      setRawText("");
      setSourceUrl("");
      onCaptured();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <p className="mb-3 text-xs text-muted">
        LinkedIn doesn&apos;t provide this app a way to search jobs directly — copy a posting&apos;s text
        from LinkedIn (or anywhere else) and paste it below. The assistant will read it, never search
        live.
      </p>
      <input
        value={sourceUrl}
        onChange={(e) => setSourceUrl(e.target.value)}
        placeholder="Job posting URL (optional)"
        className="mb-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
      />
      <textarea
        value={rawText}
        onChange={(e) => setRawText(e.target.value)}
        rows={5}
        placeholder="Paste the full job posting text here…"
        className="w-full resize-none rounded-lg border border-border bg-background p-2.5 text-sm text-foreground outline-none focus:border-accent"
      />
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      {message && <p className="mt-2 text-xs text-success">{message}</p>}
      <button
        onClick={capture}
        disabled={loading || !rawText.trim()}
        className="mt-3 w-full rounded-xl bg-accent py-2.5 text-sm font-medium text-accent-foreground active:scale-[0.98] disabled:opacity-50"
      >
        {loading ? "Reading…" : "Capture job"}
      </button>
    </div>
  );
}
