"use client";

import { useEffect, useState } from "react";
import { TopBar } from "@/components/TopBar";
import { SocialComposer } from "@/components/SocialComposer";
import { SocialDraftCard, type DraftItem } from "@/components/SocialDraftCard";
import { ConnectionRow } from "@/components/ConnectionRow";
import { apiFetch } from "@/lib/csrfClient";

type Connection = { provider: string; category: string; status: string };

export default function SocialPage() {
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);

  function refreshDrafts() {
    apiFetch("/api/social/drafts")
      .then((r) => r.json())
      .then((data) => setDrafts(data.drafts ?? []));
  }

  useEffect(() => {
    Promise.all([
      apiFetch("/api/social/drafts").then((r) => r.json()),
      apiFetch("/api/connections").then((r) => r.json()),
    ])
      .then(([draftData, connData]) => {
        setDrafts(draftData.drafts ?? []);
        setConnections((connData.connections ?? []).filter((c: Connection) => c.category === "social"));
      })
      .finally(() => setLoading(false));
  }, []);

  const active = drafts.filter((d) => d.status === "draft" || d.status === "ready");

  return (
    <div>
      <TopBar title="Social" />
      <div className="mx-auto max-w-md space-y-6 px-4 pt-4 pb-6">
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
            Create a post
          </h2>
          <SocialComposer onCreated={refreshDrafts} />
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
            Drafts
          </h2>
          {loading ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : active.length === 0 ? (
            <p className="rounded-xl border border-border bg-surface px-4 py-3.5 text-sm text-muted">
              No drafts yet. Generate one above, or ask the AI.
            </p>
          ) : (
            <div className="space-y-3">
              {active.map((d) => (
                <SocialDraftCard key={d.id} draft={d} onChanged={refreshDrafts} />
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
            Connected platforms
          </h2>
          <div className="space-y-2">
            {connections.map((c) => (
              <ConnectionRow key={c.provider} provider={c.provider} initialStatus={c.status} />
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">
            Nothing is ever published automatically — every post goes through the Approval Center
            first, and publishing also requires the platform to be connected.
          </p>
        </section>
      </div>
    </div>
  );
}
