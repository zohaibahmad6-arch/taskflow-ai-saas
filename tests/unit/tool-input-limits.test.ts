import { describe, test, expect, beforeAll } from "vitest";
import { ensureToolsRegistered } from "@/lib/tools";
import { invokeTool, ToolInputError } from "@/lib/tools/execute";
import { createTestUser } from "../helpers";

const big = (n: number) => "x".repeat(n);

beforeAll(() => {
  ensureToolsRegistered();
});

describe("tool input limits are enforced by the tool-calling path itself, not just routes", () => {
  test("oversized email 'to' address is rejected", async () => {
    const user = createTestUser("limit-to");
    await expect(
      invokeTool(
        "email.send",
        { to: `${big(310)}@example.com`, subject: "hi", body: "hi" },
        { userId: user.id }
      )
    ).rejects.toThrow(ToolInputError);
  });

  test("malformed email 'to' address is rejected", async () => {
    const user = createTestUser("limit-to-format");
    await expect(
      invokeTool("email.send", { to: "not-an-email", subject: "hi", body: "hi" }, { userId: user.id })
    ).rejects.toThrow(ToolInputError);
  });

  test("oversized subject is rejected", async () => {
    const user = createTestUser("limit-subject");
    await expect(
      invokeTool(
        "email.send",
        { to: "a@example.com", subject: big(501), body: "hi" },
        { userId: user.id }
      )
    ).rejects.toThrow(ToolInputError);
  });

  test("oversized body is rejected", async () => {
    const user = createTestUser("limit-body");
    await expect(
      invokeTool(
        "email.send",
        { to: "a@example.com", subject: "hi", body: big(20_001) },
        { userId: user.id }
      )
    ).rejects.toThrow(ToolInputError);
  });

  test("a body within the limit passes schema validation (still fails safely at execute — no provider connected)", async () => {
    const user = createTestUser("limit-body-ok");
    const result = await invokeTool(
      "email.send",
      { to: "a@example.com", subject: "hi", body: big(19_999) },
      { userId: user.id }
    );
    expect(result.awaitingApproval).toBe(true);
  });

  test("oversized draft-reply email text is rejected", async () => {
    const user = createTestUser("limit-original-email");
    await expect(
      invokeTool("email.draftReply", { originalEmail: big(20_001) }, { userId: user.id })
    ).rejects.toThrow(ToolInputError);
  });

  test("oversized draft-reply instructions are rejected", async () => {
    const user = createTestUser("limit-instructions");
    await expect(
      invokeTool(
        "email.draftReply",
        { originalEmail: "hi", instructions: big(2_001) },
        { userId: user.id }
      )
    ).rejects.toThrow(ToolInputError);
  });

  test("oversized email search query is rejected", async () => {
    const user = createTestUser("limit-query");
    await expect(
      invokeTool("email.search", { query: big(301) }, { userId: user.id })
    ).rejects.toThrow(ToolInputError);
  });

  test("oversized social post topic is rejected", async () => {
    const user = createTestUser("limit-topic");
    await expect(
      invokeTool(
        "social.createPost",
        { platform: "linkedin", topic: big(2_001) },
        { userId: user.id }
      )
    ).rejects.toThrow(ToolInputError);
  });

  test("oversized social post notes are rejected", async () => {
    const user = createTestUser("limit-notes");
    await expect(
      invokeTool(
        "social.createPost",
        { platform: "linkedin", topic: "ok", notes: big(2_001) },
        { userId: user.id }
      )
    ).rejects.toThrow(ToolInputError);
  });

  test("invalid platform enum ('array' shaped input) is rejected", async () => {
    const user = createTestUser("limit-platform-array");
    await expect(
      invokeTool(
        "social.createPost",
        { platform: ["linkedin", "x"], topic: "ok" },
        { userId: user.id }
      )
    ).rejects.toThrow(ToolInputError);
  });

  test("unsupported platform value is rejected", async () => {
    const user = createTestUser("limit-platform-bad");
    await expect(
      invokeTool("social.createPost", { platform: "myspace", topic: "ok" }, { userId: user.id })
    ).rejects.toThrow(ToolInputError);
  });

  test("oversized rewrite content is rejected", async () => {
    const user = createTestUser("limit-rewrite-content");
    await expect(
      invokeTool(
        "social.rewritePost",
        { content: big(10_001), platform: "x", instruction: "shorten" },
        { userId: user.id }
      )
    ).rejects.toThrow(ToolInputError);
  });

  test("oversized draftId is rejected", async () => {
    const user = createTestUser("limit-draftid");
    await expect(
      invokeTool("social.publishPost", { draftId: big(101) }, { userId: user.id })
    ).rejects.toThrow(ToolInputError);
  });

  test("oversized capability proposal request is rejected", async () => {
    const user = createTestUser("limit-capability");
    await expect(
      invokeTool("system.proposeCapability", { request: big(4_001) }, { userId: user.id })
    ).rejects.toThrow(ToolInputError);
  });

  test("an approval payload edit enforces the same bounds as tool creation", async () => {
    const { editApproval, ApprovalStateError } = await import("@/lib/approvals");
    const user = createTestUser("limit-edit");
    const result = await invokeTool(
      "email.send",
      { to: "a@example.com", subject: "hi", body: "hi" },
      { userId: user.id }
    );
    await expect(
      editApproval(user.id, result.approvalId!, { subject: big(501) })
    ).rejects.toThrow(ApprovalStateError);
  });
});
