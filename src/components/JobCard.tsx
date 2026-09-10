import Link from "next/link";

export type JobListItem = {
  id: string;
  title: string;
  company: string;
  location: string | null;
  easyApply: "verified" | "not_available" | "unknown";
  applicationType: "easy_apply" | "external" | "unknown";
  postedAt: string | null;
  matchScore?: number | null;
};

const EASY_APPLY_LABEL: Record<JobListItem["easyApply"], string> = {
  verified: "Easy Apply — Verified",
  not_available: "Easy Apply — Not available",
  unknown: "Easy Apply — Unknown",
};

const EASY_APPLY_STYLE: Record<JobListItem["easyApply"], string> = {
  verified: "text-success",
  not_available: "text-muted",
  unknown: "text-muted",
};

export function JobCard({ job }: { job: JobListItem }) {
  return (
    <Link
      href={`/jobs/${job.id}`}
      className="block rounded-2xl border border-border bg-surface p-4 active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{job.title}</p>
          <p className="truncate text-xs text-muted">
            {job.company}
            {job.location ? ` · ${job.location}` : ""}
          </p>
        </div>
        {job.matchScore != null && (
          <span className="shrink-0 rounded-full bg-accent/15 px-2.5 py-1 text-xs font-semibold text-accent">
            {job.matchScore}% Match
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        <span className={EASY_APPLY_STYLE[job.easyApply]}>{EASY_APPLY_LABEL[job.easyApply]}</span>
        {job.postedAt && <span className="text-muted">Posted: {job.postedAt}</span>}
      </div>
    </Link>
  );
}
