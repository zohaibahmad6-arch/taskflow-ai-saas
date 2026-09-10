"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/csrfClient";

type GmailInfo = {
  status: "not_connected" | "connected" | "error" | "revoked";
  accountLabel: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
};

const GMAIL_ERROR_MESSAGES: Record<string, string> = {
  not_configured: "Gmail isn't set up on this server yet (missing Google OAuth credentials).",
  invalid_state: "That connection attempt expired or was invalid. Please try again.",
  state_mismatch: "That connection attempt didn't match your session. Please try again.",
  missing_code: "Google didn't return an authorization code. Please try again.",
  connection_failed: "Could not complete the Gmail connection. Please try again.",
  rate_limited: "Too many connection attempts — wait a few minutes and try again.",
};

function describeCallbackDetail(detail: string | null): string {
  if (!detail) return "Could not connect Gmail. Please try again.";
  return GMAIL_ERROR_MESSAGES[detail] ?? `Could not connect Gmail (${detail}).`;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

type Banner = { kind: "success" | "error" | "info"; text: string };

function readCallbackBanner(): Banner | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const gmail = params.get("gmail");
  if (gmail === "connected") return { kind: "success", text: "Gmail connected." };
  if (gmail === "cancelled") return { kind: "info", text: "Gmail connection cancelled." };
  if (gmail === "error") return { kind: "error", text: describeCallbackDetail(params.get("gmail_detail")) };
  return null;
}

export function GmailConnectionCard({ initial }: { initial: GmailInfo }) {
  const [info, setInfo] = useState(initial);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  // Must start at null (matching the server-rendered HTML, which has no
  // access to window.location) and only pick up the real value inside an
  // effect, which runs client-only, after hydration. Reading
  // window.location during the initial render (e.g. via a useState lazy
  // initializer) would make the client's first render disagree with the
  // server's and trigger a hydration mismatch — this component was
  // rewritten once already to fix exactly that bug.
  const [banner, setBanner] = useState<Banner | null>(null);

  useEffect(() => {
    // Reading window.location.search is only possible client-side, so
    // this can't be computed during render without desyncing from the
    // server-rendered HTML (see the comment on the initial state above)
    // — this is exactly the "sync with an external system" case the
    // lint rule's own guidance carves out, not a case of not needing
    // the effect at all.
    const found = readCallbackBanner();
    if (found) setBanner(found); // eslint-disable-line react-hooks/set-state-in-effect

    const params = new URLSearchParams(window.location.search);
    if (!params.has("gmail")) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("gmail");
    url.searchParams.delete("gmail_detail");
    window.history.replaceState({}, "", url.toString());
  }, []);

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      const res = await apiFetch("/api/connections/gmail", {
        method: "POST",
        body: JSON.stringify({ action: "disconnect" }),
      });
      const data = await res.json();
      if (res.ok) {
        setInfo({ status: "not_connected", accountLabel: null, lastSyncedAt: null, lastError: null });
        setBanner(null);
      } else {
        setBanner({ kind: "error", text: data.error ?? "Could not disconnect Gmail." });
      }
    } catch {
      setBanner({ kind: "error", text: "Could not reach the server." });
    } finally {
      setDisconnecting(false);
    }
  }

  const bannerStyle =
    banner?.kind === "success"
      ? "bg-success/10 text-success"
      : banner?.kind === "error"
        ? "bg-danger/10 text-danger"
        : "bg-muted/10 text-muted";

  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3.5">
      {banner && <p className={`mb-3 rounded-lg px-2.5 py-2 text-xs ${bannerStyle}`}>{banner.text}</p>}

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Gmail</p>
          {info.status === "connected" && (
            <>
              <p className="truncate text-xs text-success">Connected{info.accountLabel ? ` as ${info.accountLabel}` : ""}</p>
              <p className="text-[11px] text-muted">Last synced: {relativeTime(info.lastSyncedAt)}</p>
            </>
          )}
          {info.status === "error" && (
            <>
              <p className="text-xs text-danger">Connection error</p>
              {info.lastError && <p className="mt-0.5 text-[11px] text-danger">{info.lastError}</p>}
            </>
          )}
          {info.status === "not_connected" && <p className="text-xs text-muted">Not connected</p>}
          {info.status === "revoked" && <p className="text-xs text-muted">Access was revoked</p>}
        </div>

        {info.status === "connected" ? (
          <button
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="shrink-0 rounded-lg border border-border px-3.5 py-2 text-xs font-medium text-foreground active:scale-95 disabled:opacity-50"
          >
            {disconnecting ? "…" : "Disconnect"}
          </button>
        ) : (
          <a
            href="/api/oauth/gmail/start"
            onClick={() => setConnecting(true)}
            className="shrink-0 rounded-lg bg-accent px-3.5 py-2 text-xs font-medium text-accent-foreground active:scale-95"
          >
            {connecting ? "Connecting…" : info.status === "error" ? "Reconnect" : "Connect Gmail"}
          </a>
        )}
      </div>
    </div>
  );
}
