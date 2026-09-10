import "server-only";

/**
 * Resolves a rate-limit bucket key for the client making a request.
 *
 * `X-Forwarded-For` and `X-Real-IP` are set by the CLIENT unless a proxy
 * in front of this app overwrites them — so trusting them blindly lets
 * any caller spoof a different value per request and get a fresh rate
 * limit bucket every time, defeating the limit entirely. This only reads
 * those headers when `trustProxy` is true (wire this to `env.trustProxy`,
 * which defaults to false); a plain Next.js Request/NextRequest has no
 * reliable way to read the raw socket address itself (particularly in
 * serverless deployments), so without an explicit trusted-proxy
 * configuration this deliberately returns a single fixed bucket key
 * instead of a spoofable one — every unauthenticated caller shares one
 * rate-limit bucket, which is coarser but cannot be bypassed by forging
 * headers.
 */
export function getClientIp(headers: Headers, trustProxy: boolean): string {
  if (trustProxy) {
    const forwardedFor = headers.get("x-forwarded-for");
    if (forwardedFor) {
      const first = forwardedFor.split(",")[0]?.trim();
      if (first) return first;
    }
    const realIp = headers.get("x-real-ip");
    if (realIp) return realIp.trim();
  }
  return "unproxied";
}
