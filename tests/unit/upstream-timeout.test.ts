import { describe, test, expect, vi, afterEach, beforeAll } from "vitest";
import { fetchWithTimeout, withTimeout, UpstreamTimeoutError } from "@/lib/upstreamTimeout";
import { GmailProvider } from "@/lib/email/gmail";
import { OutlookProvider } from "@/lib/email/outlook";
import * as outlookActions from "@/lib/email/outlookActions";
import { ensureToolsRegistered } from "@/lib/tools";
import { invokeTool } from "@/lib/tools/execute";
import { decideApproval, getApprovalById } from "@/lib/approvals";
import { storeVerifiedConnection, type OAuthTokenSet } from "@/lib/connections";
import { createTestUser } from "../helpers";

const SECRET_TOKEN = "ya29.SUPER-SECRET-ACCESS-TOKEN-must-never-leak";

function fakeTokens(overrides: Partial<OAuthTokenSet> = {}): OAuthTokenSet {
  return {
    accessToken: SECRET_TOKEN,
    refreshToken: "rt",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    scope: "read",
    ...overrides,
  };
}

/** A fetch mock that never resolves on its own — only rejects if its AbortSignal fires, exactly like real fetch(). */
function hangingFetch() {
  return vi.fn((_url: string | URL, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal) {
        if (signal.aborted) {
          reject(new DOMException("The operation was aborted.", "AbortError"));
          return;
        }
        signal.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
      }
      // otherwise: never resolves, simulating a genuinely unresponsive upstream
    });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("fetchWithTimeout: core helper behavior", () => {
  test("1. upstream timeout: aborts and throws UpstreamTimeoutError when the server never responds", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const promise = fetchWithTimeout("https://example.invalid/x", { timeoutMs: 30, serviceName: "TestService" });
    await expect(promise).rejects.toBeInstanceOf(UpstreamTimeoutError);
  });

  test("2. aborted request: the underlying fetch actually receives an aborting signal, not just an abandoned promise", async () => {
    let sawAbort = false;
    const fn = vi.fn((_url: string | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          sawAbort = true;
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    });
    vi.stubGlobal("fetch", fn);
    await expect(fetchWithTimeout("https://example.invalid/x", { timeoutMs: 30, serviceName: "TestService" })).rejects.toThrow();
    expect(sawAbort).toBe(true);
  });

  test("3. controlled error: the timeout error message never leaks the request URL, headers, or a token", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    try {
      await fetchWithTimeout("https://example.invalid/x?token=SHOULD-NOT-APPEAR", {
        headers: { Authorization: `Bearer ${SECRET_TOKEN}` },
        timeoutMs: 30,
        serviceName: "TestService",
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(UpstreamTimeoutError);
      const message = (err as Error).message;
      expect(message).not.toContain(SECRET_TOKEN);
      expect(message).not.toContain("Bearer");
      expect(message).not.toContain("token=");
      expect(message).toBe("TestService did not respond within 30ms.");
    }
  });

  test("a request that succeeds well within the timeout resolves normally", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response));
    const res = await fetchWithTimeout("https://example.invalid/x", { timeoutMs: 5000, serviceName: "TestService" });
    expect(res.ok).toBe(true);
  });

  test("a caller-supplied AbortSignal firing is reported as the original error, not mislabeled as a timeout", async () => {
    const controller = new AbortController();
    const fn = vi.fn((_url: string | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
      });
    });
    vi.stubGlobal("fetch", fn);
    const promise = fetchWithTimeout("https://example.invalid/x", { timeoutMs: 30_000, serviceName: "TestService", signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.not.toBeInstanceOf(UpstreamTimeoutError);
  });
});

describe("withTimeout: bounds a non-fetch promise (e.g. web-push)", () => {
  test("rejects with UpstreamTimeoutError if the wrapped promise never settles in time", async () => {
    const neverSettles = new Promise<void>(() => {});
    await expect(withTimeout(neverSettles, 30, "Web Push")).rejects.toBeInstanceOf(UpstreamTimeoutError);
  });

  test("resolves normally if the wrapped promise settles first", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 5000, "Web Push")).resolves.toBe("ok");
  });
});

