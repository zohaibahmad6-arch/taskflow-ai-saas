import { describe, test, expect } from "vitest";
import fs from "node:fs";
import { db } from "@/lib/db";

describe("SQLite file permissions", () => {
  test("the DB file is owner-only (0600) once opened", () => {
    // Force the lazy DB singleton to actually open.
    db.prepare("SELECT 1").get();

    if (process.platform === "win32") {
      // POSIX file modes aren't meaningfully enforced on Windows; skip.
      return;
    }

    const stat = fs.statSync("./data/test.db");
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
