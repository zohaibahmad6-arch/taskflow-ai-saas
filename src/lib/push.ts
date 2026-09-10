import "server-only";
import webpush from "web-push";
import { db, newId } from "./db";
import { env } from "./env";
import { withTimeout } from "./upstreamTimeout";

// web-push makes its own HTTPS request internally (not via fetch) and has
// no timeout option of its own — see upstreamTimeout.ts's withTimeout for
// why this can only bound the WAIT, not truly abort the socket. Bounded
// regardless so one slow/unreachable push endpoint can never hold up the
// Promise.all() below indefinitely. Never retried: a push send is already
// best-effort (see notifyUser's doc comment) and a duplicate push is
// exactly the kind of user-visible noise this app tries to avoid.
const PUSH_SEND_TIMEOUT_MS = 10_000;

let configured = false;
function ensureConfigured(): boolean {
  if (!env.pushConfigured) return false;
  if (!configured) {
    webpush.setVapidDetails(env.vapidSubject, env.vapidPublicKey, env.vapidPrivateKey);
    configured = true;
  }
  return true;
}

export type PushSubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export function saveSubscription(userId: string, sub: PushSubscriptionInput): void {
  db.prepare(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, keys_json)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, keys_json = excluded.keys_json`
  ).run(newId("push"), userId, sub.endpoint, JSON.stringify(sub.keys));
}

/**
 * Scoped to the owning user as well as the endpoint — never trust an
 * endpoint alone to identify "the caller's own" subscription, even
 * though this is a single-user app today.
 */
export function removeSubscription(userId: string, endpoint: string): void {
  db.prepare("DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?").run(
    userId,
    endpoint
  );
}

export function hasPushSubscription(userId: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM push_subscriptions WHERE user_id = ? LIMIT 1")
    .get(userId);
  return Boolean(row);
}

/**
 * The Personal Notification Center's category taxonomy. Every notification
 * belongs to exactly one — used for filtering in the Notifications screen
 * and, together with `referenceId`, for deduplication (see notifyUser).
 */
export type NotificationCategory = "EMAIL" | "JOB" | "APPLICATION" | "APPROVAL" | "SYSTEM";

/**
 * Best-effort mobile notification. This is purely informational — it must
 * never be the trigger for an external action; it only tells the user
 * something needs their attention in the app. A notification click may
 * open a screen for the user to review, but nothing here approves,
 * executes, sends, deletes, moves, or submits anything.
 *
 * `referenceId`, when given, identifies the underlying unresolved event
 * (e.g. an approval id, a job id). If an UNREAD notification with the same
 * user, category, and referenceId already exists, this is a no-op — it
 * neither inserts a new row nor sends another push. This is what stops a
 * still-pending approval (or any other unresolved item) from generating a
 * fresh notification every time something re-checks it.
 */
export async function notifyUser(
  userId: string,
  payload: {
    title: string;
    body: string;
    url?: string;
    category?: NotificationCategory;
    referenceId?: string;
  }
): Promise<void> {
  const category = payload.category ?? "SYSTEM";

  if (payload.referenceId) {
    const existing = db
      .prepare(
        "SELECT 1 FROM notifications WHERE user_id = ? AND category = ? AND reference_id = ? AND read = 0 LIMIT 1"
      )
      .get(userId, category, payload.referenceId);
    if (existing) return; // already notified about this exact unresolved item
  }

  db.prepare(
    "INSERT INTO notifications (id, user_id, type, category, title, body, link, reference_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    newId("notif"),
    userId,
    "push",
    category,
    payload.title,
    payload.body,
    payload.url ?? null,
    payload.referenceId ?? null
  );

  if (!ensureConfigured()) return;

  const subs = db
    .prepare("SELECT * FROM push_subscriptions WHERE user_id = ?")
    .all(userId) as Array<{ id: string; endpoint: string; keys_json: string }>;

  const body = JSON.stringify(payload);

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await withTimeout(
          webpush.sendNotification({ endpoint: sub.endpoint, keys: JSON.parse(sub.keys_json) }, body),
          PUSH_SEND_TIMEOUT_MS,
          "Web Push"
        );
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          removeSubscription(userId, sub.endpoint);
        }
      }
    })
  );
}

/** Marks every unread notification for this user as read. */
export function markNotificationsRead(userId: string): void {
  db.prepare(
    "UPDATE notifications SET read = 1, read_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = ? AND read = 0"
  ).run(userId);
}

/** Marks exactly one notification read — always scoped to the owning user. */
export function markNotificationRead(userId: string, notificationId: string): void {
  db.prepare(
    "UPDATE notifications SET read = 1, read_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND user_id = ? AND read = 0"
  ).run(notificationId, userId);
}

export function getUnreadNotificationCount(userId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0")
    .get(userId) as { n: number };
  return row.n;
}

export type NotificationRow = {
  id: string;
  type: string;
  category: NotificationCategory;
  title: string;
  body: string;
  link: string | null;
  reference_id: string | null;
  read: number;
  read_at: string | null;
  created_at: string;
};

/** Always scoped to the authenticated user — there is no cross-user query path here. */
export function listNotifications(
  userId: string,
  opts?: { limit?: number; category?: NotificationCategory; unreadOnly?: boolean }
): NotificationRow[] {
  const limit = opts?.limit ?? 50;
  const conditions = ["user_id = ?"];
  const params: unknown[] = [userId];
  if (opts?.category) {
    conditions.push("category = ?");
    params.push(opts.category);
  }
  if (opts?.unreadOnly) {
    conditions.push("read = 0");
  }
  params.push(limit);
  return db
    .prepare(
      `SELECT * FROM notifications WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT ?`
    )
    .all(...params) as NotificationRow[];
}
