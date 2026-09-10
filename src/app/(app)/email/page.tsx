import { TopBar } from "@/components/TopBar";
import { ConnectionRow } from "@/components/ConnectionRow";
import { getSession } from "@/lib/auth";
import { listConnections } from "@/lib/connections";

export default async function EmailPage() {
  const session = await getSession();
  const connections = listConnections(session!.user.id).filter((c) => c.category === "email");
  const anyConnected = connections.some((c) => c.status === "connected");

  return (
    <div>
      <TopBar title="Email" />
      <div className="mx-auto max-w-md px-4 pt-4 pb-6">
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
            Connect Email
          </h2>
          <div className="space-y-2">
            {connections.map((c) => (
              <ConnectionRow key={c.provider} provider={c.provider} initialStatus={c.status} />
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">
            The assistant can read, search, and summarize once connected. It can never send,
            delete, forward, or move email — and can never change mailbox settings — without your
            explicit approval for that specific action.
          </p>
        </section>

        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
            Daily Briefing
          </h2>
          {anyConnected ? (
            <p className="rounded-xl border border-border bg-surface px-4 py-3.5 text-sm text-muted">
              Ask the AI: &quot;Summarize my emails&quot; to generate today&apos;s briefing.
            </p>
          ) : (
            <p className="rounded-xl border border-border bg-surface px-4 py-3.5 text-sm text-muted">
              Connect an email account to enable Urgent / Action Required / Follow Up / FYI /
              Deadlines summaries. No summary is shown until then — nothing here is sample data.
            </p>
          )}
        </section>

        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
            Draft a Reply
          </h2>
          <p className="rounded-xl border border-border bg-surface px-4 py-3.5 text-sm text-muted">
            You can paste any email into the AI chat and ask for a reply draft — this works even
            before an account is connected, since it never touches your inbox directly.
          </p>
        </section>
      </div>
    </div>
  );
}
