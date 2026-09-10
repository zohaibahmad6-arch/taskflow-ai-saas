"use client";

import { useEffect, useState } from "react";
import { TopBar } from "@/components/TopBar";
import { ApprovalCard, type ApprovalItem } from "@/components/ApprovalCard";
import { apiFetch } from "@/lib/csrfClient";

type Tab = "pending" | "history";

export default function ApprovalsPage() {
  const [tab, setTab] = useState<Tab>("pending");
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch("/api/approvals")
      .then((r) => r.json())
      .then((data) => setItems(data.approvals ?? []))
      .finally(() => setLoading(false));
  }, []);

  function handleDecided(updated: ApprovalItem) {
    setItems((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  }

  const pending = items.filter((a) => a.status === "pending");
  const history = items.filter((a) => a.status !== "pending");
  const visible = tab === "pending" ? pending : history;

  return (
    <div>
      <TopBar title="Approval Center" />
      <div className="mx-auto max-w-md px-4 pt-4">
        <div className="mb-4 flex gap-2 rounded-xl bg-surface p-1">
          <TabButton active={tab === "pending"} onClick={() => setTab("pending")}>
            Pending {pending.length > 0 && `(${pending.length})`}
          </TabButton>
          <TabButton active={tab === "history"} onClick={() => setTab("history")}>
            History
          </TabButton>
        </div>

        {loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="mt-8 text-center text-sm text-muted">
            {tab === "pending" ? "Nothing needs your approval right now." : "No decided actions yet."}
          </p>
        ) : (
          <div className="space-y-3">
            {visible.map((a) => (
              <ApprovalCard key={a.id} approval={a} onDecided={handleDecided} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${
        active ? "bg-accent text-accent-foreground" : "text-muted"
      }`}
    >
      {children}
    </button>
  );
}
