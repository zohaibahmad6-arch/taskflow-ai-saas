import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "../types";
import { isConnected, listConnections } from "../../connections";
import { generateText } from "../../openai";
import { getPreferences, describePreferencesForPrompt } from "../../preferences";
import { createSocialDraft, getSocialDraft } from "../../socialDrafts";

const PLATFORMS = ["linkedin", "x", "facebook", "instagram"] as const;

const checkConnectionTool: ToolDefinition<Record<string, never>> = {
  id: "social.checkConnection",
  name: "Check Social Connections",
  description: "Reports which social platforms are connected. Call this before claiming a post can be published.",
  category: "social",
  permissionLevel: "READ_ONLY",
  inputSchema: z.object({}),
  run: async (_input, ctx) => {
    const connections = listConnections(ctx.userId).filter((c) => c.category === "social");
    return {
      output: {
        accounts: connections.map((c) => ({ provider: c.provider, status: c.status })),
      },
    };
  },
};

const createPostInput = z.object({
  platform: z.enum(PLATFORMS).describe("Target platform for the post."),
  topic: z.string().describe("What the post should be about."),
  notes: z.string().optional().describe("Extra guidance for this specific post."),
});

const createPostTool: ToolDefinition<z.infer<typeof createPostInput>> = {
  id: "social.createPost",
  name: "Create Social Post",
  description:
    "Generates a draft post for a platform using the user's saved content style. Saves it as a draft awaiting approval — never publishes.",
  category: "social",
  permissionLevel: "PREPARATION",
  inputSchema: createPostInput,
  run: async (input, ctx) => {
    const prefs = getPreferences(ctx.userId);
    const styleBlock = describePreferencesForPrompt(prefs);
    const content = await generateText({
      system:
        `You are a personal social media assistant writing on behalf of the user for ${input.platform}. ` +
        `Match this content style profile exactly:\n${styleBlock}\n` +
        "Do not invent facts, credentials, or claims about the user. Output only the post text, no commentary, no quotes around it.",
      prompt: `Topic: ${input.topic}\n${input.notes ? `Notes: ${input.notes}` : ""}`,
    });
    const draft = createSocialDraft({
      userId: ctx.userId,
      platform: input.platform,
      content,
      sourceNote: `Generated from topic: ${input.topic}`,
    });
    return {
      output: {
        draftId: draft.id,
        platform: draft.platform,
        content: draft.content,
        status: "ready_for_approval",
        message: "Draft created. It will not be published until you approve it in the Approval Center.",
      },
    };
  },
};

const rewritePostInput = z.object({
  content: z.string().describe("The existing post text to rewrite."),
  platform: z.enum(PLATFORMS).describe("Platform to adapt the post for."),
  instruction: z
    .string()
    .describe("How to change it, e.g. 'shorten', 'expand', 'make it punchier', 'adapt for X from a LinkedIn post'."),
});

const rewritePostTool: ToolDefinition<z.infer<typeof rewritePostInput>> = {
  id: "social.rewritePost",
  name: "Rewrite / Adapt Post",
  description: "Rewrites, shortens, expands, or adapts an existing post for a specific platform. Saves the result as a new draft.",
  category: "social",
  permissionLevel: "PREPARATION",
  inputSchema: rewritePostInput,
  run: async (input, ctx) => {
    const prefs = getPreferences(ctx.userId);
    const styleBlock = describePreferencesForPrompt(prefs);
    const content = await generateText({
      system:
        `You are a personal social media assistant adapting content for ${input.platform}. ` +
        `Match this content style profile:\n${styleBlock}\n` +
        "Output only the rewritten post text, no commentary.",
      prompt: `Original post:\n${input.content}\n\nInstruction: ${input.instruction}`,
    });
    const draft = createSocialDraft({
      userId: ctx.userId,
      platform: input.platform,
      content,
      sourceNote: `Rewritten: ${input.instruction}`,
    });
    return {
      output: {
        draftId: draft.id,
        platform: draft.platform,
        content: draft.content,
        status: "ready_for_approval",
      },
    };
  },
};

const publishPostInput = z.object({
  draftId: z.string().describe("The id of a previously created draft to publish."),
});

const publishPostTool: ToolDefinition<z.infer<typeof publishPostInput>> = {
  id: "social.publishPost",
  name: "Publish Social Post",
  description: "Publishes a draft post to its platform. External, irreversible, and always requires explicit user approval.",
  category: "social",
  permissionLevel: "EXTERNAL_ACTION",
  inputSchema: publishPostInput,
  run: async () => {
    throw new Error("social.publishPost has no direct run(); it must go through the approval flow.");
  },
  buildApprovalDraft: async (input) => {
    const draft = getSocialDraft(input.draftId);
    if (!draft) throw new Error("Draft not found.");
    return {
      action: "Publish social post",
      target: draft.platform,
      content: draft.content,
      consequence: `This will publish the post publicly to your ${draft.platform} account immediately. This cannot be undone.`,
    };
  },
  execute: async (input, ctx) => {
    const draft = getSocialDraft(input.draftId);
    if (!draft) throw new Error("Draft not found.");
    if (!isConnected(ctx.userId, draft.platform)) {
      throw new Error(
        `${draft.platform} is not connected. Connect it from Settings → Connected Services, then approve this action again.`
      );
    }
    // A real platform integration would call the publish API here. None is
    // wired up in this build, so we deliberately fail rather than pretend
    // the post went out.
    throw new Error(
      `${draft.platform} is marked connected, but no publish integration is implemented yet in this build.`
    );
  },
};

export const socialTools = [checkConnectionTool, createPostTool, rewritePostTool, publishPostTool];
