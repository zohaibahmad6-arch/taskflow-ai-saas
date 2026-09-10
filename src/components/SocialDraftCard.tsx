"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/csrfClient";

export type DraftItem = {
  id: string;
  platform: string;
  content: string;
  status: string;
  created_at: string;
};

export function SocialDraftCard({ draft, onChanged }: { draft: DraftItem; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function requestPublish() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/social/drafts/${draft.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "publish" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not prepare that action.");
        return;
      }
      router.push("/approvals");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/social/drafts/${draft.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "discard" }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Could not discard.");
        return;
      }
      onChanged();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="rounded-full bg-background px-2.5 py-1 text-[11px] font-medium capitalize text-muted">
          {draft.platform}
        </span>
        <span className="text-[11px] text-muted">{new Date(draft.created_at).toLocaleString()}</span>
      </div>
      <p className="whitespace-pre-wrap text-sm text-foreground">{draft.content}</p>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button
          onClick={requestPublish}
          disabled={busy}
          className="flex-1 rounded-xl bg-accent py-2.5 text-sm font-medium text-accent-foreground active:scale-[0.97] disabled:opacity-50"
        >
          Send for approval
        </button>
        <button
          onClick={discard}
          disabled={busy}
          className="flex-1 rounded-xl border border-border py-2.5 text-sm font-medium text-foreground active:scale-[0.97] disabled:opacity-50"
        >
          Discard
        </button>
      </div>
    </div>
  );
}
