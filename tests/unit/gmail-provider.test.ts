import { describe, test, expect, vi, afterEach } from "vitest";
import { GmailProvider, verifyGmailAccessToken } from "@/lib/email/gmail";
import { getEmailProvider } from "@/lib/email";
import { EmailProviderError } from "@/lib/email/provider";
import { storeVerifiedConnection, getConnection, type OAuthTokenSet } from "@/lib/connections";
import { createTestUser } from "../helpers";

function fakeTokens(overrides: Partial<OAuthTokenSet> = {}): OAuthTokenSet {
  return {
    accessToken: "ya29.fake",
    refreshToken: "1//fake-refresh",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    scope: "https://www.googleapis.com/auth/gmail.readonly",
    ...overrides,
  };
}

function connectGmail(userId: string, tokenOverrides: Partial<OAuthTokenSet> = {}) {
  storeVerifiedConnection({
    userId,
    provider: "gmail",
    category: "email",
    accountLabel: "me@gmail.com",
    tokens: fakeTokens(tokenOverrides),
  });
}

/** Routes a fake fetch by URL substring -> response, in order. Falls through to a 404 if unmatched. */
function stubFetchSequence(entries: Array<{ match: string; response: { ok: boolean; status?: number; json: unknown } }>) {
  const fn = vi.fn(async (url: string | URL) => {
    const urlStr = url.toString();
    const entry = entries.find((e) => urlStr.includes(e.match));
    if (!entry) {
      return { ok: false, status: 404, json: async () => ({ error: { message: "unmocked url: " + urlStr } }) } as Response;
    }
    return {
      ok: entry.response.ok,
      status: entry.response.status ?? (entry.response.ok ? 200 : 400),
      json: async () => entry.response.json,
    } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GmailProvider", () => {
  test("6. provider unavailable: getEmailProvider returns null when Gmail isn't connected, never a fabricated provider", async () => {
    const user = createTestUser("provider-unavailable");
    expect(getEmailProvider(user.id)).toBeNull();
  });

  test("6. a GmailProvider instantiated with no stored tokens fails with not_connected, never fake data", async () => {
    const user = createTestUser("provider-no-tokens");
    const provider = new GmailProvider(user.id);
    await expect(provider.getRecentMessages()).rejects.toMatchObject({ code: "not_connected" });
  });

  test("7. an expired access token is refreshed automatically before the real request", async () => {
    const user = createTestUser("provider-expired-refresh");
    connectGmail(user.id, { expiresAt: new Date(Date.now() - 1000).toISOString() });

    const fetchMock = stubFetchSequence([
      { match: "oauth2.googleapis.com/token", response: { ok: true, json: { access_token: "at_refreshed", expires_in: 3600 } } },
      { match: "/messages", response: { ok: true, json: { messages: [] } } },
    ]);

    const provider = new GmailProvider(user.id);
    const results = await provider.getRecentMessages();

    expect(results).toEqual([]);
    const calledUrls = fetchMock.mock.calls.map((c) => c[0].toString());
    expect(calledUrls.some((u) => u.includes("oauth2.googleapis.com/token"))).toBe(true);
  });

  test("7. a failed refresh (revoked/invalid refresh token) marks the connection errored and never pretends success", async () => {
    const user = createTestUser("provider-refresh-fails");
    connectGmail(user.id, { expiresAt: new Date(Date.now() - 1000).toISOString() });

    stubFetchSequence([
      { match: "oauth2.googleapis.com/token", response: { ok: false, status: 400, json: { error: "invalid_grant" } } },
    ]);

    const provider = new GmailProvider(user.id);
    await expect(provider.getRecentMessages()).rejects.toMatchObject({ code: "auth_expired" });
    expect(getConnection(user.id, "gmail")?.status).toBe("error");
  });

  test("a 401 from Gmail itself (token rejected mid-use) marks the connection errored", async () => {
    const user = createTestUser("provider-401");
    connectGmail(user.id);
    stubFetchSequence([{ match: "/messages", response: { ok: false, status: 401, json: {} } }]);

    const provider = new GmailProvider(user.id);
    await expect(provider.getRecentMessages()).rejects.toMatchObject({ code: "auth_expired" });
    expect(getConnection(user.id, "gmail")?.status).toBe("error");
  });

  test("Gmail rate limiting (429) surfaces as a clear rate_limited error, not a crash or fake result", async () => {
    const user = createTestUser("provider-429");
    connectGmail(user.id);
    stubFetchSequence([{ match: "/messages", response: { ok: false, status: 429, json: {} } }]);

    const provider = new GmailProvider(user.id);
    await expect(provider.searchMessages("test")).rejects.toMatchObject({ code: "rate_limited" });
  });

  test("a network failure surfaces as network_error, not a crash", async () => {
    const user = createTestUser("provider-network-fail");
    connectGmail(user.id);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));

    const provider = new GmailProvider(user.id);
    await expect(provider.getRecentMessages()).rejects.toMatchObject({ code: "network_error" });
  });

  test("searchMessages and getRecentMessages cap maxResults (data minimization)", async () => {
    const user = createTestUser("provider-cap-results");
    connectGmail(user.id);
    const fetchMock = stubFetchSequence([{ match: "/messages", response: { ok: true, json: { messages: [] } } }]);

    const provider = new GmailProvider(user.id);
    await provider.searchMessages("test", 9999);

    const listCall = fetchMock.mock.calls.find((c) => c[0].toString().includes("/messages?") || c[0].toString().endsWith("/messages"));
    const calledUrl = new URL(listCall![0].toString());
    expect(Number(calledUrl.searchParams.get("maxResults"))).toBeLessThanOrEqual(50);
  });

  test("verifyGmailAccessToken succeeds only on a real 2xx profile response with an email address", async () => {
    stubFetchSequence([{ match: "/profile", response: { ok: true, json: { emailAddress: "me@gmail.com" } } }]);
    await expect(verifyGmailAccessToken("at_fake")).resolves.toEqual({ emailAddress: "me@gmail.com" });
  });

  test("verifyGmailAccessToken throws (never returns success) when Gmail rejects the token", async () => {
    stubFetchSequence([{ match: "/profile", response: { ok: false, status: 401, json: {} } }]);
    await expect(verifyGmailAccessToken("bad-token")).rejects.toThrow(EmailProviderError);
  });

  test("8. read-only enforcement: GmailProvider exposes no mutation method whatsoever", () => {
    const provider = new GmailProvider("irrelevant-user-id");
    const proto = Object.getPrototypeOf(provider);
    // Every method on the class, public interface methods AND private
    // helpers alike (TypeScript `private` is compile-time only — at
    // runtime these are ordinary enumerable methods) — so this check
    // covers the whole implementation, not just the public surface.
    const methodNames = Object.getOwnPropertyNames(proto).filter((n) => n !== "constructor");

    const forbidden = /send|reply|forward|delete|trash|archive|modify|label|markread|mark_read|draft(?!.*get)|insert|import/i;
    const offending = methodNames.filter((name) => forbidden.test(name));
    expect(offending).toEqual([]);

    // The PUBLIC interface (what tool code can actually call, since it
    // only ever holds an `EmailProvider`-typed reference — see
    // email/index.ts) is exactly the read-only surface, nothing extra.
    const publicInterfaceMethods: (keyof import("@/lib/email/provider").EmailProvider)[] = [
      "getConnectionStatus",
      "searchMessages",
      "getMessage",
      "getThread",
      "getRecentMessages",
    ];
    for (const name of publicInterfaceMethods) {
      expect(typeof provider[name]).toBe("function");
    }
  });
});
