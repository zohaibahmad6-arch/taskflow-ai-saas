// Test-only stand-in for the "server-only" package.
//
// The real "server-only" package throws unconditionally when imported
// outside Next's bundler (it relies on a special webpack/turbopack
// resolve condition to pick a no-op file instead) — see the note in
// scripts/seed.ts, which hit the same issue. Vitest runs our lib code
// directly under plain Node, so vitest.config.ts aliases "server-only"
// to this empty module for tests. This does not weaken the real
// build/runtime guard at all: Next's build still uses the real package
// and still fails if a client component ever imports server-only code.
export {};
