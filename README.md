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
  implemented for Gmail in this phase.
- **Outlook / Microsoft 365 (read + approval-gated write)** — real OAuth 2.0
  against the Microsoft identity platform (authorization-code flow,
  server-side only). Reading (search, summarize, classify) works the same
  way Gmail's does. Unlike Gmail, Outlook also supports real mailbox
  *mutations* — move, archive, delete, mark read/unread, flag/unflag,
  apply a category, reply, forward — but **every one of them is an
  `EXTERNAL_ACTION` tool**: nothing ever touches your mailbox until you
  explicitly approve the exact action in the Approval Center. See "Outlook
  setup" below for the OAuth app registration steps and exactly which
  Graph permissions are requested and why.
- **Email classification & sorting ("sort my emails")** — works against
  either connected account. Ask the assistant to classify your inbox and
  it sorts real messages into one of ten categories (Urgent, Action
  Required, Deadline, Follow Up, Important, Informational, Newsletter,
  Marketing, Low Priority, Possible Spam) and — for Outlook — proposes a
  concrete move plan (e.g. "12 newsletters → Newsletters folder"). The
  plan is only ever a preview: **nothing moves until you say "approve"**,
  and approval executes exactly the list you reviewed, never anything
  discovered afterward. Destination folders come from a fixed, code-owned
  mapping, never from the AI's own judgment — so nothing in a message's
  content can steer where mail actually gets filed.
- **Email reply drafting** — paste an email, or reference a real message by
  id from search/summary results, and ask for a reply; either way this
  only prepares text, it never sends anything on its own (Outlook's
  `outlook.sendReply`/`outlook.forwardMessage` can turn a real draft into
  a real send, but only after approval).
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

- **Outlook** — the integration is fully implemented (real Graph API calls,
  real OAuth, real approval-gated mutations), but no Azure app registration
  exists in this deployment by default. Until you configure real
  `MICROSOFT_OAUTH_*` credentials (see "Outlook setup" below), it honestly
  shows "Not connected"/"Outlook isn't set up on this server yet" rather
  than pretending to work.
- **Gmail sending, replying, forwarding, deleting, archiving, labeling** —
  reading is real (see above); every mutation is deliberately out of scope
  for Gmail in this phase (it was connected with `gmail.readonly` scope
  only, so there is no real send/modify API this could call even if
  implemented). `email.send` still exists as an `EXTERNAL_ACTION` tool but
  its `execute()` always fails honestly rather than pretending to send.
  Outlook's equivalent tools (`outlook.sendReply`, `outlook.forwardMessage`,
  `outlook.moveMessages`, etc.) are real, not stubs.
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
src/lib/microsoftOAuth.ts Same pattern as googleOAuth.ts, for the Microsoft
                          identity platform (Outlook/Graph).
src/lib/connections.ts   Connected-account storage: encrypt/decrypt tokens,
                          and the ONLY function allowed to mark a provider
                          "connected" (storeVerifiedConnection) vs. every
                          other mutator (error/disconnect/refresh), which
                          structurally cannot. Fully provider-agnostic —
                          Gmail and Outlook share this one implementation.
src/lib/email/           EmailProvider interface (read-only, on purpose —
                          no send/reply/delete method exists anywhere in
                          it) + GmailProvider and OutlookProvider, the real
                          implementations, + outlookActions.ts (the
                          *separate* mutation-only interface EmailProvider's
                          own doc comment anticipates — callable ONLY from
                          inside an EXTERNAL_ACTION tool's execute(), never
                          from a read path) + classification.ts (the fixed
                          10-category taxonomy + AI classification, with a
                          hardcoded, code-owned category→folder mapping so
                          message content can never steer where mail is
                          filed) + briefing.ts (daily-briefing data/service
                          layer, not wired to any scheduler yet, now
                          provider-aware) + promptSafety.ts (wraps email
                          content as untrusted before it goes into any AI
                          prompt).
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

