import "server-only";
import { db, newId, nowIso } from "./db";

export type SocialDraftRow = {
  id: string;
  user_id: string;
  platform: string;
  content: string;
  source_note: string | null;
  status: "draft" | "ready" | "approved" | "published" | "rejected";
  approval_id: string | null;
  created_at: string;
  updated_at: string;
};

export function createSocialDraft(params: {
  userId: string;
  platform: string;
  content: string;
  sourceNote?: string;
}): SocialDraftRow {
  const id = newId("draft");
  db.prepare(
    `INSERT INTO social_drafts (id, user_id, platform, content, source_note, status)
     VALUES (?, ?, ?, ?, ?, 'ready')`
  ).run(id, params.userId, params.platform, params.content, params.sourceNote ?? null);
  return getSocialDraft(id)!;
}

export function getSocialDraft(id: string): SocialDraftRow | undefined {
  return db.prepare("SELECT * FROM social_drafts WHERE id = ?").get(id) as
    | SocialDraftRow
    | undefined;
}

export function listSocialDrafts(userId: string): SocialDraftRow[] {
  return db
    .prepare("SELECT * FROM social_drafts WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId) as SocialDraftRow[];
}

export function updateSocialDraftStatus(
  id: string,
  status: SocialDraftRow["status"],
  approvalId?: string
): void {
  db.prepare(
    "UPDATE social_drafts SET status = ?, approval_id = COALESCE(?, approval_id), updated_at = ? WHERE id = ?"
  ).run(status, approvalId ?? null, nowIso(), id);
}
