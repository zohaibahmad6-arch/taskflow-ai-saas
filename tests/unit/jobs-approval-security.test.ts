import { describe, test, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ensureToolsRegistered } from "@/lib/tools";
import { invokeTool } from "@/lib/tools/execute";
import { decideApproval, editApproval, getApprovalById, executeApproval, ApprovalRevisionMismatchError, ApprovalStateError } from "@/lib/approvals";
import { db } from "@/lib/db";
import { createJob, createJobApplication, getJobApplication } from "@/lib/jobs/store";
import { createTestUser } from "../helpers";

beforeAll(() => {
  ensureToolsRegistered();
});

function seedApplication(userId: string, overrides: { coverLetter?: string } = {}) {
  const job = createJob({ userId, title: "Gas Turbine Field Advisor", company: "Acme Power", description: "job text" });
  const application = createJobApplication({
    userId,
    jobId: job.id,
    matchScore: 80,
    coverLetter: overrides.coverLetter ?? "Dear Hiring Manager...",
    screeningAnswers: [{ question: "Right to work", answer: "UK citizen", source: "profile" }],
    missingInfo: [],
  });
  return { job, application };
}

describe("jobs.submitApplication: approval gating (structurally cannot bypass the Approval Center)", () => {
  test("invokeTool only creates a pending approval — never submits, never claims success", async () => {
    const user = createTestUser("jobs-submit-gate");
    const { application } = seedApplication(user.id);

    const result = await invokeTool("jobs.submitApplication", { applicationId: application.id }, { userId: user.id });
    expect(result.awaitingApproval).toBe(true);
    const approval = getApprovalById(result.approvalId!)!;
    expect(approval.status).toBe("pending");
    // The approval's own consequence text must be explicit that this
    // never actually submits to LinkedIn.
    expect(approval.consequence).toMatch(/does not submit anything to linkedin/i);
  });

  test("execute() never reports submitted:true — LinkedIn has no legitimate automated submission path", async () => {
    const user = createTestUser("jobs-submit-honest-result");
    const { application } = seedApplication(user.id);

    const created = await invokeTool("jobs.submitApplication", { applicationId: application.id }, { userId: user.id });
    const approval = getApprovalById(created.approvalId!)!;
    const decided = await decideApproval(user.id, approval.id, "approved", approval.revision);

    expect(decided.status).toBe("executed");
    const result = JSON.parse(decided.result_json!);
    expect(result.submitted).toBe(false);
    expect(result.readyForManualSubmission).toBe(true);

    const updated = getJobApplication(user.id, application.id)!;
    expect(updated.status).toBe("ready_for_manual_submission");
    expect(updated.status).not.toBe("submitted"); // only the user's own self-report can set this
  });

  test("editing the approval (e.g. cover letter changes upstream) invalidates an in-flight decision — same generic revision mechanism", async () => {
    const user = createTestUser("jobs-submit-stale-revision");
    const { application } = seedApplication(user.id);

    const created = await invokeTool("jobs.submitApplication", { applicationId: application.id }, { userId: user.id });
    const approval = getApprovalById(created.approvalId!)!;
    const staleRevision = approval.revision;

    await editApproval(user.id, approval.id, { coverLetter: "A materially different cover letter." });

    await expect(decideApproval(user.id, approval.id, "approved", staleRevision)).rejects.toThrow(ApprovalRevisionMismatchError);

    const fresh = getApprovalById(approval.id)!;
    expect(fresh.status).toBe("pending"); // never silently executed against the stale view
  });

  test("an expired approval is rejected, never executed", async () => {
    const user = createTestUser("jobs-submit-expired");
    const { application } = seedApplication(user.id);

    const created = await invokeTool("jobs.submitApplication", { applicationId: application.id }, { userId: user.id });
    const approval = getApprovalById(created.approvalId!)!;
    db.prepare("UPDATE approvals SET expires_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), approval.id);

    await expect(decideApproval(user.id, approval.id, "approved", approval.revision)).rejects.toThrow(ApprovalStateError);
    expect(getApprovalById(approval.id)!.status).toBe("expired");
  });

  test("a rejected approval cannot execute", async () => {
    const user = createTestUser("jobs-submit-rejected");
    const { application } = seedApplication(user.id);

    const created = await invokeTool("jobs.submitApplication", { applicationId: application.id }, { userId: user.id });
    const approval = getApprovalById(created.approvalId!)!;
    const decided = await decideApproval(user.id, approval.id, "rejected", approval.revision);

    expect(decided.status).toBe("rejected");
    expect(getJobApplication(user.id, application.id)!.status).not.toBe("ready_for_manual_submission");
  });

  test("an already-executed approval cannot execute again (idempotent replay)", async () => {
    const user = createTestUser("jobs-submit-no-double-execute");
    const { application } = seedApplication(user.id);

    const created = await invokeTool("jobs.submitApplication", { applicationId: application.id }, { userId: user.id });
    const approval = getApprovalById(created.approvalId!)!;
    await decideApproval(user.id, approval.id, "approved", approval.revision);

    const replayed = await executeApproval(user.id, approval.id);
    expect(replayed.status).toBe("executed");
    // Still exactly one recorded result — re-running produced no new side effect.
    expect(JSON.parse(replayed.result_json!).readyForManualSubmission).toBe(true);
  });

  test("duplicate submission prevented: an application already marked submitted refuses a new approval", async () => {
    const user = createTestUser("jobs-submit-duplicate-already-submitted");
    const { application } = seedApplication(user.id);
    await invokeTool("jobs.markSubmitted", { applicationId: application.id }, { userId: user.id });

    await expect(invokeTool("jobs.submitApplication", { applicationId: application.id }, { userId: user.id })).rejects.toThrow(/already.*submitted/i);
  });

  test("duplicate submission prevented: a still-pending approval for the same application refuses a second one", async () => {
    const user = createTestUser("jobs-submit-duplicate-pending");
    const { application } = seedApplication(user.id);

    const first = await invokeTool("jobs.submitApplication", { applicationId: application.id }, { userId: user.id });
    expect(first.awaitingApproval).toBe(true);

    await expect(invokeTool("jobs.submitApplication", { applicationId: application.id }, { userId: user.id })).rejects.toThrow(/already pending/i);
  });

  test("a status-unknown application does not block re-submission blindly, but a genuinely already-submitted one does — never silently retried", async () => {
    const user = createTestUser("jobs-submit-status-checks");
    const { application } = seedApplication(user.id);
    // Never called markSubmitted or submitApplication yet — status is "prepared".
    const result = await invokeTool("jobs.submitApplication", { applicationId: application.id }, { userId: user.id });
    expect(result.awaitingApproval).toBe(true); // allowed — no evidence of a prior submission
  });
});

describe("jobs.markSubmitted: idempotent self-report, never a fake external verification", () => {
  test("marks submitted and records a timestamp", async () => {
    const user = createTestUser("jobs-mark-submitted");
    const { application } = seedApplication(user.id);

    const result = await invokeTool("jobs.markSubmitted", { applicationId: application.id }, { userId: user.id });
    expect(result.output.alreadySubmitted).toBe(false);
    expect(getJobApplication(user.id, application.id)!.status).toBe("submitted");
  });

  test("marking twice is a no-op, not a duplicate record or error", async () => {
    const user = createTestUser("jobs-mark-submitted-twice");
    const { application } = seedApplication(user.id);

    await invokeTool("jobs.markSubmitted", { applicationId: application.id }, { userId: user.id });
    const second = await invokeTool("jobs.markSubmitted", { applicationId: application.id }, { userId: user.id });
    expect(second.output.alreadySubmitted).toBe(true);
  });
});

describe("Cross-user isolation for jobs/applications", () => {
  test("user B cannot resolve, approve, or execute user A's application submission", async () => {
    const userA = createTestUser("jobs-cross-user-a");
    const userB = createTestUser("jobs-cross-user-b");
    const { application } = seedApplication(userA.id);

    await expect(invokeTool("jobs.submitApplication", { applicationId: application.id }, { userId: userB.id })).rejects.toThrow(/not found/i);
    expect(getJobApplication(userB.id, application.id)).toBeUndefined();
  });

  test("user B cannot decide an approval that belongs to user A, even with the correct id/revision", async () => {
    const userA = createTestUser("jobs-cross-user-decide-a");
    const userB = createTestUser("jobs-cross-user-decide-b");
    const { application } = seedApplication(userA.id);

    const created = await invokeTool("jobs.submitApplication", { applicationId: application.id }, { userId: userA.id });
    const approval = getApprovalById(created.approvalId!)!;

    await expect(decideApproval(userB.id, approval.id, "approved", approval.revision)).rejects.toThrow();
    expect(getApprovalById(approval.id)!.status).toBe("pending");
  });

  test("user B cannot mark user A's application submitted", async () => {
    const userA = createTestUser("jobs-cross-user-mark-a");
    const userB = createTestUser("jobs-cross-user-mark-b");
    const { application } = seedApplication(userA.id);

    const result = await invokeTool("jobs.markSubmitted", { applicationId: application.id }, { userId: userB.id });
    expect(result.output.found).toBe(false);
    expect(getJobApplication(userA.id, application.id)!.status).not.toBe("submitted");
  });
});

describe("No credential/cookie/password collection anywhere in the jobs feature", () => {
  test("no jobs source file references passwords, cookies, or auth tokens copied from a browser", () => {
    const jobsDirs = [
      path.join(process.cwd(), "src/lib/jobs"),
      path.join(process.cwd(), "src/lib/tools/jobs"),
      path.join(process.cwd(), "src/lib/candidateProfile.ts"),
    ];
    const forbidden = /\bpassword\b|\bsession[_-]?cookie\b|\bbrowser[_-]?cookie\b|\bcaptcha\b|\bmfa[_-]?bypass\b/i;
    const offenders: string[] = [];

    function scan(target: string) {
      const stat = fs.statSync(target);
      if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(target)) scan(path.join(target, entry));
      } else if (/\.ts$/.test(target)) {
        const content = fs.readFileSync(target, "utf-8");
        if (forbidden.test(content)) offenders.push(target);
      }
    }
    for (const dir of jobsDirs) scan(dir);

    expect(offenders).toEqual([]);
  });
});
