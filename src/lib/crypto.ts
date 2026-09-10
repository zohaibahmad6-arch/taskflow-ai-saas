import "server-only";
import crypto from "node:crypto";
import { env } from "./env";

const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  const key = Buffer.from(env.appEncryptionKey, "base64");
  if (key.length !== 32) {
    throw new Error(
      "APP_ENCRYPTION_KEY must decode to exactly 32 bytes (base64-encoded). Generate one with: openssl rand -base64 32"
    );
  }
  return key;
}

/**
 * Encrypts a secret (e.g. an OAuth token) for storage at rest.
 * Used by the Connected Services layer; never used to hide secrets from
 * the user, only from anyone reading the database file directly.
 */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decryptSecret(payload: string): string {
  const raw = Buffer.from(payload, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf-8");
}

export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

/**
 * Constant-time string comparison for secrets (CSRF tokens, etc). Hashes
 * both sides first rather than comparing raw bytes: `crypto.timingSafeEqual`
 * throws on a length mismatch, so a naive implementation has to check
 * lengths before calling it — and that early-return branches in variable
 * time depending on input length, leaking the secret's length via timing.
 * Since SHA-256 always produces a fixed 32-byte digest, comparing digests
 * needs no length branch at all: this function takes the same code path
 * regardless of how long `a` and `b` are or how much they differ.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const hashA = crypto.createHash("sha256").update(a, "utf-8").digest();
  const hashB = crypto.createHash("sha256").update(b, "utf-8").digest();
  return crypto.timingSafeEqual(hashA, hashB);
}
