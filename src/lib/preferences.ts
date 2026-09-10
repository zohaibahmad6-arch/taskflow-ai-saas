import "server-only";
import { db, nowIso } from "./db";
import { isValidIanaTimezone } from "./timezone";

export type PreferencesRow = {
  user_id: string;
  writing_style: string | null;
  tone: string | null;
  preferred_length: string | null;
  audience: string | null;
  topics_json: string;
  avoid_topics_json: string;
  hashtag_preference: string | null;
  formatting_notes: string | null;
  ai_instructions: string | null;
  timezone: string | null;
  updated_at: string;
};

export function getPreferences(userId: string): PreferencesRow {
  const row = db.prepare("SELECT * FROM preferences WHERE user_id = ?").get(userId) as
    | PreferencesRow
    | undefined;
  if (row) return row;

  db.prepare("INSERT INTO preferences (user_id) VALUES (?)").run(userId);
  return db.prepare("SELECT * FROM preferences WHERE user_id = ?").get(userId) as PreferencesRow;
}

export type PreferencesUpdate = Partial<{
  writingStyle: string;
  tone: string;
  preferredLength: string;
  audience: string;
  topics: string[];
  avoidTopics: string[];
  hashtagPreference: string;
  formattingNotes: string;
  aiInstructions: string;
  /**
   * An IANA timezone identifier, or null to clear it back to "not set"
   * (UTC fallback). MUST already be validated by the caller (see the
   * /api/preferences route's use of isValidIanaTimezone) — this function
   * trusts its input, it does not re-validate.
   */
  timezone: string | null;
}>;

export function updatePreferences(userId: string, update: PreferencesUpdate): PreferencesRow {
  getPreferences(userId); // ensure row exists

  // Defense in depth: even though the /api/preferences route already
  // validates this before calling here, never let a raw, unvalidated
  // client-controlled timezone string reach the database from any path.
  if (update.timezone != null && !isValidIanaTimezone(update.timezone)) {
    throw new Error(`"${update.timezone}" is not a recognized IANA timezone identifier.`);
  }

  const fields: string[] = [];
  const values: unknown[] = [];

  const map: Record<string, unknown> = {
    writing_style: update.writingStyle,
    tone: update.tone,
    preferred_length: update.preferredLength,
    audience: update.audience,
    topics_json: update.topics ? JSON.stringify(update.topics) : undefined,
    avoid_topics_json: update.avoidTopics ? JSON.stringify(update.avoidTopics) : undefined,
    hashtag_preference: update.hashtagPreference,
    formatting_notes: update.formattingNotes,
    ai_instructions: update.aiInstructions,
    timezone: update.timezone,
  };

  for (const [column, value] of Object.entries(map)) {
    if (value !== undefined) {
      fields.push(`${column} = ?`);
      values.push(value);
    }
  }

  if (fields.length > 0) {
    fields.push("updated_at = ?");
    values.push(nowIso());
    values.push(userId);
    db.prepare(`UPDATE preferences SET ${fields.join(", ")} WHERE user_id = ?`).run(...values);
  }

  return getPreferences(userId);
}

export function describePreferencesForPrompt(prefs: PreferencesRow): string {
  const topics = JSON.parse(prefs.topics_json || "[]") as string[];
  const avoid = JSON.parse(prefs.avoid_topics_json || "[]") as string[];
  const lines: string[] = [];
  if (prefs.writing_style) lines.push(`Writing style: ${prefs.writing_style}`);
  if (prefs.tone) lines.push(`Tone: ${prefs.tone}`);
  if (prefs.preferred_length) lines.push(`Preferred length: ${prefs.preferred_length}`);
  if (prefs.audience) lines.push(`Audience: ${prefs.audience}`);
  if (topics.length) lines.push(`Preferred topics: ${topics.join(", ")}`);
  if (avoid.length) lines.push(`Topics to avoid: ${avoid.join(", ")}`);
  if (prefs.hashtag_preference) lines.push(`Hashtag preference: ${prefs.hashtag_preference}`);
  if (prefs.formatting_notes) lines.push(`Formatting notes: ${prefs.formatting_notes}`);
  if (prefs.ai_instructions) lines.push(`Additional instructions: ${prefs.ai_instructions}`);
  return lines.length
    ? lines.join("\n")
    : "No content style preferences have been set yet. Do not invent any — ask if it matters, otherwise use a neutral professional style.";
}