Follow `src/lib/email/gmail.ts` (or `outlook.ts`, its Microsoft Graph
counterpart, added the same way) as the template: implement the
`EmailProvider` interface (read-only), verify a connection against a real
API call before ever calling `storeVerifiedConnection`, and store tokens
through `connections.ts`'s encrypt/decrypt helpers — never write your own.
For anything that sends/modifies/deletes, that's a mutation and belongs
behind an `EXTERNAL_ACTION` tool (see above), never inside a provider's
read interface — see `src/lib/email/outlookActions.ts` for that pattern:
plain functions, callable only from a tool's `execute()`, each returning
an explicit per-item success/failure breakdown rather than an all-or-
nothing result.

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
   - `MICROSOFT_OAUTH_CLIENT_ID` / `MICROSOFT_OAUTH_CLIENT_SECRET` /
     `MICROSOFT_OAUTH_REDIRECT_URI` — optional, for Outlook. Without these,
     Outlook honestly stays "not connected" (clicking Connect explains
     exactly what's missing) — everything else in the app works fine. To
     enable it:
     1. In the [Azure Portal](https://portal.azure.com/) → **App
        registrations** → **New registration**. Choose "Accounts in any
        organizational directory and personal Microsoft accounts" (this is
        a single-user app — whichever Microsoft account you connect is the
        one that gets used).
     2. Add a **Web** platform redirect URI matching
        `MICROSOFT_OAUTH_REDIRECT_URI` exactly (default:
        `http://localhost:3000/api/oauth/outlook/callback`; update both for
        production).
     3. Under **Certificates & secrets**, create a new client secret.
     4. Under **API permissions**, add these delegated **Microsoft Graph**
        permissions (the app requests exactly this set — see
        `src/lib/microsoftOAuth.ts` for the reasoning behind each one):
        - `openid`, `profile`, `email` — identify the signed-in account for
          display (e.g. "Connected as you@outlook.com"), verified against a
          real Graph `/me` call, never trusted from the token alone.
        - `offline_access` — required to receive a refresh token, so the
          connection survives past the ~1 hour access-token lifetime.
        - `Mail.Read` — the core read/search/summarize/classify capability.
        - `Mail.ReadWrite` — required for the approval-gated mailbox
          organization actions (move/archive/delete/mark/flag/category).
          Every use of this scope is behind an `EXTERNAL_ACTION` tool that
          only runs after you explicitly approve it — the scope makes an
          *already-approved* action possible, it is never a standing grant
          to act unsupervised.
        - `Mail.Send` — required for the approval-gated reply/forward
          tools, same reasoning as `Mail.ReadWrite`.
        - No calendar, contacts, files, directory, or admin-level
          permission is ever requested.
     5. Copy the Application (client) ID and the client secret's **value**
        (not its ID) into `.env.local`.

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
  vulnerabilities). `npm test` passes 138/138 (this includes everything
  from before plus ~56 new tests for Outlook OAuth, the Outlook provider,
  classification, organization planning, and every new `EXTERNAL_ACTION`
  tool's approval gating).
- Manually verified via HTTP: login/logout, CSRF rejection on a mutating
  request without the token, unauthenticated requests get 401, an
  approved `EXTERNAL_ACTION` with no connected provider fails safely
  (status `failed` with a clear error, never a fake success), a decided
  approval cannot be decided again (idempotency), rejection never executes
  the tool, preferences/password/data-export/data-delete all round-trip
  correctly, and no secret value appears anywhere in the built client
  bundle (checked `.next/static` specifically for the Microsoft client
  secret and a test password used only for this verification pass).
- Gmail **and Outlook** OAuth specifically verified live (not just unit
  tests) against the running dev server: the connect link correctly
  redirects to `/email` with an honest "not configured" error when no
  Google/Microsoft credentials are set; the callback correctly rejects a
  forged/invalid `state` value and a `?error=access_denied` cancellation,
  in both cases leaving the connection as `not_connected` with no tokens
  stored (checked directly in the DB); no hydration/console errors on the
  Email page (checked with Playwright at 390×844) across all of that, with
  both the Gmail and Outlook connection cards rendering their honest
  "Not connected" state side by side.
- All primary screens (Login, Home, AI Chat, Email, Social, Approvals,
  Activity, Settings + subpages) were rendered and screenshotted at an
  iPhone viewport (390×844) to confirm the mobile layout.
- **Not verified — REAL vs. MOCKED, stated plainly**: no actual Microsoft/
  Azure OAuth app exists in this environment, so **no real Outlook account
  has been connected**, and no real Microsoft Graph API call has ever
  succeeded against a real mailbox in this build. Everything above
  (mailbox search/summarize/classify, and every mutation — move, archive,
  delete, mark, flag, category, reply, forward) was exercised against
  **mocked Graph HTTP responses** in the unit test suite
  (`tests/unit/outlook-*.test.ts`) and against the honest not-configured/
  error paths live — never against a real mailbox. The actual "click
  Connect Outlook, approve on Microsoft's real consent screen, land back
  connected, see real messages, approve a real move" flow needs to be run
  by you with real Azure app credentials; this build cannot and does not
  claim that happened.
- Same as before for Gmail: no real end-to-end Gmail OAuth consent was
  performed in this sandbox either (no real Google Cloud OAuth client, and
  consent requires a human at a real browser).
- **Not verified**: actual OpenAI response quality/streaming under load —
  this sandbox's network egress doesn't reach `api.openai.com`, so the AI
  calls (including the new classification/organization-plan prompts) were
  confirmed to fail *safely* rather than confirmed to produce great
  output. Test a real chat message and "Sort my emails" once you supply a
  real `OPENAI_API_KEY` and connect a real account outside this sandbox.
- **Not implemented**: Gmail sending/replying/deleting/archiving/labeling
  (deliberately — Gmail is connected with `gmail.readonly` scope only in
  this build), multiple accounts of the *same* provider (one Gmail + one
  Outlook is supported; a second Gmail account is not), a settings-page
  "Connect" button for Gmail/Outlook (`/settings/connections` uses a
  generic fetch-based connect action that doesn't handle the real
  redirect-based OAuth flow those two providers need — a pre-existing gap
  from before this build, not something new; use the dedicated cards on
  the Email page instead, which do this correctly), and OAuth for any
  social platform — those require you to register apps with each provider
  and decide which ones you actually want first.
- **No voice input/output exists anywhere in this codebase** (verified by
  a repo-wide scan for speech/microphone/TTS code — see
  `tests/unit/voice-command-scope.test.ts`) and none was added this
  session. This matters for the security model: every command, typed or
  hypothetically spoken, has exactly one path into a tool (`invokeTool()`
  in `src/lib/tools/execute.ts`) and exactly one path to actually mutate a
  mailbox (an `EXTERNAL_ACTION` tool's `execute()`, reachable only from
  `approvals.ts` after a real approval decision). There is no alternate,
  voice-specific route to either — so if voice input is added later, it
  can only ever produce text/tool-calls that go through this same gate;
  it cannot get a new, weaker path of its own without changing this
  architecture. No feature described anywhere in this README as
  "voice-controlled" exists — do not test or advertise it as if it does.
