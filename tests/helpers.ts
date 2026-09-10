import { db, newId } from "@/lib/db";

/** Creates a uniquely-named user row for a test, isolated from other tests sharing the same DB file. */
export function createTestUser(label: string): { id: string; email: string } {
  const id = newId("user");
  const email = `${label}-${id}@example.com`;
  db.prepare("INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)").run(
    id,
    email,
    label,
    "not-a-real-hash"
  );
  return { id, email };
}
