import { describe, test, expect, vi, afterEach } from "vitest";
import { db } from "@/lib/db";
import { generateDailyBriefing } from "@/lib/dailyBriefing";
import { updatePreferences } from "@/lib/preferences";
import { createTestUser } from "../helpers";

function briefingRows(userId: string): { briefing_date: string }[] {
  return db.prepare("SELECT briefing_date FROM daily_briefings WHERE user_id = ?").all(userId) as { briefing_date: string }[];
}

afterEach(() => {
  vi.useRealTimers();
});

describe("generateDailyBriefing: briefing_date respects the user's local calendar date", () => {
  test("UTC (no timezone preference set): briefing_date is the plain UTC date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T15:00:00.000Z"));
    const user = createTestUser("tzbrief-utc-default");

    const briefing = await generateDailyBriefing(user.id);
    expect(briefing.briefingDate).toBe("2026-03-10");
  });

  test("positive UTC offset (Asia/Qatar, UTC+3): a timestamp late in the UTC day is already the next local day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T22:00:00.000Z")); // 01:00 local in Qatar, March 11
    const user = createTestUser("tzbrief-positive-offset");
    updatePreferences(user.id, { timezone: "Asia/Qatar" });

    const briefing = await generateDailyBriefing(user.id);
    expect(briefing.briefingDate).toBe("2026-03-11");
  });

  test("negative UTC offset (America/Los_Angeles): a timestamp just after UTC midnight is still the previous local day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T05:00:00.000Z")); // ~21:00 the previous evening in LA (PST, UTC-8)
    const user = createTestUser("tzbrief-negative-offset");
    updatePreferences(user.id, { timezone: "America/Los_Angeles" });

    const briefing = await generateDailyBriefing(user.id);
    expect(briefing.briefingDate).toBe("2026-03-09");
  });

  test("midnight boundary: opening the app 3 minutes before and 3 minutes after UTC midnight produces the SAME local briefing_date for a negative-offset user (no duplicate around midnight)", async () => {
    vi.useFakeTimers();
    const user = createTestUser("tzbrief-midnight-boundary");
    updatePreferences(user.id, { timezone: "America/Los_Angeles" });

    vi.setSystemTime(new Date("2026-03-10T23:57:00.000Z"));
    const before = await generateDailyBriefing(user.id, { forceRefresh: true });

    vi.setSystemTime(new Date("2026-03-11T00:03:00.000Z"));
    const after = await generateDailyBriefing(user.id, { forceRefresh: true });

    expect(before.briefingDate).toBe(after.briefingDate); // still the same LA evening
    expect(briefingRows(user.id)).toHaveLength(1); // upserted, never duplicated
  });

  test("invalid timezone (somehow stored directly, bypassing the validated write path): falls back to UTC rather than throwing or fabricating a date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T15:00:00.000Z"));
    const user = createTestUser("tzbrief-invalid-stored");
    // Simulate a legacy/corrupted row — the normal write path (updatePreferences /
    // the API route) already rejects this, so the only way it could exist is a
    // pre-validation-era row or manual DB tampering; resolveTimezone must still
    // handle it safely rather than assuming it's always clean.
    db.prepare("UPDATE preferences SET timezone = ? WHERE user_id = ?").run("Not/AReal_Zone", user.id);

    const briefing = await generateDailyBriefing(user.id);
    expect(briefing.briefingDate).toBe("2026-03-10"); // UTC fallback, not a crash
  });

  test("missing timezone (column is NULL, the default for every existing user after migration): falls back to UTC", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T15:00:00.000Z"));
    const user = createTestUser("tzbrief-missing-tz");

    const briefing = await generateDailyBriefing(user.id);
    expect(briefing.briefingDate).toBe("2026-03-10");
  });

  test("repeated generation the same local day (same-day retries) upserts one row, never duplicates, regardless of timezone", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T22:00:00.000Z"));
    const user = createTestUser("tzbrief-repeated-generation");
    updatePreferences(user.id, { timezone: "Asia/Qatar" });

    await generateDailyBriefing(user.id);
    await generateDailyBriefing(user.id);
    await generateDailyBriefing(user.id, { forceRefresh: true });

    expect(briefingRows(user.id)).toHaveLength(1);
  });

  test("same local day across very different UTC timestamps produces the same briefing_date (idempotent within one local day)", async () => {
    vi.useFakeTimers();
    const user = createTestUser("tzbrief-same-local-day-different-utc");
    updatePreferences(user.id, { timezone: "Asia/Qatar" });

    vi.setSystemTime(new Date("2026-03-10T21:30:00.000Z")); // 00:30 local March 11
    const first = await generateDailyBriefing(user.id, { forceRefresh: true });

    vi.setSystemTime(new Date("2026-03-10T23:59:00.000Z")); // 02:59 local, still March 11
    const second = await generateDailyBriefing(user.id, { forceRefresh: true });

    expect(first.briefingDate).toBe("2026-03-11");
    expect(second.briefingDate).toBe("2026-03-11");
    expect(briefingRows(user.id)).toHaveLength(1);
  });

  test("changing the timezone preference affects only the NEXT briefing, and still upserts by the (now different) computed date rather than erroring", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T22:00:00.000Z"));
    const user = createTestUser("tzbrief-change-timezone");

    const utcBriefing = await generateDailyBriefing(user.id); // no timezone set yet -> UTC
    expect(utcBriefing.briefingDate).toBe("2026-03-10");

    updatePreferences(user.id, { timezone: "Asia/Qatar" });
    const qatarBriefing = await generateDailyBriefing(user.id, { forceRefresh: true });
    expect(qatarBriefing.briefingDate).toBe("2026-03-11"); // now computed in the new timezone

    expect(briefingRows(user.id).map((r) => r.briefing_date).sort()).toEqual(["2026-03-10", "2026-03-11"]);
  });
});
