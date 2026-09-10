import { describe, test, expect } from "vitest";
import { isValidIanaTimezone, resolveTimezone, todayDateInTimezone, UTC_FALLBACK } from "@/lib/timezone";
import { getPreferences, updatePreferences } from "@/lib/preferences";
import { createTestUser } from "../helpers";

describe("isValidIanaTimezone: server-side validation, never trusts arbitrary input", () => {
  test.each([
    ["Europe/London", true],
    ["Asia/Qatar", true],
    ["America/New_York", true],
    ["UTC", true],
    ["Pacific/Kiritimati", true], // UTC+14, the furthest-ahead real zone
    ["Pacific/Midway", true], // UTC-11, one of the furthest-behind real zones
  ])("%s -> %s", (tz, expected) => {
    expect(isValidIanaTimezone(tz)).toBe(expected);
  });

  test.each([
    "not-a-timezone",
    "",
    "America/Nonexistent_City",
    "DROP TABLE users;",
    "<script>alert(1)</script>",
    "../../etc/passwd",
  ])("rejects garbage/hostile input: %s", (tz) => {
    expect(isValidIanaTimezone(tz)).toBe(false);
  });

  test("rejects non-string input", () => {
    expect(isValidIanaTimezone(null)).toBe(false);
    expect(isValidIanaTimezone(undefined)).toBe(false);
    expect(isValidIanaTimezone(123)).toBe(false);
    expect(isValidIanaTimezone({})).toBe(false);
  });

  test("rejects an absurdly long string rather than passing it to Intl", () => {
    expect(isValidIanaTimezone("A".repeat(500))).toBe(false);
  });
});

describe("resolveTimezone: sensible UTC fallback, never assumes or invents a timezone", () => {
  test("returns the value when valid", () => {
    expect(resolveTimezone("Asia/Qatar")).toBe("Asia/Qatar");
  });
  test("falls back to UTC for null/undefined/invalid", () => {
    expect(resolveTimezone(null)).toBe(UTC_FALLBACK);
    expect(resolveTimezone(undefined)).toBe(UTC_FALLBACK);
    expect(resolveTimezone("not-a-timezone")).toBe(UTC_FALLBACK);
  });
});

describe("todayDateInTimezone: correct local calendar date, including across the UTC day boundary", () => {
  test("UTC: a timestamp mid-day UTC is the same date everywhere close to UTC", () => {
    const t = new Date("2026-06-15T12:00:00.000Z");
    expect(todayDateInTimezone("UTC", t)).toBe("2026-06-15");
  });

  test("positive UTC offset (Asia/Qatar, UTC+3): a timestamp just before UTC midnight is already tomorrow locally", () => {
    const t = new Date("2026-06-15T22:00:00.000Z"); // 01:00 local in Qatar the next day
    expect(todayDateInTimezone("Asia/Qatar", t)).toBe("2026-06-16");
  });

  test("negative UTC offset (America/Los_Angeles, UTC-7/8): a timestamp just after UTC midnight is still yesterday locally", () => {
    const t = new Date("2026-06-15T04:00:00.000Z"); // ~21:00 the previous day in Los Angeles (PDT, UTC-7)
    expect(todayDateInTimezone("America/Los_Angeles", t)).toBe("2026-06-14");
  });

  test("midnight boundary: two timestamps five minutes apart, straddling UTC midnight, land on different UTC dates but the SAME local date for a negative-offset zone", () => {
    const before = new Date("2026-06-15T23:57:00.000Z");
    const after = new Date("2026-06-16T00:03:00.000Z");
    expect(todayDateInTimezone("UTC", before)).toBe("2026-06-15");
    expect(todayDateInTimezone("UTC", after)).toBe("2026-06-16"); // UTC sees two different days
    expect(todayDateInTimezone("America/Los_Angeles", before)).toBe(todayDateInTimezone("America/Los_Angeles", after)); // still the same LA evening
  });

  test("same local day across very different UTC timestamps for a positive-offset zone", () => {
    const early = new Date("2026-06-15T21:30:00.000Z"); // 00:30 local (Asia/Qatar, next UTC day locally)
    const late = new Date("2026-06-15T23:59:00.000Z"); // 02:59 local, same local calendar day
    expect(todayDateInTimezone("Asia/Qatar", early)).toBe(todayDateInTimezone("Asia/Qatar", late));
  });
});

describe("preferences.ts: timezone storage is validated, nullable, and never breaks existing rows", () => {
  test("a freshly-created preferences row has no timezone set (NULL) — UTC fallback applies, nothing is assumed", () => {
    const user = createTestUser("tz-fresh-row");
    const prefs = getPreferences(user.id);
    expect(prefs.timezone).toBeNull();
  });

  test("updatePreferences stores a valid IANA timezone", () => {
    const user = createTestUser("tz-valid-store");
    const updated = updatePreferences(user.id, { timezone: "Europe/London" });
    expect(updated.timezone).toBe("Europe/London");
  });

  test("updatePreferences rejects an invalid timezone rather than silently storing it", () => {
    const user = createTestUser("tz-invalid-reject");
    expect(() => updatePreferences(user.id, { timezone: "not-a-real-place" })).toThrow();
    expect(getPreferences(user.id).timezone).toBeNull(); // untouched
  });

  test("passing timezone: null explicitly clears a previously-set value back to unset", () => {
    const user = createTestUser("tz-clear");
    updatePreferences(user.id, { timezone: "Asia/Qatar" });
    expect(getPreferences(user.id).timezone).toBe("Asia/Qatar");
    updatePreferences(user.id, { timezone: null });
    expect(getPreferences(user.id).timezone).toBeNull();
  });

  test("updating an unrelated field leaves an existing timezone untouched", () => {
    const user = createTestUser("tz-untouched-by-other-update");
    updatePreferences(user.id, { timezone: "Asia/Tokyo" });
    updatePreferences(user.id, { tone: "casual" });
    expect(getPreferences(user.id).timezone).toBe("Asia/Tokyo");
  });
});

describe("Migration sanity: existing users (no timezone ever set) continue working", () => {
  test("the preferences table actually has the timezone column (idempotent migration applied)", () => {
    const user = createTestUser("tz-migration-sanity");
    const prefs = getPreferences(user.id);
    expect("timezone" in prefs).toBe(true);
    expect(prefs.timezone).toBeNull();
  });
});
