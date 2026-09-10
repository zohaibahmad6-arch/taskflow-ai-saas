import "server-only";
import { getTool } from "./registry";
import { createApproval } from "../approvals";
import { writeAuditEvent } from "../audit";
import type { ToolContext, ToolResult } from "./types";

export class ToolNotFoundError extends Error {}
export class ToolInputError extends Error {}
export class ToolConfigError extends Error {}

/**
 * The single entry point for the agent to invoke a tool. This is the
 * enforcement point for section 18 of the spec: the permission level is
 * read from the server-side registry, never trusted from the caller, and
 * an EXTERNAL_ACTION tool is physically incapable of running its side
 * effect from here — it can only ever produce a pending Approval, and the
 * payload that goes into that Approval is validated against the tool's
 * own approvalPayloadSchema (the same schema edits are validated against
 * and execute() will later receive), so oversized or malformed
 * LLM-generated arguments never reach an Approval, let alone execution.
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
    if (!tool.resolvePayload || !tool.describePayload || !tool.approvalPayloadSchema) {
      throw new ToolConfigError(`Tool "${toolId}" is EXTERNAL_ACTION but is misconfigured.`);
    }

    const rawPayload = await tool.resolvePayload(input, ctx);
    const payloadParsed = tool.approvalPayloadSchema.safeParse(rawPayload);
    if (!payloadParsed.success) {
      throw new ToolInputError(
        `Invalid payload resolved for tool "${toolId}": ${payloadParsed.error.issues.map((i) => i.message).join("; ")}`
      );
    }
    const payload = payloadParsed.data;
    const draftText = await tool.describePayload(payload, ctx);

    const approval = createApproval({
      userId: ctx.userId,
      toolId,
      payload,
      draftText,
    });

    return {
      output: {
        status: "awaiting_approval",
        approvalId: approval.id,
        action: draftText.action,
        target: draftText.target,
        content: draftText.content,
        consequence: draftText.consequence,
        message:
          "This action requires your explicit approval before anything happens. It has been added to the Approval Center.",
      },
      awaitingApproval: true,
      approvalId: approval.id,
    };
  }

  if (!tool.run) {
    throw new ToolConfigError(`Tool "${toolId}" is ${tool.permissionLevel} but has no run().`);
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
