"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SubpageHeader } from "@/components/SubpageHeader";
import { apiFetch } from "@/lib/csrfClient";

type MatchReason = { requirement: string; level: "strong" | "partial" | "gap" | "unknown"; evidence: string };
type ScreeningAnswer = { question: string; answer: string; source: "profile" | "user_provided" | "unknown" };

type Job = {
  id: string;
  title: string;
  company: string;
  location: string | null;
  description: string;
  salary: string | null;
  employmentType: string | null;
  easyApply: "verified" | "not_available" | "unknown";
  applicationType: "easy_apply" | "external" | "unknown";
  sourceUrl: string | null;
  extracted: {
    requiredQualifications: string[];
    preferredQualifications: string[];
    technicalRequirements: string[];
    certifications: string[];
    responsibilities: string[];
  };
};

type Application = {
  id: string;
  status: string;
  matchScore: number | null;
  matchReasons: MatchReason[];
  coverLetter: string | null;
  screeningAnswers: ScreeningAnswer[];
  missingInfo: string[];
  submittedAt: string | null;
};

const LEVEL_LABEL: Record<MatchReason["level"], string> = {
  strong: "Strong match",
  partial: "Partial match",
  gap: "Gap",
  unknown: "Unknown",
};
const LEVEL_STYLE: Record<MatchReason["level"], string> = {
  strong: "text-success",
  partial: "text-accent",
  gap: "text-danger",
  unknown: "text-muted",
};

