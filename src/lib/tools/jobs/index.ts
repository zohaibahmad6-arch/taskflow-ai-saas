import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "../types";
import { getCandidateProfile, toCandidateProfile } from "../../candidateProfile";
import {
  createJob,
  getJob,
  listJobs,
  createJobApplication,
  getJobApplication,
  listApplicationsForJob,
  updateJobApplicationStatus,
  updateJobApplicationContent,
} from "../../jobs/store";
import { extractJobFields, detectEasyApply } from "../../jobs/extraction";
import { matchJobToProfile } from "../../jobs/matching";
import { prepareScreeningAnswers, generateCoverLetter, missingInfoFrom } from "../../jobs/applicationPrep";
import { generateText } from "../../openai";
import { listApprovals } from "../../approvals";
import { nowIso } from "../../db";
import type { Job } from "../../jobs/types";

/**
 * IMPORTANT CONTEXT for everything in this file: LinkedIn provides no
 * public API to this application for job search, Easy Apply detection, or
 * application submission (partner-only "Talent Solutions" APIs exist but
 * are not available to individual/personal apps), and automated browser
 * interaction with LinkedIn (scripted search, form-fill, submit) would
 * violate LinkedIn's User Agreement regardless of approval-gating — so
 * none of that is implemented here, by design, not by oversight.
 *
 * What IS real: the user pastes job postings they find on LinkedIn
 * themselves (exactly like the existing "paste an email" pattern for
 * Gmail); every tool below then does genuine work — AI extraction,
 * profile-grounded matching, cover-letter/screening-answer drafting — on
 * that user-provided content. "linkedin.searchJobs" searches only jobs
 * the user has shared this way, never a live LinkedIn search. Submission
 * is prepared and reviewed here, but the actual click on LinkedIn is
 * always the user's own action — see jobs.submitApplication's execute().
 */

function requireJob(userId: string, jobId: string): Job {
  const job = getJob(userId, jobId);
  if (!job) throw new Error("Job not found.");
  return job;
}

function latestApplicationFor(userId: string, jobId: string) {
  return listApplicationsForJob(userId, jobId)[0];
}

// --- READ_ONLY ------------------------------------------------------------

const searchJobsInput = z.object({
  query: z.string().max(300).optional().describe("Free-text search over title/company/description."),
  location: z.string().max(200).optional(),
  company: z.string().max(200).optional(),
  easyApplyOnly: z.boolean().optional(),
  minMatchScore: z.number().int().min(0).max(100).optional().describe("Only jobs already matched at or above this score."),
});

const searchJobsTool: ToolDefinition<z.infer<typeof searchJobsInput>> = {
  id: "linkedin.searchJobs",
  name: "Search Jobs",
  description:
    "Searches job postings the user has already shared with the assistant (pasted from LinkedIn or elsewhere). This is NOT a live LinkedIn search — no such API is available to this app — it only ever searches what's already been captured.",
  category: "research",
  permissionLevel: "READ_ONLY",
  inputSchema: searchJobsInput,
  run: async (input, ctx) => {
    let jobs = listJobs(ctx.userId);
    if (input.query) {
      const q = input.query.toLowerCase();
      jobs = jobs.filter(
        (j) => j.title.toLowerCase().includes(q) || j.company.toLowerCase().includes(q) || j.description.toLowerCase().includes(q)
      );
    }
    if (input.location) {
      const loc = input.location.toLowerCase();
      jobs = jobs.filter((j) => (j.location ?? "").toLowerCase().includes(loc));
    }
    if (input.company) {
      const co = input.company.toLowerCase();
      jobs = jobs.filter((j) => j.company.toLowerCase().includes(co));
    }
    if (input.easyApplyOnly) {
      jobs = jobs.filter((j) => j.easyApply === "verified");
    }
    let results = jobs.map((j) => ({ job: j, application: latestApplicationFor(ctx.userId, j.id) }));
    if (input.minMatchScore != null) {
      results = results.filter((r) => (r.application?.matchScore ?? -1) >= input.minMatchScore!);
    }
    return {
      output: {
        results: results.map((r) => ({
          id: r.job.id,
          title: r.job.title,
          company: r.job.company,
          location: r.job.location,
          easyApply: r.job.easyApply,
          matchScore: r.application?.matchScore ?? null,
          postedAt: r.job.postedAt,
        })),
        message:
          results.length > 0
            ? `Found ${results.length} matching job(s) among what you've shared.`
            : "No matching jobs among what you've shared with the assistant so far. LinkedIn provides no live job-search API to this app — paste a job posting's text (and its URL) from LinkedIn to add it.",
      },
    };
  },
};

