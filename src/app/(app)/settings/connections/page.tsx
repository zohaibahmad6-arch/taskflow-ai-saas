import { SubpageHeader } from "@/components/SubpageHeader";
import { ConnectionRow } from "@/components/ConnectionRow";
import { getSession } from "@/lib/auth";
import { listConnections } from "@/lib/connections";

export default async function ConnectionsPage() {
  const session = await getSession();
  const connections = listConnections(session!.user.id);
  const email = connections.filter((c) => c.category === "email");
  const social = connections.filter((c) => c.category === "social");

  return (
    <div>
      <SubpageHeader title="Connected Services" />
      <div className="mx-auto max-w-md space-y-6 px-4 pt-4 pb-6">
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Email</h2>
          <div className="space-y-2">
            {email.map((c) => (
              <ConnectionRow key={c.provider} provider={c.provider} initialStatus={c.status} />
            ))}
          </div>
        </section>
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Social</h2>
          <div className="space-y-2">
            {social.map((c) => (
              <ConnectionRow key={c.provider} provider={c.provider} initialStatus={c.status} />
            ))}
          </div>
        </section>
        <p className="text-xs text-muted">
          Every permission requested by a provider is shown during that provider&apos;s
          authorization step. Disconnecting removes locally stored access immediately.
        </p>
      </div>
    </div>
  );
}
