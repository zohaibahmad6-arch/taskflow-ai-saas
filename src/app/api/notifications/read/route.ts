import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { markNotificationRead, markNotificationsRead } from "@/lib/push";

const schema = z.union([z.object({ id: z.string().min(1).max(100) }), z.object({ all: z.literal(true) })]);

/**
 * Marks one notification (by id, scoped to the caller) or all of the
 * caller's notifications as read. This endpoint can never do anything
 * beyond flipping a read flag — it has no path to approving, executing,
 * or otherwise acting on whatever the notification referenced.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  if ("all" in parsed.data) {
    markNotificationsRead(session.user.id);
  } else {
    markNotificationRead(session.user.id, parsed.data.id);
  }

  return NextResponse.json({ ok: true });
}
