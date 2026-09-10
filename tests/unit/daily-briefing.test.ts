import { describe, test, expect, vi, afterEach } from "vitest";
import { db } from "@/lib/db";
import { generateDailyBriefing } from "@/lib/dailyBriefing";
import { storeVerifiedConnection, type OAuthTokenSet } from "@/lib/connections";
import { generateText } from "@/lib/openai";
import { createJob, createJobApplication, updateJobApplicationStatus } from "@/lib/jobs/store";
import { createApproval } from "@/lib/approvals";
import { createTestUser } from "../helpers";

// email/briefing.ts calls generateText() directly (not getOpenAIClient()) —
// mocking generateText here works because briefing.ts's import binding is
// what actually gets redirected; mocking getOpenAIClient would NOT reach
// generateText's internal call to it, since that call is same-module and
// keeps its closure over the real client even when the module is mocked.
vi.mock("@/lib/openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/openai")>();
  return { ...actual, generateText: vi.fn() };
});

function fakeTokens(): OAuthTokenSet {
  return {
    accessToken: "at",
    refreshToken: "rt",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    scope: "read",
  };
}

function connectGmail(userId: string) {
  storeVerifiedConnection({ userId, provider: "gmail", category: "email", accountLabel: "me@gmail.com", tokens: fakeTokens() });
}
function connectOutlook(userId: string) {
  storeVerifiedConnection({ userId, provider: "outlook", category: "email", accountLabel: "me@outlook.com", tokens: fakeTokens() });
}

function stubEmptyInbox() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const u = url.toString();
      if (u.includes("/messages")) {
        return { ok: true, status: 200, json: async () => ({ messages: [], value: [] }) } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    })
  );
}

/** Gmail list + per-message hydrate stub, returning exactly the two messages given. */
function stubGmailMessages(messages: Array<{ id: string; from: string; subject: string }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const u = url.toString();
      if (u.includes("/messages/")) {
        const id = u.split("/messages/")[1].split("?")[0];
        const m = messages.find((x) => x.id === id)!;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: m.id,
            threadId: `t-${m.id}`,
            snippet: "snippet text",
            payload: { headers: [{ name: "Subject", value: m.subject }, { name: "From", value: m.from }, { name: "Date", value: "2026-01-01" }] },
          }),
        } as Response;
      }
      if (u.includes("/messages")) {
        return { ok: true, status: 200, json: async () => ({ messages: messages.map((m) => ({ id: m.id })) }) } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    })
  );
}

function mockAIJson(response: unknown) {
  vi.mocked(generateText).mockResolvedValue(JSON.stringify(response));
}

function briefingRowCount(userId: string): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM daily_briefings WHERE user_id = ?").get(userId) as { n: number };
  return row.n;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(generateText).mockReset();
});

describe("generateDailyBriefing: honesty — never fabricates when nothing is connected/saved", () => {
  test("no email connected, no jobs, no approvals: every section says so honestly", async () => {
    const user = createTestUser("briefing-none");
    const briefing = await generateDailyBriefing(user.id);

    expect(briefing.email.gmail.connected).toBe(false);
    expect(briefing.email.gmail.statusText).toBe("Gmail is not connected.");
    expect(briefing.email.outlook.connected).toBe(false);
    expect(briefing.email.outlook.statusText).toBe("Outlook is not connected.");
    expect(briefing.jobs.totalSaved).toBe(0);
    expect(briefing.jobs.followUpNote).toBe("No saved jobs.");
    expect(briefing.approvals.pendingCount).toBe(0);
    expect(briefing.urgentCount).toBe(0);
    expect(briefing.summaryText).toMatch(/Gmail: not connected/);
    expect(briefing.summaryText).toMatch(/Outlook: not connected/);
  });
});

