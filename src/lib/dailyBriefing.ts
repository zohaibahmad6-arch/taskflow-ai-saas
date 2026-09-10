import "server-only";
import { db, newId, nowIso } from "./db";
import { isConnected } from "./connections";
import { KNOWN_EMAIL_PROVIDER_IDS, type KnownEmailProviderId } from "./email";
import { generateAndStoreBriefing, getLatestBriefing, type BriefingItem, type DeadlineItem } from "./email/briefing";
import { listJobs, listApplicationsForUser } from "./jobs/store";
import type { Job, JobApplication } from "./jobs/types";
import { listApprovals } from "./approvals";
import { notifyUser } from "./push";

/**
 * Aggregation service for the Daily Personal Briefing. Nothing in this
 * file is wired to a scheduler — generateDailyBriefing() is only ever
 * called on demand (from /api/briefing, the Home/Briefing screen, or the
 * briefing.getDailyBriefing tool). A future scheduler just needs to call
 * this same function on a timer; the storage shape (daily_briefings,
 * UNIQUE(user_id, briefing_date)) is already the real, idempotent one —
 * see the doc comment on generateDailyBriefing below for the exact
 * contract a scheduler would rely on.
 *
 * No per-user timezone preference exists anywhere in this app yet (see
 * schema.sql — preferences has no timezone column), so `briefingDate` is
 * the UTC calendar date. This is called out explicitly rather than
 * silently assumed: a future timezone preference would only need to
 * change how `todayDateUTC()` below computes "today" for a given user —
 * everything downstream (storage, idempotency, dedup) already works off
 * an opaque date string and does not care which timezone produced it.
 *
 * Every section below is built ONLY from what this app has actually
 * fetched/stored — a disconnected provider is reported as disconnected,
 * an empty jobs list is reported as empty, never fabricated (see each
 * "not connected" / "No saved jobs" branch below).
 */

export type EmailProviderBriefing = {
  provider: KnownEmailProviderId;
  connected: boolean;
  urgentCount: number;
  actionRequiredCount: number;
  deadlinesCount: number;
  followUpCount: number;
  urgent: BriefingItem[];
  actionRequired: BriefingItem[];
  deadlines: DeadlineItem[];
  statusText: string;
};

export type JobsBriefing = {
  totalSaved: number;
  newlyCaptured: { jobId: string; title: string; company: string; createdAt: string }[];
  strongMatches: { jobId: string; applicationId: string; title: string; company: string; matchScore: number }[];
  easyApplyAvailable: { jobId: string; title: string; company: string }[];
  applicationsAwaitingAction: { applicationId: string; jobId: string; title: string; company: string; status: string }[];
  applicationsAwaitingApproval: { applicationId: string; jobId: string; title: string; company: string; approvalId: string }[];
  followUpNote: string;
};

export type ApprovalsBriefing = {
  pendingCount: number;
  items: { id: string; action: string; target: string }[];
};

export type DailyBriefing = {
  userId: string;
  briefingDate: string;
  generatedAt: string;
  email: Record<KnownEmailProviderId, EmailProviderBriefing>;
  jobs: JobsBriefing;
  approvals: ApprovalsBriefing;
  urgentCount: number;
  actionsCount: number;
  deadlinesCount: number;
  approvalsCount: number;
  priorities: string[];
  summaryText: string;
};

function todayDateUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

const STRONG_MATCH_THRESHOLD = 70;
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;
const PREVIEW_ITEMS = 5;
const MAX_PRIORITIES = 6;

