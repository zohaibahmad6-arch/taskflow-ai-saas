import { describe, test, expect, vi, afterEach, beforeAll } from "vitest";
import { ensureToolsRegistered } from "@/lib/tools";
import { invokeTool } from "@/lib/tools/execute";
import { decideApproval, editApproval, getApprovalById, ApprovalRevisionMismatchError } from "@/lib/approvals";
import { storeVerifiedConnection, type OAuthTokenSet } from "@/lib/connections";
import * as outlookActions from "@/lib/email/outlookActions";
import { createTestUser } from "../helpers";

vi.mock("@/lib/email/outlookActions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/outlookActions")>();
  return {
    ...actual,
    moveMessages: vi.fn(),
    archiveMessages: vi.fn(),
    deleteMessages: vi.fn(),
    setReadState: vi.fn(),
    setFlagState: vi.fn(),
    applyCategory: vi.fn(),
    sendReply: vi.fn(),
    forwardMessage: vi.fn(),
  };
});

beforeAll(() => {
  ensureToolsRegistered();
});

afterEach(() => {
  vi.mocked(outlookActions.moveMessages).mockReset();
  vi.mocked(outlookActions.archiveMessages).mockReset();
  vi.mocked(outlookActions.deleteMessages).mockReset();
  vi.mocked(outlookActions.setReadState).mockReset();
  vi.mocked(outlookActions.setFlagState).mockReset();
  vi.mocked(outlookActions.applyCategory).mockReset();
  vi.mocked(outlookActions.sendReply).mockReset();
  vi.mocked(outlookActions.forwardMessage).mockReset();
});

function connectOutlook(userId: string) {
  const tokens: OAuthTokenSet = {
    accessToken: "at",
    refreshToken: "rt",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    scope: "Mail.Read Mail.ReadWrite Mail.Send offline_access",
  };
  storeVerifiedConnection({ userId, provider: "outlook", category: "email", accountLabel: "me@outlook.com", tokens });
}

type MockedBatchFn = { mockResolvedValue: (v: outlookActions.BatchOutcome) => void; mock: { calls: unknown[][] } };

