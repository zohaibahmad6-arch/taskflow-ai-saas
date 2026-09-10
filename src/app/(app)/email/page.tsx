import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { ConnectionRow } from "@/components/ConnectionRow";
import { GmailConnectionCard } from "@/components/GmailConnectionCard";
import { getSession } from "@/lib/auth";
import { listConnections } from "@/lib/connections";
import { getLatestBriefing } from "@/lib/email/briefing";

const QUICK_PROMPTS = [
  "Summarize my inbox",
  "Show emails requiring my action",
  "What deadlines are in my emails?",
  "Find emails from",
];

export default async function EmailPage() {
  const session = await getSession();
  const userId = session!.user.id;
  const connections = listConnections(userId).filter((c) => c.category === "email");
  const gmail = connections.find((c) => c.provider === "gmail");
  const outlook = connections.find((c) => c.provider === "outlook");
  const gmailConnected = gmail?.status === "connected";
  const briefing = gmailConnected ? getLatestBriefing(userId) : null;

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
            {outlook && <ConnectionRow provider="outlook" initialStatus={outlook.status} />}
          </div>
          <p className="mt-2 text-xs text-muted">
            The assistant can read, search, and summarize once connected. It can never send,
            delete, forward, or move email — and can never change mailbox settings — without your
            explicit approval for that specific action. This build only reads Gmail; sending is
            not implemented yet.
          </p>
        </section>

        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
            Email Assistant
          </h2>
          {gmailConnected ? (
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
              Connect Gmail above to summarize your inbox, find action items and deadlines, and
              search your mail from AI Chat.
            </p>
          )}
        </section>

        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
            Latest Briefing
          </h2>
          {!gmailConnected ? (
            <p className="rounded-xl border border-border bg-surface px-4 py-3.5 text-sm text-muted">
              Connect an email account to enable Urgent / Action Required / Follow Up / FYI /
              Deadlines summaries. No summary is shown until then — nothing here is sample data.
            </p>
          ) : briefing ? (
            <div className="space-y-2 rounded-xl border border-border bg-surface px-4 py-3.5 text-sm">
              <p className="text-foreground">{briefing.summaryText}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                <span>🔴 Urgent: {briefing.urgent.length}</span>
                <span>🟠 Action: {briefing.actionRequired.length}</span>
                <span>🟡 Follow up: {briefing.followUp.length}</span>
                <span>📅 Deadlines: {briefing.deadlines.length}</span>
              </div>
              <p className="text-[11px] text-muted">
                Generated {new Date(briefing.createdAt).toLocaleString()}
              </p>
            </div>
          ) : (
            <p className="rounded-xl border border-border bg-surface px-4 py-3.5 text-sm text-muted">
              No briefing generated yet. Ask the AI: &quot;Summarize my inbox&quot; to create one.
            </p>
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
