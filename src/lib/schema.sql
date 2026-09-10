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
-- must never claim a connection exists unless a row here says so.
CREATE TABLE IF NOT EXISTS connected_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, -- e.g. 'gmail', 'outlook', 'linkedin', 'x', 'facebook', 'instagram'
  category TEXT NOT NULL, -- 'email' | 'social'
  account_label TEXT,
  status TEXT NOT NULL DEFAULT 'not_connected', -- not_connected | connected | error | revoked
  scopes_json TEXT NOT NULL DEFAULT '[]',
  encrypted_tokens TEXT, -- AES-256-GCM ciphertext, never plaintext
  last_error TEXT,
  connected_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(user_id, provider)
);

CREATE TABLE IF NOT EXISTS email_summaries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  summary_date TEXT NOT NULL,
  urgent_json TEXT NOT NULL DEFAULT '[]',
  action_required_json TEXT NOT NULL DEFAULT '[]',
  follow_up_json TEXT NOT NULL DEFAULT '[]',
  fyi_json TEXT NOT NULL DEFAULT '[]',
  deadlines_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

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
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL UNIQUE, -- idempotency key
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  content TEXT NOT NULL,
  consequence TEXT NOT NULL,
  input_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending', -- pending|approved|rejected|expired|executed|failed
  requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL,
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
