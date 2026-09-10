import "server-only";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { env } from "./env";

declare global {
  var __personalAgentDb: Database.Database | undefined;
}

/**
 * Best-effort permission hardening — this holds private personal data
 * (email drafts, approvals, audit history) and should be owner-read/write
 * only. Wrapped in try/catch because chmod semantics vary by platform
 * (notably Windows, and some network/container filesystems don't support
 * POSIX modes at all): failing to tighten permissions there must never
 * block the app from starting.
 */
function chmodIfExists(targetPath: string, mode: number): void {
  try {
    if (fs.existsSync(targetPath)) {
      fs.chmodSync(targetPath, mode);
    }
  } catch {
    // Unsupported on this filesystem/platform — not fatal.
  }
}

function openDatabase(): Database.Database {
  const dbPath = env.databasePath;
  const dir = path.dirname(dbPath);
  if (dir && dir !== "." && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  chmodIfExists(dir, 0o700);

  const db = new Database(dbPath);
  chmodIfExists(dbPath, 0o600);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const schemaPath = path.join(process.cwd(), "src", "lib", "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf-8");
  db.exec(schema);
  runMigrations(db);

  // WAL mode creates -wal/-shm sidecar files on first write (the schema
  // exec above), which also hold live data — restrict those too.
  chmodIfExists(dbPath, 0o600);
  chmodIfExists(`${dbPath}-wal`, 0o600);
  chmodIfExists(`${dbPath}-shm`, 0o600);

  return db;
}

/**
 * Additive, backwards-compatible schema changes for columns added after a
 * database already existed. `CREATE TABLE IF NOT EXISTS` (in schema.sql)
 * only affects brand-new databases — it never alters an existing table —
 * so a new column on an existing table needs an explicit ALTER TABLE here.
 * Each statement is wrapped so "duplicate column name" (already applied,
 * every run after the first) is silently ignored; any other failure is
 * rethrown, since that indicates a real problem rather than "already
 * migrated". This never drops or rewrites existing data.
 */
function runMigrations(db: Database.Database): void {
  const migrations = [
    "ALTER TABLE email_summaries ADD COLUMN provider TEXT NOT NULL DEFAULT 'gmail'",
  ];
  for (const sql of migrations) {
    try {
      db.exec(sql);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.toLowerCase().includes("duplicate column name")) {
        throw err;
      }
    }
  }
}

// Opened lazily, on first real query, rather than at module import time.
// Next.js's build-time "collecting page data" step imports every route
// module (sometimes from several worker processes at once) just to read
// their exported config; opening better-sqlite3's WAL-mode file eagerly
// at import time made those workers race for the same DB file and fail
// the build with SQLITE_BUSY. A lazy Proxy defers the real `new Database`
// call until something actually runs a query at request time, while still
// reusing a single connection across hot reloads in dev and across
// requests in production.
function getDb(): Database.Database {
  if (!globalThis.__personalAgentDb) {
    globalThis.__personalAgentDb = openDatabase();
  }
  return globalThis.__personalAgentDb;
}

export const db: Database.Database = new Proxy({} as Database.Database, {
  get(_target, prop) {
    const real = getDb();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
