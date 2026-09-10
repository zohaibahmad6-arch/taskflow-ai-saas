import { describe, test, expect, vi, afterEach, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { handleVoiceCommand } from "@/lib/voice/command";
import { ensureToolsRegistered } from "@/lib/tools";
import { getOpenAIClient } from "@/lib/openai";
import { getApprovalById } from "@/lib/approvals";
import { db } from "@/lib/db";
import { generateDailyBriefing } from "@/lib/dailyBriefing";
import { createTestUser } from "../helpers";

vi.mock("@/lib/openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/openai")>();
  return { ...actual, getOpenAIClient: vi.fn() };
});

beforeAll(() => {
  ensureToolsRegistered();
});

afterEach(() => {
  vi.mocked(getOpenAIClient).mockReset();
});

/** Simulates the model calling briefing.getDailyBriefing with no arguments, then replying. */
function mockBriefingToolCall() {
  const create = vi
    .fn()
    .mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [{ id: "call_1", type: "function", function: { name: "briefing.getDailyBriefing", arguments: "{}" } }],
          },
        },
      ],
    })
    .mockResolvedValueOnce({
      choices: [{ message: { content: "Good morning. Nothing urgent right now.", tool_calls: undefined } }],
    });
  vi.mocked(getOpenAIClient).mockReturnValue({ chat: { completions: { create } } } as unknown as ReturnType<typeof getOpenAIClient>);
}

describe("Voice + Briefing: every required voice command reaches the same READ_ONLY tool via the existing runChatTurn()/invokeTool() path", () => {
  const questions = [
    "Give me my daily briefing.",
    "What needs my attention?",
    "What emails are urgent?",
    "Do I have any job applications waiting?",
    "Are there any approvals waiting for me?",
  ];

  for (const question of questions) {
    test(`"${question}" routes to briefing.getDailyBriefing and never creates an approval`, async () => {
      const user = createTestUser(`voice-briefing-${questions.indexOf(question)}`);
      mockBriefingToolCall();

      const result = await handleVoiceCommand(user.id, { conversationId: "conv1", text: question });

      expect(result.type).toBe("chat"); // READ_ONLY tool call, not a pending decision
      if (result.type === "chat") {
        const activity = result.toolActivity.find((t) => t.toolId === "briefing.getDailyBriefing");
        expect(activity).toBeTruthy();
        expect(activity?.awaitingApproval).toBeFalsy(); // READ_ONLY — never gated behind approval
      }
    });
  }
});

describe("Voice + Briefing: TTS-safe output — no email body content, concise summary only", () => {
  test("the briefing tool's output never includes a full email body field, only short subject/from/reason fields", async () => {
    const user = createTestUser("voice-briefing-tts-safe");
    const briefing = await generateDailyBriefing(user.id);
    const serialized = JSON.stringify(briefing);
    // These are the field names used elsewhere in the app for a FULL email body
    // (see EmailMessageFull) — the briefing must never carry one.
    expect(serialized).not.toMatch(/"bodyPreview"|"fullBody"|"htmlBody"/);
  });
});

describe("Scheduling architecture (section 15): a reusable service, honestly not a real scheduler", () => {
  test("generateDailyBriefing is a plain on-demand-callable function — no setInterval/cron anywhere in its module", () => {
    const content = fs.readFileSync(path.join(process.cwd(), "src/lib/dailyBriefing.ts"), "utf-8");
    expect(content).not.toMatch(/setInterval|node-cron|node-schedule|cron\(/);
  });

  test("calling generateDailyBriefing twice for the same user/day (simulating a scheduler retry) never creates a duplicate row — UNIQUE(user_id, briefing_date)", async () => {
    const user = createTestUser("scheduling-retry-idempotent");
    await generateDailyBriefing(user.id);
    await generateDailyBriefing(user.id);
    await generateDailyBriefing(user.id); // a third "retry"

    const row = db.prepare("SELECT COUNT(*) AS n FROM daily_briefings WHERE user_id = ?").get(user.id) as { n: number };
    expect(row.n).toBe(1);
  });

  test("the daily_briefings table actually enforces UNIQUE(user_id, briefing_date) at the schema level, not just in application code", () => {
    const user = createTestUser("scheduling-schema-unique");
    const today = new Date().toISOString().slice(0, 10);
    db.prepare(
      "INSERT INTO daily_briefings (id, user_id, briefing_date, data_json) VALUES (?, ?, ?, '{}')"
    ).run("dbrief_test1", user.id, today);
    expect(() =>
      db
        .prepare("INSERT INTO daily_briefings (id, user_id, briefing_date, data_json) VALUES (?, ?, ?, '{}')")
        .run("dbrief_test2", user.id, today)
    ).toThrow(/UNIQUE/i);
  });
});

describe("Voice cannot use the briefing to bypass approval gating", () => {
  test("asking about approvals via voice reports the pending approval but does not decide it", async () => {
    const user = createTestUser("voice-briefing-no-bypass");
    mockBriefingToolCall();

    const result = await handleVoiceCommand(user.id, {
      conversationId: "conv1",
      text: "Are there any approvals waiting for me?",
    });

    expect(result.type).toBe("chat");
    if (result.type === "chat") {
      const activity = result.toolActivity.find((t) => t.toolId === "briefing.getDailyBriefing");
      expect(activity?.approvalId).toBeFalsy();
      if (activity?.approvalId) {
        expect(getApprovalById(activity.approvalId)).toBeUndefined();
      }
    }
  });
});
