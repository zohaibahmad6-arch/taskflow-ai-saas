import "server-only";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

/**
 * Centralized, server-only access to environment configuration.
 * Importing "server-only" ensures any accidental client-side import
 * fails at build time instead of leaking secrets into the browser bundle.
 */
export const env = {
  get openaiApiKey() {
    return required("OPENAI_API_KEY");
  },
  get openaiModel() {
    return optional("OPENAI_MODEL", "gpt-4o-mini");
  },
  get authUserEmail() {
    return required("AUTH_USER_EMAIL").toLowerCase().trim();
  },
  get authUserName() {
    return optional("AUTH_USER_NAME", "Owner");
  },
  get sessionSecret() {
    return required("SESSION_SECRET");
  },
  get appEncryptionKey() {
    return required("APP_ENCRYPTION_KEY");
  },
  get databasePath() {
    return optional("DATABASE_PATH", "./data/app.db");
  },
  get vapidPublicKey() {
    return process.env.VAPID_PUBLIC_KEY ?? "";
  },
  get vapidPrivateKey() {
    return process.env.VAPID_PRIVATE_KEY ?? "";
  },
  get vapidSubject() {
    return optional("VAPID_SUBJECT", "mailto:owner@example.com");
  },
  get pushConfigured() {
    return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
  },
  get nodeEnv() {
    return optional("NODE_ENV", "development");
  },
  get isProduction() {
    return this.nodeEnv === "production";
  },
};
