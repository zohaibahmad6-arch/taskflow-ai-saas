import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getJob, listApplicationsForJob } from "@/lib/jobs/store";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { id } = await params;
  const job = getJob(session.user.id, id);
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  const applications = listApplicationsForJob(session.user.id, id);
  return NextResponse.json({ job, application: applications[0] ?? null });
}
