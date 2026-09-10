import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "../types";
import { db, newId } from "../../db";
import { generateText } from "../../openai";

const proposeCapabilityInput = z.object({
  request: z
    .string()
    .min(1)
    .max(4_000)
    .describe("What the user wants the assistant to be able to do, in their own words."),
});

const proposeCapabilityTool: ToolDefinition<z.infer<typeof proposeCapabilityInput>> = {
  id: "system.proposeCapability",
  name: "Propose New Capability",
  description:
    "Use this when the user asks the assistant to build or add a brand-new tool/capability. Produces a structured proposal (what it does, permissions needed, external access needed) for the user to review. It does not write or install any code by itself.",
  category: "system",
  permissionLevel: "PREPARATION",
  inputSchema: proposeCapabilityInput,
  run: async (input, ctx) => {
    const raw = await generateText({
      system:
        "You are the planning layer of a personal AI agent platform. The user is asking for a new capability. " +
        "Respond with strict JSON only, matching this shape: " +
        `{"name": string, "summary": string, "requiredPermissions": string[], "externalAccessNeeded": string[], "classification": "READ_ONLY"|"PREPARATION"|"EXTERNAL_ACTION", "risks": string[]}. ` +
        "Be conservative: if the capability could take an external action (sending/publishing/purchasing/deleting/submitting), classification must be EXTERNAL_ACTION and it must be listed as requiring approval for every use, not just installation.",
      prompt: input.request,
      temperature: 0.3,
    });

    let proposal: unknown;
    try {
      proposal = JSON.parse(raw);
    } catch {
      proposal = { name: "Unparsed proposal", summary: raw, requiredPermissions: [], externalAccessNeeded: [], classification: "PREPARATION", risks: ["Could not parse a structured proposal; review manually."] };
    }

    const id = newId("cap");
    db.prepare(
      "INSERT INTO capability_requests (id, user_id, request_text, proposal_json) VALUES (?, ?, ?, ?)"
    ).run(id, ctx.userId, input.request, JSON.stringify(proposal));

    return {
      output: {
        capabilityRequestId: id,
        proposal,
        message:
          "This is a proposal only — no code has been written or installed. Building it is a development task; review the proposal, and when you're ready, hand this request to a development session to implement it behind the same tool registry and approval rules.",
      },
    };
  },
};

export const systemTools = [proposeCapabilityTool];
