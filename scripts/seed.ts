/**
 * Creates (or updates the password for) the single owner account.
 * Run with: npm run seed
 * Requires AUTH_USER_EMAIL and ADMIN_PASSWORD in the environment (.env.local).
 *
 * Deliberately self-contained (opens its own better-sqlite3 connection
 * instead of importing src/lib/db.ts): those lib modules are marked
 * "server-only", which throws when required outside Next's bundler — as
 * happens when this script runs directly under tsx/Node.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function main() {
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.length < 10) {
    console.error(
      "Set ADMIN_PASSWORD (10+ chars) in your environment before seeding, e.g.\n" +
        "  ADMIN_PASSWORD='a strong passphrase' npm run seed"
    );
    process.exit(1);
  }

  const email = requiredEnv("AUTH_USER_EMAIL").toLowerCase().trim();
  const name = process.env.AUTH_USER_NAME || "Owner";
  const dbPath = process.env.DATABASE_PATH || "./data/app.db";

  const dir = path.dirname(dbPath);
  if (dir && dir !== "." && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(__dirname, "..", "src", "lib", "schema.sql"), "utf-8"));

  const hash = await bcrypt.hash(password, 12);
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as
    | { id: string }
    | undefined;

  if (existing) {
    db.prepare("UPDATE users SET password_hash = ?, name = ? WHERE id = ?").run(
      hash,
      name,
      existing.id
    );
    console.log(`Updated password for existing owner account (${email}).`);
  } else {
    const id = `user_${crypto.randomUUID().replace(/-/g, "")}`;
    db.prepare(
      "INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)"
    ).run(id, email, name, hash);
    db.prepare("INSERT INTO preferences (user_id) VALUES (?)").run(id);
    console.log(`Created owner account (${email}).`);
  }

  db.close();
  console.log("You can now log in with that email and the password you provided.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
