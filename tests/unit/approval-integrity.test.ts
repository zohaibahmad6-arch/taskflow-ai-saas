import { describe, test, expect, beforeAll, beforeEach } from "vitest";
import { z } from "zod";
import { registerTool } from "@/lib/tools/registry";
import type { ToolDefinition } from "@/lib/tools/types";
import { invokeTool } from "@/lib/tools/execute";
import {
  editApproval,
  decideApproval,
  executeApproval,
  getApprovalById,
  ApprovalRevisionMismatchError,
  ApprovalStateError,
} from "@/lib/approvals";
import { createTestUser } from "../helpers";

// A test-only EXTERNAL_ACTION tool with a mocked "provider" — proves the
// approval integrity guarantees without touching any real email/social
// integration (none exist yet, and this task explicitly must not add any).
const mockPayloadSchema = z.object({
  recipient: z.string().min(1).max(200),
  content: z.string().min(1).max(2000),
});

type MockPayload = z.infer<typeof mockPayloadSchema>;

export const mockProviderCalls: MockPayload[] = [];

beforeAll(() => {
  const tool: ToolDefinition<MockPayload, MockPayload> = {
    id: "test.mockAction",
    name: "Mock External Action",
    description: "Test-only external action with a mocked provider.",
    category: "system",
    permissionLevel: "EXTERNAL_ACTION",
    inputSchema: mockPayloadSchema,
    approvalPayloadSchema: mockPayloadSchema,
    resolvePayload: async (input) => input,
    describePayload: async (payload) => ({
      action: "Mock send",
      target: payload.recipient,
      content: payload.content,
      consequence: `This will send to ${payload.recipient}. This cannot be undone.`,
    }),
    execute: async (payload) => {
      mockProviderCalls.push({ ...payload });
      return { output: { sent: true, recipient: payload.recipient } };
    },
  };
  registerTool(tool);
});

beforeEach(() => {
  mockProviderCalls.length = 0;
});

async function createPendingApproval(userId: string, recipient: string, content: string) {
  const result = await invokeTool("test.mockAction", { recipient, content }, { userId });
  const approvalId = result.approvalId!;
  return getApprovalById(approvalId)!;
}

describe("Approval Center edit integrity", () => {
  test("A. create -> approve -> execute original payload successfully", async () => {
    const user = createTestUser("approve-original");
    const approval = await createPendingApproval(user.id, "alice@example.com", "hello alice");

    const decided = await decideApproval(user.id, approval.id, "approved", approval.revision);

    expect(decided.status).toBe("executed");
    expect(mockProviderCalls).toEqual([{ recipient: "alice@example.com", content: "hello alice" }]);
  });

  test("B. create -> edit -> approve -> execution uses the edited payload", async () => {
    const user = createTestUser("approve-edited");
    const approval = await createPendingApproval(user.id, "bob@example.com", "original text");

    const edited = await editApproval(user.id, approval.id, { content: "edited text" });
    expect(edited.revision).toBe(approval.revision + 1);
    expect(JSON.parse(edited.payload_json)).toEqual({
      recipient: "bob@example.com",
      content: "edited text",
    });

    const decided = await decideApproval(user.id, approval.id, "approved", edited.revision);

    expect(decided.status).toBe("executed");
    // The provider must have received the EDITED content, never the original.
    expect(mockProviderCalls).toEqual([{ recipient: "bob@example.com", content: "edited text" }]);
  });

  test("C. edit after approval cannot silently change the executed payload", async () => {
    const user = createTestUser("edit-after-approve");
    const approval = await createPendingApproval(user.id, "carol@example.com", "first version");

    const decided = await decideApproval(user.id, approval.id, "approved", approval.revision);
    expect(decided.status).toBe("executed");
    expect(mockProviderCalls).toEqual([{ recipient: "carol@example.com", content: "first version" }]);

    // Attempting to edit a non-pending approval must be rejected outright.
    await expect(
      editApproval(user.id, approval.id, { content: "sneaky post-hoc change" })
    ).rejects.toThrow(ApprovalStateError);

    // The stored payload and the audit trail of what executed are unchanged.
    const after = getApprovalById(approval.id)!;
    expect(JSON.parse(after.payload_json)).toEqual({
      recipient: "carol@example.com",
      content: "first version",
    });
    expect(mockProviderCalls).toHaveLength(1);
  });

  test("D. changing the recipient invalidates an in-flight approval decision", async () => {
    const user = createTestUser("invalidate-recipient");
    const approval = await createPendingApproval(user.id, "dave@example.com", "some content");
    const staleRevision = approval.revision;

    await editApproval(user.id, approval.id, { recipient: "someone-else@example.com" });

    // A decision formed against the pre-edit revision must be refused —
    // it cannot silently execute against the new recipient it never saw.
    await expect(
      decideApproval(user.id, approval.id, "approved", staleRevision)
    ).rejects.toThrow(ApprovalRevisionMismatchError);
    expect(mockProviderCalls).toHaveLength(0);

    // Deciding again with the current (post-edit) revision works, and
    // executes against the NEW recipient.
    const fresh = getApprovalById(approval.id)!;
    const decided = await decideApproval(user.id, approval.id, "approved", fresh.revision);
    expect(decided.status).toBe("executed");
    expect(mockProviderCalls).toEqual([
      { recipient: "someone-else@example.com", content: "some content" },
    ]);
  });

  test("E. changing content invalidates an in-flight approval decision", async () => {
    const user = createTestUser("invalidate-content");
    const approval = await createPendingApproval(user.id, "erin@example.com", "draft one");
    const staleRevision = approval.revision;

    await editApproval(user.id, approval.id, { content: "draft two" });

    await expect(
      decideApproval(user.id, approval.id, "approved", staleRevision)
    ).rejects.toThrow(ApprovalRevisionMismatchError);
    expect(mockProviderCalls).toHaveLength(0);

    const fresh = getApprovalById(approval.id)!;
    const decided = await decideApproval(user.id, approval.id, "approved", fresh.revision);
    expect(decided.status).toBe("executed");
    expect(mockProviderCalls).toEqual([{ recipient: "erin@example.com", content: "draft two" }]);
  });

  test("F. replaying an approval cannot execute it twice", async () => {
    const user = createTestUser("no-double-execute");
    const approval = await createPendingApproval(user.id, "frank@example.com", "only once");

    await decideApproval(user.id, approval.id, "approved", approval.revision);
    expect(mockProviderCalls).toHaveLength(1);

    // Replaying execution directly (e.g. a duplicate/retried request)
    // must be a no-op, not a second send.
    const replayed = await executeApproval(user.id, approval.id);
    expect(replayed.status).toBe("executed");
    expect(mockProviderCalls).toHaveLength(1);

    const replayedAgain = await executeApproval(user.id, approval.id);
    expect(replayedAgain.status).toBe("executed");
    expect(mockProviderCalls).toHaveLength(1);
  });

  test("rejecting an approval never calls the provider", async () => {
    const user = createTestUser("reject-flow");
    const approval = await createPendingApproval(user.id, "grace@example.com", "should not send");

    const decided = await decideApproval(user.id, approval.id, "rejected", approval.revision);
    expect(decided.status).toBe("rejected");
    expect(mockProviderCalls).toHaveLength(0);
  });
});
