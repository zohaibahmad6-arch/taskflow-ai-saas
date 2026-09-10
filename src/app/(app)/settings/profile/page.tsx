"use client";

import { useEffect, useState } from "react";
import { SubpageHeader } from "@/components/SubpageHeader";
import { apiFetch } from "@/lib/csrfClient";

type Profile = {
  fullName: string;
  headline: string;
  location: string;
  yearsExperience: number | null;
  cvText: string;
  skills: string[];
  rightToWork: string;
  noticePeriod: string;
  salaryExpectation: string;
  willingToRelocate: string;
  willingToTravel: string;
};

const EMPTY: Profile = {
  fullName: "",
  headline: "",
  location: "",
  yearsExperience: null,
  cvText: "",
  skills: [],
  rightToWork: "",
  noticePeriod: "",
  salaryExpectation: "",
  willingToRelocate: "",
  willingToTravel: "",
};

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile>(EMPTY);
  const [skillsText, setSkillsText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiFetch("/api/profile")
      .then((r) => r.json())
      .then((data) => {
        // The API returns null for any unset text field — coerce to "" so
        // every text input here stays controlled (a null value prop
        // triggers a React warning and an uncontrolled/controlled flip).
        const p = data.profile ?? {};
        setProfile({
          ...EMPTY,
          ...p,
          fullName: p.fullName ?? "",
          headline: p.headline ?? "",
          location: p.location ?? "",
          cvText: p.cvText ?? "",
          rightToWork: p.rightToWork ?? "",
          noticePeriod: p.noticePeriod ?? "",
          salaryExpectation: p.salaryExpectation ?? "",
          willingToRelocate: p.willingToRelocate ?? "",
          willingToTravel: p.willingToTravel ?? "",
        });
        setSkillsText((p.skills ?? []).join(", "));
      })
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    setSaved(false);
    const payload = {
      ...profile,
      skills: skillsText.split(",").map((t) => t.trim()).filter(Boolean),
    };
    await apiFetch("/api/profile", { method: "PUT", body: JSON.stringify(payload) });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (loading) {
    return (
      <div>
        <SubpageHeader title="Profile / CV" />
        <p className="px-4 pt-4 text-sm text-muted">Loading…</p>
      </div>
    );
  }

  return (
    <div>
      <SubpageHeader title="Profile / CV" />
      <div className="mx-auto max-w-md space-y-4 px-4 pt-4 pb-24">
        <p className="text-xs text-muted">
          This is the ONLY source of truth job matching and application prep are grounded against —
          the assistant never invents experience, qualifications, or answers beyond what&apos;s here.
          Leave anything blank that doesn&apos;t apply; it will honestly show as &quot;unknown&quot;
          rather than being guessed.
        </p>

        <Field label="Full name" value={profile.fullName} onChange={(v) => setProfile({ ...profile, fullName: v })} />
        <Field label="Headline" value={profile.headline} onChange={(v) => setProfile({ ...profile, headline: v })} placeholder="e.g. Senior Gas Turbine Field Service Engineer" />
        <Field label="Current location" value={profile.location} onChange={(v) => setProfile({ ...profile, location: v })} />
        <Field
          label="Years of experience"
          value={profile.yearsExperience?.toString() ?? ""}
          onChange={(v) => setProfile({ ...profile, yearsExperience: v.trim() === "" ? null : Number(v) || null })}
          placeholder="e.g. 12"
        />
        <Field label="Skills (comma-separated)" value={skillsText} onChange={setSkillsText} placeholder="gas turbines, field service, OEM..." />
        <Field label="Right to work" value={profile.rightToWork} onChange={(v) => setProfile({ ...profile, rightToWork: v })} placeholder="e.g. UK citizen, requires sponsorship" />
        <Field label="Notice period" value={profile.noticePeriod} onChange={(v) => setProfile({ ...profile, noticePeriod: v })} placeholder="e.g. 4 weeks" />
        <Field label="Salary expectation" value={profile.salaryExpectation} onChange={(v) => setProfile({ ...profile, salaryExpectation: v })} />
        <Field label="Willing to relocate" value={profile.willingToRelocate} onChange={(v) => setProfile({ ...profile, willingToRelocate: v })} placeholder="yes / no / case by case" />
        <Field label="Willing to travel" value={profile.willingToTravel} onChange={(v) => setProfile({ ...profile, willingToTravel: v })} placeholder="e.g. up to 75%" />
        <TextArea
          label="Full CV / resume text"
          value={profile.cvText}
          onChange={(v) => setProfile({ ...profile, cvText: v })}
          placeholder="Paste your CV/resume text here — employment history, education, certifications, etc."
          rows={10}
        />

        <button
          onClick={save}
          disabled={saving}
          className="w-full rounded-xl bg-accent py-3 text-sm font-medium text-accent-foreground active:scale-[0.98] disabled:opacity-60"
        >
          {saving ? "Saving…" : saved ? "Saved" : "Save profile"}
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
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-muted">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full resize-none rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm text-foreground outline-none focus:border-accent"
      />
    </div>
  );
}
