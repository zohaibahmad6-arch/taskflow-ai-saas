import { describe, test, expect } from "vitest";
import {
  createSessionRecord,
  getSessionByToken,
  revokeOtherSessions,
} from "@/lib/sessions";
import { createTestUser } from "../helpers";

describe("session revocation", () => {
  test("an old session cannot access authenticated routes after revocation", () => {
    const user = createTestUser("session-revoke");

    const sessionA = createSessionRecord(user.id, "device-A");
    const sessionB = createSessionRecord(user.id, "device-B");

    // Both sessions work before revocation.
    expect(getSessionByToken(sessionA.token)?.sessionId).toBe(sessionA.sessionId);
    expect(getSessionByToken(sessionB.token)?.sessionId).toBe(sessionB.sessionId);

    const revokedCount = revokeOtherSessions(user.id, sessionA.sessionId);
    expect(revokedCount).toBe(1);

    // The kept session (e.g. the one making a password change) still works...
    expect(getSessionByToken(sessionA.token)?.sessionId).toBe(sessionA.sessionId);
    // ...but the other one is immediately dead — getSession() (the exact
    // function every route calls to authenticate) returns null for it,
    // which is what makes an authenticated route reject it.
    expect(getSessionByToken(sessionB.token)).toBeNull();
  });

  test("revoking others never touches the excepted session's row, and only that user's sessions", () => {
    const userA = createTestUser("session-revoke-scope-a");
    const userB = createTestUser("session-revoke-scope-b");

    const a1 = createSessionRecord(userA.id, "a-device-1");
    const a2 = createSessionRecord(userA.id, "a-device-2");
    const b1 = createSessionRecord(userB.id, "b-device-1");

    revokeOtherSessions(userA.id, a1.sessionId);

    expect(getSessionByToken(a1.token)).not.toBeNull();
    expect(getSessionByToken(a2.token)).toBeNull();
    // A different user's session must be completely unaffected.
    expect(getSessionByToken(b1.token)).not.toBeNull();
  });

  test("revoking with no other sessions is a safe no-op", () => {
    const user = createTestUser("session-revoke-none");
    const only = createSessionRecord(user.id, "only-device");

    const revokedCount = revokeOtherSessions(user.id, only.sessionId);
    expect(revokedCount).toBe(0);
    expect(getSessionByToken(only.token)).not.toBeNull();
  });

  test("session lookup never returns the raw token", () => {
    const user = createTestUser("session-no-token-leak");
    const session = createSessionRecord(user.id, null);
    const looked = getSessionByToken(session.token);

    expect(looked).not.toBeNull();
    expect(JSON.stringify(looked)).not.toContain(session.token);
  });
});
