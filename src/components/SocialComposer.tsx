"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/csrfClient";

const PLATFORMS = ["linkedin", "x", "facebook", "instagram"] as const;

export function SocialComposer({ onCreated }: { onCreated: () => void }) {
  const [platform, setPlatform] = useState<(typeof PLATFORMS)[number]>("linkedin");
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (!topic.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/social/generate", {
        method: "POST",
        body: JSON.stringify({ platform, topic }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not generate that post.");
        return;
      }
      setTopic("");
      onCreated();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-3 flex gap-2 overflow-x-auto">
        {PLATFORMS.map((p) => (
          <button
            key={p}
            onClick={() => setPlatform(p)}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium capitalize ${
              platform === p ? "bg-accent text-accent-foreground" : "border border-border text-muted"
            }`}
          >
            {p}
          </button>
        ))}
      </div>
      <textarea
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        rows={2}
        placeholder="What should today's post be about?"
        className="w-full resize-none rounded-lg border border-border bg-background p-2.5 text-sm text-foreground outline-none focus:border-accent"
      />
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      <button
        onClick={generate}
        disabled={loading || !topic.trim()}
        className="mt-3 w-full rounded-xl bg-accent py-2.5 text-sm font-medium text-accent-foreground active:scale-[0.98] disabled:opacity-50"
      >
        {loading ? "Generating…" : "Generate draft"}
      </button>
    </div>
  );
}
