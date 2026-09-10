import { describe, test, expect, beforeAll } from "vitest";
import { invokeTool } from "@/lib/tools/execute";
import { ensureToolsRegistered } from "@/lib/tools";
import { createSocialDraft } from "@/lib/socialDrafts";
import { getApprovalById } from "@/lib/approvals";
import { createTestUser } from "../helpers";

beforeAll(() => {
  ensureToolsRegistered();
});

/**
 * Regression test for a real cross-user IDOR found during the production
 * readiness audit: social.publishPost's resolvePayload fetched a draft by
 * id alone, with no ownership check — reachable directly from chat/voice
 * (not only from the already-scoped PATCH /api/social/drafts/[id] route),
 * so a caller who supplied another user's draftId would have that user's
 * private draft content pulled into their OWN pending approval.
 */
describe("social.publishPost: cannot read or publish another user's draft (IDOR fix)", () => {
  test("resolvePayload rejects a draftId belonging to a different user", async () => {
    const victim = createTestUser("social-idor-victim");
    const attacker = createTestUser("social-idor-attacker");
    const victimDraft = createSocialDraft({
      userId: victim.id,
      platform: "linkedin",
      content: "Victim's private, unpublished draft content.",
    });

    await expect(
      invokeTool("social.publishPost", { draftId: victimDraft.id }, { userId: attacker.id })
    ).rejects.toThrow(/not found/i);
  });

  test("no approval is created for the attacker when the draftId belongs to another user", async () => {
    const victim = createTestUser("social-idor-victim2");
    const attacker = createTestUser("social-idor-attacker2");
    const victimDraft = createSocialDraft({
      userId: victim.id,
      platform: "x",
      content: "Another private draft.",
    });

    let approvalId: string | undefined;
    try {
      const result = await invokeTool("social.publishPost", { draftId: victimDraft.id }, { userId: attacker.id });
      approvalId = result.approvalId;
    } catch {
      // expected
    }
    expect(approvalId).toBeUndefined();
  });

  test("the actual owner can still successfully prepare a publish approval for their own draft", async () => {
    const user = createTestUser("social-owner-publish");
    const draft = createSocialDraft({ userId: user.id, platform: "linkedin", content: "My own real draft." });

    const result = await invokeTool("social.publishPost", { draftId: draft.id }, { userId: user.id });
    expect(result.awaitingApproval).toBe(true);
    expect(result.approvalId).toBeTruthy();
    const approval = getApprovalById(result.approvalId!)!;
    expect(approval.user_id).toBe(user.id);
    expect(approval.status).toBe("pending");
    expect(approval.content).toBe("My own real draft.");
  });

  test("a nonexistent draftId fails the same honest way (never fabricates a draft)", async () => {
    const user = createTestUser("social-nonexistent-draft");
    await expect(
      invokeTool("social.publishPost", { draftId: "draft_does_not_exist" }, { userId: user.id })
    ).rejects.toThrow(/not found/i);
  });
});
