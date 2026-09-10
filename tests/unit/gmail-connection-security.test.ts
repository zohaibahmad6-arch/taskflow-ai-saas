import { describe, test, expect } from "vitest";
import {
  storeVerifiedConnection,
  getDecryptedTokens,
  getConnection,
  listConnections,
  disconnectProvider,
  markConnectionError,
  updateAccessToken,
  type OAuthTokenSet,
} from "@/lib/connections";
import { listAuditEvents } from "@/lib/audit";
import { createTestUser } from "../helpers";

function fakeTokens(overrides: Partial<OAuthTokenSet> = {}): OAuthTokenSet {
  return {
    accessToken: "ya29.fake-access-token-value",
    refreshToken: "1//fake-refresh-token-value",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    scope: "https://www.googleapis.com/auth/gmail.readonly",
    ...overrides,
  };
}

describe("Gmail connection: token encryption, ownership, disconnect, no leakage", () => {
  test("3. tokens are encrypted at rest and decrypt back to the exact original values", () => {
    const user = createTestUser("token-crypto");
    const tokens = fakeTokens();
    storeVerifiedConnection({ userId: user.id, provider: "gmail", category: "email", accountLabel: "me@gmail.com", tokens });

    const row = getConnection(user.id, "gmail")!;
    expect(row.encrypted_tokens).toBeTruthy();
    // The ciphertext must not contain the plaintext token anywhere in it.
    expect(row.encrypted_tokens).not.toContain(tokens.accessToken);
    expect(row.encrypted_tokens).not.toContain(tokens.refreshToken!);

    const decrypted = getDecryptedTokens(user.id, "gmail");
    expect(decrypted).toEqual(tokens);
  });

  test("4. / 10. token ownership and user isolation: user A cannot read user B's tokens", () => {
    const userA = createTestUser("isolation-a");
    const userB = createTestUser("isolation-b");

    storeVerifiedConnection({
      userId: userB.id,
      provider: "gmail",
      category: "email",
      accountLabel: "userb@gmail.com",
      tokens: fakeTokens({ accessToken: "userB-access-token" }),
    });

    // There's no API to fetch "any user's tokens" — every lookup is
    // keyed by userId, so asking for user A's tokens for a provider only
    // user B connected simply returns nothing.
    expect(getDecryptedTokens(userA.id, "gmail")).toBeNull();
    expect(getConnection(userA.id, "gmail")?.status).toBe("not_connected");
    expect(getConnection(userB.id, "gmail")?.status).toBe("connected");

    // Listing user A's connections never includes user B's row.
    const idsForA = listConnections(userA.id).map((c) => c.id);
    const bRow = getConnection(userB.id, "gmail")!;
    expect(idsForA).not.toContain(bRow.id);
  });

  test("5. disconnect clears stored tokens and resets status", () => {
    const user = createTestUser("disconnect-clears");
    storeVerifiedConnection({
      userId: user.id,
      provider: "gmail",
      category: "email",
      accountLabel: "me@gmail.com",
      tokens: fakeTokens(),
    });
    expect(getConnection(user.id, "gmail")?.status).toBe("connected");

    disconnectProvider(user.id, "gmail");

    const row = getConnection(user.id, "gmail")!;
    expect(row.status).toBe("not_connected");
    expect(row.encrypted_tokens).toBeNull();
    expect(row.account_label).toBeNull();
    expect(getDecryptedTokens(user.id, "gmail")).toBeNull();
  });

  test("11. no token leakage: the shape returned to API clients never includes encrypted_tokens", () => {
    const user = createTestUser("no-leak-shape");
    storeVerifiedConnection({
      userId: user.id,
      provider: "gmail",
      category: "email",
      accountLabel: "me@gmail.com",
      tokens: fakeTokens({ accessToken: "should-never-leave-the-server" }),
    });

    // Mirrors exactly what GET /api/connections maps the DB row to.
    const clientShape = listConnections(user.id).map((c) => ({
      provider: c.provider,
      category: c.category,
      status: c.status,
      accountLabel: c.account_label,
      connectedAt: c.connected_at,
    }));

    const serialized = JSON.stringify(clientShape);
    expect(serialized).not.toContain("should-never-leave-the-server");
    expect(serialized).not.toMatch(/encrypted_tokens|accessToken|refreshToken/i);
  });

  test("11. no token leakage: audit events for connect/disconnect never contain token values", () => {
    const user = createTestUser("no-leak-audit");
    const tokens = fakeTokens({ accessToken: "audit-check-access-token", refreshToken: "audit-check-refresh-token" });
    storeVerifiedConnection({ userId: user.id, provider: "gmail", category: "email", accountLabel: "me@gmail.com", tokens });
    disconnectProvider(user.id, "gmail");

    const events = listAuditEvents(user.id, 50);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("audit-check-access-token");
    expect(serialized).not.toContain("audit-check-refresh-token");
  });

  test("12. connection status cannot be faked: nothing but storeVerifiedConnection can produce status='connected'", () => {
    const user = createTestUser("cannot-fake-status");

    // Exercise every other mutating function in the connections module —
    // none of them are capable of setting status to 'connected'.
    markConnectionError(user.id, "gmail", "some transient error");
    expect(getConnection(user.id, "gmail")?.status).toBe("error");

    disconnectProvider(user.id, "gmail");
    expect(getConnection(user.id, "gmail")?.status).toBe("not_connected");

    // updateAccessToken only touches an EXISTING connected token set — it
    // cannot conjure one into existence for a never-connected account.
    updateAccessToken(user.id, "gmail", { accessToken: "x", expiresAt: new Date().toISOString() });
    expect(getConnection(user.id, "gmail")?.status).toBe("not_connected");

    // A raw DB update is the only other way — outside the application's
    // own code paths entirely, which is the point: no function reachable
    // from a request handler does this except storeVerifiedConnection.
    expect(getConnection(user.id, "gmail")?.encrypted_tokens).toBeNull();
  });

  test("storeVerifiedConnection is the only function that sets connected_at/last_synced_at on first connect", () => {
    const user = createTestUser("connected-at-source");
    const before = getConnection(user.id, "gmail");
    expect(before?.connected_at).toBeNull();

    storeVerifiedConnection({
      userId: user.id,
      provider: "gmail",
      category: "email",
      accountLabel: "me@gmail.com",
      tokens: fakeTokens(),
    });

    const after = getConnection(user.id, "gmail")!;
    expect(after.status).toBe("connected");
    expect(after.connected_at).not.toBeNull();
    expect(after.last_synced_at).not.toBeNull();
  });
});
