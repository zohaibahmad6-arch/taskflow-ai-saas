import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listApprovals, type ApprovalStatus } from "@/lib/approvals";

const VALID_STATUSES = new Set(["pending", "approved", "rejected", "expired", "executed", "failed"]);

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const statusParam = req.nextUrl.searchParams.get("status");
  const status = statusParam && VALID_STATUSES.has(statusParam) ? (statusParam as ApprovalStatus) : undefined;

  const approvals = listApprovals(session.user.id, status);
  return NextResponse.json({ approvals });
}
