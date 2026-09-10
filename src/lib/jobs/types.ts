/**
 * Normalized job/application model. A `Job` is exactly what the user
 * pasted (verbatim description) plus an AI-structured read of it —
 * nothing here is ever fetched via a live LinkedIn search, since no
 * legitimate API for that exists for this app (see README). A
 * `JobApplication` is separate and tracks matching/preparation/approval/
 * submission state per job — kept apart from `Job` so re-matching or
 * re-preparing never has to mutate or duplicate the original posting.
 */

export type EasyApplyStatus = "verified" | "not_available" | "unknown";
export type ApplicationType = "easy_apply" | "external" | "unknown";
export type MatchLevel = "strong" | "partial" | "gap" | "unknown";
export type ApplicationStatus =
  | "prepared"
  | "awaiting_approval"
  | "ready_for_manual_submission"
  | "submitted"
  | "failed"
  | "blocked"
  | "unknown";

export type ExtractedRequirements = {
  requiredQualifications: string[];
  preferredQualifications: string[];
  technicalRequirements: string[];
  experienceRequirements: string[];
  certifications: string[];
  responsibilities: string[];
  travelRequirements: string;
};

export type Job = {
  id: string;
  source: "linkedin_pasted" | "manual";
  sourceUrl: string | null;
  title: string;
  company: string;
  location: string | null;
  description: string;
  employmentType: string | null;
  experienceLevel: string | null;
  salary: string | null;
  postedAt: string | null;
  easyApply: EasyApplyStatus;
  applicationType: ApplicationType;
  applicationUrl: string | null;
  extracted: ExtractedRequirements;
  createdAt: string;
  updatedAt: string;
};

export type MatchReason = {
  requirement: string;
  level: MatchLevel;
  evidence: string;
};

export type ScreeningAnswer = {
  question: string;
  answer: string;
  source: "profile" | "user_provided" | "unknown";
};

export type JobApplication = {
  id: string;
  jobId: string;
  status: ApplicationStatus;
  matchScore: number | null;
  matchReasons: MatchReason[];
  cvNote: string | null;
  coverLetter: string | null;
  screeningAnswers: ScreeningAnswer[];
  missingInfo: string[];
  approvalId: string | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
