"use client";

import { useEffect, useMemo, useState } from "react";
import { TopBar } from "@/components/TopBar";
import { JobCaptureComposer } from "@/components/JobCaptureComposer";
import { JobCard, type JobListItem } from "@/components/JobCard";
import { apiFetch } from "@/lib/csrfClient";

export default function JobsPage() {
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [easyApplyOnly, setEasyApplyOnly] = useState(false);

  function refresh() {
    apiFetch("/api/jobs")
      .then((r) => r.json())
      .then((data) => setJobs(data.jobs ?? []))
      .finally(() => setLoading(false));
  }

  useEffect(refresh, []);

  const visible = useMemo(() => {
    let list = jobs;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (j) => j.title.toLowerCase().includes(q) || j.company.toLowerCase().includes(q) || (j.location ?? "").toLowerCase().includes(q)
      );
    }
    if (easyApplyOnly) {
      list = list.filter((j) => j.easyApply === "verified");
    }
    return list;
  }, [jobs, query, easyApplyOnly]);

  return (
    <div>
      <TopBar title="Jobs" />
      <div className="mx-auto max-w-md px-4 pt-4 pb-6">
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Find Jobs</h2>
          <JobCaptureComposer onCaptured={refresh} />
        </section>

        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Your Jobs</h2>
          <div className="mb-3 space-y-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="What job are you looking for?"
              className="w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm text-foreground outline-none focus:border-accent"
            />
            <label className="flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" checked={easyApplyOnly} onChange={(e) => setEasyApplyOnly(e.target.checked)} />
              Easy Apply only
            </label>
          </div>

          {loading ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : visible.length === 0 ? (
            <p className="rounded-xl border border-border bg-surface px-4 py-3.5 text-sm text-muted">
              {jobs.length === 0
                ? "No jobs captured yet. Paste a posting above to get started — there's no live LinkedIn search available to this app."
                : "No jobs match that search."}
            </p>
          ) : (
            <div className="space-y-2">
              {visible.map((job) => (
                <JobCard key={job.id} job={job} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
