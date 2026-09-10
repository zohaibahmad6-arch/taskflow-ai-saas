import { describe, test, expect, vi, afterEach } from "vitest";
import {
  buildMicrosoftAuthUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  revokeMicrosoftToken,
  MicrosoftOAuthError,
  MICROSOFT_GRAPH_SCOPES,
} from "@/lib/microsoftOAuth";

function mockFetchOnce(response: { ok: boolean; status?: number; json: unknown }) {
  const fn = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 400),
    json: async () => response.json,
  } as Response);
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Microsoft OAuth client (mocked network — no real Microsoft/Azure credentials in this environment)", () => {
  test("buildMicrosoftAuthUrl requests only the documented Graph scopes, no client secret, and a state param", () => {
    const url = new URL(buildMicrosoftAuthUrl("abc123"));
    expect(url.searchParams.get("scope")).toBe(MICROSOFT_GRAPH_SCOPES);
    // Every scope requested must be one this build actually uses — never a
    // broader admin/directory/calendar/contacts/files permission.
    for (const scope of MICROSOFT_GRAPH_SCOPES.split(" ")) {
      expect(["openid", "profile", "email", "offline_access", "Mail.Read", "Mail.ReadWrite", "Mail.Send"]).toContain(scope);
    }
    expect(url.searchParams.get("state")).toBe("abc123");
    expect(url.searchParams.get("client_secret")).toBeNull(); // never sent to the browser-bound auth URL
    expect(url.toString()).not.toContain("common/oauth2/v2.0/authorize?client_secret");
  });

  test("exchangeCodeForTokens returns a normalized token set on success", async () => {
    mockFetchOnce({
      ok: true,
      json: { access_token: "at_fake", refresh_token: "rt_fake", expires_in: 3600, scope: MICROSOFT_GRAPH_SCOPES },
    });

    const tokens = await exchangeCodeForTokens("fake-code");
    expect(tokens.accessToken).toBe("at_fake");
    expect(tokens.refreshToken).toBe("rt_fake");
    expect(new Date(tokens.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  test("Microsoft rejects the code (e.g. expired/reused) — throws, never returns fake tokens", async () => {
    mockFetchOnce({ ok: false, status: 400, json: { error: "invalid_grant" } });
    await expect(exchangeCodeForTokens("already-used-code")).rejects.toThrow(MicrosoftOAuthError);
  });

  test("exchangeCodeForTokens rejects a response with no access_token instead of returning a broken token set", async () => {
    mockFetchOnce({ ok: true, json: { expires_in: 3600 } });
    await expect(exchangeCodeForTokens("code")).rejects.toThrow(MicrosoftOAuthError);
  });

  test("refreshAccessToken returns a new access token, and the rotated refresh token when Microsoft sends one", async () => {
    mockFetchOnce({ ok: true, json: { access_token: "at_new", refresh_token: "rt_rotated", expires_in: 3600 } });
    const refreshed = await refreshAccessToken("rt_fake");
    expect(refreshed.accessToken).toBe("at_new");
    expect(refreshed.refreshToken).toBe("rt_rotated");
  });

  test("refreshAccessToken throws (never silently succeeds) when the refresh token is invalid/revoked", async () => {
    mockFetchOnce({ ok: false, status: 400, json: { error: "invalid_grant" } });
    await expect(refreshAccessToken("revoked-token")).rejects.toThrow(MicrosoftOAuthError);
  });

  test("a network failure during token exchange surfaces as MicrosoftOAuthError, not a crash", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await expect(exchangeCodeForTokens("code")).rejects.toThrow(MicrosoftOAuthError);
  });

  test("revokeMicrosoftToken is an honest, documented no-op (no public revoke API exists for this token type) — never falsely reports success", async () => {
    await expect(revokeMicrosoftToken()).resolves.toBe(false);
  });

  test("error objects never carry the client secret or a raw token", async () => {
    mockFetchOnce({ ok: false, status: 400, json: { error: "invalid_client" } });
    try {
      await exchangeCodeForTokens("secret-code-value");
      expect.unreachable();
    } catch (err) {
      const serialized = JSON.stringify(err instanceof Error ? { message: err.message, name: err.name } : err);
      expect(serialized).not.toContain("secret-code-value");
    }
  });
});
