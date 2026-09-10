import "server-only";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { env } from "./env";

declare global {
  var __personalAgentDb: Database.Database | undefined;
}

function openDatabase(): Database.Database {
  const dbPath = env.databasePath;
  const dir = path.dirname(dbPath);
  if (dir && dir !== "." && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const schemaPath = path.join(process.cwd(), "src", "lib", "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf-8");
  db.exec(schema);

  return db;
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
