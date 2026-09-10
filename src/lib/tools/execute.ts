import "server-only";
import { getTool } from "./registry";
import { createApproval } from "../approvals";
import { writeAuditEvent } from "../audit";
import type { ToolContext, ToolResult } from "./types";

export class ToolNotFoundError extends Error {}
export class ToolInputError extends Error {}

/**
 * The single entry point for the agent to invoke a tool. This is the
 * enforcement point for section 18 of the spec: the permission level is
 * read from the server-side registry, never trusted from the caller, and
 * an EXTERNAL_ACTION tool is physically incapable of running its side
 * effect from here — it can only ever produce a pending Approval.
 */
export async function invokeTool(
  toolId: string,
  rawInput: unknown,
  ctx: ToolContext
): Promise<ToolResult & { approvalId?: string }> {
  const tool = getTool(toolId);
  if (!tool) throw new ToolNotFoundError(`Unknown tool: ${toolId}`);

  const parsed = tool.inputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    throw new ToolInputError(
      `Invalid input for tool "${toolId}": ${parsed.error.issues.map((i) => i.message).join("; ")}`
    );
  }
  const input = parsed.data;

  if (tool.permissionLevel === "EXTERNAL_ACTION") {
    if (!tool.buildApprovalDraft) {
      throw new Error(`Tool "${toolId}" is EXTERNAL_ACTION but has no buildApprovalDraft.`);
    }
    const draft = await tool.buildApprovalDraft(input, ctx);
    const approval = createApproval({
      userId: ctx.userId,
      toolId,
      input,
      draft,
    });
    return {
      output: {
        status: "awaiting_approval",
        approvalId: approval.id,
        action: draft.action,
        target: draft.target,
        content: draft.content,
        consequence: draft.consequence,
        message:
          "This action requires your explicit approval before anything happens. It has been added to the Approval Center.",
      },
      awaitingApproval: true,
      approvalId: approval.id,
    };
  }

  // READ_ONLY and PREPARATION tools run immediately — no external side effect.
  const result = await tool.run(input, ctx);

  writeAuditEvent({
    userId: ctx.userId,
    toolId,
    eventType: "info",
    summary: `${tool.name} ran (${tool.permissionLevel.toLowerCase()})`,
    detail: result.output,
  });

  return result;
}
