"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SubpageHeader } from "@/components/SubpageHeader";
import { apiFetch } from "@/lib/csrfClient";

export default function DataPage() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function handleExport() {
    const res = await apiFetch("/api/data/export");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "personal-agent-export.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleDelete() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/api/data/delete", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not delete data.");
        return;
      }
      router.push("/home");
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <SubpageHeader title="Data" />
      <div className="mx-auto max-w-md space-y-4 px-4 pt-4 pb-6">
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-sm font-medium text-foreground">Export your data</p>
          <p className="mt-1 text-xs text-muted">
            Downloads a JSON file of your preferences, connections, drafts, approvals, and
            activity history. Secrets and access tokens are never included.
          </p>
          <button
            onClick={handleExport}
            className="mt-3 w-full rounded-lg border border-border py-2.5 text-sm font-medium text-foreground active:scale-[0.98]"
          >
            Download export
          </button>
        </div>

        <div className="rounded-xl border border-danger/30 bg-surface p-4">
          <p className="text-sm font-medium text-danger">Delete all assistant data</p>
          <p className="mt-1 text-xs text-muted">
            Permanently deletes preferences, connections, drafts, approvals, and activity history.
            Your login itself is kept. This cannot be undone.
          </p>

          {!confirmOpen ? (
            <button
              onClick={() => setConfirmOpen(true)}
              className="mt-3 w-full rounded-lg bg-danger/15 py-2.5 text-sm font-medium text-danger active:scale-[0.98]"
            >
              Delete all data
            </button>
          ) : (
            <div className="mt-3 space-y-2">
              <input
                type="password"
                placeholder="Confirm your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none focus:border-danger"
              />
              {error && <p className="text-xs text-danger">{error}</p>}
              <div className="flex gap-2">
                <button
                  onClick={handleDelete}
                  disabled={busy || !password}
                  className="flex-1 rounded-lg bg-danger py-2.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  {busy ? "Deleting…" : "Confirm delete"}
                </button>
                <button
                  onClick={() => {
                    setConfirmOpen(false);
                    setPassword("");
                    setError(null);
                  }}
                  className="flex-1 rounded-lg border border-border py-2.5 text-sm font-medium text-foreground"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
