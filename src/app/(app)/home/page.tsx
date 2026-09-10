import Link from "next/link";
import { getSession } from "@/lib/auth";
import { listApprovals } from "@/lib/approvals";
import { listAuditEvents } from "@/lib/audit";
import { listSocialDrafts } from "@/lib/socialDrafts";
import { getUnreadNotificationCount } from "@/lib/push";
import { generateDailyBriefing, type EmailProviderBriefing } from "@/lib/dailyBriefing";
import { QuickCommandBox } from "@/components/QuickCommandBox";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default async function HomePage() {
  const session = await getSession();
  const userId = session!.user.id;

  const briefing = await generateDailyBriefing(userId);
  const unreadNotifications = getUnreadNotificationCount(userId);
  const recentActivity = listAuditEvents(userId, 6);
  const drafts = listSocialDrafts(userId).filter((d) => d.status === "ready" || d.status === "draft");
  const pending = listApprovals(userId, "pending");

  return (
    <div className="mx-auto max-w-md px-4 pt-6 safe-top">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted">
            {greeting()}, {session!.user.name}.
          </p>
          <h1 className="mt-0.5 text-2xl font-semibold text-foreground">Your briefing</h1>
        </div>
        <Link
          href="/notifications"
          aria-label="Notifications"
          className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border text-foreground active:scale-95"
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          {unreadNotifications > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-semibold text-white">
              {unreadNotifications > 9 ? "9+" : unreadNotifications}
            </span>
          )}
        </Link>
      </div>

      {briefing.urgentCount > 0 && (
        <div className="mb-4 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3">
          <p className="text-sm font-semibold text-danger">
            🔴 Urgent — {briefing.urgentCount} item{briefing.urgentCount === 1 ? "" : "s"} requiring attention.
          </p>
        </div>
      )}

      <QuickCommandBox />

      <div className="mt-6 grid grid-cols-2 gap-3">
        <StatTile label="Deadlines" value={briefing.deadlinesCount} emoji="📅" />
        <StatTile label="Actions" value={briefing.actionsCount} emoji="✅" />
        <StatTile label="Approvals" value={briefing.approvalsCount} emoji="🔐" href="/approvals" />
        <StatTile label="Strong job matches" value={briefing.jobs.strongMatches.length} emoji="💼" href="/jobs" />
      </div>

      {briefing.priorities.length > 0 && (
        <Section title="Today's priorities" href="/notifications">
          <ul className="space-y-2">
            {briefing.priorities.map((p, i) => (
              <li key={i} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground">
                🎯 {p}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Email" href="/email">
        <EmailProviderRow name="Gmail" section={briefing.email.gmail} />
        <div className="mt-2">
          <EmailProviderRow name="Outlook" section={briefing.email.outlook} />
        </div>
      </Section>

      <Section title="Jobs" href="/jobs" count={briefing.jobs.totalSaved}>
        {briefing.jobs.totalSaved === 0 ? (
          <p className="text-sm text-muted">No saved jobs.</p>
        ) : (
          <ul className="space-y-2">
            {briefing.jobs.strongMatches.length > 0 ? (
              briefing.jobs.strongMatches.map((m) => (
                <li key={m.applicationId} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm">
                  <span className="font-medium text-foreground">{m.title}</span>
                  <span className="text-muted"> at {m.company} · {m.matchScore}% match</span>
                </li>
              ))
            ) : (
              <p className="text-sm text-muted">No strong matches yet.</p>
            )}
            {briefing.jobs.applicationsAwaitingApproval.length > 0 && (
              <p className="text-xs text-muted">
                {briefing.jobs.applicationsAwaitingApproval.length} application(s) awaiting approval.
              </p>
            )}
          </ul>
        )}
      </Section>

      <Section title="Pending approvals" href="/approvals" count={pending.length}>
        {pending.length === 0 ? (
          <p className="text-sm text-muted">Nothing is waiting on you right now.</p>
        ) : (
          <ul className="space-y-2">
            {pending.slice(0, 3).map((a) => (
              <li key={a.id} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm">
                <span className="font-medium text-foreground">{a.action}</span>
                <span className="text-muted"> → {a.target}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Social drafts" href="/social" count={drafts.length}>
        {drafts.length === 0 ? (
          <p className="text-sm text-muted">No drafts waiting for review.</p>
        ) : (
          <ul className="space-y-2">
            {drafts.slice(0, 2).map((d) => (
              <li key={d.id} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm">
                <span className="font-medium capitalize text-foreground">{d.platform}</span>
                <p className="mt-0.5 line-clamp-2 text-muted">{d.content}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Recent activity" href="/activity">
        {recentActivity.length === 0 ? (
          <p className="text-sm text-muted">No activity yet.</p>
        ) : (
          <ul className="space-y-2">
            {recentActivity.map((event) => (
              <li key={event.id} className="text-sm text-muted">
                <span className="text-foreground">{eventGlyph(event.event_type)}</span> {event.summary}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function EmailProviderRow({ name, section }: { name: string; section: EmailProviderBriefing }) {
  if (!section.connected) {
    return <p className="text-sm text-muted">{name}: not connected.</p>;
  }
  return (
    <p className="text-sm text-muted">
      <span className="font-medium text-foreground">{name}: </span>
      {section.statusText}
    </p>
  );
}

function eventGlyph(type: string) {
  switch (type) {
    case "executed":
      return "✓";
    case "rejected":
    case "failed":
      return "✕";
    case "expired":
      return "⏱";
    default:
      return "⏳";
  }
}

function StatTile({ label, value, emoji, href }: { label: string; value: number; emoji: string; href?: string }) {
  const content = (
    <div className="rounded-xl border border-border bg-surface px-4 py-3.5 transition active:scale-[0.97]">
      <p className="text-lg font-semibold text-foreground">
        {emoji} {value}
      </p>
      <p className="mt-0.5 text-xs text-muted">{label}</p>
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

function Section({
  title,
  href,
  count,
  children,
}: {
  title: string;
  href: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>
        <Link href={href} className="text-xs font-medium text-accent">
          {count !== undefined ? `${count} · View all` : "View all"}
        </Link>
      </div>
      {children}
    </section>
  );
}
