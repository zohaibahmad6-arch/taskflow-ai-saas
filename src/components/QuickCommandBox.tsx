"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function QuickCommandBox() {
  const [value, setValue] = useState("");
  const router = useRouter();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    router.push(trimmed ? `/ai?prompt=${encodeURIComponent(trimmed)}` : "/ai");
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 rounded-2xl border border-border bg-surface p-2 pl-4">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0 text-muted">
        <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" strokeLinecap="round" />
        <circle cx="12" cy="12" r="2.5" />
      </svg>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Ask your agent anything…"
        className="min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted"
      />
      <button
        type="submit"
        className="shrink-0 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground active:scale-95"
      >
        Ask
      </button>
    </form>
  );
}
