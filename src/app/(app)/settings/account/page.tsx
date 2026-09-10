import { SubpageHeader } from "@/components/SubpageHeader";
import { TimezoneSetting } from "@/components/TimezoneSetting";
import { getSession } from "@/lib/auth";

export default async function AccountPage() {
  const session = await getSession();

  return (
    <div>
      <SubpageHeader title="Account" />
      <div className="mx-auto max-w-md space-y-4 px-4 pt-4 pb-6">
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs uppercase tracking-wide text-muted">Name</p>
          <p className="mt-0.5 text-sm text-foreground">{session?.user.name}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs uppercase tracking-wide text-muted">Email</p>
          <p className="mt-0.5 text-sm text-foreground">{session?.user.email}</p>
        </div>
        <TimezoneSetting />
        <p className="text-xs text-muted">
          This is a private, single-user application. There is no public registration, and the
          authorized account is fixed by the server configuration (AUTH_USER_EMAIL).
        </p>
      </div>
    </div>
  );
}
