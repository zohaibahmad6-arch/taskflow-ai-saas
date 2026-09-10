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

/** Human-readable text shown in the Approval Center, derived FROM a payload. */
export type ApprovalDraftText = {
  /** What the agent wants to do. */
  action: string;
  /** Who/what will receive the action (e.g. "LinkedIn", "jane@company.com"). */
  target: string;
  /** Exactly what will be sent/published — must match `content` inside the payload. */
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
  /**
   * What gets written to the audit log for this call INSTEAD of `output`.
   * Tools whose `output` can contain private content pulled from a
   * third-party source (an email body, a message snippet) should set
   * this to a content-free summary (e.g. counts, ids) — the audit log
   * must never become a second copy of someone's inbox. When omitted,
   * READ_ONLY/PREPARATION tools fall back to logging `output` as-is.
   */
  auditSafeSummary?: Record<string, unknown>;
};

export type ToolDefinition<TInput = unknown, TPayload = TInput> = {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  permissionLevel: ToolPermissionLevel;
  inputSchema: ZodTypeAny;
  /**
   * READ_ONLY / PREPARATION only: performs the work directly. Required
   * for those two levels; never called for EXTERNAL_ACTION tools.
   */
  run?: (input: TInput, ctx: ToolContext) => Promise<ToolResult>;

  /**
   * EXTERNAL_ACTION only, all four required. Together these guarantee the
   * Approval Center never executes anything but the payload the user
   * actually reviewed:
   *
   *  - approvalPayloadSchema: the schema of the STORED, EDITABLE,
   *    EXECUTED payload. This is the single source of truth from the
   *    moment the approval is created — editing rewrites this payload in
   *    place (validated against this same schema); execute() is only
   *    ever given a value that has passed this schema.
   *  - resolvePayload: turns the tool's initial call arguments (which may
   *    reference something external, e.g. a draft id) into the first
   *    payload snapshot. Called once, at approval-creation time.
   *  - describePayload: pure derivation of display text FROM a payload.
   *    Called both at creation and after every edit, so the shown
   *    action/target/content/consequence can never drift from the
   *    payload that will actually execute.
   *  - execute: performs the real side effect using ONLY the payload
   *    passed in — must never re-fetch or re-derive content from
   *    wherever it originally came from (e.g. a drafts table), since
   *    that source may have changed or may not reflect an edit made in
   *    the Approval Center.
   */
  approvalPayloadSchema?: ZodTypeAny;
  resolvePayload?: (input: TInput, ctx: ToolContext) => Promise<TPayload>;
  describePayload?: (payload: TPayload, ctx: ToolContext) => Promise<ApprovalDraftText>;
  execute?: (payload: TPayload, ctx: ToolContext) => Promise<ToolResult>;

  /** Optional short hint shown in the edit UI, e.g. "Fields: to, subject, body". */
  payloadHint?: string;
};
