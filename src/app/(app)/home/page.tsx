import Link from "next/link";
import { getSession } from "@/lib/auth";
import { listApprovals } from "@/lib/approvals";
import { listAuditEvents } from "@/lib/audit";
import { listConnections } from "@/lib/connections";
import { listSocialDrafts } from "@/lib/socialDrafts";
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

  const pending = listApprovals(userId, "pending");
  const recentActivity = listAuditEvents(userId, 6);
  const connections = listConnections(userId);
  const emailConnected = connections.some((c) => c.category === "email" && c.status === "connected");
  const drafts = listSocialDrafts(userId).filter((d) => d.status === "ready" || d.status === "draft");

  return (
    <div className="mx-auto max-w-md px-4 pt-6 safe-top">
      <div className="mb-6">
        <p className="text-sm text-muted">{greeting()}, {session!.user.name}.</p>
        <h1 className="mt-0.5 text-2xl font-semibold text-foreground">How can I help you today?</h1>
      </div>

      <QuickCommandBox />

      <div className="mt-6 grid grid-cols-2 gap-3">
        <QuickAction href="/ai?prompt=Summarize%20my%20email" label="Summarize my email" />
        <QuickAction href="/ai?prompt=Create%20today%27s%20LinkedIn%20post" label="Create LinkedIn post" />
        <QuickAction href="/approvals" label="Pending approvals" />
        <QuickAction href="/activity" label="Review recent activity" />
      </div>

      <Section title="Email" href="/email">
        {emailConnected ? (
          <p className="text-sm text-muted">Email is connected. Ask the AI for today&apos;s briefing.</p>
        ) : (
          <p className="text-sm text-muted">No email account connected yet.</p>
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

function QuickAction({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-border bg-surface px-4 py-3.5 text-sm font-medium text-foreground transition active:scale-[0.97]"
    >
      {label}
    </Link>
  );
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