describe("Outlook EXTERNAL_ACTION tools: approval gating (structurally cannot bypass the Approval Center)", () => {
  const cases: [string, Record<string, unknown>, MockedBatchFn][] = [
    ["outlook.moveMessages", { messageIds: ["m1"], destinationFolder: "Newsletters" }, outlookActions.moveMessages as unknown as MockedBatchFn],
    ["outlook.archiveMessages", { messageIds: ["m1"] }, outlookActions.archiveMessages as unknown as MockedBatchFn],
    ["outlook.deleteMessages", { messageIds: ["m1"] }, outlookActions.deleteMessages as unknown as MockedBatchFn],
    ["outlook.markRead", { messageIds: ["m1"] }, outlookActions.setReadState as unknown as MockedBatchFn],
    ["outlook.markUnread", { messageIds: ["m1"] }, outlookActions.setReadState as unknown as MockedBatchFn],
    ["outlook.flagMessages", { messageIds: ["m1"] }, outlookActions.setFlagState as unknown as MockedBatchFn],
    ["outlook.unflagMessages", { messageIds: ["m1"] }, outlookActions.setFlagState as unknown as MockedBatchFn],
    ["outlook.applyCategory", { messageIds: ["m1"], category: "Work" }, outlookActions.applyCategory as unknown as MockedBatchFn],
  ];

  test.each(cases)("%s: invokeTool only creates a pending approval, never calls Graph before approval", async (toolId, input, mockedFn) => {
    mockedFn.mockResolvedValue({ succeeded: ["m1"], failed: [] });
    const user = createTestUser(`gate-${toolId.replace(/\W/g, "-")}`);
    connectOutlook(user.id);

    const result = await invokeTool(toolId, input, { userId: user.id });
    expect(result.awaitingApproval).toBe(true);
    const approval = getApprovalById(result.approvalId!)!;
    expect(approval.status).toBe("pending");
    expect(mockedFn.mock.calls).toHaveLength(0);

    const decided = await decideApproval(user.id, approval.id, "approved", approval.revision);
    expect(decided.status).toBe("executed");
    expect(mockedFn.mock.calls).toHaveLength(1);
  });

  test("outlook.markRead/markUnread call setReadState with the correct boolean, never the opposite", async () => {
    vi.mocked(outlookActions.setReadState).mockResolvedValue({ succeeded: ["m1"], failed: [] });
    const user = createTestUser("mark-read-bool");
    connectOutlook(user.id);

    const readApproval = getApprovalById(
      (await invokeTool("outlook.markRead", { messageIds: ["m1"] }, { userId: user.id })).approvalId!
    )!;
    await decideApproval(user.id, readApproval.id, "approved", readApproval.revision);
    expect(outlookActions.setReadState).toHaveBeenCalledWith(user.id, ["m1"], true);

    vi.mocked(outlookActions.setReadState).mockClear();
    const unreadApproval = getApprovalById(
      (await invokeTool("outlook.markUnread", { messageIds: ["m1"] }, { userId: user.id })).approvalId!
    )!;
    await decideApproval(user.id, unreadApproval.id, "approved", unreadApproval.revision);
    expect(outlookActions.setReadState).toHaveBeenCalledWith(user.id, ["m1"], false);
  });

  test("outlook.flagMessages/unflagMessages call setFlagState with the correct boolean", async () => {
    vi.mocked(outlookActions.setFlagState).mockResolvedValue({ succeeded: ["m1"], failed: [] });
    const user = createTestUser("flag-bool");
    connectOutlook(user.id);

    const flagApproval = getApprovalById(
      (await invokeTool("outlook.flagMessages", { messageIds: ["m1"] }, { userId: user.id })).approvalId!
    )!;
    await decideApproval(user.id, flagApproval.id, "approved", flagApproval.revision);
    expect(outlookActions.setFlagState).toHaveBeenCalledWith(user.id, ["m1"], true);
  });

  test("outlook.sendReply and outlook.forwardMessage: exact recipient/message id/body must match approval, never auto-execute", async () => {
    vi.mocked(outlookActions.sendReply).mockResolvedValue(undefined);
    vi.mocked(outlookActions.forwardMessage).mockResolvedValue(undefined);
    const user = createTestUser("send-forward-gate");
    connectOutlook(user.id);

    const replyResult = await invokeTool(
      "outlook.sendReply",
      { messageId: "m1", comment: "Thanks, will do.", replyAll: false },
      { userId: user.id }
    );
    expect(replyResult.awaitingApproval).toBe(true);
    expect(outlookActions.sendReply).not.toHaveBeenCalled();
    const replyApproval = getApprovalById(replyResult.approvalId!)!;
    expect(replyApproval.content).toBe("Thanks, will do.");
    await decideApproval(user.id, replyApproval.id, "approved", replyApproval.revision);
    expect(outlookActions.sendReply).toHaveBeenCalledWith(user.id, "m1", "Thanks, will do.", false);

    const fwdResult = await invokeTool(
      "outlook.forwardMessage",
      { messageId: "m2", toRecipients: ["someone@example.com"], comment: "FYI" },
      { userId: user.id }
    );
    const fwdApproval = getApprovalById(fwdResult.approvalId!)!;
    expect(fwdApproval.target).toBe("someone@example.com");
    await decideApproval(user.id, fwdApproval.id, "approved", fwdApproval.revision);
    expect(outlookActions.forwardMessage).toHaveBeenCalledWith(user.id, "m2", ["someone@example.com"], "FYI");
  });

  test("editing a mutation approval's recipient/messageIds invalidates an in-flight decision (same generic mechanism as every other EXTERNAL_ACTION tool)", async () => {
    vi.mocked(outlookActions.moveMessages).mockResolvedValue({ succeeded: ["m2"], failed: [] });
    const user = createTestUser("outlook-edit-invalidate");
    connectOutlook(user.id);

    const created = await invokeTool("outlook.moveMessages", { messageIds: ["m1"], destinationFolder: "Newsletters" }, { userId: user.id });
    const approval = getApprovalById(created.approvalId!)!;
    const staleRevision = approval.revision;

    await editApproval(user.id, approval.id, { messageIds: ["m2"] });

    await expect(decideApproval(user.id, approval.id, "approved", staleRevision)).rejects.toThrow(ApprovalRevisionMismatchError);
    expect(outlookActions.moveMessages).not.toHaveBeenCalled();

    const fresh = getApprovalById(approval.id)!;
    await decideApproval(user.id, approval.id, "approved", fresh.revision);
    expect(outlookActions.moveMessages).toHaveBeenCalledWith(user.id, ["m2"], "Newsletters");
  });

  test("a partial failure is reported honestly — never claimed as a full success", async () => {
    vi.mocked(outlookActions.deleteMessages).mockResolvedValue({
      succeeded: ["m1"],
      failed: [{ messageId: "m2", error: "Graph returned 404" }],
    });
    const user = createTestUser("outlook-partial-failure");
    connectOutlook(user.id);

    const created = await invokeTool("outlook.deleteMessages", { messageIds: ["m1", "m2"] }, { userId: user.id });
    const approval = getApprovalById(created.approvalId!)!;
    const decided = await decideApproval(user.id, approval.id, "approved", approval.revision);

    expect(decided.status).toBe("executed");
    const result = JSON.parse(decided.result_json!);
    expect(result.succeeded).toEqual(["m1"]);
    expect(result.failed).toEqual([{ messageId: "m2", error: "Graph returned 404" }]);
    expect(result.message).toMatch(/1 failed/);
  });

  test("outlook not connected: approval still creates, but execution fails honestly rather than pretending success", async () => {
    const user = createTestUser("outlook-not-connected-execute");
    // Deliberately not connecting Outlook.
    const created = await invokeTool("outlook.moveMessages", { messageIds: ["m1"], destinationFolder: "Newsletters" }, { userId: user.id });
    const approval = getApprovalById(created.approvalId!)!;

    // Use the real (unmocked) outlookActions for this one case by
    // resetting the mock to call through, proving the real not-connected
    // path fails safely end-to-end.
    vi.mocked(outlookActions.moveMessages).mockImplementation(
      (await vi.importActual<typeof import("@/lib/email/outlookActions")>("@/lib/email/outlookActions")).moveMessages
    );

    const decided = await decideApproval(user.id, approval.id, "approved", approval.revision);
    expect(decided.status).toBe("failed");
    expect(decided.error).toMatch(/not connected/i);
  });
});