describe("generateDailyBriefing: multi-provider email, clearly identified by source", () => {
  test("Gmail connected only, empty inbox: Gmail reports connected+nothing urgent, Outlook stays disconnected", async () => {
    const user = createTestUser("briefing-gmail-only");
    connectGmail(user.id);
    stubEmptyInbox();

    const briefing = await generateDailyBriefing(user.id);
    expect(briefing.email.gmail.connected).toBe(true);
    expect(briefing.email.gmail.urgentCount).toBe(0);
    expect(briefing.email.gmail.statusText).toMatch(/nothing urgent/i);
    expect(briefing.email.outlook.connected).toBe(false);
  });

  test("Outlook connected only, empty inbox: Outlook reports connected, Gmail stays disconnected", async () => {
    const user = createTestUser("briefing-outlook-only");
    connectOutlook(user.id);
    stubEmptyInbox();

    const briefing = await generateDailyBriefing(user.id);
    expect(briefing.email.outlook.connected).toBe(true);
    expect(briefing.email.gmail.connected).toBe(false);
  });

  test("both connected, empty inboxes: both report connected independently, never mixed", async () => {
    const user = createTestUser("briefing-both");
    connectGmail(user.id);
    connectOutlook(user.id);
    stubEmptyInbox();

    const briefing = await generateDailyBriefing(user.id);
    expect(briefing.email.gmail.connected).toBe(true);
    expect(briefing.email.outlook.connected).toBe(true);
  });

  test("urgent + deadline detection: counts and items are rehydrated from OUR fetch, never trusted verbatim from the model", async () => {
    const user = createTestUser("briefing-urgent-detect");
    connectGmail(user.id);
    stubGmailMessages([
      { id: "m1", from: "boss@work.com", subject: "Server is down" },
      { id: "m2", from: "hr@work.com", subject: "Benefits enrollment" },
    ]);
    mockAIJson({
      summaryText: "One urgent issue and one deadline.",
      urgent: [{ messageId: "m1", reason: "production outage" }],
      actionRequired: [],
      followUp: [],
      fyi: [],
      deadlines: [{ messageId: "m2", reason: "enrollment closes soon", deadline: "2026-01-15" }],
    });

    const briefing = await generateDailyBriefing(user.id);
    expect(briefing.email.gmail.urgentCount).toBe(1);
    expect(briefing.email.gmail.urgent[0].subject).toBe("Server is down"); // from OUR fetch, not AI-echoed
    expect(briefing.email.gmail.deadlinesCount).toBe(1);
    expect(briefing.email.gmail.deadlines[0].deadline).toBe("2026-01-15");
    expect(briefing.urgentCount).toBe(1);
    expect(briefing.deadlinesCount).toBe(1);
    expect(briefing.priorities.some((p) => p.includes("Server is down"))).toBe(true);
  });
});

