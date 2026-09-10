/**
 * `any` is used deliberately throughout this file for two unrelated
 * reasons, both intentional type erasure rather than laziness:
 *  - ToolDefinition<any>: the registry holds tools with different input
 *    types side by side (a heterogeneous collection keyed by id), and
 *    each tool's own file still gets full type safety via its concrete
 *    ToolDefinition<T>.
 *  - the zodToJsonSchema helper: zod v4 splits its public `ZodType` from
 *    an internal `$ZodType` core type in a way that doesn't structurally
 *    line up for `.unwrap()`/`.element`; this converter is best-effort
 *    and not part of the tool contract itself.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import "server-only";
import { z } from "zod";
import { db, nowIso } from "../db";
import type { ToolDefinition } from "./types";

const registry = new Map<string, ToolDefinition<any>>();

export function registerTool(tool: ToolDefinition<any>): void {
  if (tool.permissionLevel === "EXTERNAL_ACTION") {
    if (!tool.approvalPayloadSchema || !tool.resolvePayload || !tool.describePayload || !tool.execute) {
      throw new Error(
        `Tool "${tool.id}" is EXTERNAL_ACTION but is missing one of approvalPayloadSchema/resolvePayload/describePayload/execute. Refusing to register.`
      );
    }
  } else if (!tool.run) {
    throw new Error(
      `Tool "${tool.id}" is ${tool.permissionLevel} but has no run(). Refusing to register.`
    );
  }
  registry.set(tool.id, tool);
}

export function getTool(id: string): ToolDefinition<any> | undefined {
  return registry.get(id);
}

export function listTools(): ToolDefinition<any>[] {
  return Array.from(registry.values());
}

/** Converts a zod schema to a plain JSON-schema-ish object for the OpenAI tools API. */
function zodToJsonSchema(schema: any): Record<string, unknown> {
  const def = schema._def;
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, any>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value);
      if (!value.isOptional()) required.push(key);
    }
    return { type: "object", properties, required, additionalProperties: false };
  }
  if (schema instanceof z.ZodString) {
    const out: Record<string, unknown> = { type: "string" };
    if (schema.description) out.description = schema.description;
    return out;
  }
  if (schema instanceof z.ZodEnum) {
    return { type: "string", enum: schema.options };
  }
  if (schema instanceof z.ZodOptional) {
    return zodToJsonSchema(schema.unwrap());
  }
  if (schema instanceof z.ZodNumber) {
    return { type: "number" };
  }
  if (schema instanceof z.ZodBoolean) {
    return { type: "boolean" };
  }
  if (schema instanceof z.ZodArray) {
    return { type: "array", items: zodToJsonSchema(schema.element) };
  }
  return { type: def?.typeName ?? "string" };
}

export function toolToJsonSchema(tool: ToolDefinition<any>) {
  return zodToJsonSchema(tool.inputSchema);
}

/** Mirrors the in-code registry into the DB for visibility/admin purposes. */
export function syncToolRegistryToDb(): void {
  const upsert = db.prepare(`
    INSERT INTO tool_registry (id, name, description, category, permission_level, approval_required, input_schema_json, updated_at)
    VALUES (@id, @name, @description, @category, @permission_level, @approval_required, @input_schema_json, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      category = excluded.category,
      permission_level = excluded.permission_level,
      approval_required = excluded.approval_required,
      input_schema_json = excluded.input_schema_json,
      updated_at = excluded.updated_at
  `);

  const tx = db.transaction((tools: ToolDefinition<any>[]) => {
    for (const tool of tools) {
      upsert.run({
        id: tool.id,
        name: tool.name,
        description: tool.description,
        category: tool.category,
        permission_level: tool.permissionLevel,
        approval_required: tool.permissionLevel === "EXTERNAL_ACTION" ? 1 : 0,
        input_schema_json: JSON.stringify(toolToJsonSchema(tool)),
        updated_at: nowIso(),
      });
    }
  });
  tx(listTools());
}
