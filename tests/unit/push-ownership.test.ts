import { describe, test, expect } from "vitest";
import { db } from "@/lib/db";
import { saveSubscription, removeSubscription } from "@/lib/push";
import { createTestUser } from "../helpers";

function subscriptionExists(endpoint: string): boolean {
  const row = db.prepare("SELECT 1 FROM push_subscriptions WHERE endpoint = ?").get(endpoint);
  return Boolean(row);
}

describe("push subscription ownership", () => {
  test("removeSubscription will not delete another user's subscription for a known endpoint", () => {
    const userA = createTestUser("push-owner-a");
    const userB = createTestUser("push-owner-b");
    const endpoint = `https://push.example.com/${crypto.randomUUID()}`;

    saveSubscription(userB.id, { endpoint, keys: { p256dh: "p", auth: "a" } });
    expect(subscriptionExists(endpoint)).toBe(true);

    // userA (not the owner) tries to remove userB's subscription by endpoint.
    removeSubscription(userA.id, endpoint);
    expect(subscriptionExists(endpoint)).toBe(true); // still there — not owned by userA

    // The actual owner can remove it.
    removeSubscription(userB.id, endpoint);
    expect(subscriptionExists(endpoint)).toBe(false);
  });

  test("removeSubscription with a non-matching userId is a safe no-op, not an error", () => {
    const user = createTestUser("push-owner-noop");
    const endpoint = `https://push.example.com/${crypto.randomUUID()}`;
    expect(() => removeSubscription(user.id, endpoint)).not.toThrow();
  });
});