describe("generateDailyBriefing: jobs aggregation, using only what's actually captured", () => {
  test("empty jobs list: honestly says 'No saved jobs.'", async () => {
    const user = createTestUser("briefing-jobs-empty");
    const briefing = await generateDailyBriefing(user.id);
    expect(briefing.jobs.totalSaved).toBe(0);
    expect(briefing.jobs.strongMatches).toEqual([]);
    expect(briefing.jobs.followUpNote).toBe("No saved jobs.");
  });

  test("strong matches, easy apply, awaiting action vs awaiting approval are distinguished correctly", async () => {
    const user = createTestUser("briefing-jobs-full");

    const strongJob = createJob({ userId: user.id, title: "Senior Engineer", company: "Acme", description: "d", easyApply: "verified" });
    const strongApp = createJobApplication({ userId: user.id, jobId: strongJob.id, matchScore: 85 });
    updateJobApplicationStatus(user.id, strongApp.id, "prepared");

    const weakJob = createJob({ userId: user.id, title: "Junior Role", company: "Beta", description: "d" });
    const weakApp = createJobApplication({ userId: user.id, jobId: weakJob.id, matchScore: 30 });
    updateJobApplicationStatus(user.id, weakApp.id, "prepared");

    const pendingJob = createJob({ userId: user.id, title: "Pending Review", company: "Gamma", description: "d" });
    const pendingApp = createJobApplication({ userId: user.id, jobId: pendingJob.id, matchScore: 60 });
    updateJobApplicationStatus(user.id, pendingApp.id, "prepared");
    createApproval({
      userId: user.id,
      toolId: "jobs.submitApplication",
      payload: { applicationId: pendingApp.id },
      draftText: { action: "Submit application", target: `${pendingJob.title} at ${pendingJob.company}`, content: "c", consequence: "c" },
    });

    const briefing = await generateDailyBriefing(user.id);
    expect(briefing.jobs.totalSaved).toBe(3);
    expect(briefing.jobs.strongMatches.map((m) => m.jobId)).toContain(strongJob.id);
    expect(briefing.jobs.strongMatches.map((m) => m.jobId)).not.toContain(weakJob.id);
    expect(briefing.jobs.easyApplyAvailable.map((j) => j.jobId)).toContain(strongJob.id);
    expect(briefing.jobs.applicationsAwaitingApproval.map((a) => a.applicationId)).toContain(pendingApp.id);
    expect(briefing.jobs.applicationsAwaitingAction.map((a) => a.applicationId)).toContain(strongApp.id);
    expect(briefing.jobs.applicationsAwaitingAction.map((a) => a.applicationId)).not.toContain(pendingApp.id);
    // Never fabricates follow-up due dates — honest about what isn't tracked.
    expect(briefing.jobs.followUpNote).toMatch(/does not track/i);
  });
});

describe("generateDailyBriefing: approvals aggregation links to, never bypasses, the Approval Center", () => {
  test("pending approvals are counted and previewed, but generateDailyBriefing never decides them", async () => {
    const user = createTestUser("briefing-approvals");
    createApproval({
      userId: user.id,
      toolId: "email.checkConnection",
      payload: {},
      draftText: { action: "Do a thing", target: "Somewhere", content: "c", consequence: "c" },
    });

    const briefing = await generateDailyBriefing(user.id);
    expect(briefing.approvals.pendingCount).toBe(1);
    expect(briefing.approvalsCount).toBe(1);
    expect(briefing.approvals.items[0].action).toBe("Do a thing");
  });
});

describe("generateDailyBriefing: idempotency (section 17 — userId + briefingDate)", () => {
  test("calling twice the same day reuses the stored briefing instead of creating a duplicate row", async () => {
    const user = createTestUser("briefing-idempotent");
    const first = await generateDailyBriefing(user.id);
    expect(briefingRowCount(user.id)).toBe(1);

    const second = await generateDailyBriefing(user.id);
    expect(briefingRowCount(user.id)).toBe(1); // still exactly one row — no duplicate
    expect(second.generatedAt).toBe(first.generatedAt); // reused, not recomputed
  });

  test("forceRefresh recomputes but still upserts the same row (no duplicate)", async () => {
    const user = createTestUser("briefing-force-refresh");
    const first = await generateDailyBriefing(user.id);
    expect(briefingRowCount(user.id)).toBe(1);

    createJob({ userId: user.id, title: "New Role", company: "Acme", description: "d" });
    const second = await generateDailyBriefing(user.id, { forceRefresh: true });

    expect(briefingRowCount(user.id)).toBe(1); // upsert, not insert
    expect(second.jobs.totalSaved).toBe(1);
    expect(second.generatedAt).not.toBe(first.generatedAt);
  });
});

describe("generateDailyBriefing: user isolation", () => {
  test("one user's briefing never reflects another user's jobs/approvals/email", async () => {
    const userA = createTestUser("briefing-isolation-a");
    const userB = createTestUser("briefing-isolation-b");
    connectGmail(userA.id);
    createJob({ userId: userA.id, title: "A's job", company: "A Co", description: "d" });

    const briefingB = await generateDailyBriefing(userB.id);
    expect(briefingB.email.gmail.connected).toBe(false);
    expect(briefingB.jobs.totalSaved).toBe(0);
  });
});
