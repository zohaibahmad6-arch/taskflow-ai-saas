import "server-only";

/**
 * Timezone validation + local-date computation. Nothing in this file
 * assumes, auto-detects, or hard-codes a timezone for anyone — a value is
 * either a validated IANA identifier a user explicitly set (see
 * preferences.ts), or it's treated as absent and every caller here falls
 * back to UTC. Client input is NEVER trusted without going through
 * `isValidIanaTimezone` first (see the /api/preferences route).
 */

export const UTC_FALLBACK = "UTC";

/**
 * The only reliable, dependency-free way to validate an IANA timezone
 * name across Node/browser runtimes: constructing an Intl.DateTimeFormat
 * with it throws a RangeError for anything Intl doesn't recognize.
 * Deliberately does not rely on Intl.supportedValuesOf("timeZone") (a
 * newer API not guaranteed available in every runtime this app might run
 * on) — this works everywhere Intl itself works.
 */
export function isValidIanaTimezone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Validates and returns the given timezone, or the UTC fallback if it's missing/invalid. Never throws. */
export function resolveTimezone(value: string | null | undefined): string {
  return isValidIanaTimezone(value) ? value : UTC_FALLBACK;
}

/**
 * Today's calendar date (YYYY-MM-DD) as seen from the given IANA
 * timezone. `en-CA` is used purely as a formatting trick — that locale
 * happens to render dates in ISO order (year-month-day) — this has
 * nothing to do with Canada or language, only date component ordering.
 */
export function todayDateInTimezone(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
