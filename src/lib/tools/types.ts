import type { ZodTypeAny } from "zod";

/**
 * Every tool the agent can call declares exactly one of these levels.
 * This classification is enforced server-side in execute.ts — a tool
 * cannot decide for itself to skip the approval gate.
 */
export type ToolPermissionLevel = "READ_ONLY" | "PREPARATION" | "EXTERNAL_ACTION";

export type ToolCategory =
  | "email"
  | "social"
  | "research"
  | "document"
  | "automation"
  | "system";

export type ApprovalDraft = {
  /** Human-readable description of exactly what the agent wants to do. */
  action: string;
  /** Who/what will receive the action (e.g. "LinkedIn", "jane@company.com"). */
  target: string;
  /** Exactly what will be sent/published. */
  content: string;
  /** Plain-language explanation of what will happen if approved. */
  consequence: string;
};

export type ToolContext = {
  userId: string;
};

export type ToolResult = {
  /** Machine-readable summary handed back to the model as the tool result. */
  output: Record<string, unknown>;
  /** true if this call created a pending approval instead of acting. */
  awaitingApproval?: boolean;
};

export type ToolDefinition<TInput = unknown> = {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  permissionLevel: ToolPermissionLevel;
  inputSchema: ZodTypeAny;
  /**
   * For READ_ONLY / PREPARATION tools: performs the work directly.
   * For EXTERNAL_ACTION tools: this is the PREVIEW step — it must not
   * perform the side effect. It returns the approval draft that will be
   * shown to the user; the actual side effect lives in `execute` below.
   */
  run: (input: TInput, ctx: ToolContext) => Promise<ToolResult>;
  /**
   * EXTERNAL_ACTION tools only: builds the exact Approval Center draft
   * for this call. Required whenever permissionLevel is EXTERNAL_ACTION.
   */
  buildApprovalDraft?: (input: TInput, ctx: ToolContext) => Promise<ApprovalDraft>;
  /**
   * EXTERNAL_ACTION tools only: performs the actual side effect. Called
   * ONLY by the approval-execution path, only after status === 'approved'.
   */
  execute?: (input: TInput, ctx: ToolContext) => Promise<ToolResult>;
};