export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [job, setJob] = useState<Job | null>(null);
  const [application, setApplication] = useState<Application | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function refresh() {
    apiFetch(`/api/jobs/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setJob(data.job ?? null);
        setApplication(data.application ?? null);
      })
      .finally(() => setLoading(false));
  }

  useEffect(refresh, [id]);

  async function call(path: string, busyLabel: string) {
    setBusy(busyLabel);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch(path, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "That action failed.");
        return null;
      }
      return data;
    } catch {
      setError("Could not reach the server.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function prepare() {
    const data = await call(`/api/jobs/${id}/prepare`, "prepare");
    if (data) {
      refresh();
      setNotice(data.output?.message ?? "Application prepared.");
    }
  }

  async function reviewAndApprove() {
    if (!application) return;
    const data = await call(`/api/applications/${application.id}/submit`, "submit");
    if (data) {
      router.push("/approvals");
    }
  }

  async function markSubmitted() {
    if (!application) return;
    const data = await call(`/api/applications/${application.id}/mark-submitted`, "mark");
    if (data) {
      refresh();
      setNotice(data.output?.message ?? "Recorded.");
    }
  }

  if (loading) {
    return (
      <div>
        <SubpageHeader title="Job" backHref="/jobs" />
        <p className="px-4 pt-4 text-sm text-muted">Loading…</p>
      </div>
    );
  }
  if (!job) {
    return (
      <div>
        <SubpageHeader title="Job" backHref="/jobs" />
        <p className="px-4 pt-4 text-sm text-muted">Job not found.</p>
      </div>
    );
  }

  return (
    <div>
      <SubpageHeader title={job.title} backHref="/jobs" />
      <div className="mx-auto max-w-md space-y-5 px-4 pt-4 pb-24">
        <section className="rounded-2xl border border-border bg-surface p-4">
          <p className="text-sm font-semibold text-foreground">{job.title}</p>
          <p className="text-xs text-muted">
            {job.company}
            {job.location ? ` · ${job.location}` : ""}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
            <span className={job.easyApply === "verified" ? "text-success" : "text-muted"}>
              Easy Apply — {job.easyApply === "verified" ? "Verified" : job.easyApply === "not_available" ? "Not available" : "Unknown"}
            </span>
            {job.applicationType === "external" && <span className="text-muted">External application</span>}
            {job.salary && <span className="text-muted">{job.salary}</span>}
          </div>
          {job.sourceUrl && (
            <a href={job.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-2 block text-xs text-accent underline">
              View original posting
            </a>
          )}
        </section>

        {error && <p className="rounded-xl bg-danger/10 px-3.5 py-2.5 text-xs text-danger">{error}</p>}
        {notice && <p className="rounded-xl bg-success/10 px-3.5 py-2.5 text-xs text-success">{notice}</p>}

        {application?.matchScore != null && (
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Match</h2>
            <div className="rounded-2xl border border-border bg-surface p-4">
              <p className="mb-3 text-2xl font-bold text-accent">{application.matchScore}% Match</p>
              <div className="space-y-2">
                {application.matchReasons.map((r, i) => (
                  <div key={i} className="text-xs">
                    <span className={`font-medium ${LEVEL_STYLE[r.level]}`}>{LEVEL_LABEL[r.level]}</span>
                    <span className="text-foreground"> — {r.requirement}</span>
                    <p className="text-muted">{r.evidence}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Actions</h2>
          <div className="grid grid-cols-1 gap-2">
            <button
              onClick={prepare}
              disabled={busy !== null}
              className="w-full rounded-xl bg-accent py-2.5 text-sm font-medium text-accent-foreground active:scale-[0.98] disabled:opacity-50"
            >
              {busy === "prepare" ? "Preparing…" : "Prepare Application"}
            </button>
          </div>
        </section>

        {application && (application.coverLetter || application.screeningAnswers.length > 0) && (
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Review Application</h2>
            <div className="space-y-3 rounded-2xl border border-border bg-surface p-4 text-sm">
              <div>
                <p className="text-xs font-medium text-muted">Job</p>
                <p className="text-foreground">
                  {job.title} — {job.company}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted">Application type</p>
                <p className="text-foreground capitalize">{job.applicationType.replace("_", " ")}</p>
              </div>
              {application.coverLetter && (
                <div>
                  <p className="text-xs font-medium text-muted">Cover letter</p>
                  <p className="whitespace-pre-wrap text-foreground">{application.coverLetter}</p>
                </div>
              )}
              {application.screeningAnswers.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted">
                    Questions ({application.screeningAnswers.filter((a) => a.source !== "unknown").length}/
                    {application.screeningAnswers.length} answered)
                  </p>
                  <div className="mt-1 space-y-1.5">
                    {application.screeningAnswers.map((a, i) => (
                      <div key={i}>
                        <p className="text-xs text-muted">{a.question}</p>
                        <p className="text-foreground">{a.answer || "— ask me —"}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {application.missingInfo.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-danger">Missing information</p>
                  <p className="text-foreground">{application.missingInfo.join(", ")}</p>
                </div>
              )}

              {application.status === "submitted" ? (
                <p className="rounded-lg bg-success/10 px-3 py-2 text-xs text-success">
                  Marked submitted{application.submittedAt ? ` on ${new Date(application.submittedAt).toLocaleString()}` : ""}{" "}
                  (self-reported).
                </p>
              ) : (
                <>
                  <button
                    onClick={reviewAndApprove}
                    disabled={busy !== null}
                    className="w-full rounded-xl bg-accent py-2.5 text-sm font-medium text-accent-foreground active:scale-[0.98] disabled:opacity-50"
                  >
                    {busy === "submit" ? "Preparing approval…" : "Review & Approve"}
                  </button>
                  <p className="text-[11px] text-muted">
                    This sends the package above to the Approval Center. LinkedIn provides no legitimate way for
                    this app to submit on your behalf, so approving finalizes the package — you complete the actual
                    submission yourself on LinkedIn.
                  </p>
                  {application.status === "ready_for_manual_submission" && (
                    <button
                      onClick={markSubmitted}
                      disabled={busy !== null}
                      className="w-full rounded-xl border border-border py-2.5 text-sm font-medium text-foreground active:scale-[0.98] disabled:opacity-50"
                    >
                      {busy === "mark" ? "Recording…" : "I submitted this on LinkedIn"}
                    </button>
                  )}
                </>
              )}
            </div>
          </section>
        )}

        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Full Posting</h2>
          <p className="whitespace-pre-wrap rounded-2xl border border-border bg-surface p-4 text-xs text-muted">
            {job.description}
          </p>
        </section>
      </div>
    </div>
  );
}
