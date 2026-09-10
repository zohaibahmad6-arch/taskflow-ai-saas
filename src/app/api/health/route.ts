import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * Minimal health check for a hosting platform's health monitor (e.g.
 * Render). Deliberately public (see proxy.ts's PUBLIC_API_PREFIXES) —
 * the platform's checker has no session cookie to send — and deliberately
 * minimal in what it reveals: no secrets, tokens, user data, email
 * content, database contents, or stack traces, on either the healthy or
 * unhealthy path. It exists to answer exactly one question: is this
 * instance able to serve requests and reach its own database.
 */
export async function GET() {
  try {
    // A trivial query against the already-open connection — proves the
    // persistent disk is mounted and the database file is reachable,
    // without touching or returning any actual row of user data.
    db.prepare("SELECT 1").get();
    return NextResponse.json({ status: "ok" }, { status: 200 });
  } catch {
    // Never include the caught error's message — it could echo a file
    // path or other environment detail. "unhealthy" is all a health
    // checker needs to know.
    return NextResponse.json({ status: "unhealthy" }, { status: 503 });
  }
}
