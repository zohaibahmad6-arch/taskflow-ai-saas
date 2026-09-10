import "server-only";
import { db, newId, nowIso } from "../db";
import type {
  Job,
  JobApplication,
  ExtractedRequirements,
  EasyApplyStatus,
  ApplicationType,
  ApplicationStatus,
  MatchReason,
  ScreeningAnswer,
} from "./types";

type JobRow = {
  id: string;
  user_id: string;
  source: string;
  source_url: string | null;
  title: string;
  company: string;
  location: string | null;
  description: string;
  employment_type: string | null;
  experience_level: string | null;
  salary: string | null;
  posted_at: string | null;
  easy_apply_status: EasyApplyStatus;
  application_type: ApplicationType;
  application_url: string | null;
  extracted_json: string;
  created_at: string;
  updated_at: string;
};

const EMPTY_EXTRACTED: ExtractedRequirements = {
  requiredQualifications: [],
  preferredQualifications: [],
  technicalRequirements: [],
  experienceRequirements: [],
  certifications: [],
  responsibilities: [],
  travelRequirements: "",
};

function rowToJob(row: JobRow): Job {
  return {
    id: row.id,
    source: row.source as Job["source"],
    sourceUrl: row.source_url,
    title: row.title,
    company: row.company,
    location: row.location,
    description: row.description,
    employmentType: row.employment_type,
    experienceLevel: row.experience_level,
    salary: row.salary,
    postedAt: row.posted_at,
    easyApply: row.easy_apply_status,
    applicationType: row.application_type,
    applicationUrl: row.application_url,
    extracted: { ...EMPTY_EXTRACTED, ...JSON.parse(row.extracted_json || "{}") },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createJob(params: {
  userId: string;
  source?: "linkedin_pasted" | "manual";
  sourceUrl?: string | null;
  title: string;
  company: string;
  location?: string | null;
  description: string;
  employmentType?: string | null;
  experienceLevel?: string | null;
  salary?: string | null;
  postedAt?: string | null;
  easyApply?: EasyApplyStatus;
  applicationType?: ApplicationType;
  applicationUrl?: string | null;
  extracted?: ExtractedRequirements;
}): Job {
  const id = newId("job");
  db.prepare(
    `INSERT INTO jobs
       (id, user_id, source, source_url, title, company, location, description, employment_type,
        experience_level, salary, posted_at, easy_apply_status, application_type, application_url, extracted_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.userId,
    params.source ?? "linkedin_pasted",
    params.sourceUrl ?? null,
    params.title,
    params.company,
    params.location ?? null,
    params.description,
    params.employmentType ?? null,
    params.experienceLevel ?? null,
    params.salary ?? null,
    params.postedAt ?? null,
    params.easyApply ?? "unknown",
    params.applicationType ?? "unknown",
    params.applicationUrl ?? null,
    JSON.stringify(params.extracted ?? EMPTY_EXTRACTED)
  );
  return getJobRaw(id)!;
}

function getJobRaw(id: string): Job | undefined {
  const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | undefined;
  return row ? rowToJob(row) : undefined;
}

/** Always scoped by userId — there is no way to fetch another user's job by id. */
export function getJob(userId: string, id: string): Job | undefined {
  const row = db.prepare("SELECT * FROM jobs WHERE id = ? AND user_id = ?").get(id, userId) as JobRow | undefined;
  return row ? rowToJob(row) : undefined;
}

export function listJobs(userId: string, limit = 100): Job[] {
  const rows = db
    .prepare("SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(userId, limit) as JobRow[];
  return rows.map(rowToJob);
}

// --- Job applications (matching/prep/submission tracking) --------------

type JobApplicationRow = {
  id: string;
  user_id: string;
  job_id: string;
  status: ApplicationStatus;
  match_score: number | null;
  match_reasons_json: string;
  cv_note: string | null;
  cover_letter: string | null;
  screening_answers_json: string;
  missing_info_json: string;
  approval_id: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
};

function rowToApplication(row: JobApplicationRow): JobApplication {
  return {
    id: row.id,
    jobId: row.job_id,
    status: row.status,
    matchScore: row.match_score,
    matchReasons: JSON.parse(row.match_reasons_json || "[]"),
    cvNote: row.cv_note,
    coverLetter: row.cover_letter,
    screeningAnswers: JSON.parse(row.screening_answers_json || "[]"),
    missingInfo: JSON.parse(row.missing_info_json || "[]"),
    approvalId: row.approval_id,
    submittedAt: row.submitted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createJobApplication(params: {
  userId: string;
  jobId: string;
  matchScore?: number | null;
  matchReasons?: MatchReason[];
  cvNote?: string | null;
  coverLetter?: string | null;
  screeningAnswers?: ScreeningAnswer[];
  missingInfo?: string[];
}): JobApplication {
  const id = newId("jobapp");
  db.prepare(
    `INSERT INTO job_applications
       (id, user_id, job_id, match_score, match_reasons_json, cv_note, cover_letter, screening_answers_json, missing_info_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.userId,
    params.jobId,
    params.matchScore ?? null,
    JSON.stringify(params.matchReasons ?? []),
    params.cvNote ?? null,
    params.coverLetter ?? null,
    JSON.stringify(params.screeningAnswers ?? []),
    JSON.stringify(params.missingInfo ?? [])
  );
  return getJobApplication(params.userId, id)!;
}

export function getJobApplication(userId: string, id: string): JobApplication | undefined {
  const row = db
    .prepare("SELECT * FROM job_applications WHERE id = ? AND user_id = ?")
    .get(id, userId) as JobApplicationRow | undefined;
  return row ? rowToApplication(row) : undefined;
}

/** Every application prepared for a given job, newest first — used for duplicate-submission checks. */
export function listApplicationsForJob(userId: string, jobId: string): JobApplication[] {
  const rows = db
    .prepare("SELECT * FROM job_applications WHERE user_id = ? AND job_id = ? ORDER BY created_at DESC")
    .all(userId, jobId) as JobApplicationRow[];
  return rows.map(rowToApplication);
}

export function updateJobApplicationStatus(
  userId: string,
  id: string,
  status: ApplicationStatus,
  extra?: { approvalId?: string | null; submittedAt?: string | null }
): void {
  db.prepare(
    `UPDATE job_applications SET status = ?, approval_id = COALESCE(?, approval_id), submitted_at = COALESCE(?, submitted_at), updated_at = ?
     WHERE id = ? AND user_id = ?`
  ).run(status, extra?.approvalId ?? null, extra?.submittedAt ?? null, nowIso(), id, userId);
}

export function updateJobApplicationContent(
  userId: string,
  id: string,
  update: Partial<{
    coverLetter: string;
    screeningAnswers: ScreeningAnswer[];
    missingInfo: string[];
    matchScore: number | null;
    matchReasons: MatchReason[];
  }>
): void {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (update.coverLetter !== undefined) {
    fields.push("cover_letter = ?");
    values.push(update.coverLetter);
  }
  if (update.screeningAnswers !== undefined) {
    fields.push("screening_answers_json = ?");
    values.push(JSON.stringify(update.screeningAnswers));
  }
  if (update.missingInfo !== undefined) {
    fields.push("missing_info_json = ?");
    values.push(JSON.stringify(update.missingInfo));
  }
  if (update.matchScore !== undefined) {
    fields.push("match_score = ?");
    values.push(update.matchScore);
  }
  if (update.matchReasons !== undefined) {
    fields.push("match_reasons_json = ?");
    values.push(JSON.stringify(update.matchReasons));
  }
  if (fields.length === 0) return;
  fields.push("updated_at = ?");
  values.push(nowIso(), id, userId);
  db.prepare(`UPDATE job_applications SET ${fields.join(", ")} WHERE id = ? AND user_id = ?`).run(...values);
}
