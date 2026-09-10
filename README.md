# Personal Agent

A private, single-user, mobile-first AI agent. Built with Next.js (App Router),
SQLite (via `better-sqlite3`), and the OpenAI API. There is no public
registration — this app is wired for exactly one authorized user.

This is a standalone project. It shares no code, credentials, database,
branding, or infrastructure with any other app.

## What's actually working right now

- **Authentication** — single owner account, bcrypt-hashed password, httpOnly
  signed session cookies validated against the DB on every request, CSRF
  double-submit protection on all mutating requests, rate-limited login.
- **AI Chat** — full tool-calling loop against the OpenAI API. Conversation
  history is persisted per-conversation.
- **Approval Center** — every external/irreversible action (send email,
  publish a post) is server-side classified and *must* go through here.
  Approving/rejecting/expiring is enforced in the backend, not just the UI;
  there is no code path that lets a tool skip it. Each action has a unique
  id (idempotent — re-approving or re-executing is a no-op, never a
  duplicate send). Approvals expire automatically (24h) if ignored.
- **Activity / audit log** — every proposal, approval, rejection, execution,
  and failure is recorded with a timestamp. No secrets are ever written to
  it.
- **Social content generation** — `Create a post` on the Social tab (or via
  chat) really calls the OpenAI API and drafts real content using your
  saved Content Style preferences. Nothing is published until you approve
  it in the Approval Center, and publishing itself is honestly stubbed (see
  below) until you connect a real platform.
- **Email reply drafting** — paste an email into AI Chat and ask for a
  reply; this works today because it never touches a real mailbox.
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

- **Gmail / Outlook** — no OAuth app is registered. The Email tab always
  shows "Not connected" until you configure real OAuth credentials and wire
  up the provider's API calls in `src/lib/tools/email/index.ts`.
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
src/lib/approvals.ts     Approval Center backend: create/decide/execute,
                          expiration, idempotent execution.
src/lib/audit.ts         Append-only audit log.
src/lib/ai/chat.ts       OpenAI tool-calling loop.
src/lib/auth.ts          Session + CSRF.
src/lib/crypto.ts        AES-256-GCM helpers for encrypting OAuth tokens
                          at rest (ready for when real providers are wired
                          up).
src/lib/push.ts          Web Push (VAPID) + in-app notifications.
src/lib/schema.sql       SQLite schema (single source of truth).
src/proxy.ts             Auth gate, security headers, CSRF check for every
                          request (Next's "proxy", formerly "middleware").
```

### Adding a new capability

Tools are registered in `src/lib/tools/index.ts`. A new tool is a
`ToolDefinition` (see `src/lib/tools/types.ts`) declaring its
`permissionLevel`. If it's `EXTERNAL_ACTION`, it must implement
`buildApprovalDraft` (what to show the user) and `execute` (the real side
effect, only ever invoked after approval) — the registry refuses to
register an `EXTERNAL_ACTION` tool missing either. This is also exactly
what the AI does when you ask it to "build a new capability": it proposes
a classified plan (`system.proposeCapability`) but does not write or
install code itself — that's a development task, by design.

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
   - `SESSION_SECRET` — `openssl rand -base64 48`
   - `APP_ENCRYPTION_KEY` — `openssl rand -base64 32`
   - `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` — optional, for push
     notifications: `npx web-push generate-vapid-keys --json`

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

5. **Production build**
   ```bash
   npm run build && npm start
   ```
   Serve over HTTPS in production — the app sets `Secure` cookies and HSTS
   once `NODE_ENV=production`.

## Verified before calling this done

- `npm run build` and `npm run lint` both pass clean.
- Manually verified via HTTP: login/logout, CSRF rejection on a mutating
  request without the token, unauthenticated requests get 401, an
  approved `EXTERNAL_ACTION` with no connected provider fails safely
  (status `failed` with a clear error, never a fake success), a decided
  approval cannot be decided again (idempotency), rejection never executes
  the tool, preferences/password/data-export/data-delete all round-trip
  correctly, and no secret value appears anywhere in the built client
  bundle.
- All primary screens (Login, Home, AI Chat, Email, Social, Approvals,
  Activity, Settings + subpages) were rendered and screenshotted at an
  iPhone viewport (390×844) to confirm the mobile layout.
- **Not verified**: actual OpenAI response quality/streaming under load —
  this sandbox's network egress doesn't reach `api.openai.com`, so the AI
  calls were confirmed to fail *safely* (clear 502 + message, no crash, no
  fabricated content) rather than confirmed to produce great output. Test
  a real chat message and "Generate draft" on Social once you supply a
  real `OPENAI_API_KEY` outside this sandbox.
- **Not implemented**: real OAuth for any email/social provider (see
  above) — that requires you to register apps with each provider and
  decide which ones you actually want first.
