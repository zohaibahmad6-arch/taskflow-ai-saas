import { describe, test, expect, vi, afterEach } from "vitest";
import { invokeTool } from "@/lib/tools/execute";
import { ensureToolsRegistered } from "@/lib/tools";
import { storeVerifiedConnection, type OAuthTokenSet } from "@/lib/connections";
import { classifyMessages } from "@/lib/email/classification";
import { createTestUser } from "../helpers";

vi.mock("@/lib/email/classification", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/classification")>();
  return { ...actual, classifyMessages: vi.fn() };
});

ensureToolsRegistered();

function fakeTokens(): OAuthTokenSet {
  return {
    accessToken: "at",
    refreshToken: "rt",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    scope: "Mail.Read offline_access",
  };
}

function connectOutlook(userId: string) {
  storeVerifiedConnection({ userId, provider: "outlook", category: "email", accountLabel: "me@outlook.com", tokens: fakeTokens() });
}
function connectGmail(userId: string) {
  storeVerifiedConnection({ userId, provider: "gmail", category: "email", accountLabel: "me@gmail.com", tokens: fakeTokens() });
}

function stubEmptyMessageList() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const u = url.toString();
      if (u.includes("/mailFolders/inbox/messages") || u.includes("/messages?")) {
        return { ok: true, status: 200, json: async () => ({ messages: [], value: [] }) } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    })
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(classifyMessages).mockReset();
});

describe("email.createOrganizationPlan: prepares and displays, never modifies anything", () => {
  test("ambiguous account: with both Gmail and Outlook connected and no provider specified, asks which account instead of guessing", async () => {
    const user = createTestUser("orgplan-ambiguous");
    connectGmail(user.id);
    connectOutlook(user.id);

    const result = await invokeTool("email.createOrganizationPlan", {}, { userId: user.id });
    expect(result.awaitingApproval).toBeFalsy(); // PREPARATION — never creates an approval by itself
    expect(result.output.connected).toBe(false);
    expect(String(result.output.message)).toMatch(/more than one/i);
    expect(classifyMessages).not.toHaveBeenCalled();
  });

  test("no account connected: explains itself, never fabricates a plan", async () => {
    const user = createTestUser("orgplan-none");
    const result = await invokeTool("email.createOrganizationPlan", {}, { userId: user.id });
    expect(result.output.connected).toBe(false);
    expect(classifyMessages).not.toHaveBeenCalled();
  });

  test("Outlook connected: classification maps to a deterministic move plan; nothing is executed by this call", async () => {
    const user = createTestUser("orgplan-outlook");
    connectOutlook(user.id);
    stubEmptyMessageList();
    vi.mocked(classifyMessages).mockResolvedValueOnce([
      { messageId: "m1", threadId: "t1", from: "news@site.com", subject: "Weekly digest", snippet: "", category: "NEWSLETTER", reason: "looks like a newsletter" },
      { messageId: "m2", threadId: "t2", from: "boss@work.com", subject: "Need this today", snippet: "", category: "URGENT", reason: "time-sensitive" },
      { messageId: "m3", threadId: "t3", from: "promo@shop.com", subject: "50% off!", snippet: "", category: "MARKETING", reason: "promotional" },
    ]);

    const result = await invokeTool("email.createOrganizationPlan", { provider: "outlook" }, { userId: user.id });
    expect(result.output.connected).toBe(true);
    expect(result.output.executable).toBe(true);
    const items = result.output.items as Array<{ messageId: string; proposedAction: string; proposedFolder?: string }>;
    expect(items.find((i) => i.messageId === "m1")).toMatchObject({ proposedAction: "moveToFolder", proposedFolder: "Newsletters" });
    expect(items.find((i) => i.messageId === "m2")).toMatchObject({ proposedAction: "none" });
    expect(items.find((i) => i.messageId === "m3")).toMatchObject({ proposedAction: "moveToFolder", proposedFolder: "Marketing" });
    expect(result.output.proposedMoveCount).toBe(2);
    // This is a PREPARATION tool: no approval, no pending action, nothing changed.
    expect(result.awaitingApproval).toBeFalsy();
  });

  test("Gmail connected: still classifies and previews a plan, but is explicit that automatic execution isn't available for Gmail in this build", async () => {
    const user = createTestUser("orgplan-gmail");
    connectGmail(user.id);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const u = url.toString();
        if (u.includes("/messages?")) return { ok: true, status: 200, json: async () => ({ messages: [] }) } as Response;
        return { ok: false, status: 404, json: async () => ({}) } as Response;
      })
    );
    vi.mocked(classifyMessages).mockResolvedValueOnce([]);

    const result = await invokeTool("email.createOrganizationPlan", { provider: "gmail" }, { userId: user.id });
    expect(result.output.connected).toBe(true);
    expect(result.output.executable).toBe(false);
    expect(String(result.output.message)).toMatch(/only implemented for outlook/i);
  });
});
