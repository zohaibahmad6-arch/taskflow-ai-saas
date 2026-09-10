import "server-only";
import { registerTool, syncToolRegistryToDb } from "./registry";
import { emailTools } from "./email";
import { socialTools } from "./social";
import { systemTools } from "./system";

let initialized = false;

/** Idempotent: safe to call from every request path that needs the registry. */
export function ensureToolsRegistered(): void {
  if (initialized) return;
  for (const tool of [...emailTools, ...socialTools, ...systemTools]) {
    registerTool(tool);
  }
  syncToolRegistryToDb();
  initialized = true;
}