async function buildEmailSection(userId: string, providerId: KnownEmailProviderId): Promise<EmailProviderBriefing> {
  const providerName = providerId === "gmail" ? "Gmail" : "Outlook";
  if (!isConnected(userId, providerId)) {
    return {
      provider: providerId,
      connected: false,
      urgentCount: 0,
      actionRequiredCount: 0,
      deadlinesCount: 0,
      followUpCount: 0,
      urgent: [],
      actionRequired: [],
      deadlines: [],
      statusText: `${providerName} is not connected.`,
    };
  }

  const today = todayDateUTC();
  let briefing = getLatestBriefing(userId, providerId);
  if (!briefing || briefing.summaryDate !== today) {
    try {
      briefing = await generateAndStoreBriefing(userId, providerId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not refresh this account right now.";
      return {
        provider: providerId,
        connected: true,
        urgentCount: 0,
        actionRequiredCount: 0,
        deadlinesCount: 0,
        followUpCount: 0,
        urgent: [],
        actionRequired: [],
        deadlines: [],
        statusText: `${providerName} is connected, but could not be refreshed: ${message}`,
      };
    }
  }

  return {
    provider: providerId,
    connected: true,
    urgentCount: briefing.urgent.length,
    actionRequiredCount: briefing.actionRequired.length,
    deadlinesCount: briefing.deadlines.length,
    followUpCount: briefing.followUp.length,
    urgent: briefing.urgent.slice(0, PREVIEW_ITEMS),
    actionRequired: briefing.actionRequired.slice(0, PREVIEW_ITEMS),
    deadlines: briefing.deadlines.slice(0, PREVIEW_ITEMS),
    statusText:
      briefing.urgent.length + briefing.actionRequired.length > 0
        ? `${providerName}: ${briefing.urgent.length + briefing.actionRequired.length} important message(s).`
        : `${providerName}: nothing urgent.`,
  };
}

function buildJobsSection(userId: string): JobsBriefing {
  const jobs = listJobs(userId, 500);
  const applications = listApplicationsForUser(userId, 500);
  const jobById = new Map<string, Job>(jobs.map((j) => [j.id, j]));
  const now = Date.now();

  if (jobs.length === 0) {
    return {
      totalSaved: 0,
      newlyCaptured: [],
      strongMatches: [],
      easyApplyAvailable: [],
      applicationsAwaitingAction: [],
      applicationsAwaitingApproval: [],
      followUpNote: "No saved jobs.",
    };
  }

  const pendingApprovals = listApprovals(userId, "pending").filter((a) => a.tool_id === "jobs.submitApplication");
  const pendingApplicationIds = new Map<string, string>();
  for (const approval of pendingApprovals) {
    const payload = JSON.parse(approval.payload_json) as { applicationId?: string };
    if (payload.applicationId) pendingApplicationIds.set(payload.applicationId, approval.id);
  }

  const submittedJobIds = new Set(
    applications.filter((a) => a.status === "submitted" || a.status === "ready_for_manual_submission").map((a) => a.jobId)
  );

  const newlyCaptured = jobs
    .filter((j) => now - new Date(j.createdAt).getTime() < RECENT_WINDOW_MS)
    .slice(0, PREVIEW_ITEMS)
    .map((j) => ({ jobId: j.id, title: j.title, company: j.company, createdAt: j.createdAt }));

  const strongMatches = applications
    .filter((a): a is JobApplication & { matchScore: number } => a.matchScore != null && a.matchScore >= STRONG_MATCH_THRESHOLD)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, PREVIEW_ITEMS)
    .flatMap((a) => {
      const job = jobById.get(a.jobId);
      return job ? [{ jobId: job.id, applicationId: a.id, title: job.title, company: job.company, matchScore: a.matchScore }] : [];
    });

  const easyApplyAvailable = jobs
    .filter((j) => j.easyApply === "verified" && !submittedJobIds.has(j.id))
    .slice(0, PREVIEW_ITEMS)
    .map((j) => ({ jobId: j.id, title: j.title, company: j.company }));

  const applicationsAwaitingApproval = applications
    .filter((a) => pendingApplicationIds.has(a.id))
    .flatMap((a) => {
      const job = jobById.get(a.jobId);
      const approvalId = pendingApplicationIds.get(a.id)!;
      return job ? [{ applicationId: a.id, jobId: job.id, title: job.title, company: job.company, approvalId }] : [];
    });

  const applicationsAwaitingAction = applications
    .filter((a) => a.status === "prepared" && !pendingApplicationIds.has(a.id))
    .flatMap((a) => {
      const job = jobById.get(a.jobId);
      return job ? [{ applicationId: a.id, jobId: job.id, title: job.title, company: job.company, status: a.status }] : [];
    });

  return {
    totalSaved: jobs.length,
    newlyCaptured,
    strongMatches,
    easyApplyAvailable,
    applicationsAwaitingAction,
    applicationsAwaitingApproval,
    followUpNote:
      "This app does not track application follow-up due dates yet — nothing is shown here that isn't already recorded.",
  };
}

