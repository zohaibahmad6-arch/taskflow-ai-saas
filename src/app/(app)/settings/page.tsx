import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { getSession } from "@/lib/auth";
import { LogoutButton } from "@/components/LogoutButton";

const ITEMS = [
  { href: "/settings/account", label: "Account", desc: "Your profile and sign-in" },
  { href: "/settings/connections", label: "Connected Services", desc: "Email and social accounts" },
  { href: "/settings/content-style", label: "Content Style", desc: "How the AI writes for you" },
  { href: "/settings/security", label: "Security", desc: "Password, approvals, sessions" },
  { href: "/settings/notifications", label: "Notifications", desc: "Mobile alerts" },
  { href: "/activity", label: "Activity", desc: "Full audit history" },
  { href: "/settings/data", label: "Data", desc: "Export or delete your data" },
];

export default async function SettingsPage() {
  const session = await getSession();

  return (
    <div>
      <TopBar title="Settings" />
      <div className="mx-auto max-w-md px-4 pt-4 pb-6">
        <div className="mb-4 rounded-xl border border-border bg-surface px-4 py-3.5">
          <p className="text-sm font-medium text-foreground">{session?.user.name}</p>
          <p className="text-xs text-muted">{session?.user.email}</p>
        </div>

        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
          {ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center justify-between px-4 py-3.5 active:bg-background"
            >
              <div>
                <p className="text-sm font-medium text-foreground">{item.label}</p>
                <p className="text-xs text-muted">{item.desc}</p>
              </div>
              <span className="text-muted">›</span>
            </Link>
          ))}
        </div>

        <div className="mt-6">
          <LogoutButton />
        </div>
      </div>
    </div>
  );
}
