# Personal Agent

A private, single-user, mobile-first AI agent. Built with Next.js (App Router),
SQLite (via `better-sqlite3`), and the OpenAI API. There is no public
registration — this app is wired for exactly one authorized user.

This is a standalone project. It shares no code, credentials, database,
branding, or infrastructure with any other app.

## What's actually working right now

- **Authentication** — single owner account, bcrypt-hashed password, httpOnly
  signed session cookies validated against the DB on every request, CSRF
  double-submit protection on all mutating requests, rate-limited login
  (rate limiting only trusts `X-Forwarded-For` when `TRUST_PROXY=true` — see
  `.env.example`). Changing your password immediately revokes every other
  active session; "Sign out other devices" is also available anytime from
  Settings → Security.
- **AI Chat** — full tool-calling loop against the OpenAI API. Conversation
  history is persisted per-conversation.
- **Approval Center** — every external/irreversible action (send email,
  publish a post) is server-side classified and *must* go through here.
  The approval's `payload` is the single authoritative source for what
  executes — editing it in the UI genuinely changes what will be sent, not
  just what's displayed, and a fresh explicit approval is required against
  whatever payload is current (an edit invalidates any decision already in
  flight against the pre-edit version — enforced via a revision number, not
  trust). Each action has a unique id (idempotent — re-approving or
  re-executing is a no-op, never a duplicate send). Approvals expire
  automatically (24h) if ignored, and edits reset that window.
- **Activity / audit log** — every proposal, approval, rejection, execution,
  and failure is recorded with a timestamp. No secrets are ever written to
  it.
- **Social content generation** — `Create a post` on the Social tab (or via
  chat) really calls the OpenAI API and drafts real content using your
  saved Content Style preferences. Nothing is published until you approve
  it in the Approval Center, and publishing itself is honestly stubbed (see
  below) until you connect a real platform.
- **Gmail (read-only)** — real OAuth 2.0 (authorization-code flow, server-side
  only, `gmail.readonly` scope — no send/modify/delete scope is ever
  requested). Once you connect your own Gmail account (see Setup below),
  the assistant can genuinely search your inbox, summarize it into
  Urgent/Action Required/Follow Up/FYI/Deadlines, summarize a thread, and
  draft a reply to a real message — all read-only. Tokens are AES-256-GCM
  encrypted at rest, refreshed automatically, and a connection is never
  marked "connected" until a real Gmail API call has verified it. Sending,
  replying, deleting, archiving, and labeling are deliberately **not**
  implemented in this phase.
- **Email reply drafting** — paste an email, or reference a real message by
  id from search/summary results, and ask for a reply; either way this
  only prepares text, it never sends anything.
- **Content Style preferences, Settings, Data export/delete, password
  change** — all real, all persisted in SQLite.
- **Mobile PWA shell** — installable to the Home Screen, bottom nav, safe-area
  aware, dark by default.
- **Push notifications** — real Web Push (VAPID), not a stub. Enable it from
  Settings → Notifications on an iPhone after adding the app to the Home
  Screen (Safari requirement for iOS web push).

## What is intentionally NOT faked

Per the "no fake integrations" requirement, the following are architected
end-to-end (tool definitions, approval flow, DB schema, UI) but will
honestly tell you they're not connected rather than pretend to work:

- **Outlook** — no OAuth app is registered. Shows "Not connected" until you
  configure real OAuth credentials and implement it (mirroring
  `src/lib/email/gmail.ts`) behind the same `EmailProvider` interface.
- **Gmail sending, replying, forwarding, deleting, archiving, labeling** —
  reading is real (see above); every mutation is deliberately out of scope
  for this phase. `email.send` still exists as an `EXTERNAL_ACTION` tool
  but its `execute()` always fails honestly rather than pretending to send.
- **LinkedIn / X / Facebook / Instagram publishing** — same story. Drafting
  is real; publishing requires you to register OAuth apps with each
  platform and implement the actual publish call in
  `src/lib/tools/social/index.ts`.
- If you click "Connect" on any provider today, the app explains exactly
  which environment variables are missing rather than lying about a
  connection.

