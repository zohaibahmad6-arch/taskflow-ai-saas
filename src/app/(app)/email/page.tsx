import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { GmailConnectionCard } from "@/components/GmailConnectionCard";
import { OutlookConnectionCard } from "@/components/OutlookConnectionCard";
import { getSession } from "@/lib/auth";
import { listConnections } from "@/lib/connections";
import { getLatestBriefing } from "@/lib/email/briefing";

const QUICK_PROMPTS = [
  "Summarize my inbox",
  "Show emails requiring my action",
  "What deadlines are in my emails?",
  "Sort my emails",
];

export default async function EmailPage() {
  const session = await getSession();
  const userId = session!.user.id;
  const connections = listConnections(userId).filter((c) => c.category === "email");
  const gmail = connections.find((c) => c.provider === "gmail");
  const outlook = connections.find((c) => c.provider === "outlook");
  const gmailConnected = gmail?.status === "connected";
  const outlookConnected = outlook?.status === "connected";
  const anyConnected = gmailConnected || outlookConnected;

  // When exactly one account is connected, show its briefing directly.
  // When both are connected, show both (never guess which one the user
  // means) — when neither is connected, show nothing (no sample data).
  const gmailBriefing = gmailConnected ? getLatestBriefing(userId, "gmail") : null;
  const outlookBriefing = outlookConnected ? getLatestBriefing(userId, "outlook") : null;

  return (
    <div>
      <TopBar title="Email" />
      <div className="mx-auto max-w-md px-4 pt-4 pb-6">
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
            Connect Email
          </h2>
          <div className="space-y-2">
            <GmailConnectionCard
              initial={{
                status: gmail?.status ?? "not_connected",
                accountLabel: gmail?.account_label ?? null,
                lastSyncedAt: gmail?.last_synced_at ?? null,
                lastError: gmail?.status === "error" ? gmail?.last_error ?? null : null,
              }}
            />
            <OutlookConnectionCard
              initial={{
                status: outlook?.status ?? "not_connected",
                accountLabel: outlook?.account_label ?? null,
                lastSyncedAt: outlook?.last_synced_at ?? null,
                lastError: outlook?.status === "error" ? outlook?.last_error ?? null : null,
              }}
            />
          </div>
          <p className="mt-2 text-xs text-muted">
            The assistant can read, search, summarize, and classify mail on both accounts once
            connected. It can never send, delete, forward, move, or re-categorize email — and can
            never change mailbox settings — without your explicit approval for that specific
            action, shown exactly in the Approval Center. Gmail is read-only in this build (no
            send/modify scope was requested); Outlook supports real, approval-gated mailbox
            actions, including sorting your inbox.
          </p>
        </section>

        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
            Email Assistant
          </h2>
          {anyConnected ? (
            <div className="grid grid-cols-2 gap-2">
              {QUICK_PROMPTS.map((prompt) => (
                <Link
                  key={prompt}
                  href={`/ai?prompt=${encodeURIComponent(prompt)}`}
                  className="rounded-xl border border-border bg-surface px-3.5 py-3 text-sm text-foreground active:scale-[0.97]"
                >
                  {prompt}
                </Link>
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-border bg-surface px-4 py-3.5 text-sm text-muted">
              Connect Gmail or Outlook above to summarize your inbox, find action items and
              deadlines, classify and sort mail, and search from AI Chat.
            </p>
          )}
          {gmailConnected && outlookConnected && (
            <p className="mt-2 text-[11px] text-muted">
              Both accounts are connected — when you ask the assistant to do something with your
              email, say which account (Gmail or Outlook) if it isn&apos;t obvious; it will ask
              rather than guess.
            </p>
          )}
        </section>

        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
            Latest Briefing
          </h2>
          {!anyConnected ? (
            <p className="rounded-xl border border-border bg-surface px-4 py-3.5 text-sm text-muted">
              Connect an email account to enable Urgent / Action Required / Follow Up / FYI /
              Deadlines summaries. No summary is shown until then — nothing here is sample data.
            </p>
          ) : (
            <div className="space-y-2">
              {gmailConnected && <BriefingCard label="Gmail" briefing={gmailBriefing} />}
              {outlookConnected && <BriefingCard label="Outlook" briefing={outlookBriefing} />}
            </div>
          )}
        </section>

        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
            Draft a Reply
          </h2>
          <p className="rounded-xl border border-border bg-surface px-4 py-3.5 text-sm text-muted">
            Ask the AI to draft a reply to a specific email from your search/summary results, or
            just paste any email text into AI Chat — that works even before an account is
            connected, since pasted text never touches your inbox directly.
          </p>
        </section>
      </div>
    </div>
  );
}

function BriefingCard({
  label,
  briefing,
}: {
  label: string;
  briefing: Awaited<ReturnType<typeof getLatestBriefing>>;
}) {
  if (!briefing) {
    return (
      <div className="rounded-xl border border-border bg-surface px-4 py-3.5 text-sm text-muted">
        <p className="mb-1 text-xs font-medium text-foreground">{label}</p>
        No briefing generated yet. Ask the AI: &quot;Summarize my inbox&quot; to create one.
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface px-4 py-3.5 text-sm">
      <p className="text-xs font-medium text-foreground">{label}</p>
      <p className="text-foreground">{briefing.summaryText}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span>🔴 Urgent: {briefing.urgent.length}</span>
        <span>🟠 Action: {briefing.actionRequired.length}</span>
        <span>🟡 Follow up: {briefing.followUp.length}</span>
        <span>📅 Deadlines: {briefing.deadlines.length}</span>
      </div>
      <p className="text-[11px] text-muted">Generated {new Date(briefing.createdAt).toLocaleString()}</p>
    </div>
  );
}
