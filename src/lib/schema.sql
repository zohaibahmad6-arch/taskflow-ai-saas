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

-- `timezone` is a nullable IANA identifier (e.g. "Europe/London") used
-- ONLY to compute the Daily Briefing's local calendar date (see
-- dailyBriefing.ts) — never assumed, never auto-detected server-side, and
-- never trusted without validation (see src/lib/timezone.ts). NULL means
-- "not set", and every reader of this column must fall back to UTC in
-- that case (and for any value that somehow fails validation) rather than
-- guessing or erroring.
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
  timezone TEXT,
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
  provider TEXT NOT NULL DEFAULT 'gmail', -- which connected account this briefing was generated from
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

-- The Personal Notification Center. `type` is kept for backwards
-- compatibility (existing rows/callers) but new code should read/write
-- `category` — one of EMAIL | JOB | APPLICATION | APPROVAL | SYSTEM.
-- `reference_id` is a stable identifier for the underlying event (e.g. an
-- approval id) used to avoid re-notifying about the same unresolved thing
-- (see notifyUser's dedup check in push.ts). Notifications are informational
-- only: nothing reads this table to decide whether an action is authorized
-- — see approvals.ts, which is the sole place decisions are made.
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'SYSTEM',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  reference_id TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read, created_at DESC);
-- idx_notifications_user_reference is created in db.ts's runMigrations(),
-- not here: on a pre-existing database this file runs BEFORE the
-- reference_id column migration below, so an index referencing that
-- column here would fail on any database created before this feature.

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

-- Verified candidate profile/CV facts — the single source of truth job
-- matching and screening-answer preparation are grounded against. Nothing
-- in the jobs feature may invent experience/qualifications/certifications
-- not present here (or in cv_text); "unknown" is always the honest
-- fallback for anything not covered. High-stakes screening fields (right
-- to work, notice period, salary expectation, relocation/travel) are
-- entered directly by the user, never AI-inferred.
CREATE TABLE IF NOT EXISTS candidate_profile (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name TEXT,
  headline TEXT,
  location TEXT,
  years_experience INTEGER,
  cv_text TEXT NOT NULL DEFAULT '', -- free-text CV/resume the user pasted; primary grounding source for matching
  skills_json TEXT NOT NULL DEFAULT '[]',
  certifications_json TEXT NOT NULL DEFAULT '[]', -- [{name, issuer, year}]
  employment_json TEXT NOT NULL DEFAULT '[]', -- [{employer, title, startDate, endDate, description}]
  education_json TEXT NOT NULL DEFAULT '[]', -- [{institution, degree, field, year}]
  right_to_work TEXT, -- e.g. "UK citizen", "requires sponsorship" — user-entered, never inferred
  notice_period TEXT,
  salary_expectation TEXT,
  willing_to_relocate TEXT, -- free text/tri-state, e.g. "yes", "no", "case by case" — null = unknown
  willing_to_travel TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Normalized job postings. Always captured from text the USER pasted (from
-- LinkedIn or anywhere else they're browsing themselves) — never fetched
-- via automated search or scraping, since no legitimate LinkedIn API for
-- that exists for this app (see README). source_url/description are
-- exactly what the user provided; extracted_json holds the AI's
-- structured read of that text (requirements, responsibilities, etc.) —
-- analysis, never a claim of additional fetched information.
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'linkedin_pasted', -- linkedin_pasted | manual
  source_url TEXT,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  location TEXT,
  description TEXT NOT NULL, -- the raw pasted posting text, verbatim
  employment_type TEXT, -- e.g. full-time | contract | unknown
  experience_level TEXT,
  salary TEXT,
  posted_at TEXT, -- free text as stated in the posting ("2 days ago"), or NULL if unknown — never computed/guessed
  easy_apply_status TEXT NOT NULL DEFAULT 'unknown', -- verified | not_available | unknown — verified ONLY on literal textual evidence, never inferred
  application_type TEXT NOT NULL DEFAULT 'unknown', -- easy_apply | external | unknown
  application_url TEXT,
  extracted_json TEXT NOT NULL DEFAULT '{}', -- AI-extracted structured requirements/responsibilities/etc — see jobs/extraction.ts
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_jobs_user_created ON jobs(user_id, created_at DESC);

-- Application preparation/tracking per job. Nothing here represents a
-- real LinkedIn submission unless status = 'submitted', and that status
-- is only ever set by the user's own explicit self-report (jobs.markSubmitted)
-- after they complete it themselves on LinkedIn — this app has no
-- legitimate way to submit or verify a LinkedIn application (see README),
-- so it never claims to have done so.
CREATE TABLE IF NOT EXISTS job_applications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'prepared', -- prepared | awaiting_approval | ready_for_manual_submission | submitted | failed | blocked | unknown
  match_score INTEGER, -- 0-100, computed from match_reasons_json, never a raw AI-invented number
  match_reasons_json TEXT NOT NULL DEFAULT '[]', -- [{requirement, level: strong|partial|gap|unknown, evidence}]
  cv_note TEXT, -- which CV/profile snapshot was used (this build has one profile, so mostly informational)
  cover_letter TEXT,
  screening_answers_json TEXT NOT NULL DEFAULT '[]', -- [{question, answer, source: profile|user_provided|unknown}]
  missing_info_json TEXT NOT NULL DEFAULT '[]',
  approval_id TEXT,
  submitted_at TEXT, -- set only by the user's own self-report, never by execute()
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_job_applications_user_job ON job_applications(user_id, job_id);

-- Simple in-DB rate-limit ledger so limits survive process restarts.
CREATE TABLE IF NOT EXISTS rate_limit_hits (
  bucket_key TEXT NOT NULL,
  hit_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_bucket ON rate_limit_hits(bucket_key, hit_at);

-- The aggregated Daily Personal Briefing (email + jobs + approvals). Holds
-- only counts and short reference-based item summaries (ids, subjects,
-- snippets, reasons) already minimized by the underlying tables this is
-- aggregated FROM (email_summaries, jobs, job_applications, approvals) —
-- never full email bodies. UNIQUE(user_id, briefing_date) is what makes
-- generation idempotent: a retry (or a future scheduler firing twice)
-- upserts the same row instead of creating a duplicate — see
-- src/lib/dailyBriefing.ts. `briefing_date` is the UTC calendar date
-- (see that file for why: no per-user timezone preference exists yet).
CREATE TABLE IF NOT EXISTS daily_briefings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  briefing_date TEXT NOT NULL,
  summary_text TEXT NOT NULL DEFAULT '',
  urgent_count INTEGER NOT NULL DEFAULT 0,
  actions_count INTEGER NOT NULL DEFAULT 0,
  deadlines_count INTEGER NOT NULL DEFAULT 0,
  approvals_count INTEGER NOT NULL DEFAULT 0,
  jobs_count INTEGER NOT NULL DEFAULT 0,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(user_id, briefing_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_briefings_user_date ON daily_briefings(user_id, briefing_date DESC);
