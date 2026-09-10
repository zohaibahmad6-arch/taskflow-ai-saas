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
  get googleOAuthClientId() {
    return required("GOOGLE_OAUTH_CLIENT_ID");
  },
  get googleOAuthClientSecret() {
    return required("GOOGLE_OAUTH_CLIENT_SECRET");
  },
  /** Must exactly match a redirect URI registered on the Google Cloud OAuth client. */
  get googleOAuthRedirectUri() {
    return required("GOOGLE_OAUTH_REDIRECT_URI");
  },
  get googleOAuthConfigured() {
    return Boolean(
      process.env.GOOGLE_OAUTH_CLIENT_ID &&
        process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
        process.env.GOOGLE_OAUTH_REDIRECT_URI
    );
  },
  /**
   * Whether this deployment sits behind a reverse proxy/load balancer that
   * can be trusted to set (and strip any client-supplied copy of)
   * X-Forwarded-For / X-Real-IP before requests reach this app. Defaults
   * to false: a directly-exposed Next.js server must NOT trust those
   * headers, since any client can set them to whatever they like and
   * would otherwise be able to spread requests across fake IPs to defeat
   * per-IP rate limiting. Only set TRUST_PROXY=true if you know your
   * hosting setup (e.g. Vercel, or nginx/Cloudflare configured to
   * overwrite these headers) guarantees that.
   */
  get trustProxy() {
    return optional("TRUST_PROXY", "false").toLowerCase() === "true";
  },
  get nodeEnv() {
    return optional("NODE_ENV", "development");
  },
  get isProduction() {
    return this.nodeEnv === "production";
  },
};
