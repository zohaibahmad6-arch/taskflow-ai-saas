import "server-only";
import webpush from "web-push";
import { db, newId } from "./db";
import { env } from "./env";

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

export function removeSubscription(endpoint: string): void {
  db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
}

export function hasPushSubscription(userId: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM push_subscriptions WHERE user_id = ? LIMIT 1")
    .get(userId);
  return Boolean(row);
}

/**
 * Best-effort mobile notification. This is purely informational — it must
 * never be the trigger for an external action; it only tells the user
 * something needs their attention in the app.
 */
export async function notifyUser(
  userId: string,
  payload: { title: string; body: string; url?: string }
): Promise<void> {
  db.prepare(
    "INSERT INTO notifications (id, user_id, type, title, body, link) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(newId("notif"), userId, "push", payload.title, payload.body, payload.url ?? null);

  if (!ensureConfigured()) return;

  const subs = db
    .prepare("SELECT * FROM push_subscriptions WHERE user_id = ?")
    .all(userId) as Array<{ id: string; endpoint: string; keys_json: string }>;

  const body = JSON.stringify(payload);

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: JSON.parse(sub.keys_json) },
          body
        );
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          removeSubscription(sub.endpoint);
        }
      }
    })
  );
}

export function markNotificationsRead(userId: string): void {
  db.prepare("UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0").run(userId);
}

export type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  read: number;
  created_at: string;
};

export function listNotifications(userId: string, limit = 50): NotificationRow[] {
  return db
    .prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(userId, limit) as NotificationRow[];
}
