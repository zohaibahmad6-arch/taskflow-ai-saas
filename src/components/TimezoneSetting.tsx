"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/csrfClient";

// A short, curated fallback list for browsers that don't support
// Intl.supportedValuesOf yet — the full list is preferred when available.
const FALLBACK_ZONES = [
  "UTC",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Qatar",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
];

function supportedTimezones(): string[] {
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone");
    if (list && list.length > 0) return list;
  } catch {
    // fall through to the curated list below
  }
  return FALLBACK_ZONES;
}

/**
 * Sets the IANA timezone the Daily Briefing uses to compute its local
 * calendar date (see dailyBriefing.ts). Never auto-applied — the
 * browser's own detected zone is only offered as a one-tap suggestion,
 * never saved without the user explicitly choosing it.
 */
export function TimezoneSetting() {
  const [timezone, setTimezone] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const zones = useMemo(() => supportedTimezones(), []);
  const detected = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    apiFetch("/api/preferences")
      .then((r) => r.json())
      .then((data) => setTimezone(data.preferences?.timezone ?? ""))
      .finally(() => setLoading(false));
  }, []);

  async function save(next: string) {
    setSaving(true);
    setSaved(false);
    setError(null);
    const res = await apiFetch("/api/preferences", { method: "PUT", body: JSON.stringify({ timezone: next }) });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Could not save that timezone.");
      setSaving(false);
      return;
    }
    setTimezone(next);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (loading) return null;

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs uppercase tracking-wide text-muted">Timezone</p>
      <p className="mt-1 text-xs text-muted">
        Used only to compute the Daily Briefing&apos;s local calendar date. Leave unset to use UTC.
      </p>

      <select
        value={timezone}
        onChange={(e) => void save(e.target.value)}
        disabled={saving}
        className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-accent disabled:opacity-60"
      >
        <option value="">Not set (uses UTC)</option>
        {zones.map((z) => (
          <option key={z} value={z}>
            {z}
          </option>
        ))}
      </select>

      {detected && detected !== timezone && (
        <button
          onClick={() => void save(detected)}
          disabled={saving}
          className="mt-2 text-xs font-medium text-accent disabled:opacity-60"
        >
          Use detected: {detected}
        </button>
      )}

      {saved && <p className="mt-2 text-xs text-accent">Saved.</p>}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}