function buildApprovalsSection(userId: string): ApprovalsBriefing {
  const pending = listApprovals(userId, "pending");
  return {
    pendingCount: pending.length,
    items: pending.slice(0, PREVIEW_ITEMS).map((a) => ({ id: a.id, action: a.action, target: a.target })),
  };
}

function buildPriorities(email: Record<KnownEmailProviderId, EmailProviderBriefing>, jobs: JobsBriefing, approvals: ApprovalsBriefing): string[] {
  const priorities: string[] = [];
  for (const providerId of KNOWN_EMAIL_PROVIDER_IDS) {
    const section = email[providerId];
    const name = providerId === "gmail" ? "Gmail" : "Outlook";
    for (const item of section.urgent.slice(0, 2)) {
      priorities.push(`Urgent (${name}): ${item.subject || item.from}`);
    }
  }
  for (const providerId of KNOWN_EMAIL_PROVIDER_IDS) {
    const section = email[providerId];
    const name = providerId === "gmail" ? "Gmail" : "Outlook";
    for (const item of section.deadlines.slice(0, 2)) {
      priorities.push(`Deadline (${name}): ${item.subject || item.from} — ${item.deadline}`);
    }
  }
  if (approvals.pendingCount > 0) {
    const first = approvals.items[0];
    priorities.push(
      approvals.pendingCount === 1
        ? `1 action is waiting for your approval: ${first.action} → ${first.target}.`
        : `${approvals.pendingCount} actions are waiting for your approval.`
    );
  }
  for (const match of jobs.strongMatches.slice(0, 2)) {
    priorities.push(`Strong job match: ${match.title} at ${match.company} (${match.matchScore}%).`);
  }
  return priorities.slice(0, MAX_PRIORITIES);
}

function buildSummaryText(
  email: Record<KnownEmailProviderId, EmailProviderBriefing>,
  jobs: JobsBriefing,
  approvals: ApprovalsBriefing,
  urgentCount: number,
  actionsCount: number,
  deadlinesCount: number,
  priorities: string[]
): string {
  const emailLine = KNOWN_EMAIL_PROVIDER_IDS.map((id) => {
    const section = email[id];
    const name = id === "gmail" ? "Gmail" : "Outlook";
    if (!section.connected) return `${name}: not connected`;
    return `${name}: ${section.urgentCount + section.actionRequiredCount} important message(s)`;
  }).join(" / ");

  const lines = [
    `🔴 Urgent — ${urgentCount} item(s) requiring attention.`,
    `📧 Email — ${emailLine}`,
    `💼 Jobs — ${jobs.strongMatches.length} strong job match(es)${jobs.totalSaved === 0 ? " (no saved jobs)" : ""}`,
    `📅 Deadlines — ${deadlinesCount} upcoming deadline(s)`,
    `✅ Actions — ${actionsCount} thing(s) requiring action`,
    `🔐 Approvals — ${approvals.pendingCount} action(s) waiting for your approval`,
  ];
  if (priorities.length > 0) {
    lines.push("🎯 Today's priorities");
    for (const p of priorities) lines.push(`• ${p}`);
  }
  return lines.join("\n");
}

type StoredRow = { data_json: string };

function getStoredBriefing(userId: string, briefingDate: string): DailyBriefing | null {
  const row = db
    .prepare("SELECT data_json FROM daily_briefings WHERE user_id = ? AND briefing_date = ?")
    .get(userId, briefingDate) as StoredRow | undefined;
  return row ? (JSON.parse(row.data_json) as DailyBriefing) : null;
}

