import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import {
  notifyUser,
  listNotifications,
  markNotificationRead,
  markNotificationsRead,
  getUnreadNotificationCount,
} from "@/lib/push";
import { createTestUser } from "../helpers";

describe("Personal Notification Center: create, read, unread, mark read", () => {
  test("notifyUser creates a notification with the given category and it appears unread", async () => {
    const user = createTestUser("notif-create");
    await notifyUser(user.id, { title: "New job match", body: "A strong match was found.", category: "JOB" });

    const list = listNotifications(user.id);
    expect(list).toHaveLength(1);
    expect(list[0].category).toBe("JOB");
    expect(list[0].title).toBe("New job match");
    expect(list[0].read).toBe(0);
    expect(list[0].read_at).toBeNull();
    expect(getUnreadNotificationCount(user.id)).toBe(1);
  });

  test("markNotificationRead marks exactly one notification read and sets read_at", async () => {
    const user = createTestUser("notif-mark-one");
    await notifyUser(user.id, { title: "A", body: "a", category: "SYSTEM" });
    await notifyUser(user.id, { title: "B", body: "b", category: "SYSTEM" });
    const [first, second] = listNotifications(user.id).sort((a, b) => a.title.localeCompare(b.title));

    markNotificationRead(user.id, first.id);

    const after = listNotifications(user.id);
    const updatedFirst = after.find((n) => n.id === first.id)!;
    const updatedSecond = after.find((n) => n.id === second.id)!;
    expect(updatedFirst.read).toBe(1);
    expect(updatedFirst.read_at).not.toBeNull();
    expect(updatedSecond.read).toBe(0);
    expect(getUnreadNotificationCount(user.id)).toBe(1);
  });

  test("markNotificationsRead marks every unread notification for the user", async () => {
    const user = createTestUser("notif-mark-all");
    await notifyUser(user.id, { title: "A", body: "a", category: "EMAIL" });
    await notifyUser(user.id, { title: "B", body: "b", category: "APPROVAL" });

    markNotificationsRead(user.id);

    expect(getUnreadNotificationCount(user.id)).toBe(0);
    expect(listNotifications(user.id, { unreadOnly: true })).toHaveLength(0);
  });

  test("listNotifications filters by category", async () => {
    const user = createTestUser("notif-category-filter");
    await notifyUser(user.id, { title: "Email item", body: "b", category: "EMAIL" });
    await notifyUser(user.id, { title: "Job item", body: "b", category: "JOB" });

    const emailOnly = listNotifications(user.id, { category: "EMAIL" });
    expect(emailOnly).toHaveLength(1);
    expect(emailOnly[0].title).toBe("Email item");
  });
});

describe("Personal Notification Center: user isolation", () => {
  test("a notification for one user never appears in another user's list, and cross-user mark-read is a no-op", async () => {
    const userA = createTestUser("notif-isolation-a");
    const userB = createTestUser("notif-isolation-b");
    await notifyUser(userA.id, { title: "A's notification", body: "b", category: "SYSTEM" });

    expect(listNotifications(userB.id)).toHaveLength(0);
    expect(getUnreadNotificationCount(userB.id)).toBe(0);

    const [aNotif] = listNotifications(userA.id);
    markNotificationRead(userB.id, aNotif.id); // userB tries to mark userA's notification
    const stillUnread = listNotifications(userA.id).find((n) => n.id === aNotif.id)!;
    expect(stillUnread.read).toBe(0); // untouched — not owned by userB
  });
});

describe("Personal Notification Center: deduplication (section 18)", () => {
  test("the same unresolved event (same category + referenceId) does not generate a second unread notification", async () => {
    const user = createTestUser("notif-dedup");
    await notifyUser(user.id, { title: "Approval waiting", body: "b", category: "APPROVAL", referenceId: "appr_123" });
    await notifyUser(user.id, { title: "Approval waiting (again)", body: "b", category: "APPROVAL", referenceId: "appr_123" });

    expect(listNotifications(user.id)).toHaveLength(1); // not duplicated
  });

  test("a different referenceId (a different unresolved event) DOES generate a separate notification", async () => {
    const user = createTestUser("notif-dedup-different-ref");
    await notifyUser(user.id, { title: "A", body: "b", category: "APPROVAL", referenceId: "appr_1" });
    await notifyUser(user.id, { title: "B", body: "b", category: "APPROVAL", referenceId: "appr_2" });

    expect(listNotifications(user.id)).toHaveLength(2);
  });

  test("once the earlier notification for a referenceId is read, a new notification for the SAME referenceId is allowed again", async () => {
    const user = createTestUser("notif-dedup-after-read");
    await notifyUser(user.id, { title: "First", body: "b", category: "APPROVAL", referenceId: "appr_9" });
    markNotificationsRead(user.id);
    await notifyUser(user.id, { title: "Second", body: "b", category: "APPROVAL", referenceId: "appr_9" });

    expect(listNotifications(user.id)).toHaveLength(2);
  });
});

describe("Personal Notification Center: reference ids and deep links", () => {
  test("reference_id and link (deep-link target) are stored and returned", async () => {
    const user = createTestUser("notif-refid-link");
    await notifyUser(user.id, { title: "Approval", body: "b", category: "APPROVAL", referenceId: "appr_42", url: "/approvals" });

    const [n] = listNotifications(user.id);
    expect(n.reference_id).toBe("appr_42");
    expect(n.link).toBe("/approvals");
  });
});

describe("Notifications are informational only — never an action authorization mechanism (section 12)", () => {
  test("the mark-read API route never imports approval/tool execution machinery", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/notifications/read/route.ts"),
      "utf-8"
    );
    expect(content).not.toMatch(/decideApproval|invokeTool|executeApproval/);
  });

  test("the notifications list API route never imports approval/tool execution machinery", () => {
    const content = fs.readFileSync(path.join(process.cwd(), "src/app/api/notifications/route.ts"), "utf-8");
    expect(content).not.toMatch(/decideApproval|invokeTool|executeApproval/);
  });

  test("push payloads stay minimal — notifyUser never receives a full email body, only short titles/bodies", () => {
    // Structural check on the approvals.ts call sites (the only production callers besides
    // dailyBriefing.ts): none pass anything beyond short template strings built from
    // action/target, never raw third-party content.
    const content = fs.readFileSync(path.join(process.cwd(), "src/lib/approvals.ts"), "utf-8");
    const calls = content.match(/notifyUser\([\s\S]*?\}\)\.catch/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call).not.toMatch(/content:|snippet:|body:\s*row\.result_json|body:\s*payload/);
    }
  });
});

describe("notifyUser row shape (regression: category defaults, back-compat)", () => {
  test("omitting category defaults to SYSTEM (back-compat with pre-existing callers)", async () => {
    const user = createTestUser("notif-default-category");
    await notifyUser(user.id, { title: "No category given", body: "b" });
    const [n] = listNotifications(user.id);
    expect(n.category).toBe("SYSTEM");
  });

  test("the notifications table actually persists the new columns (schema migration sanity check)", () => {
    const columns = db.prepare("PRAGMA table_info(notifications)").all() as Array<{ name: string }>;
    const names = columns.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["category", "reference_id", "read_at"]));
  });
});
