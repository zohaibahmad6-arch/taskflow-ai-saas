import "server-only";
import { db, newId, nowIso } from "./db";
import { writeAuditEvent } from "./audit";
import { getTool } from "./tools/registry";
import { notifyUser } from "./push";
import type { ApprovalDraft } from "./tools/types";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "executed"
  | "failed";

export type ApprovalRow = {
  id: string;
  action_id: string;
  user_id: string;
  tool_id: string;
  action: string;
  target: string;
  content: string;
  consequence: string;
  input_json: string;
  status: ApprovalStatus;
  requested_at: string;
  expires_at: string;
  decided_at: string | null;
  executed_at: string | null;
  result_json: string | null;
  error: string | null;
};

export function createApproval(params: {
  userId: string;
  toolId: string;
  input: unknown;
  draft: ApprovalDraft;
  ttlMs?: number;
}): ApprovalRow {
  const id = newId("appr");
  const actionId = newId("action");
  const expiresAt = new Date(Date.now() + (params.ttlMs ?? DEFAULT_TTL_MS)).toISOString();

  db.prepare(
    `INSERT INTO approvals (id, action_id, user_id, tool_id, action, target, content, consequence, input_json, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    actionId,
    params.userId,
    params.toolId,
    params.draft.action,
    params.draft.target,
    params.draft.content,
    params.draft.consequence,
    JSON.stringify(params.input),
    expiresAt
  );

  writeAuditEvent({
    userId: params.userId,
    toolId: params.toolId,
    actionId,
    eventType: "proposed",
    summary: `Prepared: ${params.draft.action} → ${params.draft.target}`,
    target: params.draft.target,
    detail: { content: params.draft.content, consequence: params.draft.consequence },
  });

  // Best-effort, non-blocking: a notification failure must never affect the approval itself.
  void notifyUser(params.userId, {
    title: "Action awaiting your approval",
    body: `${params.draft.action} → ${params.draft.target}`,
    url: "/approvals",
  }).catch(() => {});

  return getApprovalById(id)!;
}

export function getApprovalById(id: string): ApprovalRow | undefined {
  return db.prepare("SELECT * FROM approvals WHERE id = ?").get(id) as
    | ApprovalRow
    | undefined;
}

export function listApprovals(userId: string, status?: ApprovalStatus): ApprovalRow[] {
  expireStaleApprovals(userId);
  if (status) {
    return db
      .prepare(
        "SELECT * FROM approvals WHERE user_id = ? AND status = ? ORDER BY requested_at DESC"
      )
      .all(userId, status) as ApprovalRow[];
  }
  return db
    .prepare("SELECT * FROM approvals WHERE user_id = ? ORDER BY requested_at DESC")
    .all(userId) as ApprovalRow[];
}

export function expireStaleApprovals(userId: string): void {
  const stale = db
    .prepare(
      "SELECT * FROM approvals WHERE user_id = ? AND status = 'pending' AND expires_at < ?"
    )
    .all(userId, nowIso()) as ApprovalRow[];

  for (const row of stale) {
    db.prepare("UPDATE approvals SET status = 'expired' WHERE id = ?").run(row.id);
    writeAuditEvent({
      userId,
      toolId: row.tool_id,
      actionId: row.action_id,
      eventType: "expired",
      summary: `Approval expired before a decision was made: ${row.action}`,
      target: row.target,
    });
  }
}

/**
 * The only place in the codebase allowed to reject/approve an approval.
 * Never call this from anywhere that isn't the explicit, user-initiated
 * Approval Center endpoint — viewing or listing an approval must never
 * reach this function.
 */
export async function decideApproval(
  userId: string,
  approvalId: string,
  decision: "approved" | "rejected",
  editedContent?: string
): Promise<ApprovalRow> {
  const row = getApprovalById(approvalId);
  if (!row || row.user_id !== userId) {
    throw new Error("Approval not found.");
  }
  if (row.status !== "pending") {
    throw new Error(`Approval is already ${row.status}; it cannot be decided again.`);
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare("UPDATE approvals SET status = 'expired' WHERE id = ?").run(row.id);
    throw new Error("This approval has expired. Ask the assistant to prepare it again.");
  }

  const content = editedContent !== undefined ? editedContent : row.content;

  db.prepare(
    "UPDATE approvals SET status = ?, decided_at = ?, content = ? WHERE id = ?"
  ).run(decision, nowIso(), content, row.id);

  writeAuditEvent({
    userId,
    toolId: row.tool_id,
    actionId: row.action_id,
    eventType: decision,
    summary: `User ${decision === "approved" ? "approved" : "rejected"}: ${row.action} → ${row.target}`,
    target: row.target,
    detail: editedContent !== undefined ? { editedContent } : undefined,
  });

  const updated = getApprovalById(approvalId)!;

  if (decision === "approved") {
    return executeApproval(userId, updated.id);
  }
  return updated;
}

/**
 * Executes an approved action exactly once. Idempotent: if called again
 * (e.g. a duplicate request) on an approval that is already executed or
 * failed, it returns the existing recorded result instead of re-running
 * the side effect.
 */
export async function executeApproval(
  userId: string,
  approvalId: string
): Promise<ApprovalRow> {
  const row = getApprovalById(approvalId);
  if (!row || row.user_id !== userId) {
    throw new Error("Approval not found.");
  }

  if (row.status === "executed" || row.status === "failed") {
    return row; // idempotent no-op
  }

  if (row.status !== "approved") {
    throw new Error(`Cannot execute an approval in status "${row.status}".`);
  }

  const tool = getTool(row.tool_id);
  if (!tool || tool.permissionLevel !== "EXTERNAL_ACTION" || !tool.execute) {
    const error = `Tool "${row.tool_id}" is not a valid executable EXTERNAL_ACTION tool.`;
    db.prepare("UPDATE approvals SET status = 'failed', error = ? WHERE id = ?").run(
      error,
      row.id
    );
    writeAuditEvent({
      userId,
      toolId: row.tool_id,
      actionId: row.action_id,
      eventType: "failed",
      summary: error,
      error,
    });
    return getApprovalById(approvalId)!;
  }

  try {
    const input = JSON.parse(row.input_json);
    const result = await tool.execute(input, { userId });
    db.prepare(
      "UPDATE approvals SET status = 'executed', executed_at = ?, result_json = ? WHERE id = ?"
    ).run(nowIso(), JSON.stringify(result.output), row.id);

    writeAuditEvent({
      userId,
      toolId: row.tool_id,
      actionId: row.action_id,
      eventType: "executed",
      summary: `Executed: ${row.action} → ${row.target}`,
      target: row.target,
      detail: result.output,
    });
    void notifyUser(userId, {
      title: "Action completed",
      body: `${row.action} → ${row.target} finished successfully.`,
      url: "/activity",
    }).catch(() => {});
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error during execution.";
    db.prepare("UPDATE approvals SET status = 'failed', error = ? WHERE id = ?").run(
      message,
      row.id
    );
    writeAuditEvent({
      userId,
      toolId: row.tool_id,
      actionId: row.action_id,
      eventType: "failed",
      summary: `Execution failed: ${row.action} → ${row.target}`,
      target: row.target,
      error: message,
    });
    void notifyUser(userId, {
      title: "Action failed",
      body: `${row.action} → ${row.target} could not be completed.`,
      url: "/activity",
    }).catch(() => {});
  }

  return getApprovalById(approvalId)!;
}