const jobIdInput = z.object({ jobId: z.string().min(1).max(100) });

const getJobTool: ToolDefinition<z.infer<typeof jobIdInput>> = {
  id: "linkedin.getJob",
  name: "Get Job Details",
  description: "Fetches full details for a job the user has captured, including the latest match/application state.",
  category: "research",
  permissionLevel: "READ_ONLY",
  inputSchema: jobIdInput,
  run: async (input, ctx) => {
    const job = getJob(ctx.userId, input.jobId);
    if (!job) return { output: { found: false, message: "That job wasn't found." } };
    const application = latestApplicationFor(ctx.userId, job.id);
    return { output: { found: true, job, application: application ?? null } };
  },
};

const getCompanyTool: ToolDefinition<z.infer<typeof jobIdInput>> = {
  id: "linkedin.getCompany",
  name: "Get Company Info",
  description:
    "Returns what's known about a job's company from postings the user has captured. This app has no dedicated company database or LinkedIn Company API access — it only ever reflects what's in captured postings.",
  category: "research",
  permissionLevel: "READ_ONLY",
  inputSchema: jobIdInput,
  run: async (input, ctx) => {
    const job = getJob(ctx.userId, input.jobId);
    if (!job) return { output: { found: false, message: "That job wasn't found." } };
    const otherJobsAtCompany = listJobs(ctx.userId).filter(
      (j) => j.id !== job.id && j.company.toLowerCase() === job.company.toLowerCase()
    );
    return {
      output: {
        company: job.company,
        knownFromPostings: [job, ...otherJobsAtCompany].map((j) => ({ jobId: j.id, title: j.title, postedAt: j.postedAt })),
        message: "No dedicated company data source is available — this reflects only postings you've shared for this company.",
      },
    };
  },
};

const checkEasyApplyTool: ToolDefinition<z.infer<typeof jobIdInput>> = {
  id: "linkedin.checkEasyApply",
  name: "Check Easy Apply Status",
  description: "Reports a job's Easy Apply status — VERIFIED only when the posting's own text literally said so, otherwise NOT_AVAILABLE or UNKNOWN. Never inferred.",
  category: "research",
  permissionLevel: "READ_ONLY",
  inputSchema: jobIdInput,
  run: async (input, ctx) => {
    const job = getJob(ctx.userId, input.jobId);
    if (!job) return { output: { found: false, message: "That job wasn't found." } };
    return {
      output: {
        found: true,
        easyApply: job.easyApply,
        applicationType: job.applicationType,
        message:
          job.easyApply === "verified"
            ? "Easy Apply — Verified (the posting's own text said so)."
            : job.easyApply === "not_available"
              ? "Easy Apply — Not available (this posting pointed to an external/company-site application)."
              : "Easy Apply — Unknown (the pasted text didn't clearly state either way).",
      },
    };
  },
};

