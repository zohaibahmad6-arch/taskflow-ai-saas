import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("/api/health: safe for an external platform health checker", () => {
  const routeContent = fs.readFileSync(path.join(process.cwd(), "src/app/api/health/route.ts"), "utf-8");
  const proxyContent = fs.readFileSync(path.join(process.cwd(), "src/proxy.ts"), "utf-8");

  test("the route is registered as a public path (no session required) in proxy.ts", () => {
    expect(proxyContent).toMatch(/PUBLIC_API_PREFIXES\s*=\s*\[[^\]]*"\/api\/health"/);
  });

  test("the route never returns the caught error's message, and never imports anything secret-bearing", () => {
    expect(routeContent).not.toMatch(/err\.message|String\(err\)/);
    expect(routeContent).not.toMatch(/getSession|env\.|process\.env/);
  });

  test("the route never queries or returns user-identifying tables (users, approvals, notifications, connected_accounts)", () => {
    expect(routeContent).not.toMatch(/FROM users|FROM approvals|FROM notifications|FROM connected_accounts|FROM candidate_profile/i);
  });

  test("the healthy response body contains only a status field, nothing else", async () => {
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ status: "ok" });
  });
});
