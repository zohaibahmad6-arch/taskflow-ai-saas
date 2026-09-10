"use client";

import { useEffect, useState } from "react";
import { SubpageHeader } from "@/components/SubpageHeader";
import { apiFetch } from "@/lib/csrfClient";

type Prefs = {
  writingStyle: string;
  tone: string;
  preferredLength: string;
  audience: string;
  topics: string[];
  avoidTopics: string[];
  hashtagPreference: string;
  formattingNotes: string;
  aiInstructions: string;
};

const EMPTY: Prefs = {
  writingStyle: "",
  tone: "",
  preferredLength: "",
  audience: "",
  topics: [],
  avoidTopics: [],
  hashtagPreference: "",
  formattingNotes: "",
  aiInstructions: "",
};

export default function ContentStylePage() {
  const [prefs, setPrefs] = useState<Prefs>(EMPTY);
  const [topicsText, setTopicsText] = useState("");
  const [avoidText, setAvoidText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiFetch("/api/preferences")
      .then((r) => r.json())
      .then((data) => {
        setPrefs(data.preferences);
        setTopicsText((data.preferences.topics ?? []).join(", "));
        setAvoidText((data.preferences.avoidTopics ?? []).join(", "));
      })
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    setSaved(false);
    const payload = {
      ...prefs,
      topics: topicsText.split(",").map((t) => t.trim()).filter(Boolean),
      avoidTopics: avoidText.split(",").map((t) => t.trim()).filter(Boolean),
    };
    await apiFetch("/api/preferences", { method: "PUT", body: JSON.stringify(payload) });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (loading) {
    return (
      <div>
        <SubpageHeader title="Content Style" />
        <p className="px-4 pt-4 text-sm text-muted">Loading…</p>
      </div>
    );
  }

  return (
    <div>
      <SubpageHeader title="Content Style" />
      <div className="mx-auto max-w-md space-y-4 px-4 pt-4 pb-24">
        <p className="text-xs text-muted">
          These preferences shape everything the AI drafts for email and social posts. Nothing is
          assumed — leave a field blank if you have no preference.
        </p>

        <Field label="Writing style" value={prefs.writingStyle} onChange={(v) => setPrefs({ ...prefs, writingStyle: v })} placeholder="e.g. direct, concise, technical" />
        <Field label="Tone" value={prefs.tone} onChange={(v) => setPrefs({ ...prefs, tone: v })} placeholder="e.g. professional but warm" />
        <Field label="Preferred length" value={prefs.preferredLength} onChange={(v) => setPrefs({ ...prefs, preferredLength: v })} placeholder="e.g. short, 2-3 sentences" />
        <Field label="Audience" value={prefs.audience} onChange={(v) => setPrefs({ ...prefs, audience: v })} placeholder="e.g. fellow engineers and hiring managers" />
        <Field label="Preferred topics (comma-separated)" value={topicsText} onChange={setTopicsText} placeholder="engineering leadership, AI, career growth" />
        <Field label="Topics to avoid (comma-separated)" value={avoidText} onChange={setAvoidText} placeholder="politics, religion" />
        <Field label="Hashtag preference" value={prefs.hashtagPreference} onChange={(v) => setPrefs({ ...prefs, hashtagPreference: v })} placeholder="e.g. none, or 2-3 relevant ones" />
        <TextArea label="Formatting notes" value={prefs.formattingNotes} onChange={(v) => setPrefs({ ...prefs, formattingNotes: v })} placeholder="e.g. use short paragraphs, no emoji" />
        <TextArea label="Additional AI instructions" value={prefs.aiInstructions} onChange={(v) => setPrefs({ ...prefs, aiInstructions: v })} placeholder="Anything else the assistant should always keep in mind." />

        <button
          onClick={save}
          disabled={saving}
          className="w-full rounded-xl bg-accent py-3 text-sm font-medium text-accent-foreground active:scale-[0.98] disabled:opacity-60"
        >
          {saving ? "Saving…" : saved ? "Saved" : "Save preferences"}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-muted">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm text-foreground outline-none focus:border-accent"
      />
    </div>
  );
}

function TextArea({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-muted">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full resize-none rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm text-foreground outline-none focus:border-accent"
      />
    </div>
  );
}
