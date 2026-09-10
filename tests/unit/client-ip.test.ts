import { describe, test, expect } from "vitest";
import { getClientIp } from "@/lib/clientIp";

describe("getClientIp / trusted-proxy handling", () => {
  test("without trustProxy, X-Forwarded-For is ignored entirely (not spoofable)", () => {
    const headersA = new Headers({ "x-forwarded-for": "1.2.3.4" });
    const headersB = new Headers({ "x-forwarded-for": "9.9.9.9" });

    // Two "different" attacker-supplied IPs must map to the SAME bucket
    // key when the header isn't trusted — otherwise an attacker could
    // spread requests across fake IPs to bypass rate limiting.
    expect(getClientIp(headersA, false)).toBe(getClientIp(headersB, false));
  });

  test("without trustProxy, X-Real-IP is also ignored", () => {
    const headers = new Headers({ "x-real-ip": "6.6.6.6" });
    expect(getClientIp(headers, false)).toBe("unproxied");
  });

  test("with trustProxy, the first X-Forwarded-For entry is used", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" });
    expect(getClientIp(headers, true)).toBe("203.0.113.5");
  });

  test("with trustProxy and no X-Forwarded-For, falls back to X-Real-IP", () => {
    const headers = new Headers({ "x-real-ip": "203.0.113.9" });
    expect(getClientIp(headers, true)).toBe("203.0.113.9");
  });

  test("with trustProxy and no forwarding headers at all, falls back to the fixed bucket", () => {
    const headers = new Headers();
    expect(getClientIp(headers, true)).toBe("unproxied");
  });
});
