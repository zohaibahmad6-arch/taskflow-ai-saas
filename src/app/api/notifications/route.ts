import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listNotifications, getUnreadNotificationCount, type NotificationCategory } from "@/lib/push";

const VALID_CATEGORIES: NotificationCategory[] = ["EMAIL", "JOB", "APPLICATION", "APPROVAL", "SYSTEM"];

/** Always scoped to the authenticated user — see listNotifications. */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const categoryParam = req.nextUrl.searchParams.get("category");
  const category =
    categoryParam && VALID_CATEGORIES.includes(categoryParam as NotificationCategory)
      ? (categoryParam as NotificationCategory)
      : undefined;
  const unreadOnly = req.nextUrl.searchParams.get("unreadOnly") === "1";

  const notifications = listNotifications(session.user.id, { limit: 100, category, unreadOnly });
  const unreadCount = getUnreadNotificationCount(session.user.id);

  return NextResponse.json({ notifications, unreadCount });
}
