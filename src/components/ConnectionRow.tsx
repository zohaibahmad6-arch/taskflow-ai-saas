"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/csrfClient";

const LABELS: Record<string, string> = {
  gmail: "Gmail",
  outlook: "Outlook",
  linkedin: "LinkedIn",
  x: "X",
  facebook: "Facebook",
  instagram: "Instagram",
};

export function ConnectionRow({
  provider,
  initialStatus,
}: {
  provider: string;
  initialStatus: string;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function act(action: "connect" | "disconnect") {
    setBusy(true);
    setNote(null);
    try {
      const res = await apiFetch(`/api/connections/${provider}`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNote(data.error ?? "That action isn't available yet.");
        return;
      }
      if (data.status) setStatus(data.status);
    } catch {
      setNote("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const connected = status === "connected";

  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3.5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">{LABELS[provider] ?? provider}</p>
          <p className={`text-xs ${connected ? "text-success" : "text-muted"}`}>
            {connected ? "Connected" : "Not connected"}
          </p>
        </div>
        <button
          onClick={() => act(connected ? "disconnect" : "connect")}
          disabled={busy}
          className={`rounded-lg px-3.5 py-2 text-xs font-medium active:scale-95 disabled:opacity-50 ${
            connected ? "border border-border text-foreground" : "bg-accent text-accent-foreground"
          }`}
        >
          {connected ? "Disconnect" : "Connect"}
        </button>
      </div>
      {note && <p className="mt-2 text-xs text-muted">{note}</p>}
    </div>
  );
}
