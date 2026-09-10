import { describe, test, expect } from "vitest";
import { db, newId } from "@/lib/db";
// Deliberately NOT importing @/lib/tools or @/lib/tools/execute anywhere
// in this file — the whole point is to prove that resolving and running a
// real tool during approval decide/execute does not depend on some
// earlier code path (a page render, another route) having already called
// ensureToolsRegistered(). approvals.ts must do that defensively itself.
import { decideApproval, getApprovalById } from "@/lib/approvals";
import { createTestUser } from "../helpers";

describe("defensive tool registration", () => {
  test("deciding an approval works even if nothing registered tools first", async () => {
    const user = createTestUser("defensive-registration");

    // Simulate an approval that already exists in the DB — e.g. created
    // by an earlier request to a different, now-cold server instance —
    // rather than going through invokeTool() in this same test run.
    const approvalId = newId("appr");
    const actionId = newId("action");
    db.prepare(
      `INSERT INTO approvals (id, action_id, user_id, tool_id, action, target, content, consequence, payload_json, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      approvalId,
      actionId,
      user.id,
      "email.send",
      "Send email",
      "someone@example.com",
      "Subject: Hi\n\nHello",
      "This will send an email.",
      JSON.stringify({ to: "someone@example.com", subject: "Hi", body: "Hello" }),
      new Date(Date.now() + 3600_000).toISOString()
    );

    const before = getApprovalById(approvalId)!;

    // No ensureToolsRegistered() call anywhere above this line. If
    // decideApproval/executeApproval didn't defensively register tools,
    // getTool("email.send") would come back undefined and this would
    // fail with a generic "not a valid executable EXTERNAL_ACTION tool"
    // error instead of reaching the tool's own real logic.
    const decided = await decideApproval(user.id, approvalId, "approved", before.revision);

    expect(decided.status).toBe("failed");
    // This specific message only comes from inside email.send's own
    // execute() — proof the real tool was found and actually ran, not
    // that it was missing from the registry.
    expect(decided.error).toMatch(/No email account is connected/);
  });
});