## Architecture

```
src/lib/tools/           Tool registry: every tool declares
                          READ_ONLY | PREPARATION | EXTERNAL_ACTION.
                          EXTERNAL_ACTION tools are structurally incapable
                          of running their side effect outside the
                          Approval Center (see tools/execute.ts).
src/lib/approvals.ts     Approval Center backend: create/edit/decide/execute,
                          revision-based optimistic concurrency, expiration,
                          idempotent execution. Always reads the payload
                          fresh from the DB at execution time — never a
                          value passed in by a caller.
src/lib/audit.ts         Append-only audit log.
src/lib/ai/chat.ts       OpenAI tool-calling loop.
src/lib/auth.ts          Cookie-based session/CSRF wrapper around sessions.ts.
src/lib/sessions.ts      Pure, DB-backed session storage (no cookies) —
                          separated out so it's unit-testable and so
                          revocation logic lives in one place.
src/lib/crypto.ts        AES-256-GCM helpers for encrypting OAuth tokens
                          at rest (ready for when real providers are wired
                          up).
src/lib/push.ts          Web Push (VAPID) + in-app notifications.
src/lib/schema.sql       SQLite schema (single source of truth).
src/lib/oauthState.ts    Single-use, expiring OAuth CSRF state tokens.
src/lib/googleOAuth.ts   Direct (no SDK) Google OAuth 2.0 + token endpoint
                          client. Never logs a token, code, or client secret.
src/lib/connections.ts   Connected-account storage: encrypt/decrypt tokens,
                          and the ONLY function allowed to mark a provider
                          "connected" (storeVerifiedConnection) vs. every
                          other mutator (error/disconnect/refresh), which
                          structurally cannot.
src/lib/email/           EmailProvider interface (read-only, on purpose —
                          no send/reply/delete method exists anywhere in
                          it) + GmailProvider, the real implementation,
                          + briefing.ts (daily-briefing data/service layer,
                          not wired to any scheduler yet) + promptSafety.ts
                          (wraps email content as untrusted before it goes
                          into any AI prompt).
src/proxy.ts             Auth gate, security headers, CSRF check for every
                          request (Next's "proxy", formerly "middleware").
```

### Adding a new capability

Tools are registered in `src/lib/tools/index.ts`. A new tool is a
`ToolDefinition` (see `src/lib/tools/types.ts`) declaring its
`permissionLevel`. If it's `EXTERNAL_ACTION`, it must implement
`approvalPayloadSchema`, `resolvePayload`, `describePayload`, and
`execute` — the registry refuses to register an `EXTERNAL_ACTION` tool
missing any of them. `execute` only ever receives the approval's current,
possibly-edited payload (re-validated against `approvalPayloadSchema`),
read fresh from the database — never a value re-derived from wherever it
originally came from. This is also exactly what the AI does when you ask
it to "build a new capability": it proposes a classified plan
(`system.proposeCapability`) but does not write or install code itself —
that's a development task, by design.

### Adding a real email/social provider

