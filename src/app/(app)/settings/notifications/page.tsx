"use client";

import { useEffect, useState } from "react";
import { SubpageHeader } from "@/components/SubpageHeader";
import { apiFetch } from "@/lib/csrfClient";

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0))).buffer;
}

function detectSupport(): boolean {
  if (typeof window === "undefined") return false;
  return "serviceWorker" in navigator && "PushManager" in window;
}

export default function NotificationsPage() {
  const [supported] = useState(detectSupport);
  const [subscribed, setSubscribed] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/push/config")
      .then((r) => r.json())
      .then((data) => setConfigured(Boolean(data.configured)));

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.ready.then(async (reg) => {
        const sub = await reg.pushManager.getSubscription();
        setSubscribed(Boolean(sub));
      });
    }
  }, []);

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      const configRes = await apiFetch("/api/push/config").then((r) => r.json());
      if (!configRes.configured) {
        setError("Push notifications aren't configured on the server yet (missing VAPID keys).");
        return;
      }
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setError("Notification permission was not granted.");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(configRes.publicKey),
      });
      await apiFetch("/api/push/subscribe", { method: "POST", body: JSON.stringify(sub.toJSON()) });
      setSubscribed(true);
    } catch {
      setError("Could not enable notifications on this device.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await apiFetch("/api/push/unsubscribe", {
          method: "POST",
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setSubscribed(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <SubpageHeader title="Notifications" />
      <div className="mx-auto max-w-md space-y-4 px-4 pt-4 pb-6">
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-sm font-medium text-foreground">Push notifications</p>
          <p className="mt-1 text-xs text-muted">
            On iPhone, add this app to your Home Screen first (Share → Add to Home Screen), then
            enable notifications from here.
          </p>

          {!supported && (
            <p className="mt-3 text-xs text-danger">This browser doesn&apos;t support push notifications.</p>
          )}
          {configured === false && (
            <p className="mt-3 text-xs text-danger">Server isn&apos;t configured for push yet (VAPID keys missing).</p>
          )}
          {error && <p className="mt-3 text-xs text-danger">{error}</p>}

          {supported && configured && (
            <button
              onClick={subscribed ? disable : enable}
              disabled={busy}
              className={`mt-3 w-full rounded-lg py-2.5 text-sm font-medium disabled:opacity-60 ${
                subscribed ? "border border-border text-foreground" : "bg-accent text-accent-foreground"
              }`}
            >
              {busy ? "Working…" : subscribed ? "Disable on this device" : "Enable on this device"}
            </button>
          )}
        </div>

        <div className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
          <p className="mb-2 font-medium text-foreground">What triggers a notification</p>
          <ul className="space-y-1">
            <li>• An action is now awaiting your approval</li>
            <li>• An approved action finished executing</li>
          </ul>
          <p className="mt-2 text-xs">
            Notifications are informational only — they can never themselves execute an action.
          </p>
        </div>
      </div>
    </div>
  );
}
