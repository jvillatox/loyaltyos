import type { HttpMethod } from "@loyaltyos/api-contract";
import type { Permission } from "@loyaltyos/permissions";
import type { z } from "zod";

/**
 * A tool's contract with the API. Every MCP tool must register one; the
 * contract test resolves `method + path` against the shared route manifest and
 * verifies the declared permission and request schema match, so a tool can
 * never silently target a route the API does not expose or send a field the API
 * ignores.
 */
export interface ToolContract {
  name: string;
  method: HttpMethod;
  path: string;
  permission: Permission;
  /** Full tool argument schema (path params + body/query fields). */
  inputSchema: z.ZodType<unknown>;
  /** The API body/query schema the tool's non-path arguments must match. */
  requestSchema?: z.ZodType<unknown>;
  /** Tool argument names that are URL path params, not request fields. */
  pathParams?: string[];
}

const registry: ToolContract[] = [];

export function registerContract(contract: ToolContract): void {
  registry.push(contract);
}

export function getContracts(): readonly ToolContract[] {
  return registry;
}

export function clearContracts(): void {
  registry.length = 0;
}
