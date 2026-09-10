import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { getCandidateProfile, updateCandidateProfile, toCandidateProfile } from "@/lib/candidateProfile";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const profile = toCandidateProfile(getCandidateProfile(session.user.id));
  return NextResponse.json({ profile });
}

const certificationSchema = z.object({ name: z.string().max(200), issuer: z.string().max(200).optional(), year: z.string().max(20).optional() });
const employmentSchema = z.object({
  employer: z.string().max(300),
  title: z.string().max(300),
  startDate: z.string().max(50).optional(),
  endDate: z.string().max(50).optional(),
  description: z.string().max(2000).optional(),
});
const educationSchema = z.object({
  institution: z.string().max(300),
  degree: z.string().max(200).optional(),
  field: z.string().max(200).optional(),
  year: z.string().max(20).optional(),
});

const updateSchema = z.object({
  fullName: z.string().max(200).optional(),
  headline: z.string().max(300).optional(),
  location: z.string().max(200).optional(),
  yearsExperience: z.number().int().min(0).max(80).nullable().optional(),
  cvText: z.string().max(30_000).optional(),
  skills: z.array(z.string().max(100)).max(100).optional(),
  certifications: z.array(certificationSchema).max(50).optional(),
  employment: z.array(employmentSchema).max(50).optional(),
  education: z.array(educationSchema).max(50).optional(),
  rightToWork: z.string().max(300).optional(),
  noticePeriod: z.string().max(200).optional(),
  salaryExpectation: z.string().max(200).optional(),
  willingToRelocate: z.string().max(200).optional(),
  willingToTravel: z.string().max(200).optional(),
});

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid profile data." }, { status: 400 });

  updateCandidateProfile(session.user.id, parsed.data);
  return NextResponse.json({ ok: true });
}
