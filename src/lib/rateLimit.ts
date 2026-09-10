import "server-only";
import { db } from "./db";

/**
 * DB-backed sliding-window rate limiter. Deliberately simple for a
 * single-user personal app — no external store needed, and it survives
 * process restarts (an in-memory Map would not).
 */
export function checkRateLimit(params: {
  bucket: string;
  limit: number;
  windowMs: number;
}): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const windowStart = now - params.windowMs;

  db.prepare("DELETE FROM rate_limit_hits WHERE bucket_key = ? AND hit_at < ?").run(
    params.bucket,
    windowStart
  );

  const { count } = db
    .prepare("SELECT COUNT(*) as count FROM rate_limit_hits WHERE bucket_key = ?")
    .get(params.bucket) as { count: number };

  if (count >= params.limit) {
    return { allowed: false, remaining: 0 };
  }

  db.prepare("INSERT INTO rate_limit_hits (bucket_key, hit_at) VALUES (?, ?)").run(
    params.bucket,
    now
  );

  return { allowed: true, remaining: params.limit - count - 1 };
}
