"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/csrfClient";

type OutlookInfo = {
  status: "not_connected" | "connected" | "error" | "revoked";
  accountLabel: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
};

const OUTLOOK_ERROR_MESSAGES: Record<string, string> = {
  not_configured: "Outlook isn't set up on this server yet (missing Microsoft OAuth credentials).",
  invalid_state: "That connection attempt expired or was invalid. Please try again.",
  state_mismatch: "That connection attempt didn't match your session. Please try again.",
  missing_code: "Microsoft didn't return an authorization code. Please try again.",
  connection_failed: "Could not complete the Outlook connection. Please try again.",
  rate_limited: "Too many connection attempts — wait a few minutes and try again.",
};

function describeCallbackDetail(detail: string | null): string {
  if (!detail) return "Could not connect Outlook. Please try again.";
  return OUTLOOK_ERROR_MESSAGES[detail] ?? `Could not connect Outlook (${detail}).`;
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
  const outlook = params.get("outlook");
  if (outlook === "connected") return { kind: "success", text: "Outlook connected." };
  if (outlook === "cancelled") return { kind: "info", text: "Outlook connection cancelled." };
  if (outlook === "error") return { kind: "error", text: describeCallbackDetail(params.get("outlook_detail")) };
  return null;
}

export function OutlookConnectionCard({ initial }: { initial: OutlookInfo }) {
  const [info, setInfo] = useState(initial);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  // Same hydration-safe pattern as GmailConnectionCard: start at null (no
  // access to window.location on the server) and only read the real
  // value inside an effect, client-only, after hydration — see the
  // comment there for why reading it during render breaks hydration.
  const [banner, setBanner] = useState<Banner | null>(null);

  useEffect(() => {
    const found = readCallbackBanner();
    if (found) setBanner(found); // eslint-disable-line react-hooks/set-state-in-effect

    const params = new URLSearchParams(window.location.search);
    if (!params.has("outlook")) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("outlook");
    url.searchParams.delete("outlook_detail");
    window.history.replaceState({}, "", url.toString());
  }, []);

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      const res = await apiFetch("/api/connections/outlook", {
        method: "POST",
        body: JSON.stringify({ action: "disconnect" }),
      });
      const data = await res.json();
      if (res.ok) {
        setInfo({ status: "not_connected", accountLabel: null, lastSyncedAt: null, lastError: null });
        setBanner(null);
      } else {
        setBanner({ kind: "error", text: data.error ?? "Could not disconnect Outlook." });
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
          <p className="text-sm font-medium text-foreground">Outlook</p>
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
            href="/api/oauth/outlook/start"
            onClick={() => setConnecting(true)}
            className="shrink-0 rounded-lg bg-accent px-3.5 py-2 text-xs font-medium text-accent-foreground active:scale-95"
          >
            {connecting ? "Connecting…" : info.status === "error" ? "Reconnect" : "Connect Outlook"}
          </a>
        )}
      </div>
    </div>
  );
}
