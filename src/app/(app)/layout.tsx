import { getSession } from "@/lib/auth";
import { listApprovals } from "@/lib/approvals";
import { BottomNav } from "@/components/BottomNav";
import { ensureToolsRegistered } from "@/lib/tools";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  ensureToolsRegistered();
  const session = await getSession();
  const pendingCount = session ? listApprovals(session.user.id, "pending").length : 0;

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex-1 pb-20">{children}</div>
      <BottomNav pendingApprovals={pendingCount} />
    </div>
  );
}
