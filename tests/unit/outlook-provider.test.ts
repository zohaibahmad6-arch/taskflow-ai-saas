import { describe, test, expect, vi, afterEach } from "vitest";
import { OutlookProvider, verifyOutlookAccessToken } from "@/lib/email/outlook";
import { getEmailProviderById, getConnectedEmailProviders, getEmailProvider } from "@/lib/email";
import { EmailProviderError } from "@/lib/email/provider";
import { storeVerifiedConnection, getConnection, type OAuthTokenSet } from "@/lib/connections";
import { createTestUser } from "../helpers";

function fakeTokens(overrides: Partial<OAuthTokenSet> = {}): OAuthTokenSet {
  return {
    accessToken: "eyJ.fake",
    refreshToken: "M.fake-refresh",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    scope: "Mail.Read offline_access",
    ...overrides,
  };
}

function connectOutlook(userId: string, tokenOverrides: Partial<OAuthTokenSet> = {}) {
  storeVerifiedConnection({
    userId,
    provider: "outlook",
    category: "email",
    accountLabel: "me@outlook.com",
    tokens: fakeTokens(tokenOverrides),
  });
}

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

describe("OutlookProvider", () => {
  test("provider unavailable: getEmailProviderById returns null when Outlook isn't connected, never a fabricated provider", () => {
    const user = createTestUser("outlook-provider-unavailable");
    expect(getEmailProviderById(user.id, "outlook")).toBeNull();
    expect(getConnectedEmailProviders(user.id)).toEqual([]);
  });

  test("an OutlookProvider instantiated with no stored tokens fails with not_connected, never fake data", async () => {
    const user = createTestUser("outlook-provider-no-tokens");
    const provider = new OutlookProvider(user.id);
    await expect(provider.getRecentMessages()).rejects.toMatchObject({ code: "not_connected" });
  });

  test("an expired access token is refreshed automatically before the real request", async () => {
    const user = createTestUser("outlook-provider-expired-refresh");
    connectOutlook(user.id, { expiresAt: new Date(Date.now() - 1000).toISOString() });

    const fetchMock = stubFetchSequence([
      { match: "login.microsoftonline.com", response: { ok: true, json: { access_token: "at_refreshed", expires_in: 3600 } } },
      { match: "/mailFolders/inbox/messages", response: { ok: true, json: { value: [] } } },
    ]);

    const provider = new OutlookProvider(user.id);
    const results = await provider.getRecentMessages();

    expect(results).toEqual([]);
    const calledUrls = fetchMock.mock.calls.map((c) => c[0].toString());
    expect(calledUrls.some((u) => u.includes("login.microsoftonline.com"))).toBe(true);
  });

  test("a failed refresh (revoked/invalid refresh token) marks the connection errored and never pretends success", async () => {
    const user = createTestUser("outlook-provider-refresh-fails");
    connectOutlook(user.id, { expiresAt: new Date(Date.now() - 1000).toISOString() });

    stubFetchSequence([
      { match: "login.microsoftonline.com", response: { ok: false, status: 400, json: { error: "invalid_grant" } } },
    ]);

    const provider = new OutlookProvider(user.id);
    await expect(provider.getRecentMessages()).rejects.toMatchObject({ code: "auth_expired" });
    expect(getConnection(user.id, "outlook")?.status).toBe("error");
  });

  test("a 401 from Graph itself (token rejected mid-use) marks the connection errored", async () => {
    const user = createTestUser("outlook-provider-401");
    connectOutlook(user.id);
    stubFetchSequence([{ match: "/mailFolders/inbox/messages", response: { ok: false, status: 401, json: {} } }]);

    const provider = new OutlookProvider(user.id);
    await expect(provider.getRecentMessages()).rejects.toMatchObject({ code: "auth_expired" });
    expect(getConnection(user.id, "outlook")?.status).toBe("error");
  });

  test("Graph rate limiting (429) surfaces as a clear rate_limited error, not a crash or fake result", async () => {
    const user = createTestUser("outlook-provider-429");
    connectOutlook(user.id);
    stubFetchSequence([{ match: "/messages", response: { ok: false, status: 429, json: {} } }]);

    const provider = new OutlookProvider(user.id);
    await expect(provider.searchMessages("test")).rejects.toMatchObject({ code: "rate_limited" });
  });

  test("a network failure surfaces as network_error, not a crash", async () => {
    const user = createTestUser("outlook-provider-network-fail");
    connectOutlook(user.id);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));

    const provider = new OutlookProvider(user.id);
    await expect(provider.getRecentMessages()).rejects.toMatchObject({ code: "network_error" });
  });

  test("searchMessages and getRecentMessages cap maxResults (data minimization)", async () => {
    const user = createTestUser("outlook-provider-cap-results");
    connectOutlook(user.id);
    const fetchMock = stubFetchSequence([{ match: "/messages", response: { ok: true, json: { value: [] } } }]);

    const provider = new OutlookProvider(user.id);
    await provider.searchMessages("test", 9999);

    const listCall = fetchMock.mock.calls.find((c) => c[0].toString().includes("/messages?"));
    const calledUrl = new URL(listCall![0].toString());
    expect(Number(calledUrl.searchParams.get("$top"))).toBeLessThanOrEqual(50);
  });

  test("verifyOutlookAccessToken succeeds only on a real 2xx profile response with an email address", async () => {
    stubFetchSequence([{ match: "graph.microsoft.com/v1.0/me?", response: { ok: true, json: { mail: "me@outlook.com" } } }]);
    await expect(verifyOutlookAccessToken("at_fake")).resolves.toEqual({ emailAddress: "me@outlook.com" });
  });

  test("verifyOutlookAccessToken falls back to userPrincipalName when mail is empty (common for personal accounts)", async () => {
    stubFetchSequence([
      { match: "graph.microsoft.com/v1.0/me?", response: { ok: true, json: { mail: null, userPrincipalName: "me@outlook.com" } } },
    ]);
    await expect(verifyOutlookAccessToken("at_fake")).resolves.toEqual({ emailAddress: "me@outlook.com" });
  });

  test("verifyOutlookAccessToken throws (never returns success) when Graph rejects the token", async () => {
    stubFetchSequence([{ match: "graph.microsoft.com/v1.0/me?", response: { ok: false, status: 401, json: {} } }]);
    await expect(verifyOutlookAccessToken("bad-token")).rejects.toThrow(EmailProviderError);
  });

  test("getThread filters by conversationId, never returns unrelated messages", async () => {
    const user = createTestUser("outlook-provider-thread");
    connectOutlook(user.id);
    const fetchMock = stubFetchSequence([
      {
        match: "/messages?",
        response: {
          ok: true,
          json: {
            value: [
              { id: "m1", conversationId: "conv1", subject: "Re: hi", from: { emailAddress: { address: "a@x.com" } }, receivedDateTime: "2026-01-01", bodyPreview: "hi", body: { contentType: "text", content: "hi" } },
            ],
          },
        },
      },
    ]);

    const provider = new OutlookProvider(user.id);
    const thread = await provider.getThread("conv1");
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0].id).toBe("m1");
    const listCall = fetchMock.mock.calls.find((c) => c[0].toString().includes("/messages?"));
    const decodedUrl = decodeURIComponent(listCall![0].toString().replace(/\+/g, " "));
    expect(decodedUrl).toContain("conversationId eq 'conv1'");
  });

  test("read-only enforcement: OutlookProvider exposes no mutation method whatsoever", () => {
    const provider = new OutlookProvider("irrelevant-user-id");
    const proto = Object.getPrototypeOf(provider);
    const methodNames = Object.getOwnPropertyNames(proto).filter((n) => n !== "constructor");

    const forbidden = /send|reply|forward|delete|trash|archive|modify|move|categor|markread|mark_read|draft(?!.*get)|insert|import|flag/i;
    const offending = methodNames.filter((name) => forbidden.test(name));
    expect(offending).toEqual([]);

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

  test("Gmail-only and Outlook-only connections are both still honored by getEmailProvider back-compat helper", () => {
    const gmailOnly = createTestUser("multi-provider-gmail-only");
    storeVerifiedConnection({ userId: gmailOnly.id, provider: "gmail", category: "email", accountLabel: "g@gmail.com", tokens: fakeTokens() });
    expect(getEmailProvider(gmailOnly.id)?.providerId).toBe("gmail");

    const outlookOnly = createTestUser("multi-provider-outlook-only");
    connectOutlook(outlookOnly.id);
    expect(getEmailProvider(outlookOnly.id)?.providerId).toBe("outlook");
  });

  test("when both are connected, getConnectedEmailProviders lists both — never silently picks one for a caller that needs to disambiguate", () => {
    const user = createTestUser("multi-provider-both");
    storeVerifiedConnection({ userId: user.id, provider: "gmail", category: "email", accountLabel: "g@gmail.com", tokens: fakeTokens() });
    connectOutlook(user.id);

    const connected = getConnectedEmailProviders(user.id);
    expect(connected.map((c) => c.providerId).sort()).toEqual(["gmail", "outlook"]);
  });
});
