"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SubpageHeader } from "@/components/SubpageHeader";
import { apiFetch } from "@/lib/csrfClient";

type NotificationCategory = "EMAIL" | "JOB" | "APPLICATION" | "APPROVAL" | "SYSTEM";

type NotificationItem = {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string;
  link: string | null;
  read: number;
  read_at: string | null;
  created_at: string;
};

const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  EMAIL: "Email",
  JOB: "Job",
  APPLICATION: "Application",
  APPROVAL: "Approval",
  SYSTEM: "System",
};

const CATEGORY_ICON: Record<NotificationCategory, string> = {
  EMAIL: "📧",
  JOB: "💼",
  APPLICATION: "📄",
  APPROVAL: "🔐",
  SYSTEM: "🔔",
};

const FILTERS: { value: NotificationCategory | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "APPROVAL", label: "Approvals" },
  { value: "EMAIL", label: "Email" },
  { value: "JOB", label: "Jobs" },
  { value: "APPLICATION", label: "Applications" },
  { value: "SYSTEM", label: "System" },
];

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function NotificationsPage() {
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [filter, setFilter] = useState<NotificationCategory | "all">("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch("/api/notifications")
      .then((r) => r.json())
      .then((data) => {
        setItems(data.notifications ?? []);
        setUnreadCount(data.unreadCount ?? 0);
      })
      .finally(() => setLoading(false));
  }, []);

  async function markAllRead() {
    setItems((prev) => prev.map((n) => ({ ...n, read: 1 })));
    setUnreadCount(0);
    await apiFetch("/api/notifications/read", { method: "POST", body: JSON.stringify({ all: true }) });
  }

  async function openNotification(n: NotificationItem) {
    if (!n.read) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: 1 } : x)));
      setUnreadCount((c) => Math.max(0, c - 1));
      await apiFetch("/api/notifications/read", { method: "POST", body: JSON.stringify({ id: n.id }) });
    }
    if (n.link) router.push(n.link);
  }

  const visible = filter === "all" ? items : items.filter((n) => n.category === filter);

  return (
    <div>
      <SubpageHeader title="Notifications" backHref="/home" />
      <div className="mx-auto max-w-md px-4 pt-4 pb-6">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm text-muted">{unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}</p>
          {unreadCount > 0 && (
            <button onClick={() => void markAllRead()} className="text-xs font-medium text-accent">
              Mark all read
            </button>
          )}
        </div>

        <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${
                filter === f.value ? "bg-accent text-accent-foreground" : "border border-border text-muted"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading && <p className="text-sm text-muted">Loading…</p>}

        {!loading && visible.length === 0 && (
          <p className="mt-8 text-center text-sm text-muted">No notifications here.</p>
        )}

        <ul className="space-y-2">
          {visible.map((n) => (
            <li key={n.id}>
              <button
                onClick={() => void openNotification(n)}
                className={`w-full rounded-xl border px-3.5 py-3 text-left transition active:scale-[0.99] ${
                  n.read ? "border-border bg-surface" : "border-accent/40 bg-accent/5"
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 text-base leading-none">{CATEGORY_ICON[n.category]}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium text-foreground">{n.title}</p>
                      {!n.read && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />}
                    </div>
                    <p className="mt-0.5 text-sm text-muted">{n.body}</p>
                    <p className="mt-1 text-xs text-muted">
                      {CATEGORY_LABEL[n.category]} · {timeAgo(n.created_at)}
                    </p>
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