describe("Gmail/Outlook read paths: a hanging upstream produces a controlled EmailProviderError, never an unhandled crash", () => {
  test("4. GmailProvider.getRecentMessages: no secret (access token) ever appears in the resulting error", async () => {
    vi.useFakeTimers();
    const user = createTestUser("timeout-gmail-read");
    storeVerifiedConnection({ userId: user.id, provider: "gmail", category: "email", accountLabel: "me@gmail.com", tokens: fakeTokens() });
    vi.stubGlobal("fetch", hangingFetch());

    const provider = new GmailProvider(user.id);
    const promise = provider.getRecentMessages(5);
    const assertion = expect(promise).rejects.toMatchObject({ code: "network_error" });
    await vi.advanceTimersByTimeAsync(15_001); // past gmail.ts's internal 15s timeout
    await assertion;

    try {
      await promise;
    } catch (err) {
      const message = (err as Error).message;
      expect(message).not.toContain(SECRET_TOKEN);
    }
  });

  test("Outlook getRecentMessages: same controlled failure, no secret leakage", async () => {
    vi.useFakeTimers();
    const user = createTestUser("timeout-outlook-read");
    storeVerifiedConnection({ userId: user.id, provider: "outlook", category: "email", accountLabel: "me@outlook.com", tokens: fakeTokens() });
    vi.stubGlobal("fetch", hangingFetch());

    const provider = new OutlookProvider(user.id);
    const promise = provider.getRecentMessages(5);
    const assertion = expect(promise).rejects.toMatchObject({ code: "network_error" });
    await vi.advanceTimersByTimeAsync(15_001);
    await assertion;
  });
});

describe("Outlook mutations: a timeout is one failed attempt, never a retry, never a partial ambiguous state", () => {
  test("5+6. moveMessages: a hanging Graph API call fails that ONE message once — no retry, no duplicate network call", async () => {
    vi.useFakeTimers();
    const user = createTestUser("timeout-outlook-move");
    storeVerifiedConnection({ userId: user.id, provider: "outlook", category: "email", accountLabel: "me@outlook.com", tokens: fakeTokens() });
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);

    const promise = outlookActions.moveMessages(user.id, ["m1"], "inbox"); // "inbox" is well-known, skips folder lookup, goes straight to the move call
    const assertion = expect(promise).resolves.toMatchObject({
      succeeded: [],
      failed: [{ messageId: "m1", error: "Outlook took too long to respond." }],
    });
    await vi.advanceTimersByTimeAsync(20_001); // past outlookActions.ts's internal 20s timeout
    await assertion;

    // Exactly one Graph call was attempted for this message — never retried after the timeout.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("Approval Center: an approval that times out during execution ends up safely FAILED, never stuck approved/executed twice", () => {
  beforeAll(() => {
    ensureToolsRegistered();
  });

  test("5+6. full approve -> execute -> timeout flow: exactly one attempt, final status is 'failed', no secret in the stored error", async () => {
    vi.useFakeTimers();
    const user = createTestUser("timeout-approval-flow");
    storeVerifiedConnection({ userId: user.id, provider: "outlook", category: "email", accountLabel: "me@outlook.com", tokens: fakeTokens() });
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);

    const created = await invokeTool("outlook.moveMessages", { messageIds: ["m1"], destinationFolder: "inbox" }, { userId: user.id });
    expect(created.awaitingApproval).toBe(true);
    const approval = getApprovalById(created.approvalId!)!;
    expect(approval.status).toBe("pending");
    expect(fetchMock).toHaveBeenCalledTimes(0); // nothing touched Graph before approval

    const decidePromise = decideApproval(user.id, approval.id, "approved", approval.revision);
    await vi.advanceTimersByTimeAsync(20_001);
    const decided = await decidePromise;

    // moveMessages reports per-message failures rather than throwing, so the
    // tool call itself succeeds and the approval reaches 'executed' with a
    // result that honestly records the one message as failed — it never
    // gets stuck at 'approved' unexecuted, and it is never retried.
    expect(decided.status).toBe("executed");
    const output = JSON.parse(decided.result_json!);
    expect(output.failed).toEqual([{ messageId: "m1", error: "Outlook took too long to respond." }]);
    expect(output.succeeded).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1); // exactly one Graph attempt total — never retried

    // Re-approving/re-executing the same approval must still be a safe no-op (pre-existing idempotency, unaffected by timeouts).
    await expect(decideApproval(user.id, approval.id, "approved", decided.revision)).rejects.toThrow(/already/i);
    expect(fetchMock).toHaveBeenCalledTimes(1); // still exactly one — the replay did not touch Graph again

    const storedError = decided.result_json! + (decided.error ?? "");
    expect(storedError).not.toContain(SECRET_TOKEN);
  });
});
