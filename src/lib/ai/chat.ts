import "server-only";
import type OpenAI from "openai";
import { getOpenAIClient, AIUnavailableError } from "../openai";
import { env } from "../env";
import { db, newId } from "../db";
import { listTools, toolToJsonSchema } from "../tools/registry";
import { invokeTool, ToolInputError, ToolNotFoundError } from "../tools/execute";
import { getPreferences, describePreferencesForPrompt } from "../preferences";
import { listConnections } from "../connections";

const MAX_TOOL_ITERATIONS = 6;

type ChatMessageRow = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls_json: string | null;
  tool_call_id: string | null;
};

function buildSystemPrompt(userId: string): string {
  const prefs = getPreferences(userId);
  const connections = listConnections(userId);
  const connectedList = connections
    .filter((c) => c.status === "connected")
    .map((c) => c.provider);

  return [
    "You are the user's private, personal AI agent. You exist to help exactly one person — the account owner — with email, social media content, research, and general tasks.",
    "This is not a multi-tenant product. There is only one user.",
    "",
    "HARD SECURITY RULE: you may read, search, analyze, summarize, and draft freely. You must NEVER claim to have sent an email, published a post, or performed any other external/irreversible action. Those actions can only happen through the Approval Center, after the user explicitly approves that specific action. When you call a tool that requires approval, tell the user it is now pending in the Approval Center — do not say it is done.",
    "Never fabricate data. If email or social accounts are not connected, say so plainly instead of inventing inbox contents or account activity.",
    "",
    `Currently connected services: ${connectedList.length ? connectedList.join(", ") : "none"}.`,
    "",
    "Content style profile (respect this when drafting anything the user will publish):",
    describePreferencesForPrompt(prefs),
  ].join("\n");
}

function toOpenAITools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return listTools().map((tool) => ({
    type: "function",
    function: {
      name: tool.id,
      description: tool.description,
      parameters: toolToJsonSchema(tool),
    },
  }));
}

function saveMessage(
  userId: string,
  conversationId: string,
  row: Partial<ChatMessageRow> & { role: ChatMessageRow["role"]; content: string }
): void {
  db.prepare(
    `INSERT INTO chat_messages (id, user_id, conversation_id, role, content, tool_calls_json, tool_call_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newId("msg"),
    userId,
    conversationId,
    row.role,
    row.content,
    row.tool_calls_json ?? null,
    row.tool_call_id ?? null
  );
}

export function getConversationHistory(
  userId: string,
  conversationId: string
): ChatMessageRow[] {
  return db
    .prepare(
      `SELECT role, content, tool_calls_json, tool_call_id FROM chat_messages
       WHERE user_id = ? AND conversation_id = ? ORDER BY created_at ASC`
    )
    .all(userId, conversationId) as ChatMessageRow[];
}

export type ChatTurnResult = {
  reply: string;
  toolActivity: Array<{ toolId: string; awaitingApproval: boolean; approvalId?: string }>;
};

export async function runChatTurn(
  userId: string,
  conversationId: string,
  userMessage: string
): Promise<ChatTurnResult> {
  saveMessage(userId, conversationId, { role: "user", content: userMessage });

  const history = getConversationHistory(userId, conversationId);
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt(userId) },
    ...history.map((m): OpenAI.Chat.Completions.ChatCompletionMessageParam => {
      if (m.role === "tool") {
        return { role: "tool", content: m.content, tool_call_id: m.tool_call_id ?? "" };
      }
      if (m.role === "assistant") {
        return {
          role: "assistant",
          content: m.content || null,
          tool_calls: m.tool_calls_json ? JSON.parse(m.tool_calls_json) : undefined,
        };
      }
      return { role: m.role, content: m.content };
    }),
  ];

  const openai = getOpenAIClient();
  const tools = toOpenAITools();
  const toolActivity: ChatTurnResult["toolActivity"] = [];

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    let completion;
    try {
      completion = await openai.chat.completions.create({
        model: env.openaiModel,
        messages,
        tools,
        tool_choice: "auto",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      throw new AIUnavailableError(`AI request failed: ${message}`);
    }

    const choice = completion.choices[0];
    const assistantMessage = choice.message;

    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      const reply = assistantMessage.content ?? "";
      saveMessage(userId, conversationId, { role: "assistant", content: reply });
      return { reply, toolActivity };
    }

    saveMessage(userId, conversationId, {
      role: "assistant",
      content: assistantMessage.content ?? "",
      tool_calls_json: JSON.stringify(assistantMessage.tool_calls),
    });
    messages.push({
      role: "assistant",
      content: assistantMessage.content ?? null,
      tool_calls: assistantMessage.tool_calls,
    });

    for (const call of assistantMessage.tool_calls) {
      if (call.type !== "function") continue;
      let resultPayload: Record<string, unknown>;
      try {
        const input = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        const result = await invokeTool(call.function.name, input, { userId });
        resultPayload = result.output;
        toolActivity.push({
          toolId: call.function.name,
          awaitingApproval: Boolean(result.awaitingApproval),
          approvalId: result.approvalId,
        });
      } catch (err) {
        if (err instanceof ToolNotFoundError || err instanceof ToolInputError) {
          resultPayload = { error: err.message };
        } else {
          resultPayload = {
            error: err instanceof Error ? err.message : "Tool execution failed.",
          };
        }
      }

      const toolContent = JSON.stringify(resultPayload);
      saveMessage(userId, conversationId, {
        role: "tool",
        content: toolContent,
        tool_call_id: call.id,
      });
      messages.push({ role: "tool", content: toolContent, tool_call_id: call.id });
    }
  }

  const fallback =
    "I ran into a loop trying to complete that using multiple tools. Please rephrase or break it into smaller steps.";
  saveMessage(userId, conversationId, { role: "assistant", content: fallback });
  return { reply: fallback, toolActivity };
}
