import { describe, test, expect, vi, afterEach, beforeAll } from "vitest";
import { z } from "zod";
import { handleVoiceCommand, VoiceCommandError } from "@/lib/voice/command";
import { registerTool } from "@/lib/tools/registry";
import type { ToolDefinition } from "@/lib/tools/types";
import { invokeTool } from "@/lib/tools/execute";
import { getApprovalById, editApproval, decideApproval } from "@/lib/approvals";
import { getOpenAIClient } from "@/lib/openai";
import { db } from "@/lib/db";
import { createTestUser } from "../helpers";

vi.mock("@/lib/openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/openai")>();
  return { ...actual, getOpenAIClient: vi.fn() };
});

function mockChatReply(text: string) {
  vi.mocked(getOpenAIClient).mockReturnValue({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: text, tool_calls: undefined } }],
        }),
      },
    },
  } as unknown as ReturnType<typeof getOpenAIClient>);
}

afterEach(() => {
  vi.mocked(getOpenAIClient).mockReset();
});

const mockPayloadSchema = z.object({ recipient: z.string(), content: z.string() });
type MockPayload = z.infer<typeof mockPayloadSchema>;
const mockExecuteCalls: MockPayload[] = [];

beforeAll(() => {
  const tool: ToolDefinition<MockPayload, MockPayload> = {
    id: "test.voiceMockAction",
    name: "Mock voice-gated action",
    description: "test tool",
    category: "system",
    permissionLevel: "EXTERNAL_ACTION",
    inputSchema: mockPayloadSchema,
    approvalPayloadSchema: mockPayloadSchema,
    resolvePayload: async (input) => input,
    describePayload: async (payload) => ({
      action: "Mock voice action",
      target: payload.recipient,
      content: payload.content,
      consequence: "test consequence",
    }),
    execute: async (payload) => {
      mockExecuteCalls.push({ ...payload });
      return { output: { done: true } };
    },
  };
  registerTool(tool);
});

async function createPendingApproval(userId: string, recipient: string, content: string) {
  const result = await invokeTool("test.voiceMockAction", { recipient, content }, { userId });
  return getApprovalById(result.approvalId!)!;
}

describe("handleVoiceCommand: general commands route through the EXACT SAME chat/tool pipeline as typed input", () => {
  test("a non-confirmation utterance calls runChatTurn — same invokeTool path, same persisted conversation history", async () => {
    mockChatReply("Here is your summary.");
    const user = createTestUser("voice-general-command");

    const result = await handleVoiceCommand(user.id, { conversationId: "conv1", text: "Summarize my emails" });

    expect(result.type).toBe("chat");
    if (result.type === "chat") {
      expect(result.reply).toBe("Here is your summary.");
    }
    // Proves it really went through the real runChatTurn (which persists
    // to chat_messages), not some bypass.
    const rows = db.prepare("SELECT * FROM chat_messages WHERE user_id = ? AND conversation_id = ?").all(user.id, "conv1");
    expect(rows.length).toBeGreaterThan(0);
  });

  test("mundane conversational text containing 'yes' mid-sentence still goes to chat, never to an approval decision", async () => {
    mockChatReply("Got it.");
    const user = createTestUser("voice-embedded-yes");
    const result = await handleVoiceCommand(user.id, {
      conversationId: "conv1",
      text: "yes, I have 10 years of experience",
    });
    expect(result.type).toBe("chat");
  });
});

