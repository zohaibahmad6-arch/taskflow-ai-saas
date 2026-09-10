import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "./types";
import { generateDailyBriefing } from "../dailyBriefing";

/**
 * A single READ_ONLY tool covers every briefing-related voice/chat
 * question ("Give me my daily briefing.", "What needs my attention?",
 * "What emails are urgent?", "Do I have any job applications waiting?",
 * "Are there any approvals waiting for me?") — the model reads the
 * structured output below and phrases whichever framing the user asked
 * for. This reaches voice through the existing runChatTurn()/invokeTool()
 * path with no voice-specific code: registering the tool here is the only
 * change needed for every one of those questions to work.
 *
 * READ_ONLY: this never approves, executes, sends, deletes, moves, or
 * submits anything — it only reports what's already true, aggregated from
 * data this app already fetched and stored (see dailyBriefing.ts).
 */
const inputSchema = z.object({});

const getDailyBriefingTool: ToolDefinition<z.infer<typeof inputSchema>> = {
  id: "briefing.getDailyBriefing",
  name: "Get Daily Briefing",
  description:
    "Returns today's aggregated Personal Briefing: urgent/important email by provider, job matches and " +
    "applications needing attention, and pending approvals. Honestly reports when an email provider isn't " +
    "connected or there are no saved jobs — never invents content. Use this for any question about what's " +
    "urgent, what needs attention today, or a summary of email/jobs/approvals.",
  category: "system",
  permissionLevel: "READ_ONLY",
  inputSchema,
  run: async (_input, ctx) => {
    const briefing = await generateDailyBriefing(ctx.userId);
    return {
      output: {
        summaryText: briefing.summaryText,
        priorities: briefing.priorities,
        urgentCount: briefing.urgentCount,
        actionsCount: briefing.actionsCount,
        deadlinesCount: briefing.deadlinesCount,
        approvalsCount: briefing.approvalsCount,
        email: {
          gmail: {
            connected: briefing.email.gmail.connected,
            statusText: briefing.email.gmail.statusText,
            urgent: briefing.email.gmail.urgent.map((i) => ({ subject: i.subject, from: i.from, reason: i.reason })),
            deadlines: briefing.email.gmail.deadlines.map((i) => ({ subject: i.subject, deadline: i.deadline })),
          },
          outlook: {
            connected: briefing.email.outlook.connected,
            statusText: briefing.email.outlook.statusText,
            urgent: briefing.email.outlook.urgent.map((i) => ({ subject: i.subject, from: i.from, reason: i.reason })),
            deadlines: briefing.email.outlook.deadlines.map((i) => ({ subject: i.subject, deadline: i.deadline })),
          },
        },
        jobs: {
          totalSaved: briefing.jobs.totalSaved,
          strongMatches: briefing.jobs.strongMatches,
          applicationsAwaitingAction: briefing.jobs.applicationsAwaitingAction,
          applicationsAwaitingApproval: briefing.jobs.applicationsAwaitingApproval,
          followUpNote: briefing.jobs.followUpNote,
        },
        approvals: briefing.approvals,
      },
      auditSafeSummary: {
        briefingDate: briefing.briefingDate,
        urgentCount: briefing.urgentCount,
        actionsCount: briefing.actionsCount,
        approvalsCount: briefing.approvalsCount,
      },
    };
  },
};

export const briefingTools = [getDailyBriefingTool];
