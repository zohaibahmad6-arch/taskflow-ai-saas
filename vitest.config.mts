import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      // Real "server-only" throws when imported outside Next's bundler —
      // see tests/stubs/server-only.ts for why this is safe.
      "server-only": path.resolve(import.meta.dirname, "tests/stubs/server-only.ts"),
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    environment: "node",
    globalSetup: path.resolve(import.meta.dirname, "tests/globalSetup.ts"),
    fileParallelism: false,
    env: {
      DATABASE_PATH: "./data/test.db",
      AUTH_USER_EMAIL: "test-owner@example.com",
      AUTH_USER_NAME: "Test Owner",
      OPENAI_API_KEY: "sk-test-not-a-real-key",
      OPENAI_MODEL: "gpt-4o-mini",
      APP_ENCRYPTION_KEY: "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=",
      TRUST_PROXY: "false",
      NODE_ENV: "test",
    },
  },
});