Follow `src/lib/email/gmail.ts` as the template: implement the
`EmailProvider` interface (read-only), verify a connection against a real
API call before ever calling `storeVerifiedConnection`, and store tokens
through `connections.ts`'s encrypt/decrypt helpers — never write your own.
For anything that sends/modifies/deletes, that's a mutation and belongs
behind an `EXTERNAL_ACTION` tool (see above), never inside a provider's
read interface.

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment** — copy `.env.example` to `.env.local` and fill
   in:
   - `OPENAI_API_KEY` — your OpenAI key (never exposed to the browser).
   - `AUTH_USER_EMAIL` / `AUTH_USER_NAME` — your identity.
   - `ADMIN_PASSWORD` — used once by the seed script, not stored.
   - `APP_ENCRYPTION_KEY` — `openssl rand -base64 32`
   - `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` — optional, for push
     notifications: `npx web-push generate-vapid-keys --json`
   - `TRUST_PROXY` — leave `false` unless deployed behind a reverse proxy
     that overwrites `X-Forwarded-For`/`X-Real-IP` (see `.env.example`).
   - `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` /
     `GOOGLE_OAUTH_REDIRECT_URI` — optional, for Gmail. Without these,
     Gmail honestly stays "not connected" (clicking Connect explains
     exactly what's missing) — everything else in the app works fine. To
     enable it:
     1. In [Google Cloud Console](https://console.cloud.google.com/), create
        a project (or use an existing one) and enable the **Gmail API**.
     2. Configure the OAuth consent screen (External is fine for personal
        use — you'll be the only test user).
     3. Create an **OAuth client ID** of type "Web application".
     4. Add an authorized redirect URI matching `GOOGLE_OAUTH_REDIRECT_URI`
        exactly (default: `http://localhost:3000/api/oauth/gmail/callback`;
        update both for production).
     5. Copy the client ID and secret into `.env.local`.

3. **Create your account**
   ```bash
   npm run seed
   ```

4. **Run it**
   ```bash
   npm run dev
   ```
   Open on your iPhone (same network) or `localhost:3000`, and use Safari's
   Share → Add to Home Screen to install it as an app.

5. **Run the test suite**
   ```bash
   npm test
   ```
   Unit/regression tests for the security-critical paths (Approval Center
   edit integrity, session revocation, tool input limits, defensive tool
   registration, push subscription ownership, timing-safe comparison,
   trusted-proxy IP resolution). Uses an isolated SQLite file at
   `./data/test.db`, never your real `./data/app.db`.

6. **Production build**
   ```bash
   npm run build && npm start
   ```
   Serve over HTTPS in production — the app sets `Secure` cookies and HSTS
   once `NODE_ENV=production`.

## Verified before calling this done

- `npm run build`, `npm run lint`, and `npm audit` all pass clean (0
  vulnerabilities). `npm test` passes 82/82.
- Manually verified via HTTP: login/logout, CSRF rejection on a mutating
  request without the token, unauthenticated requests get 401, an
  approved `EXTERNAL_ACTION` with no connected provider fails safely
  (status `failed` with a clear error, never a fake success), a decided
  approval cannot be decided again (idempotency), rejection never executes
  the tool, preferences/password/data-export/data-delete all round-trip
  correctly, and no secret value appears anywhere in the built client
  bundle.
- Gmail OAuth specifically verified live (not just unit tests) against the
  running dev server: the connect link correctly redirects to `/email` with
  an honest "not configured" error when no Google credentials are set; the
  callback correctly rejects a forged/invalid `state` value and a
  `?error=access_denied` cancellation, in both cases leaving the connection
  as `not_connected` with no tokens stored (checked directly in the DB);
  no hydration/console errors on the Email page across all of that.
- All primary screens (Login, Home, AI Chat, Email, Social, Approvals,
  Activity, Settings + subpages) were rendered and screenshotted at an
  iPhone viewport (390×844) to confirm the mobile layout.
- **Not verified**: actual OpenAI response quality/streaming under load —
  this sandbox's network egress doesn't reach `api.openai.com`, so the AI
  calls were confirmed to fail *safely* (clear 502 + message, no crash, no
  fabricated content) rather than confirmed to produce great output. Test
  a real chat message and "Generate draft" on Social once you supply a
  real `OPENAI_API_KEY` outside this sandbox.
- **Not verified**: a real end-to-end Gmail OAuth consent (this sandbox has
  no real Google Cloud OAuth client and OAuth consent requires a human at
  a real browser — it can't be scripted). Network reachability to Google's
  OAuth/Gmail endpoints was confirmed from this sandbox, and every code
  path was tested with realistic mocked responses (`tests/unit/gmail-*.ts`,
  `tests/unit/oauth-state.test.ts`), but the actual "click Connect, approve
  on Google's real consent screen, land back connected" flow needs to be
  run by you with real credentials.
- **Not implemented**: Gmail sending/replying/deleting/archiving/labeling
  (deliberately, this phase is read-only only), Outlook, and OAuth for any
  social platform — those require you to register apps with each provider
  and decide which ones you actually want first.
