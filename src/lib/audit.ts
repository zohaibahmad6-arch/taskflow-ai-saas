import "server-only";
import { db, newId } from "./db";

export type AuditEventType =
  | "proposed"
  | "approved"
  | "rejected"
  | "executed"
  | "failed"
  | "expired"
  | "info";

export function writeAuditEvent(params: {
  userId: string;
  toolId: string;
  eventType: AuditEventType;
  summary: string;
  actionId?: string | null;
  target?: string | null;
  detail?: unknown;
  error?: string | null;
}): void {
  db.prepare(
    `INSERT INTO audit_events (id, user_id, action_id, tool_id, event_type, summary, target, detail_json, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newId("evt"),
    params.userId,
    params.actionId ?? null,
    params.toolId,
    params.eventType,
    params.summary,
    params.target ?? null,
    params.detail !== undefined ? JSON.stringify(params.detail) : null,
    params.error ?? null
  );
}

export type AuditEventRow = {
  id: string;
  user_id: string;
  action_id: string | null;
  tool_id: string;
  event_type: AuditEventType;
  summary: string;
  target: string | null;
  detail_json: string | null;
  error: string | null;
  created_at: string;
};

export function listAuditEvents(userId: string, limit = 100): AuditEventRow[] {
  return db
    .prepare(
      "SELECT * FROM audit_events WHERE user_id = ? ORDER BY created_at DESC LIMIT ?"
    )
    .all(userId, limit) as AuditEventRow[];
}
