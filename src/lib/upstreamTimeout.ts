import "server-only";

/**
 * Thrown when an upstream request is aborted for taking too long. The
 * message deliberately carries only the service name and the configured
 * timeout — never a URL with query params, never headers, never a token —
 * so it is always safe to surface directly to a user or write to the
 * audit log without redaction.
 */
export class UpstreamTimeoutError extends Error {
  readonly serviceName: string;
  readonly timeoutMs: number;
  constructor(serviceName: string, timeoutMs: number) {
    super(`${serviceName} did not respond within ${timeoutMs}ms.`);
    this.name = "UpstreamTimeoutError";
    this.serviceName = serviceName;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * fetch() with a bounded timeout. Aborts the underlying connection (not
 * just "stops waiting") the moment the timeout elapses, via the standard
 * AbortController/signal mechanism `fetch` already supports — so the
 * socket is actually torn down, not left running in the background.
 *
 * Deliberately does NOT retry. Whether a failed/timed-out call is safe to
 * retry depends entirely on what the caller was doing (a GET is usually
 * fine to retry; a mailbox mutation like "move this message" is NOT,
 * since the first attempt may have already reached the server) — that
 * decision belongs to each call site, never to this shared helper. See
 * outlookActions.ts for why mutation call sites here never retry.
 */
export async function fetchWithTimeout(
  input: string | URL,
  init: Omit<RequestInit, "signal"> & { timeoutMs: number; serviceName: string; signal?: AbortSignal }
): Promise<Response> {
  const { timeoutMs, serviceName, signal: callerSignal, ...rest } = init;
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener("abort", onCallerAbort);
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...rest, signal: controller.signal });
  } catch (err) {
    // A caller-supplied signal aborting is the caller's own concern, not a
    // timeout — only translate OUR timer's abort into UpstreamTimeoutError.
    if (err instanceof Error && err.name === "AbortError" && !callerSignal?.aborted) {
      throw new UpstreamTimeoutError(serviceName, timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (callerSignal) callerSignal.removeEventListener("abort", onCallerAbort);
  }
}

/**
 * Bounds an arbitrary promise (for libraries like `web-push` that make
 * their own HTTP request internally via Node's `https` module and don't
 * accept an AbortSignal) to a maximum wait time. Unlike fetchWithTimeout,
 * this cannot truly tear down the underlying socket — it only stops the
 * caller from waiting on it forever — so prefer fetchWithTimeout whenever
 * the call is a plain fetch(). Never retries, for the same reason as above.
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, serviceName: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new UpstreamTimeoutError(serviceName, timeoutMs)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}
