import { describe, test, expect, vi, afterEach } from "vitest";
import {
  buildGoogleAuthUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  revokeGoogleToken,
  GoogleOAuthError,
  GMAIL_READONLY_SCOPE,
} from "@/lib/googleOAuth";

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

describe("Google OAuth client (mocked network — no real Google credentials in this environment)", () => {
  test("buildGoogleAuthUrl requests only the read-only Gmail scope, offline access, and a state param", () => {
    const url = new URL(buildGoogleAuthUrl("abc123"));
    expect(url.searchParams.get("scope")).toBe(GMAIL_READONLY_SCOPE);
    expect(url.searchParams.get("scope")).not.toMatch(/modify|send|compose/);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("abc123");
    expect(url.searchParams.get("client_secret")).toBeNull(); // never sent to the browser-bound auth URL
  });

  test("exchangeCodeForTokens returns a normalized token set on success", async () => {
    mockFetchOnce({
      ok: true,
      json: { access_token: "at_fake", refresh_token: "rt_fake", expires_in: 3600, scope: GMAIL_READONLY_SCOPE },
    });

    const tokens = await exchangeCodeForTokens("fake-code");
    expect(tokens.accessToken).toBe("at_fake");
    expect(tokens.refreshToken).toBe("rt_fake");
    expect(new Date(tokens.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  test("2. OAuth callback failure: Google rejects the code (e.g. expired/reused) — throws, never returns fake tokens", async () => {
    mockFetchOnce({ ok: false, status: 400, json: { error: "invalid_grant" } });

    await expect(exchangeCodeForTokens("already-used-code")).rejects.toThrow(GoogleOAuthError);
  });

  test("exchangeCodeForTokens rejects a response with no access_token instead of returning a broken token set", async () => {
    mockFetchOnce({ ok: true, json: { expires_in: 3600 } });
    await expect(exchangeCodeForTokens("code")).rejects.toThrow(GoogleOAuthError);
  });

  test("refreshAccessToken returns a new access token on success", async () => {
    mockFetchOnce({ ok: true, json: { access_token: "at_new", expires_in: 3600 } });
    const refreshed = await refreshAccessToken("rt_fake");
    expect(refreshed.accessToken).toBe("at_new");
  });

  test("refreshAccessToken throws (never silently succeeds) when the refresh token is invalid/revoked", async () => {
    mockFetchOnce({ ok: false, status: 400, json: { error: "invalid_grant" } });
    await expect(refreshAccessToken("revoked-token")).rejects.toThrow(GoogleOAuthError);
  });

  test("a network failure during token exchange surfaces as GoogleOAuthError, not a crash", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down"))
    );
    await expect(exchangeCodeForTokens("code")).rejects.toThrow(GoogleOAuthError);
  });

  test("revokeGoogleToken never throws even if the request fails (disconnect must always succeed locally)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await expect(revokeGoogleToken("some-token")).resolves.toBe(false);
  });

  test("revokeGoogleToken returns true on a successful revoke", async () => {
    mockFetchOnce({ ok: true, json: {} });
    await expect(revokeGoogleToken("some-token")).resolves.toBe(true);
  });

  test("error objects never carry the client secret or a raw token", async () => {
    mockFetchOnce({ ok: false, status: 400, json: { error: "invalid_client" } });
    try {
      await exchangeCodeForTokens("secret-code-value");
      expect.unreachable();
    } catch (err) {
      const serialized = JSON.stringify(err instanceof Error ? { message: err.message, name: err.name } : err);
      expect(serialized).not.toContain("test-client-secret-not-real");
      expect(serialized).not.toContain("secret-code-value");
    }
  });
});
