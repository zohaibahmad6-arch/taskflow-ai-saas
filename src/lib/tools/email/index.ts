import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "../types";
import { isConnected, listConnections } from "../../connections";
import { generateText } from "../../openai";

const checkConnectionTool: ToolDefinition<Record<string, never>> = {
  id: "email.checkConnection",
  name: "Check Email Connection",
  description:
    "Reports whether an email account is connected and, if so, which provider. Always call this before claiming anything about the user's inbox.",
  category: "email",
  permissionLevel: "READ_ONLY",
  inputSchema: z.object({}),
  run: async (_input, ctx) => {
    const connections = listConnections(ctx.userId).filter((c) => c.category === "email");
    const connected = connections.filter((c) => c.status === "connected");
    return {
      output: {
        connected: connected.length > 0,
        accounts: connections.map((c) => ({ provider: c.provider, status: c.status })),
      },
    };
  },
};

const searchEmailInput = z.object({
  query: z
    .string()
    .min(1)
    .max(300)
    .describe("Search terms, e.g. sender name, subject keywords, or a date range in plain English."),
});

const searchEmailTool: ToolDefinition<z.infer<typeof searchEmailInput>> = {
  id: "email.search",
  name: "Search Email",
  description: "Searches the connected inbox. Returns nothing and explains itself if no email account is connected — never invent results.",
  category: "email",
  permissionLevel: "READ_ONLY",
  inputSchema: searchEmailInput,
  run: async (_input, ctx) => {
    if (!isConnected(ctx.userId, "gmail") && !isConnected(ctx.userId, "outlook")) {
      return {
        output: {
          connected: false,
          results: [],
          message:
            "No email account is connected yet. Go to Email → Connect Email to authorize one before I can search real messages.",
        },
      };
    }
    // A provider is connected: real search would happen here via that
    // provider's API. No provider integration is wired up yet in this build.
    return {
      output: {
        connected: true,
        results: [],
        message: "Connected, but no messages have been indexed yet.",
      },
    };
  },
};

const summarizeInboxTool: ToolDefinition<Record<string, never>> = {
  id: "email.summarizeInbox",
  name: "Summarize Inbox",
  description:
    "Produces the daily email briefing (Urgent / Action Required / Follow Up / FYI / Deadlines). Requires a connected email account.",
  category: "email",
  permissionLevel: "READ_ONLY",
  inputSchema: z.object({}),
  run: async (_input, ctx) => {
    if (!isConnected(ctx.userId, "gmail") && !isConnected(ctx.userId, "outlook")) {
      return {
        output: {
          connected: false,
          message:
            "No email account is connected, so I can't produce a real briefing. Connect one from the Email tab first — I won't fabricate a summary.",
        },
      };
    }
    return {
      output: {
        connected: true,
        message: "Connected, but there is no mail history yet to summarize.",
      },
    };
  },
};

const draftReplyInput = z.object({
  originalEmail: z
    .string()
    .min(1)
    .max(20_000)
    .describe("The full text of the email being replied to, pasted in by the user."),
  instructions: z
    .string()
    .max(2_000)
    .optional()
    .describe("Any guidance on tone, points to make, or how to respond."),
});

const draftReplyTool: ToolDefinition<z.infer<typeof draftReplyInput>> = {
  id: "email.draftReply",
  name: "Draft Email Reply",
  description:
    "Drafts a reply to an email the user pastes in. This only prepares text — it never sends anything.",
  category: "email",
  permissionLevel: "PREPARATION",
  inputSchema: draftReplyInput,
  run: async (input) => {
    const draft = await generateText({
      system:
        "You are a personal email assistant. Draft a clear, professional reply to the email the user provides. " +
        "Follow any instructions given. Output only the reply body text, no subject line, no commentary.",
      prompt: `Original email:\n${input.originalEmail}\n\nInstructions: ${input.instructions ?? "Use your best judgment for a helpful, concise reply."}`,
    });
    return { output: { draft } };
  },
};

// The initial tool-call arguments (what the AI passes when it decides to
// send an email) happen to have the exact same shape as the executable
// payload for this tool, so one schema serves both roles.
const sendEmailPayload = z.object({
  to: z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .max(320) // RFC 5321 maximum mailbox length
    .describe("Recipient email address."),
  subject: z.string().trim().min(1).max(500).describe("Email subject line."),
  body: z.string().min(1).max(20_000).describe("Email body text."),
});

const sendEmailTool: ToolDefinition<z.infer<typeof sendEmailPayload>> = {
  id: "email.send",
  name: "Send Email",
  description:
    "Sends an email. This is an external, irreversible action and always requires explicit user approval before anything is sent.",
  category: "email",
  permissionLevel: "EXTERNAL_ACTION",
  inputSchema: sendEmailPayload,
  payloadHint: "Fields: to, subject, body",
  approvalPayloadSchema: sendEmailPayload,
  resolvePayload: async (input) => input,
  describePayload: async (payload) => ({
    action: "Send email",
    target: payload.to,
    content: `Subject: ${payload.subject}\n\n${payload.body}`,
    consequence: `This will send an email to ${payload.to} that they will receive immediately. This cannot be undone.`,
  }),
  execute: async (payload, ctx) => {
    const connected = isConnected(ctx.userId, "gmail") || isConnected(ctx.userId, "outlook");
    if (!connected) {
      throw new Error(
        "No email account is connected. Connect one from Settings → Connected Services, then approve this action again."
      );
    }
    // A real provider integration would call the send API here, using
    // payload.to/subject/body exactly as approved. None is wired up in
    // this build, so we deliberately fail rather than pretend.
    throw new Error(
      "An email provider is marked connected, but no send integration is implemented yet in this build."
    );
  },
};

export const emailTools = [
  checkConnectionTool,
  searchEmailTool,
  summarizeInboxTool,
  draftReplyTool,
  sendEmailTool,
];
