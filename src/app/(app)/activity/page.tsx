import { TopBar } from "@/components/TopBar";
import { getSession } from "@/lib/auth";
import { listAuditEvents } from "@/lib/audit";

const TYPE_STYLE: Record<string, string> = {
  executed: "text-success",
  failed: "text-danger",
  rejected: "text-danger",
  expired: "text-muted",
  approved: "text-info",
  proposed: "text-warning",
  info: "text-muted",
};

const TYPE_GLYPH: Record<string, string> = {
  executed: "✓",
  failed: "✕",
  rejected: "✕",
  expired: "⏱",
  approved: "✓",
  proposed: "⏳",
  info: "•",
};

export default async function ActivityPage() {
  const session = await getSession();
  const events = listAuditEvents(session!.user.id, 200);

  return (
    <div>
      <TopBar title="Activity" />
      <div className="mx-auto max-w-md px-4 pt-4">
        {events.length === 0 ? (
          <p className="mt-8 text-center text-sm text-muted">Nothing has happened yet.</p>
        ) : (
          <ul className="space-y-3">
            {events.map((event) => (
              <li key={event.id} className="rounded-xl border border-border bg-surface px-3.5 py-3">
                <div className="flex items-start gap-2">
                  <span className={`mt-0.5 text-sm ${TYPE_STYLE[event.event_type] ?? "text-muted"}`}>
                    {TYPE_GLYPH[event.event_type] ?? "•"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">{event.summary}</p>
                    {event.error && <p className="mt-0.5 text-xs text-danger">{event.error}</p>}
                    <p className="mt-1 text-[11px] text-muted">
                      {event.tool_id} · {new Date(event.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
