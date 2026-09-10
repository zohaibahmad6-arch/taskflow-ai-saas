import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "../types";
import { isConnected, listConnections } from "../../connections";
import { generateText } from "../../openai";
import { getPreferences, describePreferencesForPrompt } from "../../preferences";
import { createSocialDraft, getSocialDraft } from "../../socialDrafts";

const PLATFORMS = ["linkedin", "x", "facebook", "instagram"] as const;
const MAX_POST_LENGTH = 10_000; // generous upper bound; real platform limits are enforced by the platform itself

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
  topic: z.string().min(1).max(2_000).describe("What the post should be about."),
  notes: z.string().max(2_000).optional().describe("Extra guidance for this specific post."),
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
  content: z.string().min(1).max(MAX_POST_LENGTH).describe("The existing post text to rewrite."),
  platform: z.enum(PLATFORMS).describe("Platform to adapt the post for."),
  instruction: z
    .string()
    .min(1)
    .max(500)
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

// What the AI passes when it asks to publish — just a reference to an
// existing draft.
const publishPostInput = z.object({
  draftId: z.string().min(1).max(100).describe("The id of a previously created draft to publish."),
});

// What actually gets stored on the Approval, edited, and executed. Built
// once (a snapshot) by resolvePayload below, and from then on is the
// ONLY thing execute() reads — the drafts table is never re-read to
// decide what gets published, so an edit made in the Approval Center (or
// a change to the source draft after the approval was created) can never
// cause a mismatch between what was reviewed and what executes.
const publishPostPayload = z.object({
  platform: z.enum(PLATFORMS),
  content: z.string().min(1).max(MAX_POST_LENGTH),
  draftId: z.string().max(100).optional(), // kept only for bookkeeping (marking the source draft published)
});

const publishPostTool: ToolDefinition<z.infer<typeof publishPostInput>, z.infer<typeof publishPostPayload>> = {
  id: "social.publishPost",
  name: "Publish Social Post",
  description: "Publishes a draft post to its platform. External, irreversible, and always requires explicit user approval.",
  category: "social",
  permissionLevel: "EXTERNAL_ACTION",
  inputSchema: publishPostInput,
  payloadHint: "Fields: platform, content",
  approvalPayloadSchema: publishPostPayload,
  resolvePayload: async (input) => {
    const draft = getSocialDraft(input.draftId);
    if (!draft) throw new Error("Draft not found.");
    return { platform: draft.platform as (typeof PLATFORMS)[number], content: draft.content, draftId: draft.id };
  },
  describePayload: async (payload) => ({
    action: "Publish social post",
    target: payload.platform,
    content: payload.content,
    consequence: `This will publish the post publicly to your ${payload.platform} account immediately. This cannot be undone.`,
  }),
  execute: async (payload, ctx) => {
    if (!isConnected(ctx.userId, payload.platform)) {
      throw new Error(
        `${payload.platform} is not connected. Connect it from Settings → Connected Services, then approve this action again.`
      );
    }
    // A real platform integration would call the publish API here, using
    // payload.content exactly as approved (which may differ from the
    // source draft's current text if it was edited in the Approval
    // Center) — never re-reading the draft. On success it should also
    // mark the source draft published via updateSocialDraftStatus. None
    // of that is wired up in this build, so we deliberately fail rather
    // than pretend the post went out.
    throw new Error(
      `${payload.platform} is marked connected, but no publish integration is implemented yet in this build.`
    );
  },
};

export const socialTools = [checkConnectionTool, createPostTool, rewritePostTool, publishPostTool];
