import "server-only";
import { db, nowIso } from "./db";

/**
 * The verified source of truth for job matching, screening answers, and
 * cover letter generation. Nothing in the jobs feature may invent
 * experience/qualifications/certifications/dates not present here — every
 * matching/prep function must treat this (plus cv_text) as the only
 * ground truth and fall back to "unknown" for anything else. Mirrors
 * preferences.ts's storage pattern exactly, but is a fully separate
 * table/domain (career facts, not writing-style preferences).
 */
export type CandidateProfileRow = {
  user_id: string;
  full_name: string | null;
  headline: string | null;
  location: string | null;
  years_experience: number | null;
  cv_text: string;
  skills_json: string;
  certifications_json: string;
  employment_json: string;
  education_json: string;
  right_to_work: string | null;
  notice_period: string | null;
  salary_expectation: string | null;
  willing_to_relocate: string | null;
  willing_to_travel: string | null;
  updated_at: string;
};

export type Certification = { name: string; issuer?: string; year?: string };
export type EmploymentEntry = { employer: string; title: string; startDate?: string; endDate?: string; description?: string };
export type EducationEntry = { institution: string; degree?: string; field?: string; year?: string };

export function getCandidateProfile(userId: string): CandidateProfileRow {
  const row = db.prepare("SELECT * FROM candidate_profile WHERE user_id = ?").get(userId) as
    | CandidateProfileRow
    | undefined;
  if (row) return row;

  db.prepare("INSERT INTO candidate_profile (user_id) VALUES (?)").run(userId);
  return db.prepare("SELECT * FROM candidate_profile WHERE user_id = ?").get(userId) as CandidateProfileRow;
}

export type CandidateProfileUpdate = Partial<{
  fullName: string;
  headline: string;
  location: string;
  yearsExperience: number | null;
  cvText: string;
  skills: string[];
  certifications: Certification[];
  employment: EmploymentEntry[];
  education: EducationEntry[];
  rightToWork: string;
  noticePeriod: string;
  salaryExpectation: string;
  willingToRelocate: string;
  willingToTravel: string;
}>;

export function updateCandidateProfile(userId: string, update: CandidateProfileUpdate): CandidateProfileRow {
  getCandidateProfile(userId); // ensure row exists
  const fields: string[] = [];
  const values: unknown[] = [];

  const map: Record<string, unknown> = {
    full_name: update.fullName,
    headline: update.headline,
    location: update.location,
    years_experience: update.yearsExperience,
    cv_text: update.cvText,
    skills_json: update.skills ? JSON.stringify(update.skills) : undefined,
    certifications_json: update.certifications ? JSON.stringify(update.certifications) : undefined,
    employment_json: update.employment ? JSON.stringify(update.employment) : undefined,
    education_json: update.education ? JSON.stringify(update.education) : undefined,
    right_to_work: update.rightToWork,
    notice_period: update.noticePeriod,
    salary_expectation: update.salaryExpectation,
    willing_to_relocate: update.willingToRelocate,
    willing_to_travel: update.willingToTravel,
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
    db.prepare(`UPDATE candidate_profile SET ${fields.join(", ")} WHERE user_id = ?`).run(...values);
  }

  return getCandidateProfile(userId);
}

export type CandidateProfile = {
  fullName: string | null;
  headline: string | null;
  location: string | null;
  yearsExperience: number | null;
  cvText: string;
  skills: string[];
  certifications: Certification[];
  employment: EmploymentEntry[];
  education: EducationEntry[];
  rightToWork: string | null;
  noticePeriod: string | null;
  salaryExpectation: string | null;
  willingToRelocate: string | null;
  willingToTravel: string | null;
  updatedAt: string;
};

export function toCandidateProfile(row: CandidateProfileRow): CandidateProfile {
  return {
    fullName: row.full_name,
    headline: row.headline,
    location: row.location,
    yearsExperience: row.years_experience,
    cvText: row.cv_text,
    skills: JSON.parse(row.skills_json || "[]"),
    certifications: JSON.parse(row.certifications_json || "[]"),
    employment: JSON.parse(row.employment_json || "[]"),
    education: JSON.parse(row.education_json || "[]"),
    rightToWork: row.right_to_work,
    noticePeriod: row.notice_period,
    salaryExpectation: row.salary_expectation,
    willingToRelocate: row.willing_to_relocate,
    willingToTravel: row.willing_to_travel,
    updatedAt: row.updated_at,
  };
}

/** Renders the profile as text for an AI prompt — the ONLY facts matching/prep may treat as true. Explicitly instructs the model never to add to this. */
export function describeCandidateProfileForPrompt(profile: CandidateProfile): string {
  const hasAnything =
    profile.cvText.trim().length > 0 ||
    profile.skills.length > 0 ||
    profile.employment.length > 0 ||
    profile.certifications.length > 0 ||
    profile.education.length > 0;

  if (!hasAnything) {
    return "No candidate profile/CV has been entered yet. Treat every requirement as UNKNOWN — do not invent any experience, skills, or qualifications.";
  }

  const lines: string[] = [];
  if (profile.fullName) lines.push(`Name: ${profile.fullName}`);
  if (profile.headline) lines.push(`Headline: ${profile.headline}`);
  if (profile.location) lines.push(`Location: ${profile.location}`);
  if (profile.yearsExperience != null) lines.push(`Years of experience: ${profile.yearsExperience}`);
  if (profile.skills.length) lines.push(`Skills: ${profile.skills.join(", ")}`);
  if (profile.certifications.length) {
    lines.push(
      `Certifications: ${profile.certifications.map((c) => [c.name, c.issuer, c.year].filter(Boolean).join(" — ")).join("; ")}`
    );
  }
  if (profile.employment.length) {
    lines.push(
      `Employment history:\n${profile.employment
        .map((e) => `- ${e.title} at ${e.employer} (${e.startDate ?? "?"}–${e.endDate ?? "present"})${e.description ? `: ${e.description}` : ""}`)
        .join("\n")}`
    );
  }
  if (profile.education.length) {
    lines.push(
      `Education: ${profile.education.map((e) => [e.degree, e.field, e.institution, e.year].filter(Boolean).join(" — ")).join("; ")}`
    );
  }
  if (profile.rightToWork) lines.push(`Right to work: ${profile.rightToWork}`);
  if (profile.noticePeriod) lines.push(`Notice period: ${profile.noticePeriod}`);
  if (profile.salaryExpectation) lines.push(`Salary expectation: ${profile.salaryExpectation}`);
  if (profile.willingToRelocate) lines.push(`Willing to relocate: ${profile.willingToRelocate}`);
  if (profile.willingToTravel) lines.push(`Willing to travel: ${profile.willingToTravel}`);
  if (profile.cvText.trim()) lines.push(`Full CV/resume text:\n${profile.cvText.trim()}`);

  lines.push(
    "\nThese are the ONLY verified facts about this candidate. Never invent, assume, or embellish " +
      "experience, employers, dates, certifications, skills, or education beyond what is stated above " +
      "— if a requirement isn't clearly supported by this profile, mark it unknown or a gap, never strong or partial."
  );

  return lines.join("\n");
}
