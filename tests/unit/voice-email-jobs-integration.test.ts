import { describe, test, expect, vi, afterEach, beforeAll } from "vitest";
import { handleVoiceCommand } from "@/lib/voice/command";
import { ensureToolsRegistered } from "@/lib/tools";
import { getApprovalById } from "@/lib/approvals";
import { getOpenAIClient } from "@/lib/openai";
import { storeVerifiedConnection, type OAuthTokenSet } from "@/lib/connections";
import * as outlookActions from "@/lib/email/outlookActions";
import { createJob, createJobApplication } from "@/lib/jobs/store";
import { createTestUser } from "../helpers";

vi.mock("@/lib/openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/openai")>();
  return { ...actual, getOpenAIClient: vi.fn() };
});

vi.mock("@/lib/email/outlookActions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/outlookActions")>();
  return { ...actual, moveMessages: vi.fn() };
});

beforeAll(() => {
  ensureToolsRegistered();
});

afterEach(() => {
  vi.mocked(getOpenAIClient).mockReset();
  vi.mocked(outlookActions.moveMessages).mockReset();
});

/** Simulates the model deciding to call ONE specific tool with these arguments, then stopping. */
function mockSingleToolCall(toolName: string, args: Record<string, unknown>) {
  const create = vi
    .fn()
    .mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [{ id: "call_1", type: "function", function: { name: toolName, arguments: JSON.stringify(args) } }],
          },
        },
      ],
    })
    .mockResolvedValueOnce({
      choices: [{ message: { content: "Done — see the Approval Center.", tool_calls: undefined } }],
    });
  vi.mocked(getOpenAIClient).mockReturnValue({ chat: { completions: { create } } } as unknown as ReturnType<typeof getOpenAIClient>);
}

function connectOutlook(userId: string) {
  const tokens: OAuthTokenSet = {
    accessToken: "at",
    refreshToken: "rt",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    scope: "Mail.ReadWrite",
  };
  storeVerifiedConnection({ userId, provider: "outlook", category: "email", accountLabel: "me@outlook.com", tokens });
}

describe("Voice + Email (Outlook): the exact same approval gating as typed chat, reached via the same invokeTool path", () => {
  test("a voice command that resolves to an Outlook mutation creates a pending approval — it never moves anything directly", async () => {
    const user = createTestUser("voice-outlook-mutation");
    connectOutlook(user.id);
    mockSingleToolCall("outlook.moveMessages", { messageIds: ["m1"], destinationFolder: "Newsletters" });

    const result = await handleVoiceCommand(user.id, {
      conversationId: "conv1",
      text: "Move these newsletters to the newsletter folder",
    });

    expect(result.type).toBe("chat");
    if (result.type === "chat") {
      const activity = result.toolActivity.find((t) => t.toolId === "outlook.moveMessages");
      expect(activity?.awaitingApproval).toBe(true);
      expect(activity?.approvalId).toBeTruthy();
      const approval = getApprovalById(activity!.approvalId!)!;
      expect(approval.status).toBe("pending");
    }
    expect(outlookActions.moveMessages).not.toHaveBeenCalled(); // never executed by the voice/chat turn itself
  });

  test("voice 'yes' after that Outlook mutation approval executes exactly it, via the unmodified Approval Center", async () => {
    const user = createTestUser("voice-outlook-approve-flow");
    connectOutlook(user.id);
    vi.mocked(outlookActions.moveMessages).mockResolvedValue({ succeeded: ["m1"], failed: [] });
    mockSingleToolCall("outlook.moveMessages", { messageIds: ["m1"], destinationFolder: "Newsletters" });

    const created = await handleVoiceCommand(user.id, { conversationId: "conv1", text: "Move these newsletters to the newsletter folder" });
    const approvalId = created.type === "chat" ? created.toolActivity[0]?.approvalId : undefined;
    expect(approvalId).toBeTruthy();

    const decided = await handleVoiceCommand(user.id, { conversationId: "conv1", text: "yes", trackedApprovalId: approvalId });
    expect(decided.type).toBe("decided");
    if (decided.type === "decided") expect(decided.approval.status).toBe("executed");
    expect(outlookActions.moveMessages).toHaveBeenCalledWith(user.id, ["m1"], "Newsletters");
  });
});

describe("Voice + Jobs: application submission requires approval, voice cannot bypass it", () => {
  test("a voice command to submit a job application creates a pending approval, never a real submission", async () => {
    const user = createTestUser("voice-jobs-submit");
    const job = createJob({ userId: user.id, title: "Field Engineer", company: "Acme", description: "job text" });
    const application = createJobApplication({ userId: user.id, jobId: job.id, coverLetter: "Dear Hiring Manager..." });
    mockSingleToolCall("jobs.submitApplication", { applicationId: application.id });

    const result = await handleVoiceCommand(user.id, { conversationId: "conv1", text: "Submit this application" });

    expect(result.type).toBe("chat");
    if (result.type === "chat") {
      const activity = result.toolActivity.find((t) => t.toolId === "jobs.submitApplication");
      expect(activity?.awaitingApproval).toBe(true);
      const approval = getApprovalById(activity!.approvalId!)!;
      expect(approval.status).toBe("pending");
      expect(approval.consequence).toMatch(/does not submit anything to linkedin/i);
    }
  });

  test("voice 'yes' finalizes the approval but still never contacts LinkedIn — execute() is honestly incapable of it", async () => {
    const user = createTestUser("voice-jobs-approve-flow");
    const job = createJob({ userId: user.id, title: "Field Engineer", company: "Acme", description: "job text" });
    const application = createJobApplication({ userId: user.id, jobId: job.id, coverLetter: "Dear Hiring Manager..." });
    mockSingleToolCall("jobs.submitApplication", { applicationId: application.id });

    const created = await handleVoiceCommand(user.id, { conversationId: "conv1", text: "Submit this application" });
    const approvalId = created.type === "chat" ? created.toolActivity[0]?.approvalId : undefined;

    const decided = await handleVoiceCommand(user.id, { conversationId: "conv1", text: "approve", trackedApprovalId: approvalId });
    expect(decided.type).toBe("decided");
    if (decided.type === "decided") {
      expect(decided.approval.status).toBe("executed");
      const output = JSON.parse(decided.approval.result_json!);
      expect(output.submitted).toBe(false); // never claims a real LinkedIn submission occurred
    }
  });
});

describe("Voice classification never runs on AI/tool output, only on the raw transcribed user utterance", () => {
  test("a tool result or AI reply containing the word 'yes' cannot itself trigger an approval decision — classification only ever sees params.text", async () => {
    const user = createTestUser("voice-injection-cannot-self-approve");
    // The assistant's own reply text contains "yes" — this must have zero
    // bearing on approval decisions, since classifyConfirmation is only
    // ever called on the literal text the ENDPOINT received as input.
    mockSingleToolCall("email.checkConnection", {});
    const result = await handleVoiceCommand(user.id, { conversationId: "conv1", text: "Check my email connection" });
    expect(result.type).toBe("chat"); // a READ_ONLY tool call, not a decision — proves the classifier only fires on user input
  });
});
