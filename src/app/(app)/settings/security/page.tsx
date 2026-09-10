"use client";

import { useState, type FormEvent } from "react";
import { SubpageHeader } from "@/components/SubpageHeader";
import { apiFetch } from "@/lib/csrfClient";

export default function SecurityPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    if (newPassword !== confirm) {
      setError("New passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch("/api/account/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not change password.");
        return;
      }
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <SubpageHeader title="Security" />
      <div className="mx-auto max-w-md space-y-6 px-4 pt-4 pb-6">
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
            Change password
          </h2>
          <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border border-border bg-surface p-4">
            <input
              type="password"
              placeholder="Current password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none focus:border-accent"
            />
            <input
              type="password"
              placeholder="New password (10+ characters)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={10}
              className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none focus:border-accent"
            />
            <input
              type="password"
              placeholder="Confirm new password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none focus:border-accent"
            />
            {error && <p className="text-xs text-danger">{error}</p>}
            {success && <p className="text-xs text-success">Password updated.</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-accent py-2.5 text-sm font-medium text-accent-foreground disabled:opacity-60"
            >
              {busy ? "Updating…" : "Update password"}
            </button>
          </form>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
            How approvals are enforced
          </h2>
          <ul className="space-y-2 rounded-xl border border-border bg-surface p-4 text-sm text-muted">
            <li>• Every external action (send, publish, delete, purchase, submit) is classified server-side and cannot skip the Approval Center, regardless of what the AI says.</li>
            <li>• Approving an action authorizes only that exact action — never future or unrelated actions.</li>
            <li>• Pending approvals expire automatically; an expired action must be re-prepared and re-approved.</li>
            <li>• Every action has a unique id, so re-submitting an approved action cannot execute it twice.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Session</h2>
          <p className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
            Sessions are httpOnly, secure cookies validated against the server on every request.
            Mutating requests require a matching CSRF token. Signing out immediately revokes the
            session.
          </p>
        </section>
      </div>
    </div>
  );
}
