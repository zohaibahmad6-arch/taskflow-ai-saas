import { describe, test, expect } from "vitest";
import { createOAuthState, consumeOAuthState } from "@/lib/oauthState";
import { db } from "@/lib/db";
import { createTestUser } from "../helpers";

describe("OAuth state (CSRF protection for the Gmail connect flow)", () => {
  test("1. a valid state consumes once and returns the issuing user", () => {
    const user = createTestUser("oauth-state-valid");
    const state = createOAuthState(user.id, "gmail");

    expect(consumeOAuthState(state, "gmail")).toBe(user.id);
  });

  test("a state cannot be replayed — second use is rejected", () => {
    const user = createTestUser("oauth-state-replay");
    const state = createOAuthState(user.id, "gmail");

    expect(consumeOAuthState(state, "gmail")).toBe(user.id);
    expect(consumeOAuthState(state, "gmail")).toBeNull();
  });

  test("an unknown state is rejected", () => {
    expect(consumeOAuthState("not-a-real-state-value", "gmail")).toBeNull();
  });

  test("a state issued for a different provider is rejected", () => {
    const user = createTestUser("oauth-state-wrong-provider");
    const state = createOAuthState(user.id, "gmail");

    expect(consumeOAuthState(state, "outlook")).toBeNull();
    // And since it was rejected on provider mismatch, it's still consumed/gone either way:
    expect(consumeOAuthState(state, "gmail")).toBeNull();
  });

  test("an expired state is rejected even though it exists", () => {
    const user = createTestUser("oauth-state-expired");
    const state = createOAuthState(user.id, "gmail");

    // Simulate time passing by directly back-dating the row's expiry —
    // this is the same DB the app uses, so this exercises the real check.
    db.prepare("UPDATE oauth_states SET expires_at = ? WHERE state = ?").run(
      new Date(Date.now() - 1000).toISOString(),
      state
    );

    expect(consumeOAuthState(state, "gmail")).toBeNull();
  });

  test("state values are unique per call and unguessable-length", () => {
    const user = createTestUser("oauth-state-unique");
    const a = createOAuthState(user.id, "gmail");
    const b = createOAuthState(user.id, "gmail");
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });
});
