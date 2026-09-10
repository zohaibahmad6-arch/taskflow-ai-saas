import { describe, test, expect } from "vitest";
import { timingSafeEqual } from "@/lib/crypto";

describe("timingSafeEqual", () => {
  test("matching strings are equal", () => {
    expect(timingSafeEqual("abc123", "abc123")).toBe(true);
  });

  test("different strings of the same length are not equal", () => {
    expect(timingSafeEqual("abc123", "abc124")).toBe(false);
  });

  test("different-length strings are not equal and do not throw", () => {
    expect(() => timingSafeEqual("short", "a-much-longer-string-entirely")).not.toThrow();
    expect(timingSafeEqual("short", "a-much-longer-string-entirely")).toBe(false);
  });

  test("empty strings compare equal to each other, not to non-empty", () => {
    expect(timingSafeEqual("", "")).toBe(true);
    expect(timingSafeEqual("", "x")).toBe(false);
    expect(timingSafeEqual("x", "")).toBe(false);
  });

  test("is case-sensitive / byte-exact", () => {
    expect(timingSafeEqual("Token", "token")).toBe(false);
  });

  test("realistic fixed-length random tokens still compare correctly", () => {
    const a = crypto.randomUUID().replace(/-/g, "");
    const b = crypto.randomUUID().replace(/-/g, "");
    expect(timingSafeEqual(a, a)).toBe(true);
    expect(timingSafeEqual(a, b)).toBe(false);
  });
});
