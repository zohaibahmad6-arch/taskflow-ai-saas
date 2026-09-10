import "server-only";
import { db, newId, nowIso } from "./db";
import { writeAuditEvent } from "./audit";
import { getTool } from "./tools/registry";
import { ensureToolsRegistered } from "./tools";
import { notifyUser } from "./push";
import type { ApprovalDraftText } from "./tools/types";

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
  payload_json: string;
  revision: number;
  status: ApprovalStatus;
  requested_at: string;
  expires_at: string;
  edited_at: string | null;
  decided_at: string | null;
  executed_at: string | null;
  result_json: string | null;
  error: string | null;
};

export class ApprovalRevisionMismatchError extends Error {}
export class ApprovalStateError extends Error {}
export class ApprovalNotFoundError extends Error {}

export function createApproval(params: {
  userId: string;
  toolId: string;
  payload: unknown;
  draftText: ApprovalDraftText;
  ttlMs?: number;
}): ApprovalRow {
  const id = newId("appr");
  const actionId = newId("action");
  const expiresAt = new Date(Date.now() + (params.ttlMs ?? DEFAULT_TTL_MS)).toISOString();

  db.prepare(
    `INSERT INTO approvals (id, action_id, user_id, tool_id, action, target, content, consequence, payload_json, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    actionId,
    params.userId,
    params.toolId,
    params.draftText.action,
    params.draftText.target,
    params.draftText.content,
    params.draftText.consequence,
    JSON.stringify(params.payload),
    expiresAt
  );

  writeAuditEvent({
    userId: params.userId,
    toolId: params.toolId,
    actionId,
    eventType: "proposed",
    summary: `Prepared: ${params.draftText.action} → ${params.draftText.target}`,
    target: params.draftText.target,
    detail: { content: params.draftText.content, consequence: params.draftText.consequence },
  });

  // Best-effort, non-blocking: a notification failure must never affect the approval itself.
  void notifyUser(params.userId, {
    title: "Action awaiting your approval",
    body: `${params.draftText.action} → ${params.draftText.target}`,
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
 * Edits the payload of a pending approval in place. This is the ONLY way
 * an approval's content can change after creation, and it is only ever
 * possible while status === 'pending' — an approved or executed approval
 * is immutable (test requirement C). The merged payload is re-validated
 * against the tool's own approvalPayloadSchema (never trusted as-is), the
 * display text is recomputed from it via describePayload so it can never
 * drift from what will execute, and `revision` is bumped so any decision
 * already in flight against the pre-edit state is invalidated (see
 * decideApproval's expectedRevision check).
 */
export async function editApproval(
  userId: string,
  approvalId: string,
  partialPayload: Record<string, unknown>
): Promise<ApprovalRow> {
  ensureToolsRegistered();

  const row = getApprovalById(approvalId);
  if (!row || row.user_id !== userId) {
    throw new ApprovalNotFoundError("Approval not found.");
  }
  if (row.status !== "pending") {
    throw new ApprovalStateError(
      `Cannot edit an approval that is already ${row.status}. Only pending approvals can be edited.`
    );
  }

  const tool = getTool(row.tool_id);
  if (!tool || tool.permissionLevel !== "EXTERNAL_ACTION" || !tool.approvalPayloadSchema || !tool.describePayload) {
    throw new ApprovalStateError(`Tool "${row.tool_id}" cannot be edited.`);
  }

  const currentPayload = JSON.parse(row.payload_json) as Record<string, unknown>;
  const merged = { ...currentPayload, ...partialPayload };

  const parsed = tool.approvalPayloadSchema.safeParse(merged);
  if (!parsed.success) {
    throw new ApprovalStateError(
      `Invalid edit: ${parsed.error.issues.map((i) => i.message).join("; ")}`
    );
  }

  const draftText = await tool.describePayload(parsed.data, { userId });
  const expiresAt = new Date(Date.now() + DEFAULT_TTL_MS).toISOString();

  db.prepare(
    `UPDATE approvals SET
       payload_json = ?, action = ?, target = ?, content = ?, consequence = ?,
       revision = revision + 1, edited_at = ?, expires_at = ?
     WHERE id = ?`
  ).run(
    JSON.stringify(parsed.data),
    draftText.action,
    draftText.target,
    draftText.content,
    draftText.consequence,
    nowIso(),
    expiresAt,
    row.id
  );

  const updated = getApprovalById(approvalId)!;

  writeAuditEvent({
    userId,
    toolId: row.tool_id,
    actionId: row.action_id,
    eventType: "edited",
    summary: `Edited: ${draftText.action} → ${draftText.target} (revision ${updated.revision})`,
    target: draftText.target,
    detail: { payload: parsed.data },
  });

  return updated;
}

/**
 * The only place in the codebase allowed to reject/approve an approval.
 * Never call this from anywhere that isn't the explicit, user-initiated
 * Approval Center endpoint — viewing or listing an approval must never
 * reach this function.
 *
 * `expectedRevision` implements optimistic concurrency: the caller must
 * pass the revision it last saw. If the approval was edited since (by
 * this user in another tab, or in principle by any other path) the
 * revision will have moved on and this throws instead of silently
 * deciding on a payload the caller never actually reviewed — this is
 * what makes edits to the target/recipient/content "invalidate" a
 * decision that was formed against the pre-edit state (test requirements
 * D and E), without needing a separate invalidation flag.
 */
export async function decideApproval(
  userId: string,
  approvalId: string,
  decision: "approved" | "rejected",
  expectedRevision: number
): Promise<ApprovalRow> {
  const row = getApprovalById(approvalId);
  if (!row || row.user_id !== userId) {
    throw new ApprovalNotFoundError("Approval not found.");
  }
  if (row.status !== "pending") {
    throw new ApprovalStateError(`Approval is already ${row.status}; it cannot be decided again.`);
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare("UPDATE approvals SET status = 'expired' WHERE id = ?").run(row.id);
    throw new ApprovalStateError("This approval has expired. Ask the assistant to prepare it again.");
  }
  if (row.revision !== expectedRevision) {
    throw new ApprovalRevisionMismatchError(
      "This approval has changed since you last viewed it (it was edited). Refresh and review the latest version before deciding."
    );
  }

  db.prepare(
    "UPDATE approvals SET status = ?, decided_at = ? WHERE id = ?"
  ).run(decision, nowIso(), row.id);

  writeAuditEvent({
    userId,
    toolId: row.tool_id,
    actionId: row.action_id,
    eventType: decision,
    summary: `User ${decision === "approved" ? "approved" : "rejected"}: ${row.action} → ${row.target}`,
    target: row.target,
  });

  const updated = getApprovalById(approvalId)!;

  if (decision === "approved") {
    return executeApproval(userId, updated.id);
  }
  return updated;
}

/**
 * Executes an approved action exactly once, reading the payload fresh
 * from the DB (never a value passed in by a caller), so it is physically
 * impossible for this to execute anything other than the approval's
 * current, final, reviewed payload. Idempotent: if called again (e.g. a
 * duplicate request) on an approval that is already executed or failed,
 * it returns the existing recorded result instead of re-running the side
 * effect.
 *
 * Defensively re-registers tools on every call rather than assuming some
 * earlier page render already did it — this must behave correctly as the
 * very first thing that runs in a fresh server process (e.g. a
 * serverless cold start hitting the approval endpoint directly).
 */
export async function executeApproval(
  userId: string,
  approvalId: string
): Promise<ApprovalRow> {
  ensureToolsRegistered();

  const row = getApprovalById(approvalId);
  if (!row || row.user_id !== userId) {
    throw new ApprovalNotFoundError("Approval not found.");
  }

  if (row.status === "executed" || row.status === "failed") {
    return row; // idempotent no-op
  }

  if (row.status !== "approved") {
    throw new ApprovalStateError(`Cannot execute an approval in status "${row.status}".`);
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
    const payload = JSON.parse(row.payload_json);
    const result = await tool.execute(payload, { userId });
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
