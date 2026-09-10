import { describe, test, expect, vi, afterEach } from "vitest";
import { prepareScreeningAnswers, generateCoverLetter, missingInfoFrom } from "@/lib/jobs/applicationPrep";
import { toCandidateProfile, type CandidateProfileRow } from "@/lib/candidateProfile";
import { generateText } from "@/lib/openai";
import type { Job } from "@/lib/jobs/types";

vi.mock("@/lib/openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/openai")>();
  return { ...actual, generateText: vi.fn() };
});

afterEach(() => {
  vi.mocked(generateText).mockReset();
});

function job(): Job {
  return {
    id: "job1",
    source: "linkedin_pasted",
    sourceUrl: null,
    title: "Gas Turbine Field Advisor",
    company: "Acme Power",
    location: "Doha, Qatar",
    description: "Full job description text here.",
    employmentType: null,
    experienceLevel: null,
    salary: null,
    postedAt: null,
    easyApply: "unknown",
    applicationType: "unknown",
    applicationUrl: null,
    extracted: {
      requiredQualifications: [],
      preferredQualifications: [],
      technicalRequirements: [],
      experienceRequirements: [],
      certifications: [],
      responsibilities: [],
      travelRequirements: "",
    },
    createdAt: "",
    updatedAt: "",
  };
}

function profileRow(overrides: Partial<CandidateProfileRow> = {}): CandidateProfileRow {
  return {
    user_id: "u1",
    full_name: null,
    headline: null,
    location: null,
    years_experience: null,
    cv_text: "",
    skills_json: "[]",
    certifications_json: "[]",
    employment_json: "[]",
    education_json: "[]",
    right_to_work: null,
    notice_period: null,
    salary_expectation: null,
    willing_to_relocate: null,
    willing_to_travel: null,
    updated_at: "",
    ...overrides,
  };
}

describe("prepareScreeningAnswers", () => {
  test("high-stakes fields come DIRECTLY from the profile, with zero AI involvement, when present", async () => {
    vi.mocked(generateText).mockResolvedValueOnce(JSON.stringify({ technicalExperience: "", whyInterested: "", whySuitable: "" }));
    const profile = toCandidateProfile(
      profileRow({
        location: "London, UK",
        right_to_work: "UK citizen",
        notice_period: "4 weeks",
        salary_expectation: "£90,000",
        willing_to_relocate: "yes",
        willing_to_travel: "up to 75%",
        years_experience: 12,
      })
    );
    const answers = await prepareScreeningAnswers(job(), profile);

    expect(answers.find((a) => a.question === "Current location")).toEqual({ question: "Current location", answer: "London, UK", source: "profile" });
    expect(answers.find((a) => a.question === "Right to work")).toEqual({ question: "Right to work", answer: "UK citizen", source: "profile" });
    expect(answers.find((a) => a.question === "Years of experience")).toEqual({ question: "Years of experience", answer: "12", source: "profile" });
    // These direct fields never touch the model at all.
    const promptSent = vi.mocked(generateText).mock.calls[0]?.[0]?.prompt ?? "";
    expect(promptSent).not.toContain("£90,000");
  });

  test("unset high-stakes fields are honestly 'unknown' — never guessed", async () => {
    vi.mocked(generateText).mockResolvedValueOnce(JSON.stringify({ technicalExperience: "", whyInterested: "", whySuitable: "" }));
    const answers = await prepareScreeningAnswers(job(), toCandidateProfile(profileRow()));
    expect(answers.find((a) => a.question === "Right to work")).toEqual({ question: "Right to work", answer: "", source: "unknown" });
    expect(answers.find((a) => a.question === "Notice period / availability")).toMatchObject({ source: "unknown" });
  });

  test("narrative answers fall back to unknown (blank) when the model can't ground them, never fabricated", async () => {
    vi.mocked(generateText).mockResolvedValueOnce(JSON.stringify({ technicalExperience: "", whyInterested: "", whySuitable: "" }));
    const answers = await prepareScreeningAnswers(job(), toCandidateProfile(profileRow()));
    const why = answers.find((a) => a.question === "Why are you interested in this role?");
    expect(why?.answer).toBe("");
    expect(why?.source).toBe("unknown");
  });

  test("a model failure fails safe: narrative answers become unknown, never a crash", async () => {
    vi.mocked(generateText).mockRejectedValueOnce(new Error("AI down"));
    const answers = await prepareScreeningAnswers(job(), toCandidateProfile(profileRow()));
    expect(answers.find((a) => a.question === "Why are you suitable for this role?")).toEqual({
      question: "Why are you suitable for this role?",
      answer: "",
      source: "unknown",
    });
  });

  test("job posting content is wrapped as untrusted before reaching the model", async () => {
    vi.mocked(generateText).mockResolvedValueOnce(JSON.stringify({ technicalExperience: "", whyInterested: "", whySuitable: "" }));
    await prepareScreeningAnswers(job(), toCandidateProfile(profileRow()));
    const promptSent = vi.mocked(generateText).mock.calls[0][0].prompt;
    expect(promptSent).toContain("UNTRUSTED_JOB_CONTENT");
  });
});

describe("missingInfoFrom", () => {
  test("flags exactly the questions with unknown source, nothing else", () => {
    const missing = missingInfoFrom([
      { question: "A", answer: "x", source: "profile" },
      { question: "B", answer: "", source: "unknown" },
      { question: "C", answer: "y", source: "user_provided" },
    ]);
    expect(missing).toEqual(["B"]);
  });
});

describe("generateCoverLetter", () => {
  test("returns real content when the model succeeds", async () => {
    vi.mocked(generateText).mockResolvedValueOnce("Dear Hiring Manager, ...");
    const letter = await generateCoverLetter(job(), toCandidateProfile(profileRow({ cv_text: "12 years in gas turbines." })));
    expect(letter).toBe("Dear Hiring Manager, ...");
  });

  test("returns empty string (never a fabricated letter) on AI failure", async () => {
    vi.mocked(generateText).mockRejectedValueOnce(new Error("AI down"));
    const letter = await generateCoverLetter(job(), toCandidateProfile(profileRow()));
    expect(letter).toBe("");
  });

  test("wraps the job posting as untrusted content", async () => {
    vi.mocked(generateText).mockResolvedValueOnce("letter");
    await generateCoverLetter(job(), toCandidateProfile(profileRow()));
    const promptSent = vi.mocked(generateText).mock.calls[0][0].prompt;
    expect(promptSent).toContain("UNTRUSTED_JOB_CONTENT");
  });
});
