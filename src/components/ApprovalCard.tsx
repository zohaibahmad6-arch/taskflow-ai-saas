"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/csrfClient";

export type ApprovalItem = {
  id: string;
  tool_id: string;
  action: string;
  target: string;
  content: string;
  consequence: string;
  status: string;
  requested_at: string;
  expires_at: string;
  error: string | null;
};

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-warning/15 text-warning",
  approved: "bg-info/15 text-info",
  executed: "bg-success/15 text-success",
  rejected: "bg-muted/15 text-muted",
  expired: "bg-muted/15 text-muted",
  failed: "bg-danger/15 text-danger",
};

export function ApprovalCard({
  approval,
  onDecided,
}: {
  approval: ApprovalItem;
  onDecided: (updated: ApprovalItem) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(approval.content);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "approved" | "rejected") {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/approvals/${approval.id}`, {
        method: "POST",
        body: JSON.stringify({
          decision,
          editedContent: editing ? content : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not process that decision.");
        return;
      }
      onDecided(data.approval);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const isPending = approval.status === "pending";

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground">{approval.action}</p>
          <p className="text-xs text-muted">Target: {approval.target}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium capitalize ${STATUS_STYLE[approval.status] ?? "bg-muted/15 text-muted"}`}>
          {approval.status}
        </span>
      </div>

      {editing ? (
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={4}
          className="mb-2 w-full rounded-lg border border-border bg-background p-2.5 text-sm text-foreground outline-none focus:border-accent"
        />
      ) : (
        <p className="mb-2 whitespace-pre-wrap rounded-lg border border-border bg-background p-2.5 text-sm text-foreground">
          {approval.content}
        </p>
      )}

      <p className="mb-3 text-xs text-muted">{approval.consequence}</p>

      {approval.error && (
        <p className="mb-3 rounded-lg bg-danger/10 px-2.5 py-2 text-xs text-danger">{approval.error}</p>
      )}
      {error && <p className="mb-3 rounded-lg bg-danger/10 px-2.5 py-2 text-xs text-danger">{error}</p>}

      {isPending && (
        <div className="flex gap-2">
          <button
            onClick={() => decide("approved")}
            disabled={busy}
            className="flex-1 rounded-xl bg-success/15 py-2.5 text-sm font-medium text-success active:scale-[0.97] disabled:opacity-50"
          >
            Approve
          </button>
          <button
            onClick={() => setEditing((v) => !v)}
            disabled={busy}
            className="flex-1 rounded-xl border border-border py-2.5 text-sm font-medium text-foreground active:scale-[0.97] disabled:opacity-50"
          >
            {editing ? "Cancel edit" : "Edit"}
          </button>
          <button
            onClick={() => decide("rejected")}
            disabled={busy}
            className="flex-1 rounded-xl bg-danger/15 py-2.5 text-sm font-medium text-danger active:scale-[0.97] disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      )}

      <p className="mt-3 text-[11px] text-muted">
        Requested {new Date(approval.requested_at).toLocaleString()} · Expires{" "}
        {new Date(approval.expires_at).toLocaleString()}
      </p>
    </div>
  );
}