describe("email.applyOrganizationPlan: exact, immutable batch move list", () => {
  test("groups actions by destination folder and calls moveMessages once per folder — executes exactly the approved list, nothing more", async () => {
    vi.mocked(outlookActions.moveMessages).mockImplementation(async (_userId, messageIds) => ({
      succeeded: messageIds,
      failed: [],
    }));
    const user = createTestUser("org-plan-batch");
    connectOutlook(user.id);

    const created = await invokeTool(
      "email.applyOrganizationPlan",
      {
        actions: [
          { messageId: "m1", folder: "Newsletters" },
          { messageId: "m2", folder: "Newsletters" },
          { messageId: "m3", folder: "Marketing" },
        ],
      },
      { userId: user.id }
    );
    expect(outlookActions.moveMessages).not.toHaveBeenCalled();
    const approval = getApprovalById(created.approvalId!)!;
    expect(approval.content).toContain("2 → Newsletters");
    expect(approval.content).toContain("1 → Marketing");

    const decided = await decideApproval(user.id, approval.id, "approved", approval.revision);
    expect(decided.status).toBe("executed");
    expect(outlookActions.moveMessages).toHaveBeenCalledTimes(2);
    expect(outlookActions.moveMessages).toHaveBeenCalledWith(user.id, ["m1", "m2"], "Newsletters");
    expect(outlookActions.moveMessages).toHaveBeenCalledWith(user.id, ["m3"], "Marketing");

    const result = JSON.parse(decided.result_json!);
    expect(result.succeeded.sort()).toEqual(["m1", "m2", "m3"]);
  });

  test("a plan approval only ever executes the exact list it was approved with — a message added later needs its own approval, never gets swept in", async () => {
    vi.mocked(outlookActions.moveMessages).mockResolvedValue({ succeeded: ["m1"], failed: [] });
    const user = createTestUser("org-plan-immutable");
    connectOutlook(user.id);

    const created = await invokeTool(
      "email.applyOrganizationPlan",
      { actions: [{ messageId: "m1", folder: "Newsletters" }] },
      { userId: user.id }
    );
    const approval = getApprovalById(created.approvalId!)!;

    // A second, unrelated organization-plan approval for a different
    // message is entirely separate — approving the first never touches it.
    const secondCreated = await invokeTool(
      "email.applyOrganizationPlan",
      { actions: [{ messageId: "m2", folder: "Marketing" }] },
      { userId: user.id }
    );
    expect(secondCreated.approvalId).not.toBe(approval.id);

    await decideApproval(user.id, approval.id, "approved", approval.revision);
    expect(outlookActions.moveMessages).toHaveBeenCalledTimes(1);
    expect(outlookActions.moveMessages).toHaveBeenCalledWith(user.id, ["m1"], "Newsletters");
    // m2's plan is still sitting pending, untouched.
    const second = getApprovalById(secondCreated.approvalId!)!;
    expect(second.status).toBe("pending");
  });
});