const analyzeJobTool: ToolDefinition<z.infer<typeof jobIdInput>> = {
  id: "linkedin.analyzeJob",
  name: "Analyze Job",
  description: "Summarizes a captured job's requirements, responsibilities, and application route in plain language.",
  category: "research",
  permissionLevel: "READ_ONLY",
  inputSchema: jobIdInput,
  run: async (input, ctx) => {
    const job = getJob(ctx.userId, input.jobId);
    if (!job) return { output: { found: false, message: "That job wasn't found." } };
    const e = job.extracted;
    const structured = [
      e.requiredQualifications.length ? `Required: ${e.requiredQualifications.join("; ")}` : null,
      e.preferredQualifications.length ? `Preferred: ${e.preferredQualifications.join("; ")}` : null,
      e.technicalRequirements.length ? `Technical: ${e.technicalRequirements.join("; ")}` : null,
      e.experienceRequirements.length ? `Experience: ${e.experienceRequirements.join("; ")}` : null,
      e.certifications.length ? `Certifications: ${e.certifications.join("; ")}` : null,
      e.responsibilities.length ? `Responsibilities: ${e.responsibilities.join("; ")}` : null,
      e.travelRequirements ? `Travel: ${e.travelRequirements}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    let summary = "";
    if (structured) {
      try {
        summary = await generateText({
          system:
            "Write a short (under 120 words) plain-language analysis of this job's requirements and " +
            "responsibilities from the structured fields below (already extracted from the posting — " +
            "not raw third-party text). Do not add anything not present in the fields.",
          prompt: structured,
          temperature: 0.2,
        });
      } catch {
        summary = "";
      }
    }

    return {
      output: {
        found: true,
        title: job.title,
        company: job.company,
        location: job.location,
        employmentType: job.employmentType,
        salary: job.salary,
        applicationType: job.applicationType,
        easyApply: job.easyApply,
        extracted: job.extracted,
        summary: summary || "Not enough structured information was extracted from this posting to summarize.",
      },
    };
  },
};

// --- PREPARATION ------------------------------------------------------------

const captureInput = z.object({
  rawText: z.string().min(20).max(30_000).describe("The full pasted text of a job posting, e.g. copied from LinkedIn."),
  sourceUrl: z.string().url().max(1000).optional().describe("The LinkedIn (or other) URL of the posting, if available."),
});

const captureFromTextTool: ToolDefinition<z.infer<typeof captureInput>> = {
  id: "jobs.captureFromText",
  name: "Capture Job Posting",
  description:
    "Structures a job posting the user pasted (from LinkedIn or anywhere else) into the assistant's job list. This is how job data enters the app — there is no automated search.",
  category: "research",
  permissionLevel: "PREPARATION",
  inputSchema: captureInput,
  run: async (input, ctx) => {
    const fields = await extractJobFields(input.rawText);
    const { easyApply, applicationType } = detectEasyApply(input.rawText);
    const job = createJob({
      userId: ctx.userId,
      sourceUrl: input.sourceUrl ?? null,
      title: fields.title,
      company: fields.company,
      location: fields.location,
      description: input.rawText,
      employmentType: fields.employmentType,
      experienceLevel: fields.experienceLevel,
      salary: fields.salary,
      postedAt: fields.postedAt,
      easyApply,
      applicationType,
      applicationUrl: input.sourceUrl ?? null,
      extracted: fields.extracted,
    });
    return {
      output: {
        job,
        message: `Captured "${job.title}" at ${job.company}. Easy Apply: ${job.easyApply}. Nothing else has been done with it yet — ask to analyze, match, or prepare an application.`,
      },
      auditSafeSummary: { jobId: job.id, title: job.title, company: job.company },
    };
  },
};

const matchProfileTool: ToolDefinition<z.infer<typeof jobIdInput>> = {
  id: "jobs.matchProfile",
  name: "Match Job to Profile",
  description: "Compares a captured job's requirements against the user's verified candidate profile and produces an explainable match score. Never invents qualifications.",
  category: "research",
  permissionLevel: "PREPARATION",
  inputSchema: jobIdInput,
  run: async (input, ctx) => {
    const job = requireJob(ctx.userId, input.jobId);
    const profile = toCandidateProfile(getCandidateProfile(ctx.userId));
    const { matchScore, matchReasons } = await matchJobToProfile(job, profile);

    let application = latestApplicationFor(ctx.userId, job.id);
    if (!application) {
      application = createJobApplication({ userId: ctx.userId, jobId: job.id, matchScore, matchReasons });
    } else {
      updateJobApplicationContent(ctx.userId, application.id, { matchScore, matchReasons });
    }

    return {
      output: {
        applicationId: application.id,
        matchScore,
        matchReasons,
        message:
          matchScore == null
            ? "This posting had no extractable requirements to match against."
            : `${matchScore}% match.`,
      },
      auditSafeSummary: { jobId: job.id, matchScore },
    };
  },
};

const prepareScreeningInput = jobIdInput;
const prepareScreeningTool: ToolDefinition<z.infer<typeof prepareScreeningInput>> = {
  id: "jobs.prepareScreeningAnswers",
  name: "Prepare Screening Answers",
  description: "Drafts answers to common screening questions from the user's verified profile. Anything not supported by the profile is left for the user to answer, never guessed.",
  category: "research",
  permissionLevel: "PREPARATION",
  inputSchema: prepareScreeningInput,
  run: async (input, ctx) => {
    const job = requireJob(ctx.userId, input.jobId);
    const profile = toCandidateProfile(getCandidateProfile(ctx.userId));
    const screeningAnswers = await prepareScreeningAnswers(job, profile);
    const missingInfo = missingInfoFrom(screeningAnswers);

    let application = latestApplicationFor(ctx.userId, job.id);
    if (!application) {
      application = createJobApplication({ userId: ctx.userId, jobId: job.id, screeningAnswers, missingInfo });
    } else {
      updateJobApplicationContent(ctx.userId, application.id, { screeningAnswers, missingInfo });
    }

    return {
      output: { applicationId: application.id, screeningAnswers, missingInfo },
      auditSafeSummary: { jobId: job.id, answeredCount: screeningAnswers.filter((a) => a.source !== "unknown").length, missingCount: missingInfo.length },
    };
  },
};

const coverLetterInput = jobIdInput;
const generateCoverLetterTool: ToolDefinition<z.infer<typeof coverLetterInput>> = {
  id: "jobs.generateCoverLetter",
  name: "Generate Cover Letter",
  description: "Drafts a cover letter grounded strictly in the user's verified profile for a captured job.",
  category: "research",
  permissionLevel: "PREPARATION",
  inputSchema: coverLetterInput,
  run: async (input, ctx) => {
    const job = requireJob(ctx.userId, input.jobId);
    const profile = toCandidateProfile(getCandidateProfile(ctx.userId));
    const coverLetter = await generateCoverLetter(job, profile);

    let application = latestApplicationFor(ctx.userId, job.id);
    if (!application) {
      application = createJobApplication({ userId: ctx.userId, jobId: job.id, coverLetter });
    } else {
      updateJobApplicationContent(ctx.userId, application.id, { coverLetter });
    }

    return {
      output: { applicationId: application.id, coverLetter: coverLetter || null, message: coverLetter ? undefined : "Not enough profile information to draft a grounded cover letter." },
      auditSafeSummary: { jobId: job.id, generated: Boolean(coverLetter) },
    };
  },
};

const createPackageInput = jobIdInput;
const createApplicationPackageTool: ToolDefinition<z.infer<typeof createPackageInput>> = {
  id: "jobs.createApplicationPackage",
  name: "Prepare Application",
  description:
    "Full application preparation for a job: matches the profile, drafts screening answers and a cover letter, and reports missing information. This ONLY prepares — nothing is submitted. Review the package, then explicitly approve jobs.submitApplication when ready.",
  category: "research",
  permissionLevel: "PREPARATION",
  inputSchema: createPackageInput,
  run: async (input, ctx) => {
    const job = requireJob(ctx.userId, input.jobId);
    const profile = toCandidateProfile(getCandidateProfile(ctx.userId));

    const [{ matchScore, matchReasons }, screeningAnswers, coverLetter] = await Promise.all([
      matchJobToProfile(job, profile),
      prepareScreeningAnswers(job, profile),
      generateCoverLetter(job, profile),
    ]);
    const missingInfo = missingInfoFrom(screeningAnswers);

    let application = latestApplicationFor(ctx.userId, job.id);
    if (!application) {
      application = createJobApplication({
        userId: ctx.userId,
        jobId: job.id,
        matchScore,
        matchReasons,
        screeningAnswers,
        coverLetter,
        missingInfo,
      });
    } else {
      updateJobApplicationContent(ctx.userId, application.id, { matchScore, matchReasons, screeningAnswers, coverLetter, missingInfo });
      application = getJobApplication(ctx.userId, application.id)!;
    }
    updateJobApplicationStatus(ctx.userId, application.id, "prepared");

    return {
      output: {
        job,
        applicationId: application.id,
        matchScore,
        matchReasons,
        screeningAnswers,
        coverLetter: coverLetter || null,
        missingInfo,
        easyApply: job.easyApply,
        applicationType: job.applicationType,
        message:
          "APPLICATION READY FOR REVIEW. Nothing has been submitted. Review this package, then ask to submit it when you're ready — that will require your explicit approval, and even then the actual submission on LinkedIn is something you complete yourself (see jobs.submitApplication).",
      },
      auditSafeSummary: { jobId: job.id, applicationId: application.id, matchScore, missingCount: missingInfo.length },
    };
  },
};

const markSubmittedInput = z.object({ applicationId: z.string().min(1).max(100) });
const markSubmittedTool: ToolDefinition<z.infer<typeof markSubmittedInput>> = {
  id: "jobs.markSubmitted",
  name: "Mark Application Submitted",
  description:
    "Self-reported bookkeeping only: records that the user has personally completed submitting this application on LinkedIn. This tool does not submit anything itself and never verifies LinkedIn's side — it only updates the assistant's own tracking, and is idempotent (marking twice is a no-op).",
  category: "research",
  permissionLevel: "PREPARATION",
  inputSchema: markSubmittedInput,
  run: async (input, ctx) => {
    const application = getJobApplication(ctx.userId, input.applicationId);
    if (!application) return { output: { found: false, message: "That application wasn't found." } };
    if (application.status === "submitted") {
      return {
        output: { found: true, alreadySubmitted: true, submittedAt: application.submittedAt, message: `Already marked submitted (${application.submittedAt}). Not recorded again.` },
      };
    }
    updateJobApplicationStatus(ctx.userId, application.id, "submitted", { submittedAt: nowIso() });
    return {
      output: { found: true, alreadySubmitted: false, message: "Recorded as submitted (self-reported) — this app has no way to verify that with LinkedIn." },
      auditSafeSummary: { applicationId: application.id },
    };
  },
};

// --- EXTERNAL_ACTION --------------------------------------------------------

const submitPayload = z.object({
  applicationId: z.string().min(1).max(100),
  jobId: z.string().min(1).max(100),
  jobTitle: z.string().max(300),
  company: z.string().max(300),
  sourceUrl: z.string().nullable(),
  linkedinAccountNote: z.string().max(500),
  applicationType: z.enum(["easy_apply", "external", "unknown"]),
  matchScore: z.number().nullable(),
  coverLetter: z.string().max(20_000),
  screeningAnswers: z.array(
    z.object({
      question: z.string().max(300),
      answer: z.string().max(2000),
      source: z.enum(["profile", "user_provided", "unknown"]),
    })
  ),
  missingInfo: z.array(z.string().max(300)),
});

const submitInput = z.object({ applicationId: z.string().min(1).max(100) });

const submitApplicationTool: ToolDefinition<z.infer<typeof submitInput>, z.infer<typeof submitPayload>> = {
  id: "jobs.submitApplication",
  name: "Submit Application",
  description:
    "Finalizes a prepared, reviewed application package for submission. This is an EXTERNAL_ACTION and always requires explicit approval of the exact package. IMPORTANT: LinkedIn provides no legitimate automated submission mechanism to this app, so approving this does NOT submit anything on LinkedIn — it finalizes the package and marks it ready for you to submit yourself.",
  category: "research",
  permissionLevel: "EXTERNAL_ACTION",
  inputSchema: submitInput,
  payloadHint: "Fields: applicationId, job, cover letter, screening answers",
  approvalPayloadSchema: submitPayload,
  resolvePayload: async (input, ctx) => {
    const application = getJobApplication(ctx.userId, input.applicationId);
    if (!application) throw new Error("Application not found.");
    if (application.status === "submitted") {
      throw new Error(`This application was already marked submitted (${application.submittedAt}). Not preparing another approval for it.`);
    }
    const pendingForThisApplication = listApprovals(ctx.userId, "pending").find(
      (a) => a.tool_id === "jobs.submitApplication" && (JSON.parse(a.payload_json) as { applicationId?: string }).applicationId === application.id
    );
    if (pendingForThisApplication) {
      throw new Error("An approval for this exact application is already pending review in the Approval Center.");
    }
    const job = getJob(ctx.userId, application.jobId);
    if (!job) throw new Error("The job for this application was not found.");

    return {
      applicationId: application.id,
      jobId: job.id,
      jobTitle: job.title,
      company: job.company,
      sourceUrl: job.sourceUrl,
      linkedinAccountNote:
        "No LinkedIn account is connected for automated submission (none exists for this app) — you will complete the actual submission yourself, on your own LinkedIn account.",
      applicationType: job.applicationType,
      matchScore: application.matchScore,
      coverLetter: application.coverLetter ?? "",
      screeningAnswers: application.screeningAnswers,
      missingInfo: application.missingInfo,
    };
  },
  describePayload: async (payload) => {
    const answered = payload.screeningAnswers.filter((a) => a.source !== "unknown").length;
    return {
      action: "APPLICATION READY — finalize for manual submission",
      target: `${payload.jobTitle} at ${payload.company}${payload.sourceUrl ? ` (${payload.sourceUrl})` : ""}`,
      content:
        `Application type: ${payload.applicationType}\n` +
        `Match: ${payload.matchScore != null ? `${payload.matchScore}%` : "not matched"}\n` +
        `Cover letter: ${payload.coverLetter ? `${payload.coverLetter.slice(0, 200)}${payload.coverLetter.length > 200 ? "…" : ""}` : "(none prepared)"}\n` +
        `Screening answers: ${answered}/${payload.screeningAnswers.length} answered\n` +
        `Missing information: ${payload.missingInfo.length ? payload.missingInfo.join(", ") : "none"}`,
      consequence:
        "Approving this finalizes the package above and marks it ready. It does NOT submit anything to LinkedIn — " +
        "LinkedIn provides no legitimate automated submission path to this app, so you will need to complete the " +
        "actual submission yourself on LinkedIn using this reviewed package, then tell the assistant so it can be " +
        "recorded (jobs.markSubmitted). If you edit this approval, a fresh approval is required.",
    };
  },
  execute: async (payload, ctx) => {
    updateJobApplicationStatus(ctx.userId, payload.applicationId, "ready_for_manual_submission");
    return {
      output: {
        submitted: false,
        readyForManualSubmission: true,
        message:
          `The package for "${payload.jobTitle}" at ${payload.company} is finalized and ready. ` +
          "This app cannot submit it to LinkedIn for you — no legitimate automated mechanism exists. " +
          "Complete the submission yourself on LinkedIn, then say so and the assistant will record it.",
      },
      auditSafeSummary: { applicationId: payload.applicationId, jobId: payload.jobId },
    };
  },
};

export const jobsTools = [
  searchJobsTool,
  getJobTool,
  getCompanyTool,
  checkEasyApplyTool,
  analyzeJobTool,
  captureFromTextTool,
  matchProfileTool,
  prepareScreeningTool,
  generateCoverLetterTool,
  createApplicationPackageTool,
  markSubmittedTool,
  submitApplicationTool,
];