describe("handleVoiceCommand: voice approval confirmation — exact pending action only, never a bypass", () => {
  test("'yes' with a valid trackedApprovalId approves and executes exactly that action", async () => {
    const user = createTestUser("voice-approve-tracked");
    const approval = await createPendingApproval(user.id, "alice@example.com", "hello");

    const result = await handleVoiceCommand(user.id, {
      conversationId: "conv1",
      text: "yes",
      trackedApprovalId: approval.id,
    });

    expect(result.type).toBe("decided");
    if (result.type === "decided") {
      expect(result.decision).toBe("approved");
      expect(result.approval.status).toBe("executed");
    }
    expect(mockExecuteCalls).toEqual([{ recipient: "alice@example.com", content: "hello" }]);
  });

  test("'no' with a valid trackedApprovalId rejects — the tool never runs", async () => {
    const user = createTestUser("voice-reject-tracked");
    const approval = await createPendingApproval(user.id, "bob@example.com", "hello");
    mockExecuteCalls.length = 0;

    const result = await handleVoiceCommand(user.id, {
      conversationId: "conv1",
      text: "no",
      trackedApprovalId: approval.id,
    });

    expect(result.type).toBe("decided");
    if (result.type === "decided") expect(result.decision).toBe("rejected");
    expect(mockExecuteCalls).toEqual([]);
  });

  test("zero pending approvals: 'yes' decides nothing and says so", async () => {
    const user = createTestUser("voice-no-pending");
    const result = await handleVoiceCommand(user.id, { conversationId: "conv1", text: "approve" });
    expect(result.type).toBe("no_pending");
  });

  test("multiple pending approvals with no valid tracked hint: 'yes' must ask which one, never guess — a generic yes cannot approve multiple actions", async () => {
    const user = createTestUser("voice-ambiguous");
    await createPendingApproval(user.id, "one@example.com", "first");
    await createPendingApproval(user.id, "two@example.com", "second");
    mockExecuteCalls.length = 0;

    const result = await handleVoiceCommand(user.id, { conversationId: "conv1", text: "yes" });

    expect(result.type).toBe("ambiguous");
    if (result.type === "ambiguous") expect(result.pending).toHaveLength(2);
    expect(mockExecuteCalls).toEqual([]); // nothing executed while ambiguous
  });

  test("a trackedApprovalId belonging to ANOTHER user is never honored — falls through to the caller's own pending approvals", async () => {
    const userA = createTestUser("voice-cross-user-a");
    const userB = createTestUser("voice-cross-user-b");
    const approvalA = await createPendingApproval(userA.id, "victim@example.com", "should not be touched by B");

    // userB has no pending approvals of their own.
    const result = await handleVoiceCommand(userB.id, {
      conversationId: "conv1",
      text: "yes",
      trackedApprovalId: approvalA.id,
    });

    expect(result.type).toBe("no_pending"); // never resolved to userA's approval
    expect(getApprovalById(approvalA.id)!.status).toBe("pending"); // untouched
  });

  test("a trackedApprovalId that is no longer pending (already decided) is ignored, not blindly re-decided", async () => {
    const user = createTestUser("voice-already-decided-tracked");
    const approval = await createPendingApproval(user.id, "carol@example.com", "first");
    await decideApproval(user.id, approval.id, "approved", approval.revision);
    mockExecuteCalls.length = 0;

    const result = await handleVoiceCommand(user.id, {
      conversationId: "conv1",
      text: "yes",
      trackedApprovalId: approval.id, // stale — already executed
    });

    // No other pending approvals exist, so this correctly reports nothing pending.
    expect(result.type).toBe("no_pending");
    expect(mockExecuteCalls).toEqual([]); // did not re-execute
  });

  test("an expired approval cannot be voice-approved", async () => {
    const user = createTestUser("voice-expired");
    const approval = await createPendingApproval(user.id, "dave@example.com", "hi");
    db.prepare("UPDATE approvals SET expires_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), approval.id);

    await expect(
      handleVoiceCommand(user.id, { conversationId: "conv1", text: "yes", trackedApprovalId: approval.id })
    ).rejects.toThrow(VoiceCommandError);
    expect(getApprovalById(approval.id)!.status).toBe("expired");
  });

  test("the revision used to decide is always read fresh by the server — an edit made after the client last saw the approval is still respected, not overridden by stale client belief", async () => {
    const user = createTestUser("voice-fresh-revision");
    const approval = await createPendingApproval(user.id, "erin@example.com", "original");
    // Simulate an edit happening between when the client last saw this
    // approval and when it says "yes" — the voice endpoint never receives
    // or trusts a client-supplied revision at all, so this must still work.
    const edited = await editApproval(user.id, approval.id, { content: "edited content" });
    expect(edited.revision).toBe(approval.revision + 1);

    const result = await handleVoiceCommand(user.id, {
      conversationId: "conv1",
      text: "yes",
      trackedApprovalId: approval.id,
    });

    expect(result.type).toBe("decided");
    if (result.type === "decided") expect(result.approval.status).toBe("executed");
    expect(mockExecuteCalls.at(-1)).toEqual({ recipient: "erin@example.com", content: "edited content" }); // the EDITED payload, not the original
  });

  test("rejecting via voice never calls the tool's execute()", async () => {
    const user = createTestUser("voice-reject-never-executes");
    const approval = await createPendingApproval(user.id, "frank@example.com", "hi");
    mockExecuteCalls.length = 0;
    await handleVoiceCommand(user.id, { conversationId: "conv1", text: "cancel", trackedApprovalId: approval.id });
    expect(mockExecuteCalls).toEqual([]);
    expect(getApprovalById(approval.id)!.status).toBe("rejected");
  });
});
