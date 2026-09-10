import "server-only";
import { isConnected } from "../connections";
import { GmailProvider } from "./gmail";
import { OutlookProvider } from "./outlook";
import type { EmailProvider } from "./provider";

export type {
  EmailProvider,
  EmailConnectionStatus,
  EmailMessageSummary,
  EmailMessageFull,
  EmailThread,
} from "./provider";
export { EmailProviderError } from "./provider";

export const KNOWN_EMAIL_PROVIDER_IDS = ["gmail", "outlook"] as const;
export type KnownEmailProviderId = (typeof KNOWN_EMAIL_PROVIDER_IDS)[number];

function instantiate(userId: string, providerId: KnownEmailProviderId): EmailProvider {
  switch (providerId) {
    case "gmail":
      return new GmailProvider(userId);
    case "outlook":
      return new OutlookProvider(userId);
  }
}

/**
 * Returns a specific connected provider by id, or null if that provider
 * isn't connected. This is the explicit-selection entry point tool code
 * should use whenever the account matters (mutations, multi-account
 * disambiguation) — never instantiate GmailProvider/OutlookProvider
 * directly elsewhere.
 */
export function getEmailProviderById(userId: string, providerId: KnownEmailProviderId): EmailProvider | null {
  if (!isConnected(userId, providerId)) return null;
  return instantiate(userId, providerId);
}

/**
 * Returns every currently-connected email provider for this user. Use
 * this whenever an operation should consider "all connected mail", or
 * when ambiguity between accounts needs to be detected (more than one
 * entry here means a tool must ask which account, never guess).
 */
export function getConnectedEmailProviders(userId: string): { providerId: KnownEmailProviderId; instance: EmailProvider }[] {
  return KNOWN_EMAIL_PROVIDER_IDS.filter((id) => isConnected(userId, id)).map((id) => ({
    providerId: id,
    instance: instantiate(userId, id),
  }));
}

/**
 * Back-compat single-provider getter for call sites that only ever
 * needed "the" connected account (from when Gmail was the only
 * provider). Returns Gmail if connected, else Outlook if connected, else
 * null. Prefer getEmailProviderById / getConnectedEmailProviders for any
 * new code where the account matters or multiple could be connected.
 */
export function getEmailProvider(userId: string): EmailProvider | null {
  const connected = getConnectedEmailProviders(userId);
  return connected[0]?.instance ?? null;
}