/**
 * Upserts by UNIQUE(user_id, briefing_date) — this is the idempotency
 * mechanism. Calling generateDailyBriefing twice for the same user on the
 * same UTC date (a retry, a duplicate scheduler firing, the user opening
 * the app twice) updates the same row rather than creating a duplicate.
 */
function storeBriefing(briefing: DailyBriefing): void {
  const id = newId("dbrief");
  const now = nowIso();
  db.prepare(
    `INSERT INTO daily_briefings
       (id, user_id, briefing_date, summary_text, urgent_count, actions_count, deadlines_count, approvals_count, jobs_count, data_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, briefing_date) DO UPDATE SET
       summary_text = excluded.summary_text,
       urgent_count = excluded.urgent_count,
       actions_count = excluded.actions_count,
       deadlines_count = excluded.deadlines_count,
       approvals_count = excluded.approvals_count,
       jobs_count = excluded.jobs_count,
       data_json = excluded.data_json,
       updated_at = excluded.updated_at`
  ).run(
    id,
    briefing.userId,
    briefing.briefingDate,
    briefing.summaryText,
    briefing.urgentCount,
    briefing.actionsCount,
    briefing.deadlinesCount,
    briefing.approvalsCount,
    briefing.jobs.totalSaved,
    JSON.stringify(briefing),
    now,
    now
  );
}

/**
 * Builds (or reuses today's already-generated) Daily Personal Briefing for
 * a user. Idempotent per UTC calendar day via UNIQUE(user_id,
 * briefing_date): a second call the same day returns the same stored
 * briefing instead of recomputing/re-fetching, unless `forceRefresh` is
 * set. This is the single reusable entry point a future scheduler, the
 * /api/briefing route, the Home/Briefing screen, and the
 * briefing.getDailyBriefing tool all call — none of them duplicate this
 * aggregation logic themselves.
 */
export async function generateDailyBriefing(userId: string, opts?: { forceRefresh?: boolean }): Promise<DailyBriefing> {
  const briefingDate = todayDateUTC();

  if (!opts?.forceRefresh) {
    const existing = getStoredBriefing(userId, briefingDate);
    if (existing) return existing;
  }

  const emailEntries = await Promise.all(
    KNOWN_EMAIL_PROVIDER_IDS.map(async (id) => [id, await buildEmailSection(userId, id)] as const)
  );
  const email = Object.fromEntries(emailEntries) as Record<KnownEmailProviderId, EmailProviderBriefing>;

  const jobs = buildJobsSection(userId);
  const approvals = buildApprovalsSection(userId);

  const urgentCount = KNOWN_EMAIL_PROVIDER_IDS.reduce((sum, id) => sum + email[id].urgentCount, 0);
  const deadlinesCount = KNOWN_EMAIL_PROVIDER_IDS.reduce((sum, id) => sum + email[id].deadlinesCount, 0);
  const actionsCount =
    KNOWN_EMAIL_PROVIDER_IDS.reduce((sum, id) => sum + email[id].actionRequiredCount, 0) +
    jobs.applicationsAwaitingAction.length;
  const approvalsCount = approvals.pendingCount;

  const priorities = buildPriorities(email, jobs, approvals);
  const summaryText = buildSummaryText(email, jobs, approvals, urgentCount, actionsCount, deadlinesCount, priorities);

  const briefing: DailyBriefing = {
    userId,
    briefingDate,
    generatedAt: nowIso(),
    email,
    jobs,
    approvals,
    urgentCount,
    actionsCount,
    deadlinesCount,
    approvalsCount,
    priorities,
    summaryText,
  };

  storeBriefing(briefing);

  if (urgentCount > 0 || approvalsCount > 0) {
    void notifyUser(userId, {
      title: "Your daily briefing is ready",
      body: `${urgentCount} urgent, ${approvalsCount} awaiting approval.`,
      url: "/home",
      category: "SYSTEM",
      referenceId: `briefing:${briefingDate}`,
    }).catch(() => {});
  }

  return briefing;
}

/** Convenience alias matching the task's requested function name. */
export const getOrGenerateDailyBriefing = generateDailyBriefing;
