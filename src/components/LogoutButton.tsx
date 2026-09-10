"use client";

import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/csrfClient";

export function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await apiFetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <button
      onClick={handleLogout}
      className="w-full rounded-xl border border-danger/30 py-3 text-sm font-medium text-danger active:scale-[0.98]"
    >
      Sign out
    </button>
  );
}
