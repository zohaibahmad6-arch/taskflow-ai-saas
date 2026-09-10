-- Personal AI Agent database schema.
-- Single-user application: exactly one row will ever exist in `users`.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_secret TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  writing_style TEXT,
  tone TEXT,
  preferred_length TEXT,
  audience TEXT,
  topics_json TEXT NOT NULL DEFAULT '[]',
  avoid_topics_json TEXT NOT NULL DEFAULT '[]',
  hashtag_preference TEXT,
  formatting_notes TEXT,
  ai_instructions TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Connected external services (email providers, social platforms).
-- `status` is the single source of truth the UI must read from; the UI
-- must never claim a connection exists unless a row here says so, and
-- nothing may set status='connected' except the OAuth callback after it
-- has verified the token against a real API call (see gmail.ts).
CREATE TABLE IF NOT EXISTS connected_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, -- e.g. 'gmail', 'outlook', 'linkedin', 'x', 'facebook', 'instagram'
  category TEXT NOT NULL, -- 'email' | 'social'
  account_label TEXT, -- e.g. the connected Gmail address; never a secret
  status TEXT NOT NULL DEFAULT 'not_connected', -- not_connected | connected | error | revoked
  scopes_json TEXT NOT NULL DEFAULT '[]',
  encrypted_tokens TEXT, -- AES-256-GCM ciphertext (JSON: access/refresh token + expiry), never plaintext
  last_error TEXT,
  connected_at TEXT,
  last_synced_at TEXT, -- last successful real API read
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(user_id, provider)
);

-- Single-use, short-lived OAuth CSRF state tokens. A row is created right
-- before redirecting to the provider's consent screen and deleted the
-- moment the callback consumes it (or expires), so a state value can
-- never be replayed.
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL
);

-- Stored daily briefings. Deliberately holds only short references to
-- source messages (id/subject/snippet), never full bodies — see
-- src/lib/email/briefing.ts. Nothing schedules writes to this table yet;
-- it is populated on-demand (e.g. "Summarize my inbox"), never
-- fabricated when no provider is connected.
CREATE TABLE IF NOT EXISTS email_summaries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  summary_date TEXT NOT NULL,
  summary_text TEXT NOT NULL DEFAULT '',
  urgent_json TEXT NOT NULL DEFAULT '[]',
  action_required_json TEXT NOT NULL DEFAULT '[]',
  follow_up_json TEXT NOT NULL DEFAULT '[]',
  fyi_json TEXT NOT NULL DEFAULT '[]',
  deadlines_json TEXT NOT NULL DEFAULT '[]',
  source_message_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_email_summaries_user_date ON email_summaries(user_id, summary_date DESC);

CREATE TABLE IF NOT EXISTS social_drafts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL, -- linkedin | x | facebook | instagram
  content TEXT NOT NULL,
  source_note TEXT,
  status TEXT NOT NULL DEFAULT 'draft', -- draft | ready | approved | published | rejected
  approval_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- The Approval Center. Every EXTERNAL_ACTION tool call creates exactly one
-- row here before anything external can happen, and execution is only ever
-- triggered from the approve endpoint after status = 'approved'.
--
-- payload_json is the SOLE authoritative, structured input that execution
-- reads from — never a separate/original copy. action/target/content/
-- consequence are display text derived FROM payload_json (via a tool's
-- describePayload) and are recomputed every time payload_json changes, so
-- they can never drift from what will actually execute. `revision` is
-- bumped on every edit and must be echoed back by the decide endpoint
-- (optimistic concurrency), so approving cannot silently act on a payload
-- older than the one the user last reviewed.
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL UNIQUE, -- idempotency key
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  content TEXT NOT NULL,
  consequence TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|approved|rejected|expired|executed|failed
  requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL,
  edited_at TEXT,
  decided_at TEXT,
  executed_at TEXT,
  result_json TEXT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_approvals_user_status ON approvals(user_id, status);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_id TEXT,
  tool_id TEXT NOT NULL,
  event_type TEXT NOT NULL, -- proposed|approved|rejected|executed|failed|expired|info
  summary TEXT NOT NULL,
  target TEXT,
  detail_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_user_created ON audit_events(user_id, created_at DESC);

-- Mirror of the in-code tool registry, refreshed on server start.
-- Lets future tools be inspected/administered without a code deploy,
-- while handlers themselves always live in code (never DB-stored logic).
CREATE TABLE IF NOT EXISTS tool_registry (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL, -- email | social | research | document | automation | system
  permission_level TEXT NOT NULL, -- READ_ONLY | PREPARATION | EXTERNAL_ACTION
  approval_required INTEGER NOT NULL,
  input_schema_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS capability_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_text TEXT NOT NULL,
  proposal_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed', -- proposed|approved_for_build|rejected
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read, created_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL, -- system | user | assistant | tool
  content TEXT NOT NULL,
  tool_calls_json TEXT,
  tool_call_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_conversation ON chat_messages(user_id, conversation_id, created_at);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  keys_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Simple in-DB rate-limit ledger so limits survive process restarts.
CREATE TABLE IF NOT EXISTS rate_limit_hits (
  bucket_key TEXT NOT NULL,
  hit_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_bucket ON rate_limit_hits(bucket_key, hit_at);
