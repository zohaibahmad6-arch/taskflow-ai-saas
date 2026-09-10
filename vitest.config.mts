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
      GOOGLE_OAUTH_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
      GOOGLE_OAUTH_CLIENT_SECRET: "test-client-secret-not-real",
      GOOGLE_OAUTH_REDIRECT_URI: "http://localhost:3000/api/oauth/gmail/callback",
      MICROSOFT_OAUTH_CLIENT_ID: "00000000-0000-0000-0000-000000000000",
      MICROSOFT_OAUTH_CLIENT_SECRET: "test-microsoft-client-secret-not-real",
      MICROSOFT_OAUTH_REDIRECT_URI: "http://localhost:3000/api/oauth/outlook/callback",
      NODE_ENV: "test",
    },
  },
});
