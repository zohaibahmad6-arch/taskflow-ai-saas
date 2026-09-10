import "server-only";
import { isConnected } from "../connections";
import { GmailProvider } from "./gmail";
import type { EmailProvider } from "./provider";

export type {
  EmailProvider,
  EmailConnectionStatus,
  EmailMessageSummary,
  EmailMessageFull,
  EmailThread,
} from "./provider";
export { EmailProviderError } from "./provider";

/**
 * Returns the connected email provider for this user, or null if none is
 * connected. This is the ONLY place tool code should get a provider from
 * — never instantiate GmailProvider directly elsewhere, so adding a
 * second provider later never means hunting down hard-coded Gmail calls.
 */
export function getEmailProvider(userId: string): EmailProvider | null {
  if (isConnected(userId, "gmail")) {
    return new GmailProvider(userId);
  }
  return null;
}
