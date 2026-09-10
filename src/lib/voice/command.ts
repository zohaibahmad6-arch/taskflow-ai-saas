import "server-only";
import { runChatTurn, type ChatTurnResult } from "../ai/chat";
import { classifyConfirmation } from "./confirmation";
import {
  getApprovalById,
  listApprovals,
  decideApproval,
  ApprovalNotFoundError,
  ApprovalStateError,
  ApprovalRevisionMismatchError,
  type ApprovalRow,
} from "../approvals";

/**
 * The single, centralized security-critical routing decision for a
 * transcribed voice utterance — see the doc comment on
 * classifyConfirmation for why this exists as dedicated code rather than
 * being left to the model. Extracted from the route handler (like
 * runChatTurn/decideApproval themselves) so it's directly unit-testable
 * without needing to construct a NextRequest.
 */

export type PendingApprovalSummary = { id: string; action: string; target: string; revision: number };

export type VoiceCommandResult =
  | ({ type: "chat" } & ChatTurnResult)
  | { type: "decided"; decision: "approved" | "rejected"; approval: ApprovalRow }
  | { type: "no_pending"; message: string }
  | { type: "ambiguous"; message: string; pending: PendingApprovalSummary[] };

export class VoiceCommandError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "VoiceCommandError";
    this.status = status;
  }
}

function summarize(a: ApprovalRow): PendingApprovalSummary {
  return { id: a.id, action: a.action, target: a.target, revision: a.revision };
}

export async function handleVoiceCommand(
  userId: string,
  params: { conversationId: string; text: string; trackedApprovalId?: string }
): Promise<VoiceCommandResult> {
  const intent = classifyConfirmation(params.text);

  if (intent === null) {
    // Not a confirm/deny utterance — route through the EXACT SAME
    // authenticated agent/tool pipeline typed chat uses. No new
    // execution path, no separate voice agent.
    const result = await runChatTurn(userId, params.conversationId, params.text);
    return { type: "chat", ...result };
  }

  // --- Confirm/deny path: resolve EXACTLY one pending approval, never guess ---
  let target: ApprovalRow | undefined;

  if (params.trackedApprovalId) {
    const candidate = getApprovalById(params.trackedApprovalId);
    // Every property re-checked fresh, right now, regardless of what the
    // caller believed was true when it sent the hint.
    if (candidate && candidate.user_id === userId && candidate.status === "pending") {
      target = candidate;
    }
    // If the hint no longer resolves (already decided, expired, wrong
    // user), fall through to disambiguation rather than silently failing.
  }

  if (!target) {
    const pending = listApprovals(userId, "pending");
    if (pending.length === 0) {
      return { type: "no_pending", message: "There's nothing currently awaiting your approval." };
    }
    if (pending.length > 1) {
      return {
        type: "ambiguous",
        message: "You have more than one pending approval. Which one — say the action or target?",
        pending: pending.map(summarize),
      };
    }
    target = pending[0];
  }

  const decision = intent === "approve" ? "approved" : "rejected";

  try {
    // expectedRevision comes from `target`, read fresh from the database
    // in THIS call (either just now via getApprovalById, or via
    // listApprovals a moment ago) — never from anything the caller
    // supplied. decideApproval's own optimistic-concurrency check still
    // catches any change between that read and this call.
    const updated = await decideApproval(userId, target.id, decision, target.revision);
    return { type: "decided", decision, approval: updated };
  } catch (err) {
    if (err instanceof ApprovalRevisionMismatchError) {
      throw new VoiceCommandError(
        "That approval changed since it was last shown to you. Please review it again before deciding.",
        409
      );
    }
    if (err instanceof ApprovalStateError || err instanceof ApprovalNotFoundError) {
      throw new VoiceCommandError(err.message, 400);
    }
    throw err;
  }
}
